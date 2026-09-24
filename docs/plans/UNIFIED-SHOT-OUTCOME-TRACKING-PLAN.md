# Unified Shot-Outcome Tracking (replaces separate Goal/Shot/Save entry)

Status: Draft — ready for architecture review
Date: 2026-09-24
Risk tier: **Tier 2** (stated explicitly per the orchestrating thread's instruction, not re-derived from `classify:risk-tier`, which only reports Tier 0 pre-implementation because no diff exists yet). Reasons: touches `amplify/data/resource.ts` (schema change to `Shot` + `submitStatEvent`'s arguments) and `amplify/functions/submit-stat-event/**` (Lambda logic change to the app's only unauthenticated write path) — both on the dev-pipeline skill's hardcoded Tier-2 path list. It also changes the idempotency/dedup contract of a guest-writable Lambda, which is a security/data-integrity-relevant change in its own right.

## Background / resolved design (not up for relitigation)

Today `Goal`, `Shot`, `Save` are three independent models with three independent entry points (coach-side: `GoalTracker.tsx` + `ShotSaveTracker.tsx`, switched by `StatsSubViewTabs.tsx`'s Goals/Shots/Saves segmented control; helper-side: `StatTrackerView.tsx`'s 3-way GOAL/SHOT/SAVE tap grid + `submitStatEvent`). A coach or helper has to remember, unprompted, to log correlated events (tap Shot AND Goal for a shot that scores). No production `Shot` rows exist yet, so `Shot`'s shape is free to change with zero migration concern; `Goal` and `Save` have real historical data and are **not** changing shape.

Replacement design (already agreed with the user):
- Exactly **two entry points**: "Log Shot – Us" / "Log Shot – Them" (mirrors the existing `btn-stat-us`/`btn-stat-opponent` pattern).
- "Us": pick shooter (skippable) → pick outcome (**Goal / Saved / Blocked / Wide**) → if Goal, optional assist picker; if Saved, no keeper attribution possible (no opponent roster) — plain confirm.
- "Them": no shooter step → pick outcome → if Saved, auto-prefill the current on-field goalkeeper (reuse `getCurrentGoalkeeperId`/`computeActiveGoalkeeperId`, don't reimplement), overridable via the existing "pick another keeper" escape hatch.
- One submission writes whatever combination of records the outcome implies:
  - **Every outcome always writes a `Shot` row** (attributed to the shooter when "Us" and known).
  - **Goal** also writes a `Goal` row (scorer/assist only on the "Us" side).
  - **Saved** also writes a `Save` row (keeper attribution only when "Them" shot + our keeper saved it).
  - **Blocked**/**Wide** write only the `Shot` row.
- Identical outcome→records mapping on both surfaces (coach live-game screen and the public `/track/:token` helper page + `submitStatEvent`).
- `Shot.onTarget: boolean` → `Shot.outcome: a.enum(['GOAL','SAVED','BLOCKED','WIDE'])`. `Goal`/`Save` shapes unchanged.
- **Decision (per the user's own lean, confirmed here, no concrete need found to override it): no new FK between `Shot` and `Goal`/`Save`.** They remain unlinked siblings written together atomically from one user action, exactly as today. See "Accepted risk: sibling drift" below for what this costs.

## Critical technical risk this plan must solve explicitly (flagged per the task's own ask)

`submitStatEvent` now writes **up to two** records per invocation (`Shot` always, plus `Goal` or `Save` conditionally) through two independent AppSync mutations — there is no multi-table transaction available to it (it must stay on `generateClient<Schema>({ authMode: 'iam' })`, not raw DynamoDB SDK, so the coach's `observeQuery` subscription still fires — CLAUDE.md's standing constraint). If the first write (`Shot`) succeeds and the second (`Goal`/`Save`) throws, the existing dedup pattern's blanket "release the claim on any throw" behavior would let a client retry with the same `clientEventId` re-run the **entire** pipeline from scratch — re-writing a **duplicate `Shot` row**. This is a real, not theoretical, regression risk introduced by going from 1 write to 2, and is called out explicitly below rather than solved by a copy-paste of the existing single-write dedup code.

### Recommended design: resumable dedup state (no new unverified Amplify assumption)

Extend the existing dedup row (still stored in the `FanViewRateLimit` table, same `{limiterKey: 'dedup#<clientEventId>', minuteBucket: 'dedup'}` identifier and ~10-minute TTL) with a third status and a small persisted write-context:

- `status: 'pending' | 'shot-written' | 'succeeded'` (was `'pending' | 'succeeded'`).
- On first claim (`status` didn't exist → claimed 'pending'): run the full validate → select-game → validate-players pipeline, then create `Shot`.
  - If `outcome` is `BLOCKED`/`WIDE` (nothing more to write): mark `succeeded`, done — identical shape to today's single-write case.
  - If `outcome` is `GOAL`/`SAVED`: **before** attempting the second write, persist a `writeContext` (gameId, gameSeconds, half, timestamp, coaches, outcome, forUs, playerId, assistPlayerId, keeperPlayerId — i.e. everything needed to write the `Goal`/`Save` row without re-deriving it) onto the dedup row and set `status: 'shot-written'`. Then attempt the `Goal`/`Save` write.
    - Success → mark `succeeded`, return `{ok:true}` (unchanged shape).
    - Throw → **do not release/delete the dedup row** (this is the one deviation from today's outer catch-all "release on any throw"). Propagate a distinguishable error (e.g. a `PartialWriteError` the outer handler's catch specifically recognizes to skip `releaseDedupRow`) so the row stays at `shot-written`, bounded by the same TTL as before.
- On a later claim attempt finding `status === 'shot-written'`: **resume** — skip validation/selection/`Shot`-write entirely (already done), reconstruct the `Goal`/`Save` create call from the persisted `writeContext`, and attempt only that. This deliberately does **not** re-check `GAME_NOT_LIVE`/`GAME_CHANGED`/roster-membership against current game state — those were already satisfied by the original attempt, and re-validating against a game that has since moved on (paused, halftime, completed) must not permanently orphan an already-committed `Shot` row. On success, mark `succeeded`; on throw, leave at `shot-written` again (still resumable until TTL).
- `status === 'pending'` on a claim attempt still means "a genuinely concurrent, same-instant request is mid-flight" → `concurrent-duplicate`, unchanged.

This requires no assumption about Amplify's exact conditional-create-on-client-supplied-id error surface (an alternative, simpler "deterministic clientEventId-derived id + create-then-get-on-error" design was considered and rejected as the primary recommendation *specifically because* it depends on an unverified Amplify Gen2 behavior with no in-repo precedent — a `git grep` for `.create({ id:` found zero existing call sites in this codebase. If the coding agent wants to pursue that simpler design instead, it must run a real validation spike against a deployed sandbox first, per this repo's own precedent for exactly this class of assumption — see the schema file's trailing comment on the original IAM-write mechanism's spike). **Architecture review should confirm this resumable-state design (or approve an alternative) before implementation** — it is the single highest-complexity, highest-risk piece of this change.

Bounded accepted gap: if a helper's connectivity never recovers and no retry ever lands, a `Shot` row can permanently exist with no matching `Goal`/`Save` sibling once the dedup row's TTL expires. This is a data-quality nuisance visible (and correctable) in the coach's own Shots list, not corruption — same category of gap as the "Accepted risk: sibling drift" section below, not a new class of problem.

### Coach-side (authenticated) path gets a lighter-weight treatment

`useOfflineMutations.ts`'s `createShot`/`createGoal`/`createSave` are independent, separately-queued mutations (each goes through its own `enqueueOrRun` call) — if offline, both a `createShot` and a follow-on `createGoal`/`createSave` call get queued and flushed independently by the existing offline-queue retry logic, which already tolerates one succeeding before the other. The realistic failure mode (an authenticated, non-guest write to the coach's own AppSync API, immediately visible to the coach who has full Edit/Delete affordances on both `Shot` and `Goal`/`Save`) does not warrant the same resumable-state machinery as the anonymous, no-UI-recourse helper path. Plan: sequence `mutations.createShot(...)` then, if applicable, `mutations.createGoal(...)`/`mutations.createSave(...)`; if the first throws, surface the existing generic failure message and stop (nothing written); if the first succeeds but the second throws, catch that specifically and show *"Shot logged, but the additional Goal/Save details failed to save — check the Shots list and log it manually if needed"* so the coach knows exactly what state things are in rather than a generic error. This asymmetry (helper gets server-side idempotency machinery; coach gets a clear manual-recovery message) is intentional and should be called out to whoever reviews this, not silently inconsistent.

## Accepted risk: sibling drift (no FK, by design)

Because `Shot`/`Goal`/`Save` stay unlinked siblings, any independent edit or delete on one side can now visibly diverge from the shot-outcome story that created it — e.g. deleting a `Goal` row leaves a `Shot` row with `outcome: 'GOAL'` and no backing `Goal`; editing a `Shot`'s shooter doesn't update a same-event `Goal.scorerId` or vice versa. This already existed in a smaller form today (two independent taps could already go out of sync); unifying entry widens the surface where it's *expected* the two move together, without actually enforcing it. Given the explicit user direction to lean away from adding a new relationship absent a concrete need, and that a coach retains full visibility/Edit/Delete on every affected list to manually reconcile a mismatch, this plan accepts the drift rather than building cross-model cascade logic. One concrete guardrail is still worth keeping (cheap, closes the worst case): **the Shot edit modal's outcome control, if kept, should only offer `BLOCKED`/`WIDE`** — not `GOAL`/`SAVED` — so a plain field edit can never make a Shot claim an outcome that has zero chance of a backing `Goal`/`Save` row anywhere. Correcting a genuinely wrong Goal/Saved outcome should be delete-and-relog through the unified entry flow, not an in-place outcome edit. Flagging this explicitly for architecture/UI review to push back on if they disagree with the tradeoff.

## Schema change (`amplify/data/resource.ts`)

`Shot` model (currently lines ~389–404):
```ts
Shot: a
  .model({
    gameId: a.id().required(),
    game: a.belongsTo('Game', 'gameId'),
    playerId: a.id(),
    player: a.belongsTo('Player', 'playerId'),
    takenByUs: a.boolean().required(),
    // Replaces onTarget: a.boolean().required(). No production Shot rows
    // exist (confirmed), so no back-compat/migration path is needed --
    // unlike loggedVia, there is no "absent means X" fallback to write
    // anywhere for this field. a.enum() can't be .required() at the schema
    // level (same DynamoDB-side constraint as Goal.loggedVia) -- enforced
    // instead via ShotCreateFields's required TS field, same established
    // pattern. "On target" is now `outcome IN ('GOAL', 'SAVED')` rather than
    // a raw boolean -- see scripts/queries/offense-by-position.sql.
    outcome: a.enum(['GOAL', 'SAVED', 'BLOCKED', 'WIDE']),
    gameSeconds: a.integer().required(),
    half: a.integer().required(),
    timestamp: a.datetime().required(),
    loggedVia: a.enum(['COACH', 'HELPER']),
    coaches: a.string().array(),
  })
  .secondaryIndexes((index) => [index('gameId').queryField('listShotsByGameId')])
  .authorization((allow) => [allow.ownersDefinedIn('coaches')]),
```

`submitStatEvent` mutation arguments (currently lines ~1046–1075): drop `eventType` (the 3-way GOAL/SHOT/SAVE choice is gone) and `onTarget`; add `outcome: a.string().required()` (validated against the 4-value allowlist in the handler — same "string arg + handler-side allowlist validation" precedent the existing `eventType` arg already used, not `a.enum()` at the arg level) and `keeperPlayerId: a.string()` (our keeper attribution, "Them" + `SAVED` only — new, since `playerId` stays reserved for shooter/scorer attribution on the "Us" side and the two must not be conflated). Update the surrounding doc comments (they currently describe the GOAL/SHOT/SAVE/onTarget shape by name).

`Goal`/`Save` models: **no changes**.

## New shared pure module (mirrors the `gameClock.ts`/`goalkeeper.ts`/`score.ts` pattern)

The "outcome → which records to write, with what values" mapping is exactly the kind of logic CLAUDE.md says must be a single pure module with a Lambda-side twin (a Lambda can't import from `src/`):

- `src/utils/shotOutcomeMapping.ts` (new, coach-side):
  ```ts
  export type ShotOutcome = 'GOAL' | 'SAVED' | 'BLOCKED' | 'WIDE';
  export interface ShotOutcomeInput {
    forUs: boolean;
    outcome: ShotOutcome;
    playerId?: string | null;       // shooter ("Us" only) -- also becomes Goal.scorerId on GOAL
    assistPlayerId?: string | null; // "Us" + GOAL only
    keeperPlayerId?: string | null; // "Them" + SAVED only -- our keeper
  }
  export interface DerivedShotWrites {
    shot: { takenByUs: boolean; outcome: ShotOutcome; playerId: string | null };
    goal: { scoredByUs: boolean; scorerId: string | null; assistId: string | null } | null;
    save: { byUs: boolean; playerId: string | null } | null;
  }
  export function deriveShotOutcomeWrites(input: ShotOutcomeInput): DerivedShotWrites { /* ... */ }
  ```
  Key derivations to get right (verified against `Goal.scoredByUs`/`Save.byUs`'s existing documented semantics):
  - `shot.takenByUs = forUs`; `shot.playerId = forUs ? (playerId ?? null) : null`.
  - `goal` populated iff `outcome === 'GOAL'`: `scoredByUs = forUs` (an "Us" shot that goes in is our goal; a "Them" shot that goes in is their goal — **not** inverted), `scorerId`/`assistId` only when `forUs` (opponent goals carry no scorer, matching today).
  - `save` populated iff `outcome === 'SAVED'`: `byUs = !forUs` — **inverted relative to the shot's own side**, because a "Us" shot being Saved means the *opponent's* keeper made the save (`byUs: false`), and a "Them" shot being Saved means *our* keeper made it (`byUs: true`). `playerId` (keeper) only ever populated on the `!forUs` branch (our keeper), from `keeperPlayerId` — never on the `forUs` branch, since there's no opponent roster to attribute to (matches the background spec's "no keeper attribution is possible" for that direction exactly).
- `amplify/functions/shared/shotOutcome.ts` (new, Lambda-side twin, identical logic, can't import `src/`).
- `amplify/functions/shared/shotOutcome.test.ts` (new, parity test, same format as `goalkeeper.test.ts`: an `it.each` table exercising every `{forUs, outcome, playerId, assistPlayerId, keeperPlayerId}` combination, asserting both modules agree).

Both `submitStatEvent`'s handler and the new coach-side entry component call this instead of re-deriving the branch logic inline.

## File-by-file change list

### Backend / schema
1. **`amplify/data/resource.ts`** — `Shot.outcome` field (replaces `onTarget`); `submitStatEvent` args (drop `eventType`/`onTarget`, add `outcome`/`keeperPlayerId`); updated doc comments. `Goal`/`Save` untouched.
2. **`amplify/functions/shared/shotOutcome.ts`** (new) — pure outcome→writes mapping, Lambda side.
3. **`amplify/functions/shared/shotOutcome.test.ts`** (new) — parity test vs. `src/utils/shotOutcomeMapping.ts`.
4. **`amplify/functions/submit-stat-event/handler.ts`** — the plan's central rework:
   - Remove `VALID_EVENT_TYPES`/`isValidEventType`/`EventType`; add `VALID_OUTCOMES`/`isValidOutcome`/`ShotOutcome` import from the new shared module.
   - `CoreArgs`: drop `eventType`/`onTarget`; add `outcome`, `keeperPlayerId`.
   - Validation: keep the existing `forUs === false` (no `playerId`/`assistPlayerId`) and "assist only on GOAL" and roster-membership checks (reusing `queryRosterPlayerIdsByTeamId`); add `keeperPlayerId` validity (only when `forUs === false && outcome === 'SAVED'`, must be a genuine roster member when supplied).
   - Always create `Shot` (via `deriveShotOutcomeWrites`'s `shot` descriptor); conditionally create `Goal` or `Save` per the `goal`/`save` descriptors.
   - Implement the resumable dedup-state design above: extend `claimDedupRow` (or add a parallel resumable-claim function) to return `'claimed' | 'resume-after-shot' | 'already-succeeded' | 'concurrent-duplicate'`, persist/consume `writeContext`, and introduce the `PartialWriteError`-style signal so the outer handler's catch block skips releasing the row specifically for a post-`Shot`-write failure.
5. **`amplify/functions/submit-stat-event/handler.test.ts`** — substantial rework: replace every `eventType`-keyed test case with `outcome`-keyed ones; add cases for each of the 4 outcomes × 2 sides; add the new `keeperPlayerId` validation cases; add the partial-failure/resume scenario (mock `Shot.create` succeeding and `Goal.create`/`Save.create` throwing, assert a retry with the same `clientEventId` resumes rather than duplicating `Shot`).

### Coach-side (live game screen)
6. **`src/components/GameManagement/GoalTracker.tsx`** — remove the `goal-buttons` entry buttons and the "Goal Recording Modal" (creation only); keep the Goals list, edit modal, and delete flow unchanged.
7. **`src/components/GameManagement/ShotSaveTracker.tsx`** — remove the `stat-buttons` entry buttons and the "Entry Modal" (creation only); keep the Shots/Saves lists, edit modal, and delete flow. Update remaining `onTarget` references (list badge text "On target"/"Off target" → an outcome label; edit-modal dropdown restricted to `BLOCKED`/`WIDE` only, per the "Accepted risk" guardrail above — editing to `GOAL`/`SAVED` is not offered).
8. **`src/components/GameManagement/ShotOutcomeEntry.tsx`** (new) — the two "Log Shot – Us"/"Log Shot – Them" buttons plus the multi-step modal flow (shooter picker → outcome picker → assist picker or keeper-confirm-with-override, mirroring `StatTrackerView.tsx`'s existing `confirmKeeper` pattern for the "Them"+Saved auto-prefill case). On submit: compute `gameSeconds`/`half`/`timestamp` once, call `deriveShotOutcomeWrites`, then `mutations.createShot(...)` followed conditionally by `mutations.createGoal(...)`/`mutations.createSave(...)`, with the partial-failure message described above. Reuses `getCurrentGoalkeeperId`, `isPlayerCurrentlyPlaying`/`isPlayerInLineup` (on-field filtering), and `PlayerSelect` exactly as the components it replaces already do.
9. **`src/components/GameManagement/ShotOutcomeEntry.test.tsx`** (new).
10. **`src/components/GameManagement/GameManagement.tsx`** — mount `<ShotOutcomeEntry {...sharedGoalTrackerProps} />` once per layout (scheduled/in-progress/completed "goals" tab-panel), alongside `StatsSubViewTabs`, independent of which sub-view (`statSubView`) is selected — its buttons apply regardless of which list the coach is currently viewing. Three call sites (currently ~2406-2422, ~2577-2589, ~2676-2693).
11. **`src/components/GameManagement/GoalTracker.test.tsx`** — remove entry/create-modal test cases; keep list/edit/delete cases.
12. **`src/components/GameManagement/ShotSaveTracker.test.tsx`** — remove entry/create-modal test cases; keep list/edit/delete cases; update `onTarget` fixtures to `outcome`.
13. **`src/components/GameManagement/GameManagement.test.tsx`** — verify unaffected (no existing assertions reference `goal-buttons`/`stat-buttons`/button text per a repo grep); touch only if something breaks from the new mount point.

### Shared mutation types
14. **`src/hooks/useOfflineMutations.ts`** — `ShotCreateFields`/`ShotUpdateFields`: replace `onTarget: boolean` with `outcome: 'GOAL' | 'SAVED' | 'BLOCKED' | 'WIDE'` (required on create, matching `loggedVia`'s established required-TS-field-even-though-schema-can't-enforce-it pattern; optional on update, restricted at the UI layer per the guardrail above, not at the type layer — the hook itself shouldn't need to know about that restriction).
15. **`src/hooks/useOfflineMutations.test.ts`** — update `Shot`-related fixtures/assertions from `onTarget` to `outcome`.

### Public helper page
16. **`src/components/FanMode/StatTrackerView.tsx`** — structural rework of the tap flow:
    - Tap grid: 3 targets (Goal/Shot/Save) → 2 targets ("Log Shot – Us"/"Log Shot – Them"); `forUs` is now chosen by which grid button is tapped, not a `side` step inside the sheet.
    - `FlowStep`: `'closed' | 'side' | 'player' | 'confirmKeeper' | 'assist' | 'onTarget' | 'confirm'` → `'closed' | 'player' | 'outcome' | 'confirmKeeper' | 'assist' | 'confirm'` (drop `side`, drop `onTarget`, add `outcome`).
    - "Us" flow: open → `player` (shooter, skippable) → `outcome` (Goal/Saved/Blocked/Wide) → (Goal only) `assist` → `confirm`/submit.
    - "Them" flow: open → `outcome` directly (no shooter step) → (Saved only) `confirmKeeper` (reuse the existing auto-prefill-from-`activeGoalkeeperId` logic, now triggered by "Them"+Saved rather than the old "Us"+Save-eventType condition) → `confirm`/submit; (Goal/Blocked/Wide) straight to `confirm`/submit.
    - `submit()`'s payload to `submitStatEvent`: replace `eventType`/`onTarget` with `outcome`; add `keeperPlayerId` (sent only on the "Them"+Saved path, from the same `flow.playerId` state slot the `confirmKeeper` step already populates — reusing that slot for both "Us" shooter and "Them" keeper is fine since they're mutually exclusive per-flow, but rename the `FlowState` field or add a comment clarifying the dual use).
17. **`src/components/FanMode/StatTrackerView.test.tsx`** — substantial rework mirroring the above; add cases for each of the 4 outcomes on both sides, and the "Them"+Saved auto-prefill/override path.

### Test fixtures elsewhere
18. **`src/components/GameManagement/hooks/useGameSubscriptions.test.ts`** — update any `Shot` fixture literals from `onTarget` to `outcome` (subscription logic itself is generic/untyped-by-field and needs no code change).

### Analytics / exports (explicitly called out in the task)
19. **`scripts/export-analytics-data.ts`** — `scanAll(config.shotTable, [..., 'takenByUs', 'onTarget', ...])` → `[..., 'takenByUs', 'outcome', ...]`; `writeCsv(..., 'shots.csv', [..., 'takenByUs', 'onTarget', ...], ...)` → same column swap.
20. **`scripts/queries/offense-by-position.sql`** — the `shots_on_target` CTE's filter `WHERE "takenByUs" = true AND "onTarget" = true` → `WHERE "takenByUs" = true AND "outcome" IN ('GOAL', 'SAVED')`; update the file's header comment accordingly.

### Docs (app-wide specs — required, not optional, per this feature removing/changing a user-facing capability and a data-model field)
21. **`README.md`** — Features list: line 43 ("Shot & Save Tracking: Log shots (on/off target) and saves for either team from the same Goals tab, via a Goals/Shots/Saves segmented control...") needs to describe the new two-button unified outcome flow, not the old on/off-target framing. Lines 51-55 (Sideline Stat Tracking section) — line 53's "Goal / Shot / Save tap flow" description and line 55's reference need the same update for the helper page. Line 156 (Data Model summary) — "Shot / Save: Per-shot (on/off target) and per-save stat events" → describe the 4-outcome model.
22. **`docs/ARCHITECTURE.md`** — the `Shot` model section (currently lines 243–254: `onTarget: Boolean` → `outcome`: the 4-value enum, with the "on target" derivation note); line 45's parenthetical listing `submitStatEvent`'s arguments by name (`token/eventType/playerId/etc.`) should drop the now-removed `eventType`.
23. **`docs/specs/UI-SPEC.md`**:
    - §7.4 (Game Management — In Progress State)'s Goals-tab table row (line 399) — currently describes "Shots and Saves each open with an Us/Opponent choice... an 'Us' Shot requires a player..." — needs to describe the new single unified entry point (two buttons, not per-sub-view buttons) and the outcome step; the analogous §7.3/§7.6 gaps (scheduled/completed states don't currently document a Goals-tab row at all) are pre-existing drift, not introduced by this change, and are out of scope here.
    - §7.15 (Sideline Stat Tracker) — the tap-grid description (line 995: "three large targets — Goal / Shot / Save") and the full flow description (lines 996-1003) need a full rewrite for the two-button/outcome-step flow, including the relocated `confirmKeeper` trigger condition ("Them"+Saved, not "Us"+Save-eventType).
    - §13.2 (line 1231, "Shot/Save exception") — "Edit lets the coach re-attribute the player, and for Shot, correct on/off-target" needs to reflect the new outcome field and the Blocked/Wide-only edit restriction from the "Accepted risk" section.
    - Exact wording/placement is left to the UI review stage — this plan identifies which sections go stale and why, not final copy.

### New plan doc
24. **`docs/plans/UNIFIED-SHOT-OUTCOME-TRACKING-PLAN.md`** (this file).

## Data model impact summary

- `Shot`: field replacement (`onTarget: boolean` → `outcome: enum`), no new relationships, no migration needed (zero production rows).
- `Goal`, `Save`: no shape change; new write-time trigger paths only (via the shared mapping module), same fields as today.
- `submitStatEvent`: argument shape change (`eventType`+`onTarget` → `outcome`; new `keeperPlayerId`), and an internal dedup-state-machine change (2 statuses → 3, plus a persisted `writeContext`) — no schema-visible change beyond the mutation's own arguments (the dedup row lives in the existing `FanViewRateLimit` table, already schema-flexible/untyped at the DynamoDB level for this Lambda's own bookkeeping use).
- No changes to `ShareLink`, `FanViewRateLimit`'s *schema declaration*, `getFanGameView`, or `getStatTrackerView`.
- `coaches[]` population: unaffected — every new/changed write path (`ShotOutcomeEntry.tsx`'s `mutations.createShot/createGoal/createSave` calls, and `submitStatEvent`'s Lambda-side creates) already sources `coaches` from `team.coaches` exactly as the code being replaced does today; no new record-creating path introduced that skips this.

## Edge cases (beyond the two flagged above as their own sections)

- **`outcome` is nullable in the generated TypeScript type** even though every new write always populates it (an `a.enum()` field can't be `.required()` at the schema level) — any UI code rendering `shot.outcome` should handle `null`/`undefined` defensively (e.g. "Unknown outcome") rather than assuming one of the 4 values or silently defaulting to a guess; this should be unreachable in practice given zero legacy rows, but must not crash if a row is ever hand-edited via the console.
- **Skipped shooter/keeper on "Us"+Goal**: if a coach/helper skips the shooter picker on a "Us" shot that then resolves to Goal, the resulting `Goal` row has no `scorerId` — identical to today's existing "Us Goal with no scorer selected" case (already handled: `GoalTracker`'s own create-goal validation currently *requires* a scorer for a "Us" goal — `if (goalScoredByUs && !goalScorerId)`. The unified flow's "Us" shooter step should mirror this: since a Goal outcome downstream needs a scorer for score-attribution UX parity, the shooter step should arguably become *required*, not skippable, specifically when the coach later picks Goal — but the background spec says the shooter picker itself is "skippable" up front, before outcome is even known. **Flagging this as a real spec tension for architecture/UI review**: either (a) the shooter step stays skippable and a later "Us"+Goal with no shooter silently produces a scorer-less Goal (a behavior change from today's coach-side validation, though it already matches the *helper*-side `StatTrackerView.tsx`'s existing "every event type's playerId is optional" stance), or (b) the flow prompts for a shooter specifically when outcome turns out to be Goal, closer to today's `GoalTracker` behavior. This plan defaults to (a) for consistency with the resolved "pick shooter (skippable)... then pick outcome" ordering in the background spec, but flags it since it's a real, user-visible behavior change on the coach side (today's `GoalTracker` blocks a scorer-less "Us" goal with a warning toast; the unified flow as specified would not).
- **`GAME_NOT_LIVE`/`GAME_CHANGED` mid-flow on the helper page**: unaffected by this change — those checks still run identically before any write is attempted (or, on a resumed partial-failure, are deliberately skipped per the resumable-state design above).
- **Rate limiting**: unaffected — `checkRateLimits`'s write-dimension ceiling is still consulted once per invocation (inside `runCore`, before any write), regardless of whether that invocation ends up performing 1 or 2 model writes.

## Test strategy

- **Parity test** (new): `amplify/functions/shared/shotOutcome.test.ts` — table-driven, covering all `{forUs, outcome}` combinations plus `playerId`/`assistPlayerId`/`keeperPlayerId` presence/absence permutations, asserting the Lambda and coach-side modules agree, per the `goalkeeper.test.ts` precedent.
- **Lambda unit tests** (`submit-stat-event/handler.test.ts`, reworked): every outcome × side combination's write shape; validation rejections (opponent+player, non-GOAL+assist, wrong-side keeperPlayerId, invalid roster membership for shooter/assist/keeper); the resumed-after-partial-failure scenario (mock first `Shot.create` succeeding then a thrown `Goal.create`/`Save.create`, assert a second invocation with the same `clientEventId` does not re-create `Shot` and does complete the second write); the existing `already-succeeded`/`concurrent-duplicate`/rate-limit/link-validity cases, unchanged in shape.
- **Coach-side component tests**: `GoalTracker.test.tsx`/`ShotSaveTracker.test.tsx` trimmed to list/edit/delete only; new `ShotOutcomeEntry.test.tsx` covering both entry buttons, every outcome branch, the assist-skip case, the keeper auto-prefill + override case, and the partial-failure error message.
- **Helper-page tests**: `StatTrackerView.test.tsx` reworked for the 2-button grid and the new step sequence, including the relocated `confirmKeeper` trigger.
- **Regression coverage to re-run, not just re-read**: `useOfflineMutations.test.ts` (Shot create/update field shape), `useGameSubscriptions.test.ts` (fixture literals only), `GameManagement.test.tsx` (mount-site smoke test), `npm run lint` / `npm run test:run` / `npm run build` via `gate:commit` at the end per the standing rule.
- **No e2e spec currently exercises this flow by name** (not found in a repo search for `goal-buttons`/`stat-buttons`/tracker flow selectors in `e2e/`) — if Stage 5's validation review finds an existing e2e spec depends on the removed 3-tab entry buttons, it must be updated, not skipped; the plan does not assume e2e coverage here beyond what the unit/component tests above provide.

## Open questions for architecture/UI review (not blocking, but should get an explicit answer before/during implementation)

1. Confirm the resumable dedup-state design above (vs. the simpler-but-unverified deterministic-id alternative) before implementation begins.
2. Confirm the "shooter picker stays skippable even when the outcome later turns out to be Goal" behavior change on the coach side (see Edge Cases) is acceptable, or whether the flow should require a shooter once Goal is picked.
3. Confirm the Shot edit-modal outcome restriction (Blocked/Wide only, no GOAL/SAVED) as the chosen guardrail for the no-FK sibling-drift risk.
4. UI review to finalize the exact interaction shape of `ShotOutcomeEntry.tsx`'s modal (immediate-submit-per-tap vs. an explicit final confirm button) and whether the existing 3-tab `StatsSubViewTabs` (Goals/Shots/Saves) still makes sense as the *browsing* structure once "outcome" is a shot-level concept, or whether a UI reshuffle is warranted — this plan keeps the 3 tabs as-is for browsing/editing and only replaces the entry mechanism, but flags this as a real design choice the UI reviewer should weigh in on rather than treat as settled.
