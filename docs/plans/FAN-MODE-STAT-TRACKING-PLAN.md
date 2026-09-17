# Fan Mode + Sideline Stat Tracking Mode

## Context

Coaches currently run games solo through `GameManagement.tsx`, and every collaborator — including a "read-only" parent invitee — ends up with full Cognito-authenticated, coach-level data access (`allow.ownersDefinedIn('coaches')` on every model). Two gaps prompted this feature:

1. **Parents/fans have no lightweight way to follow a live game.** The existing `TeamInvitation` `PARENT` role requires a full Cognito signup and, despite being UI-labeled "read-only," grants unrestricted read/write access once accepted — there's no actual read-only enforcement anywhere in the app.
2. **There's no way to capture shot/save stats, or to offload live stat entry to a non-coaching helper** (parent/assistant) standing on the sideline while the coach focuses on subs and lineup.

Both features need genuinely public access — no Cognito account for the viewer/helper — which is new territory for this app: `defineData` today has only `defaultAuthorizationMode: "userPool"` (confirmed `amplify/data/resource.ts:744-749`, zero `allow.guest()`/`allow.publicApiKey()` anywhere in the schema), and `src/main.tsx` gates the whole app behind `authStatus === 'authenticated'`. The team has already been burned by underscoping exactly this kind of exposure once — see the `CalendarFeed` model's hardening comment (`amplify/data/resource.ts:586-594`), added after an architecture review found the first draft let "a caller who knows a teamId... plant a row the real coaches couldn't see or remove." This plan follows that same hardened pattern deliberately.

**Confirmed product decisions** (from user Q&A):
- Fan Mode: live score/clock/lineup/events, via **one persistent public link per team** (no login).
- Stat Tracking: **Goals, Assists, Shots (on/off target), Saves** — logged by a **non-coach helper via a public link with write access** (no login).
- New event data lives in **new linked models**, additive to `Game`/`PlayTimeRecord`/`Substitution`.

**This plan has been through four rounds of independent review.** Round 1 (informal, pre-branch) caught: a nested-`BrowserRouter` crash in the original routing sketch, and a critical gap where Lambda→DynamoDB-SDK writes never fire AppSync subscriptions, verified against the exact same hazard already hit and documented in this codebase at `src/components/Home.tsx:135-145`. Round 2 (formal `architect-reviewer` + `ui-reviewer` passes, on this branch) caught: two build-breaking gaps in Milestone A's data model (missing reciprocal `hasMany` relations; an incomplete file list that omitted `useOfflineMutations.ts`/`useGameSubscriptions.ts`), a `Save`/`Shot` data-model naming/completeness gap, a measured tab-bar-width regression from the originally-proposed 6th tab, a missing duplicate-tap guard for the public write flow, an incorrect claim about where the game-clock formula lives, and several documentation-completeness gaps — `ui-reviewer` then re-checked the corrected segmented-sub-view approach specifically and cleared Milestone A to proceed to `coding-agent`. After that clearance, an explicit **Us/Opponent choice** was added to every Goal/Shot/Save tap flow (both the coach-side `ShotSaveTracker` and the public `StatTrackerView`) — `Shot.takenByUs`/`Save.byUs`/`Goal.scoredByUs` all exist specifically so a shot or save can be logged for either side, and the original UI descriptions hadn't surfaced that in the tap flow. Round 4 (two more independent full-plan validations against the fully-revised plan, including that Us/Opponent addition) found one real Milestone-A blocker — the segmented-control fix only covered one of the three places `GoalTracker` actually renders, leaving the completed-game view with no way to log Shots/Saves at all — plus several consistency/documentation gaps, all folded in. **Milestone A was then implemented, reviewed (validation/security/UI, in parallel, against the actual diff — no Critical/Major findings), and committed.** Round 5 was Milestone B1's first dedicated `architect-reviewer` + `ui-reviewer` pass (B1 had only had opportunistic findings folded in before this) — it caught two real bugs that would have shipped silently (a missing `Suspense` boundary that crashes the app's cold load; a rate limiter keyed in a way that throttles out most of a live game's actual audience within the first two minutes), a game-selection algorithm that would surface a future scheduled game instead of today's just-finished one for any team using Calendar Feed Import, a guest/authenticated Identity-Pool role mismatch that would `AccessDenied` a coach opening their own link, and several other Major/Minor findings — all folded into Milestone B1 below. **Milestone B1 was then implemented, reviewed (validation/security/UI in parallel against the actual diff — security independently verified the guest-auth IAM scoping against a real local CDK synth; two more real bugs were caught post-implementation, both fixed: a transient poll error overwriting a valid live view with "invalid link," and a missing page-level heading on the live state), and committed.** Round 6 was Milestone B2's first dedicated `architect-reviewer` + `ui-reviewer` pass, run once A and B1 were real, shipped code rather than plans — it found B2's text had gone stale in several places against what B1 actually built (a `getStatTrackerView` query referenced but never specified; `submitStatEvent` still `allow.guest()`-only against B1's established dual-role pattern; a second, incompatible rate-limit table where B1's `FanViewRateLimit` should be reused; no UI step for a mutation argument the plan itself required), a live-game-selection race that could write a helper's taps to the wrong game with no way to notice, and — the most consequential finding — that the AppSync-write mechanism this milestone's core fix depends on has **zero precedent anywhere in this repo and was previously evaluated and explicitly rejected** for exactly that reason (`docs/plans/TEAM-ARCHIVE-STEP11-GAME-CREATE-CONVERSION-PART1.md`, "Decision 0"); B2 is a legitimate case where the tradeoff flips, but the plan now requires a small validation spike with a named fallback before the rest of the milestone is built on it, rather than proceeding on faith. All findings across all six rounds are folded in; the design decisions and file paths reflect the corrected version.

## Key existing precedents to reuse (not reinvent)

- **`Goal` model** (`amplify/data/resource.ts:318-335`) is the template shape for a per-event game stat (`gameId`, `gameSeconds`, `half`, optional player refs, `timestamp`, `coaches[]`) — template for new `Shot`/`Save` models.
- **`Game.goals: a.hasMany('Goal','gameId')`** (`resource.ts:182`) and **`Player.goalsScored`/`Player.assists`** (`resource.ts:122-123`) — this codebase declares **both sides** of every relationship; Gen2 rejects a one-sided `belongsTo` at schema-build time. New `Shot`/`Save` models need the same reciprocal `hasMany` treatment (see Milestone A below) — this was missed in the first draft and would have failed `npm run build` on the first commit.
- **`CalendarFeed` model** (`amplify/data/resource.ts:595-601`) is the template for any model reachable by a non-coach: `allow.authenticated().to([])` (or `allow.guest().to([])`) — **zero direct client grants**, all access via Lambda IAM.
- **`BugReportRateLimit` model** (`amplify/data/resource.ts:432-443`, keyed `[userId, hourBucket]`, DynamoDB TTL) is the template for rate-limiting.
- **`createGameSafe`/`deleteGameSafe`/`archiveTeam`** Lambda-mutation pattern — authenticated custom mutations that do their own authorization check inside the handler — template for coach-side "generate/revoke share link" mutations. `createGameSafe` also has an archived-team guard (`amplify/data/resource.ts:568-572`) the new coach-side mutations should mirror.
- **`CalendarSyncResult`-style custom type** (`amplify/data/resource.ts:603-654`) is precedent for returning a curated custom type instead of `a.ref('Game')`/`a.ref('Team')` from a query — this codebase already hit and solved "cannot `.ref()` a model from a custom type" here, and already paid the cost of getting model-vs-custom-type returns wrong (at deploy time, not `tsc`/test time). Any operation whose model has zero client grants (like `ShareLink`) must return a custom type for the same reason — see Milestone B1.
- **`coachArraySync.ts`** (`amplify/functions/shared/coachArraySync.ts:126-160`) is the in-repo precedent for a Lambda querying a GSI by its **physical** index name (not its GraphQL `queryField` name) via the raw DynamoDB SDK, including the "confirmed index name" evidence standard (inspecting `.amplify/artifacts/cdk.out`). Any lifecycle-cascade handler using `QueryCommand` against a new `gameId` GSI needs this same pattern, not the GraphQL `queryField`.
- Score is **derived, not stored, during play**: `GoalTracker.tsx:87-93,145-153` shows `ourScore`/`opponentScore` are computed live from `Goal` records and only written back to `Game` at completion-time reconciliation.
- **Lambda writes via the DynamoDB SDK do not fire AppSync subscriptions** — this is a known, previously-hit, already-documented hazard in this exact codebase (`src/components/Home.tsx:135-145`, referencing `docs/plans/TEAM-ARCHIVE-STEP11-GAME-CREATE-CONVERSION-PART1.md` Decision 0/3). Any new Lambda write that a coach's live screen needs to see in real time must go through AppSync (IAM-signed), not a raw `PutCommand`.
- **`LineupPanel.tsx`'s `pendingRemovalIds` pattern** (`LineupPanel.tsx:71-132`, added in PR #172) — a client-side "in flight" id set that hides/disables a just-tapped item immediately, before its mutation round-trips back through the subscription, specifically to stop a user from re-tapping something that already fired. This is the direct precedent for the duplicate-tap guard the public Stat Tracker page needs (see Milestone B2) — arguably more urgently there, since an unauthenticated helper has no other way to confirm a tap landed.
- `isReadOnly` props exist on `LineupPanel.tsx`, `PlannerLineupView.tsx`, `PreGameNotesPanel.tsx`, `shape/LineupShapeView.tsx` — **not directly reused here**: those components are typed against coach-scoped model shapes that the curated Fan Mode payload won't satisfy, so Fan Mode gets new standalone read-only components instead. Noted explicitly so a future reviewer doesn't re-ask.

## Recommended phasing

Three milestones, each its own full `dev-pipeline` cycle (squarely "Larger: 3+ files, architecture/security-relevant" per CLAUDE.md):

- **Milestone A — Stats data model + coach-only UI.** New `Shot`/`Save` models, `loggedVia` field on `Goal`/`Shot`/`Save`, a new tab in `GameManagement.tsx` for the coach to log them directly. Stays entirely inside the existing `ownersDefinedIn('coaches')` pattern.
- **Milestone B1 — Fan Mode (public read only).** `ShareLink` model, the 3 authenticated coach-side link-management mutations, `getFanGameView`, the routing restructure, the Fan Mode page. This lands the guest-auth mechanism and the routing change with **zero unauthenticated write exposure** — if the guest IAM scoping turns out wrong, the blast radius is a curated read payload, not a write into game records.
- **Milestone B2 — Sideline Stat Tracker (public write).** `ShareLinkRateLimit`, `submitStatEvent` (writing through AppSync, not raw DynamoDB, per the subscription finding above), the Stat Tracker page. This is the first unauthenticated write path in the app's history — it gets its own review cycle rather than riding along with Fan Mode.

---

## Milestone A — Stat models + coach UI

### Data model (`amplify/data/resource.ts`)

```ts
Shot: a.model({
  gameId: a.id().required(),
  game: a.belongsTo('Game', 'gameId'),
  playerId: a.id(),
  player: a.belongsTo('Player', 'playerId'),
  takenByUs: a.boolean().required(),   // renamed from an earlier `scoredByUs` draft — a shot
                                        // isn't "scored"; this reads correctly next to
                                        // Goal.scoredByUs and Save.byUs (below) instead of
                                        // colliding in meaning with either.
  onTarget: a.boolean().required(),
  gameSeconds: a.integer().required(),
  half: a.integer().required(),
  timestamp: a.datetime().required(),
  loggedVia: a.enum(['COACH', 'HELPER']),   // absent/undefined == COACH (legacy-safe default)
  coaches: a.string().array(),
})
  .secondaryIndexes((index) => [index('gameId').queryField('listShotsByGameId')])
  .authorization((allow) => [allow.ownersDefinedIn('coaches')]),

Save: a.model({
  gameId: a.id().required(),
  game: a.belongsTo('Game', 'gameId'),
  playerId: a.id(),           // goalkeeper, when known
  player: a.belongsTo('Player', 'playerId'),
  byUs: a.boolean().required(),   // symmetric with Shot.takenByUs — without this, "our keeper
                                   // saved a shot" and "the opponent's keeper saved our shot"
                                   // are indistinguishable, which breaks any season-report
                                   // split of saves-for vs. saves-against. `playerId` stays
                                   // optional (a save can be logged before anyone identifies
                                   // the keeper), but `byUs` is always required.
  gameSeconds: a.integer().required(),
  half: a.integer().required(),
  timestamp: a.datetime().required(),
  loggedVia: a.enum(['COACH', 'HELPER']),
  coaches: a.string().array(),
})
  .secondaryIndexes((index) => [index('gameId').queryField('listSavesByGameId')])
  .authorization((allow) => [allow.ownersDefinedIn('coaches')]),
```

**Reciprocal relationships — required, not optional.** Add to the existing `Game` model: `shots: a.hasMany('Shot', 'gameId')`, `saves: a.hasMany('Save', 'gameId')` (alongside its existing `goals: a.hasMany('Goal', 'gameId')` at `resource.ts:182`). Add to the existing `Player` model: `shots: a.hasMany('Shot', 'playerId')`, `saves: a.hasMany('Save', 'playerId')` (alongside its existing `goalsScored`/`assists` at `resource.ts:122-123`). Without these, Gen2 rejects the one-sided `belongsTo` at schema-build time and `npm run build` fails on the first commit.

Add `loggedVia: a.enum(['COACH', 'HELPER'])` to `Goal` too. **Contract**: `a.enum()` can't be `.required()` at the schema level (see existing precedent/comment at `resource.ts:344`), but that's a DynamoDB-side constraint, not a TypeScript one — make `loggedVia` a **required** field on `GoalCreateFields`/`ShotCreateFields`/`SaveCreateFields` (`useOfflineMutations.ts`, see Frontend below) so every write path is forced to pass it explicitly at compile time, rather than relying on discipline. This means `GoalTracker.tsx:75-85`'s existing `createGoal` call needs a one-line update to pass `loggedVia: 'COACH'` alongside its other fields — add this to the Frontend file list below. A record with the field unset/absent in the database (i.e. any row written before this milestone) is still treated as `COACH` everywhere it's read (UI badge logic, any future filtering) — the required-field constraint governs new writes, not historical rows.

**Also add `index('gameId').queryField('listGoalsByGameId')` to `Goal`** — to be precise about what's actually missing: Amplify already auto-creates an implicit relationship GSI for `belongsTo('Game','gameId')` (the pattern `coachArraySync.ts:126-139` documents), so `Goal` isn't *indexless* today, it has no **queryField** to reach that index from a Lambda without a GraphQL client. Adding an explicit named index gives `delete-game-safe` a `QueryCommand`-reachable physical index instead of its current `scanAll(goalTable, ...)` (`handler.ts:142`) — this yields two `gameId`-keyed GSIs on the table, which is the same shape `PlayTimeRecord` already has (`resource.ts:311-323`) and is a normal, low-cost DynamoDB pattern, not a design smell. **State explicitly in this milestone's implementation**: yes, `delete-game-safe`'s existing `scanAll` for goals is being converted to the new indexed query (not left as-is) — and because the GSI backfills asynchronously on an already-populated `Goal` table, a delete that runs during that backfill window could miss a very recently created row the old scan would have caught. Accept this as a one-time, narrow-window migration tradeoff (call it out in the PR description), not a permanent behavior change — the same GSI-propagation-lag tradeoff already accepted for `Shot`/`Save` below applies identically here once the index is live.

**Known gap this milestone introduces (record it here, since these tables start existing here, even though it isn't fully addressed until later):** `accept-invitation`'s `coaches[]` backfill covers `Team`/`TeamRoster`/`Player`/`Formation`/`FormationPosition`/`Game` only, not `Goal` — a co-coach accepting an invitation after a game can't see its goals. `Shot`/`Save` inherit the same gap the moment they exist. Likewise `revoke-coach-access` cascades five tables, not `Goal` — a revoked coach retains read access to `Goal` rows, and will to `Shot`/`Save`. Not fixed by this plan (pre-existing, unrelated scope), but flagged here rather than left to be re-discovered later.

### Lifecycle wiring (do not skip — these tables don't exist yet, but the moment they do, every place that currently cascades `Goal` needs the same treatment)

- `amplify/functions/delete-game-safe/handler.ts` — add `Shot`/`Save` to the `Promise.all([...scanAll/query...])` block (~line 140) and the delete loops (~line 166). This handler uses the raw DynamoDB SDK with no GraphQL client, so it **cannot** call the `listGoalsByGameId`/`listShotsByGameId`/`listSavesByGameId` GraphQL `queryField`s directly — it needs `QueryCommand` against the GSI's **physical** name, resolved the same way `coachArraySync.ts:126-160` already does (inspect `.amplify/artifacts/cdk.out` to confirm the synthesized index name, same evidence standard used elsewhere in this repo). Note as an accepted tradeoff: a GSI read has higher propagation lag than a table scan, so a game deleted within seconds of a goal being logged could theoretically miss it where the old scan wouldn't — acceptable, but state it rather than let it be a silent behavior change.
- `amplify/functions/delete-team-safe/` and `amplify/functions/delete-player-safe/` — both already cascade `Goal` (`amplify/backend.ts:287,313`); add `Shot`/`Save` alongside, plus the matching table grants and `*_TABLE` env vars in `amplify/backend.ts`, plus entries in each handler's rollback-snapshot stack.
- `src/utils/e2eCleanup.ts:14-17` — add `'Shot'`, `'Save'` to the cleanup model list so E2E runs don't leak rows.

### Frontend

- **No new top-level tab.** `TabNav.tsx` currently ships 5 tabs at `flex: 0 0 auto; min-width: 90px` below the 600px breakpoint (`App.css:6279-6305`) — 5×90px already exceeds a 375px viewport (the tab bar already horizontally scrolls today, by design — see the fade-gradient/scrollbar rules at `App.css:6330-6343`). A 6th tab would push total width ~44% past viewport, landing "Stats" almost entirely off-screen — directly against UI-SPEC §1's "sideline-first, glanceable" principles for the one screen where that matters most. Instead: add a **segmented control** (Goals / Shots / Saves) wherever `GoalTracker` renders, reusing the tablist/pill interaction and `aria-selected`/arrow-key semantics UI-SPEC §7.7 already specifies for the Game Planner timeline (its `planner-timeline-pill` sizing comfortably fits 3 segments inside 375px — verified against `App.css:7412-7476`). `GoalTracker.tsx` keeps owning the Goals sub-view; `ShotSaveTracker.tsx` (new) owns Shots and Saves, selected by the same segmented control. Two small decisions to pin down rather than leave to improvisation: (1) whether the label stays "Goals" or becomes "Stats" now that it can show Shots/Saves too — a pure text change either way, no width cost; (2) the segmented control needs its own distinguishing `aria-label` (e.g. `"Goals sub-view"`) so it doesn't collide with the outer `TabNav`'s existing `aria-label="Game management tabs"` (`TabNav.tsx:63`) for a screen-reader user landmark-navigating the page.
- **`GoalTracker` renders in three places in `GameManagement.tsx`, not one — the segmented control needs to go everywhere it does. Get the mapping right; an earlier draft of this paragraph didn't.** Verified directly against the state blocks, not just the call sites: `GameManagement.tsx:2405` is inside the **`scheduled` (pregame) block's** `goals` tabpanel (`gameState.status === 'scheduled'`, `:2241`) — `GoalTracker.tsx:164` has its own internal guard that renders nothing while `status === 'scheduled'`, so this mount exists but is currently a no-op. `:2562` is inside the **`in-progress` block's** `goals` tabpanel (`:2433`) — this is the fully-functional one. `:2652` is the **completed-game layout** (`gameState.status === 'completed'`, `:2637`) — not inside any tab at all; `.completed-layout` renders `CompletedPlayTimeSummary` → `CompletedGameTimeline` → `GoalTracker` → `PreGameNotesPanel` as a flat stack of standalone sections, so a segmented control scoped to "inside the Goals tab" literally cannot appear there. **The `halftime` block (`:2580-2634`) has no `GoalTracker` mount at all** — it renders only `GameTimer`, `LineupPanel`, and three action buttons (Manage Injuries, Add note, Start Second Half); this is today's existing behavior for `Goal` itself, not a gap this plan introduces.
  - This matters concretely for the completed site: Milestone B2's correction path for helper mistakes ("the coach corrects mistakes via the Milestone A `ShotSaveTracker`/existing `GoalTracker` edit UI") depends on the coach being able to reach Shots/Saves on a **completed** game, which is exactly when most of that review happens.
  - **Required**: `ShotSaveTracker` mirrors `GoalTracker`'s exact mount footprint — the segmented control (or, in the completed layout specifically, an equivalent same-pattern standalone section header, since there's no tab context to nest inside) renders at the same three sites `GoalTracker` does (scheduled, in-progress, completed), with the same internal no-op-while-`scheduled` guard `GoalTracker.tsx:164` already has, and **is explicitly not mounted during halftime** — consistent with `Goal`'s own current behavior, not a new limitation. The active-sub-view state should live on the shared props object both `GoalTracker` and `ShotSaveTracker` already take (`sharedGoalTrackerProps`, `GameManagement.tsx:2151`) rather than independent local states that could drift out of sync per layout.
- `ShotSaveTracker.tsx` — same interaction shape as `GoalTracker.tsx`: modal-driven create, `GameActionRow`/`actionContract` for edit/delete, explicitly sets `loggedVia: 'COACH'` on every write. **Every entry starts with an Us/Opponent choice** — but concretely, that means *matching `GoalTracker.tsx`'s actual existing pattern*, not inventing a new one: `GoalTracker.tsx` doesn't ask inside a modal, it has two entry buttons (`.goal-buttons`, `GoalTracker.tsx:166-171`, styled at `App.css:3295`) — e.g. "Log Goal — Riverside Rovers" / "Log Goal — Lakeside FC" — and the modal that opens already knows which side was picked. `ShotSaveTracker.tsx` should mirror this exact two-button-per-sub-view shape (distinct from the public `StatTrackerView`'s own sheet-based per-tap question in Milestone B2, which is a different page with a different interaction model and stays as designed there). Selecting "Us" proceeds to our player picker as normal; selecting "Opponent" skips the player picker entirely and logs an aggregate event with no `playerId` — this app doesn't track an opposing roster, so an opponent shot/save is a count, not an attributed one. **Edit-modal semantics, decided rather than left open**: unlike `Goal`, neither `Shot` nor `Save` carries a `notes` field (`resource.ts:339` is `Goal`-only), so an opponent-attributed `Save` row would have zero editable fields once created if treated like `Goal`'s edit modal. Rather than bolt a `notes` field onto both models purely for edit-symmetry, **suppress the Edit action on opponent-attributed rows and keep Delete** — an opponent event has nothing meaningful to edit by design (no player, no assist, no notes), so offering an edit modal with nothing in it is worse than not offering one. **An "Us" `Shot` requires a player**, mirroring `Goal`'s required-scorer validation (`GoalTracker.tsx:69-72,118-121`) — a shot logged in the moment without a shooter is a materially weaker signal than a `Save` logged before anyone's identified the keeper (which is why `Save.playerId` stays optional; that rationale doesn't transfer to `Shot`).
- **`src/hooks/useOfflineMutations.ts`** (modify, not new — this was missing from the original file list) — `GameMutationInput` (`:135-153`) needs `createShot`/`deleteShot`/`updateShot` and `createSave`/`deleteSave`/`updateSave` callbacks, matching the existing `createGoal`/`deleteGoal`/`updateGoal` shape; add `ShotCreateFields`/`ShotUpdateFields`/`SaveCreateFields`/`SaveUpdateFields` interfaces mirroring `GoalCreateFields`/`GoalUpdateFields` (`:73-89`), each with `loggedVia` as a **required** field (see the data-model contract above); add the new mutation names to the `ALLOWED_MODELS` allowlist (`executeSingleMutation`, `:342-345`) and the hook's `useMemo` dependency list (`:798`).
- **`src/components/GameManagement/hooks/useGameSubscriptions.ts`** (modify, not new — also missing from the original file list) — this is where the existing `Goal` subscription actually lives (`useAmplifyQuery('Goal', {filter:{gameId}})`, `:84-87`), not in `GameManagement.tsx` directly. Add matching `Shot`/`Save` subscriptions here and thread them through the hook's return shape into `GameManagement.tsx` and down into `ShotSaveTracker.tsx`.
- **`GoalTracker.tsx`** (modify — also missing from the original file list) — update its `createGoal` call (`:75-85`) to pass `loggedVia: 'COACH'`, and render inside the new segmented control at all three mount sites above rather than unconditionally.
- **`src/App.css`** (modify — also missing from the original file list) — new segmented-control and `ShotSaveTracker` styles, appended at the bottom per this repo's single-stylesheet convention (CLAUDE.md).
- `src/types/schema.ts` / `src/components/GameManagement/types.ts` — re-export `Shot`/`Save` types.
- **Test-surface consequence**: widening `GameMutationInput` touches every mock `mutations` object across the `GameManagement` test suite — budget for that churn rather than treating it as incidental.

### Docs (part of this milestone, not deferred)

- `README.md` — Data Model section: add `Shot`, `Save`. Features section: add shot/save tracking.
- `docs/ARCHITECTURE.md` — update the entity diagram (`:59`), the `Player` relationships line (`:110`, which currently enumerates `Goal`), and add `#### Shot`/`#### Save` sections mirroring the existing `#### Goal` section (`:218`). Missed in the first draft, which only scheduled this doc for Milestone B1 — but Milestone A is where the entities and relationships actually change.
- `docs/specs/UI-SPEC.md` — two things, not one: (1) the §7.4 game-tab table (`:388-394`) is **already** stale in two ways, not one — it's missing the Plan and Goals rows entirely, and its existing "Lineup" row is a stale name for what `TabNav.tsx:14` actually ships as "Field." Fix all three (add Plan and Goals, rename Lineup → Field) in the same edit that documents the new Goals-tab segmented control, rather than partially fixing a table that's already wrong; (2) extend §13 "Note And Goal Actions (Post-Game)" (`:1117-1145`) — `ShotSaveTracker` reuses the same `GameActionRow`/`actionContract` unified-action contract, so §13.2/§13.3 need Shot/Save entries and the section title needs updating to reflect it's no longer Goal-only.

### Tests

- `ShotSaveTracker.test.tsx` (mirrors `GoalTracker.test.tsx`), including the Us/Opponent two-button entry and the opponent-row edit-semantics decision made above.
- New tests for the segmented control (keyboard/ARIA nav between Goals/Shots/Saves sub-views) **at all three real mount sites** — scheduled (asserting the internal no-op guard still holds), in-progress, and the completed layout — plus a test asserting no `ShotSaveTracker`/segmented control renders during halftime, matching `Goal`'s existing behavior there. The completed-layout case is the one most likely to be skipped by accident; don't skip it.
- `useOfflineMutations.test.ts` / `useGameSubscriptions.test.ts` — new Shot/Save coverage, plus updates to every existing mock `mutations` object the widened `GameMutationInput` interface touches.
- `delete-game-safe` / `delete-team-safe` / `delete-player-safe` handler tests — new cascade coverage, including a test that exercises the physical-GSI-name query path.

---

## Milestone B1 — Fan Mode (public read-only)

**This section has been through its own dedicated `architect-reviewer` + `ui-reviewer` round** (unlike the rest of the plan, which only had B1-relevant findings folded in opportunistically during earlier rounds). That round found 7 Major architecture findings and 4 Major UI findings — including two real bugs that would have shipped silently (a missing `Suspense` boundary that crashes the app's cold load, and a rate limiter keyed in a way that throttles out most of a game's actual audience) — all folded in below. `ui-reviewer` asked for one more scoped pass on just the changes below before this milestone proceeds to `coding-agent`.

### Data model (`amplify/data/resource.ts`)

```ts
// Fully closed model, same rationale as CalendarFeed. No client (coach or guest)
// ever reads/writes this table directly; every access goes through a Lambda that
// does its own authorization/validation. Token is the primary key for O(1) lookups.
// Field named `issuedAt`, not `createdAt` — avoids colliding with Amplify's
// auto-managed createdAt/updatedAt timestamps (same reason Goal uses `timestamp`
// instead of `createdAt`, resource.ts:330).
ShareLink: a.model({
  token: a.string().required(),        // random(24) via node:crypto, unguessable —
                                        // NOT nanoid: nanoid isn't a dependency of this
                                        // project; use randomBytes(18).toString('base64url')
                                        // instead (create-game-safe/handler.ts already
                                        // imports randomUUID from node:crypto, same module).
  teamId: a.id().required(),
  type: a.enum(['FAN', 'STAT_TRACKER']),
  createdBy: a.string().required(),    // coach Cognito sub
  issuedAt: a.datetime().required(),
  revokedAt: a.datetime(),             // null = active
})
  .identifier(['token'])
  .secondaryIndexes((index) => [index('teamId').queryField('listShareLinksByTeamId')])
  .authorization((allow) => [allow.authenticated().to([])]), // no client grants at all
```

(No `lastUsedAt` — a per-poll write to a single hot item on every fan-page refresh is pure cost with no product value yet; drop it for v1, revisit if usage analytics become a real ask.)

**Read-path rate limiting, keyed correctly this time.** The original draft keyed `FanViewRateLimit` on `[token, minuteBucket]` alone at ~30 reads/min — but the confirmed product decision is *one persistent public link per team*, and `FanGameView` polls every 10-15s. Twenty parents watching a game at 12s cadence is ~100 reads/min against a 30/min ceiling: **the limiter throttles out most of the actual audience it exists to serve**, starting in the second minute of the game. Fix: key the *real* per-viewer limit on the guest's own identity, not the shared token — an IAM-authorized AppSync resolver receives `event.identity.cognitoIdentityId`, a distinct value per browser/guest session, for free. Keep a per-token ceiling too, but as a pure billing circuit-breaker at a much higher threshold (an actual attacker can mint fresh guest identities trivially, so the per-token number is the real abuse control, not the per-viewer one):

```ts
FanViewRateLimit: a.model({
  limiterKey: a.string().required(),   // "identity#<cognitoIdentityId>" or "token#<token>" —
                                        // one row written/checked per request, per dimension
  minuteBucket: a.string().required(), // e.g. "2026-09-06T18:32"
  count: a.integer().required(),
  ttl: a.integer(),                    // DynamoDB TTL, ~10 min
})
  .identifier(['limiterKey', 'minuteBucket'])
  .authorization((allow) => [allow.authenticated().to([])]),
```

Per-identity ceiling: ~30 reads/min (generous for one viewer's own polling). Per-token ceiling: ~600 reads/min (a billing backstop, not a UX throttle — sized so a popular game with dozens of simultaneous viewers never approaches it under normal polling). `get-fan-game-view` checks both dimensions per request.

**`Game` needs a queryable index for "this team's current game."** Today `Game` has no `secondaryIndexes` at all (confirmed — only the implicit `belongsTo('Team')` relationship index, which has no sort key). The chronological field is `gameDate` (`resource.ts:169`) — but it's declared `a.datetime()` **without** `.required()`, and `create-game-safe/handler.ts:83` writes `gameDate: gameDate ?? null`. A sort-key GSI on an optional attribute **omits every item where that attribute is absent** — a `sortKeys(['gameDate'])` index would make a dateless in-progress game invisible to `getFanGameView`, which would report "team hasn't started a game yet" while the coach is mid-game. Add a partition-key-only index instead, which has no such gap:

```ts
// on Game:
.secondaryIndexes((index) => [
  index('teamId').queryField('listGamesByTeamId'),
])
```

**Game-selection algorithm — corrected.** The original draft's fallback ("else the most recent by `gameDate`") is wrong for any team using Calendar Feed Import (already shipped): a synced feed populates a whole season of *future*-dated `scheduled` games from the moment it's linked, so `max(gameDate)` picks next Saturday, not today's just-finished game. Concretely: game ends 5pm 3-2, a parent opens the link at 5:05pm expecting the final score, and instead sees "0-0, scheduled" for next week's game — and the plan's own "game finished — final score X-Y" state becomes unreachable for any scheduled team. `get-fan-game-view` queries `listGamesByTeamId` (every one of the team's games — a season's worth, dozens not thousands, cheap in Lambda memory) and picks in this corrected order:
1. Any game with `status` `in-progress` or `halftime` (live now).
2. Else, among games with `gameDate <= now` (i.e. already happened or happening today), the most recent one — **only if within a stated recency window** (e.g. 12 hours past `gameDate`, generous enough to cover a late-running game or a same-day doubleheader); render this as the "just finished" state.
3. Else, among games with `gameDate > now`, the soonest one — render this as a distinct **"next game"** state (not "team hasn't started a game yet," which implies today), showing the scheduled date/time so a fan checking early isn't confused for a game day that hasn't arrived.
4. Else, fall back to creation order. **This branch covers two different fan-facing situations and the copy must distinguish them, not share one string** — a brand-new team with zero games ever ("no games yet — check back once your coach schedules one") reads very differently from a team mid-season during a bye week or off-season lull, where games exist but none is upcoming or was recent enough for branch 2 ("no game right now — check back closer to the next one"). Branch on whether any game at all exists for the team, not just on reaching this fallback.

State this four-branch algorithm explicitly in the handler's own code comments — it's the one piece of real business logic in this Lambda, not just plumbing — and give each branch its own named frontend state (see New frontend components below).

**Client-side game-clock extraction — moved here from B2.** B1 is actually the *first* consumer of the game-clock formula outside `useGameSubscriptions.ts` (B2's Lambda-side mirror can still wait), so doing the extraction here avoids a guaranteed-to-diverge inline reimplementation. Extract the formula currently inlined at `useGameSubscriptions.ts:229-239` into `src/utils/gameClock.ts` (a small, pure function — current-seconds-in-game given `elapsedSeconds`/`lastStartTime`/`status`), have `useGameSubscriptions.ts` call it instead of inlining it, and have `FanGameView` do the same: seed a local 1-second tick from each poll's payload, and re-poll immediately on `visibilitychange` resume rather than waiting for the next scheduled interval (otherwise the clock is frozen mid-value from before the tab was hidden). Without this, a literal reading of the payload gives a clock that jumps in 10-15s steps and freezes solid while backgrounded — the polling-pause behavior would look like a broken clock, not a paused one.

**`Substitution` needs the same queryField treatment as `Goal` did in Milestone A.** `recentEvents`'s derivation needs to reach `Substitution` rows by `gameId` from a raw-SDK Lambda; `Substitution` (`resource.ts:294-311`) has no `secondaryIndexes`/`queryField` today (only the implicit relationship GSI). Add `index('gameId').queryField('listSubstitutionsByGameId')` — same pattern, same accepted GSI-backfill-window tradeoff Milestone A already stated for `Goal`.

### Lifecycle wiring (a gap in the original draft — B1 has none, and it needs one)

`ShareLink` is a second team-scoped table `delete-team-safe` doesn't know about yet, and `generate-share-link` will already reject creating a link for an archived team (see table below) while nothing revokes an *existing* live link when a team is archived after the fact — an inconsistent, half-finished lifecycle if left as-is:

- `amplify/functions/delete-team-safe/handler.ts` — add `ShareLink` to its scan/delete/rollback-snapshot stack (it already cascades `TeamInvitation` by `teamId` the same way, `handler.ts:84,128` — same pattern), plus the matching table grant and env var in `amplify/backend.ts`.
- `archive-team` — extend its existing `TeamInvitation`-sweeping behavior to also revoke any active `ShareLink`s for the team (the original draft punted this to B2 "since `ShareLink` already exists by then" — it exists starting *here*, so do it here).
- Add handler tests for both, matching Milestone A's "Lifecycle wiring (do not skip)" standard.

### Shared validation module (new: `amplify/functions/shared/shareLinkAccess.ts`)

Both `get-fan-game-view` (this milestone) and B2's forthcoming stat-tracker query need the same token → team → validity → rate-limit → current-game-selection pipeline. Factor it into one shared module now (same in-repo shape as `coachArraySync.ts`) rather than let B2 copy-paste it: token lookup, revoked/wrong-type rejection, the dual-dimension rate-limit check, and the four-branch game-selection algorithm all live here, parameterized by link `type`. This is what keeps "two guest-exposed read operations" (see the B1/B2 query-split decision below) from becoming two independently-drifting security boundaries.

### Custom operations

`ShareLink` is `allow.authenticated().to([])` — **zero client grants**. Returning `a.ref('ShareLink')` directly from `generateShareLink`/`listTeamShareLinks` doesn't work with that: the in-repo precedent that *does* return a model ref (`createSecureGameNote` → `a.ref('GameNote')`) only works because `GameNote` retains `.to(['read'])`. The actual zero-grant precedent, `CalendarFeed`, is never returned from an operation at all — `syncTeamCalendar` returns a `CalendarSyncResult` custom type instead. Follow that: define a `ShareLinkSummary` custom type (`token`, `type`, `issuedAt`, `revokedAt`) and return that, not `a.ref('ShareLink')`.

```ts
generateShareLink: a.mutation()
  .arguments({ teamId: a.string().required(), type: a.string().required() })
  .returns(a.ref('ShareLinkSummary'))
  .authorization((allow) => [allow.authenticated()])
  .handler(a.handler.function(generateShareLink)),

revokeShareLink: a.mutation()
  .arguments({ token: a.string().required() })
  .returns(a.boolean())
  .authorization((allow) => [allow.authenticated()])
  .handler(a.handler.function(revokeShareLink)),

listTeamShareLinks: a.query()
  .arguments({ teamId: a.string().required() })
  .returns(a.ref('ShareLinkSummary').array())
  .authorization((allow) => [allow.authenticated()])
  .handler(a.handler.function(listTeamShareLinks)),

getFanGameView: a.query()
  .arguments({ token: a.string().required() })
  .returns(a.ref('FanGameViewResult'))
  .authorization((allow) => [allow.guest(), allow.authenticated('identityPool')])
  .handler(a.handler.function(getFanGameView)),
```

**`getFanGameView` needs both `allow.guest()` AND `allow.authenticated('identityPool')`.** `allow.guest()` alone only grants the field to the Identity Pool's *unauthenticated* role. A signed-in coach opening their own freshly-generated link — the single most likely first interaction with this feature (Generate → copy → paste in a new tab to confirm it works) — has `fetchAuthSession()` resolve to the *authenticated* role, which wouldn't carry this permission, producing an AppSync `Unauthorized` error the first time anyone tries it. The query is token-gated regardless of caller identity, so granting the authenticated role too doesn't widen data exposure, only who can reach the (already-narrow) door. The same applies to B2's `submitStatEvent`.

`generateShareLink`'s handler must validate `type` against `['FAN', 'STAT_TRACKER']` explicitly (the arg is `a.string().required()`, not the enum type, so nothing else enforces this) and reject anything else. Also: **create the new link before revoking the old one, not after** — the original draft's "revoke first, then create" ordering leaves the team with zero active links if the process dies in between; reversing the order means a failure leaves two links active (a link a coach can manually clean up) rather than zero (a link a fan/helper is silently locked out of, with no coach action able to fix it faster than generating a replacement anyway).

`FanGameViewResult` — curated custom type (following the `CalendarSyncResult` precedent, `resource.ts:603-654`): `teamName`, `opponentName`, `locationName`, `status`, `currentHalf`, `elapsedSeconds`, `lastStartTime`, `halfLengthMinutes`, `ourScore`, `opponentScore`, `gameDate` (added — see below), `onFieldPlayers: [{ firstName, lastInitial, positionName }]` (first name + last **initial** only — no `birthYear`, no coach identities, **no `playerId`** — see the B1/B2 query-split decision below for why), `recentEvents: [{ type, playerName, minute, half }]` (last ~5 `Goal`/`Substitution` rows, using the `listGoalsByGameId` index from Milestone A and the new `listSubstitutionsByGameId` index above).

**`gameDate` is a required field on the payload, not an omission.** Without it, the "game finished — final score X-Y" state (below) is indistinguishable from a stale completed game surfaced by the recency-window fallback (branch 2 above) once that window has lapsed — a fan reopening a bookmarked link during a bye week has no way to tell "today's final" from "three weeks ago's final." The frontend uses this to caption the state correctly (e.g. "Final (Sept 12) — 3-2").

`onFieldPlayers` derivation reuses the **existing** `listPlayTimeRecordsByGameId` index (`resource.ts:311-312`) — query open rows (`endGameSeconds == null`) and batch-fetch `Player`/`FieldPosition`. No new index needed for this part.

### New Lambda functions (`amplify/functions/`)

| Function | Auth | Responsibility |
|---|---|---|
| `generate-share-link` | authenticated | Verify caller ∈ `team.coaches`; reject if `team.status === 'archived'` (mirror `createGameSafe`'s guard); validate `type` is `'FAN'` or `'STAT_TRACKER'`; write the new `ShareLink` row with a `crypto.randomBytes`-derived token first, then revoke any existing active link of that `type` for the team (one active link per team per type, create-before-revoke ordering — see above); return it. |
| `revoke-share-link` | authenticated | Look up `ShareLink` by token → `teamId` → verify caller ∈ `team.coaches`; set `revokedAt`. |
| `list-team-share-links` | authenticated | Verify caller ∈ `team.coaches`; return active/recent links for the `InvitationManagement.tsx` display. |
| `get-fan-game-view` | **guest + authenticated (identityPool)** | Via the shared `shareLinkAccess.ts` module: look up `ShareLink` by token; reject if missing/revoked/wrong type; check both rate-limit dimensions; run the four-branch game-selection algorithm; assemble `FanGameViewResult` via the indexed queries above. |

All use `grantReadData`/`grantReadWriteData` IAM grants wired in `amplify/backend.ts`, following the `CalendarFeed`/`GameNote` pattern. Pagination note: `listGamesByTeamId` needs `nextToken` looping in the handler like every other multi-page query in this codebase — a team with a long game history shouldn't silently truncate.

### Guest auth — must be pinned down before implementation starts, not deferred to it

- **Favorable finding, narrows this item**: `amplify_outputs.json` already shows `"unauthenticated_identities_enabled": true` and lists `AWS_IAM` under `authorization_types` — the unauthenticated Identity Pool role and the IAM auth mode already exist in this environment (likely provisioned by Amplify Gen2 automatically the first time *any* `allow.guest()`/IAM-mode construct appeared in the project's history, or available by default). The implementer does not need to go looking for a `defineAuth` change — there isn't one to make. The real remaining unknown, unchanged from the original draft, is field-level policy scoping.
- **Acceptance check, not optional**: confirm the generated unauthenticated (and, per the dual-role fix above, authenticated) role's `appsync:GraphQL` policy is scoped to exactly `.../types/Query/fields/getFanGameView` (and, in B2, `.../types/Mutation/fields/submitStatEvent`) — **not** `.../apis/<id>/*`. This is the single highest-risk item in the whole feature; security-reviewer must diff `defineData`'s authorization modes before/after and confirm this scoping directly for **both** IAM roles, not take the plan's word for it.
- Client calls use `{ authMode: 'identityPool' }` (the current, non-deprecated Amplify v6 name — not `'iam'`).
- `allow.guest()`/`allow.authenticated('identityPool')` must land **only** on `getFanGameView` (and, in B2, `submitStatEvent`) — nowhere else. `ShareLink`/`FanViewRateLimit` stay `allow.authenticated().to([])` (Cognito user-pool `authenticated`, a different thing entirely from the IAM `authenticated('identityPool')` role above — don't conflate the two "authenticated"s when implementing). Every other model/operation is untouched.
- The bug-screenshot S3 bucket (`amplify/storage/resource.ts`) currently has **no client-accessible paths at all** ("Bug report screenshots are uploaded to GitHub Issues directly by the Lambda") — there is no existing storage policy for guest identities to interact with, so this is not a verification item.

### Frontend routing (`src/main.tsx`, `src/App.tsx`)

Current structure (verified): `main.tsx` renders `<Authenticator.Provider><Root/></Authenticator.Provider>` with **no router** — `Root()` conditionally renders `<LandingPage>`/`<Authenticator>`/`<App/>`. `App.tsx` owns the **only** `<BrowserRouter>` in the app, with its own `<Routes>` including a catch-all `<Route path="*" element={<Navigate to="/" replace />} />`.

The fix is to **hoist `BrowserRouter` up to `main.tsx`**, convert `App.tsx` to render only `<Routes>` (no router), and add the two public routes as siblings, ordered before any catch-all:

```tsx
// main.tsx
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Suspense fallback={
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading...</div>
      }>
        <Routes>
          <Route path="/watch/:token" element={<FanGameView />} />
          <Route path="/track/:token" element={<StatTrackerView />} /> {/* added in B2 */}
          <Route path="*" element={<AppRootLazy />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>
);

// App.tsx — drop the <BrowserRouter> wrapper, keep everything else:
function App() {
  return (
    <Routes>
      <Route path="/invite/:invitationId" element={<InvitationRoute />} />
      <Route element={<AppLayout />}>{/* ...unchanged... */}</Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
```

**The `<Suspense>` boundary above is required, not optional — its absence would crash the app.** `AppRootLazy` (`React.lazy(() => import('./AppRoot'))`, see below) suspends on its first render while its chunk loads; with no `Suspense` ancestor, React throws "A component suspended while rendering, but no fallback UI was specified" on every cold load of the authenticated shell — i.e., for every existing user, on every first visit. The fallback shown matches today's `main.tsx:50` "Loading..." full-height div (the existing `authStatus === 'configuring'` state) so there's no visible regression.

Because `main.tsx`'s `"*"` route only matches when neither `/watch/:token` nor `/track/:token` matched, `App.tsx`'s own inner `"*"` (which redirects to `/`) is unaffected — it only ever sees paths that already fell through to `Root`/`App`. `UpdatePrompt` stays exactly where it is today (inside `Root`'s branches) — correct as originally stated. Two corrections to the original claim, though:

- **`initGA` is not inside `Root`** — it runs at module scope in `main.tsx:38-42`, before `ReactDOM.createRoot`. Under this restructure it would fire unconditionally, including for unauthenticated visitors on `/watch/:token`/`/track/:token` who never saw any consent surface. Guard it explicitly: check `window.location.pathname` for the `/watch/`/`/track/` prefixes before calling `initGA`, so analytics only initializes for the authenticated app shell.
- **The two public pages won't actually be "minimal" just by hoisting the router.** `main.tsx:5` statically imports `App`, which statically imports `AppLayout`, `Home`, `App.css`, and `@aws-amplify/ui-react/styles.css` — a fan on stadium LTE would still download the entire authenticated app shell to view a scoreboard, because `React.lazy`-wrapping the `"*"` route inline in `main.tsx` doesn't help when `Root` and its imports are *defined in that same file*: `Authenticator`/`useAuthenticator` (`main.tsx:4`), `App` (`:5`), `LandingPage` (`:6`), `UpdatePrompt` (`:7`), and the amplify-ui stylesheet (`:11`) are all static imports at module scope, so they load regardless of which route matched. The actual fix needs an extraction, not just a `lazy()` wrapper: move `Root` (and the `Authenticator.Provider` wrapper, and the amplify-ui stylesheet import) into a new `src/AppRoot.tsx`, leaving `main.tsx` with only `Amplify.configure`, the hoisted `BrowserRouter`/`Suspense`/`Routes`, and the two public routes. `AppRootLazy = React.lazy(() => import('./AppRoot'))` (same pattern already used for `Management`/`UserProfile`/`SeasonReportRoute` in `App.tsx:17-27`) genuinely keeps the authenticated shell out of `/watch`/`/track`'s bundle.
- **Service-worker precache must stay confined to the authenticated shell.** `useRegisterSW` lives in `UpdatePrompt.tsx`, which the extraction above keeps inside `AppRoot` — so this happens to already be correct, but it's worth stating as an explicit constraint rather than an accident: the SW's `globPatterns` (`vite.config.ts:114`) precache the *entire* app bundle, so if registration ever moved to somewhere reachable from `/watch`/`/track`, the whole code-splitting effort above would be silently undone for every public-page visitor.

### New frontend components

- `src/components/FanMode/FanGameView.tsx` — polls `getFanGameView` (every 10-15s, paused via the Page Visibility API when hidden, with an immediate re-poll on visibility-resume — see the game-clock extraction above); runs the extracted `gameClock.ts` locally on a 1-second tick seeded from each poll, rather than rendering the raw payload's `elapsedSeconds` directly (which would visibly jump/freeze between polls); renders score/timer/half (new standalone component, visual style borrowed from `CommandBand.tsx` — including its `aria-live="polite" aria-atomic="true"` score wrapper, `CommandBand.tsx:183`, which carries over for free), on-field lineup grid, recent-events feed. **Named states, matching the corrected 4-branch selection algorithm**: "this link isn't valid" (covers both an explicitly revoked token and one that's syntactically garbage or never existed — one generic state, deliberately not split into "revoked" vs. "not found," since a fan can't act differently on the distinction either way), "next game" (branch 3 — shows the upcoming scheduled date/time, distinct from the no-game states), "game finished — final score X-Y (as of `gameDate`)" (branch 2, dated so a stale/bye-week view isn't mistaken for today's game), and branch 4's two distinct variants per the algorithm above — "no games yet" (team has never had a game) vs. "no game right now" (games exist, none upcoming — e.g. a bye week) — plus **"you're checking a bit too often — try again in a moment"** for a rate-limit rejection (the original draft had no state for this at all, despite introducing a rate limiter specifically for this endpoint).
- **CSS**: a dedicated `src/components/FanMode/FanMode.css` (imported only by `FanGameView`/`StatTrackerView` in B2), not `App.css`. `App.css` is imported exactly once, by `App.tsx`, which the routing extraction above moves behind the lazy `AppRoot` chunk — so `/watch` never loads it, meaning styles written into `App.css` per the repo's normal single-stylesheet convention would silently produce an unstyled public page. This is a deliberate, narrow exception to that convention (record it in `docs/ARCHITECTURE.md`/`CLAUDE.md` so a future reviewer doesn't flag the second stylesheet as a violation) — the alternative (importing `App.css` directly into `FanGameView`) would pull ~4500 lines into the public bundle and defeat the whole code-splitting justification above. `index.css` (the CSS custom-property theme tokens) stays available either way, since `main.tsx` imports it directly.
- `src/components/InvitationManagement.tsx` — new "Share Links" section, visually separated (e.g. a divider/distinguishing heading) from the panel's other three regions since it's a materially different trust boundary (public/unauthenticated) than inviting a coach or parent — generate/copy/revoke controls for the `FAN` link type (the `STAT_TRACKER` half of this UI lands in B2), replacing today's raw-text invite-link display pattern with a proper copy-to-clipboard control. **Both "Generate" (when it would replace an active link) and standalone "Revoke" need a confirmation step** — the original draft only covered Generate, but an explicit Revoke tap is at least as disruptive to a third party (it immediately cuts off anyone actively viewing/polling) and UI-SPEC §1's "destructive/irreversible actions always require confirmation" applies squarely to both. Mirror the existing Confirmation Modal convention (UI-SPEC §5.6/§7.9), with an explicit title and `variant` for each (matching the precedent `variant: 'danger'`/`'warning'` pattern already used for Remove/Cancel in this same panel) — e.g. Generate-replace: "Replace this link?" / "This replaces the current link — anyone still using it will lose access." (`warning`); Revoke: "Revoke this link?" / "Anyone using it will immediately lose access." (`danger`).

### Docs

- `README.md` — Data Model: add `ShareLink`, `FanViewRateLimit`. Features: add "Fan Mode (public read-only live game view)."
- `CLAUDE.md` — the Authorization pattern section states "Every Amplify model carries a `coaches: string[]` field and uses `allow.ownersDefinedIn('coaches')`." This becomes narrowly false the moment `getFanGameView` ships (a guest-reachable operation, not just another closed table) — add the exception here, since this is the first file every agent in this pipeline reads. While editing: correct the same section's stale claim that "`gameTimeUtils.ts` and `gameCalculations.ts` hold the conversion logic" — `gameTimeUtils.ts` is display-formatting only; the actual clock arithmetic is the newly-extracted `src/utils/gameClock.ts` (moved out of `useGameSubscriptions.ts` by this milestone).
- `docs/ARCHITECTURE.md` — five separate updates, not one: (1) Authorization Model section (`:25-31`, restated at `:464-465` — the original draft's "line 431" pointer was stale) — document the guest-auth exception, exactly which operation(s) carry it, and link to the `CalendarFeed`-style closed-model rationale; (2) `### Data Models` (`:66`) — add `#### ShareLink` / `#### FanViewRateLimit` sections, matching the standard Milestone A's `#### Shot`/`#### Save` sections already set; (3) `### Lambda Functions` (`:382`) — list the four new functions; (4) `### GraphQL Operations` (`:394`) — list the four new custom operations; (5) `### Navigation Structure` (`:300`) — update past describing `App.tsx` as the sole router owner, since it no longer is; (6) `### 4. Client-Side Timer` (`:476`) — add the `gameClock.ts` extraction pointer.
- `docs/specs/UI-SPEC.md` — four things, not three: (1) add a full entry for the `FanGameView` screen (layout, a11y — screen-reader semantics for the lineup grid and events feed, not just the top-level empty state; responsive breakpoints); (2) §6 "Routes Outside AppLayout" (`:216-219`) currently lists only `/invite/:invitationId` and `/dev` — add `/watch/:token` (and, in B2, `/track/:token`), and note that unlike the existing two entries, this route is outside the *auth gate* entirely, not just outside `AppLayout`'s chrome — a stronger statement worth calling out explicitly; (3) §7.9's "Sharing & Permissions" panel is currently documented as having "**Three regions**" (`:656`) — the new Share Links section makes it four, visually separated per the Frontend section above; (4) §9.4's Help FAB visibility table (`:1020-1027`) explicitly enumerates which routes get the Help FAB and excludes Landing/Invitation-flow/Dev-Dashboard by name — add an explicit `/watch/:token` row (almost certainly "No": no coach, no `HelpFabContext` debug data to attach to a session that was never authenticated), rather than leaving it as a silent implementation-time judgment call the spec never ends up reflecting. The same gap will recur for `/track/:token` in B2 if this pattern isn't fixed here.
- **Known, accepted gap**: `ShareLink`/`FanViewRateLimit` are `allow.authenticated().to([])`, so `src/utils/e2eCleanup.ts`'s `ORPHAN_MODELS` list can't reach them the way it does every other E2E-created model — E2E-generated links/rate-limit rows will accumulate in whatever environment runs the E2E suite. Accepted for v1 (no user-facing impact — these are dev/test artifacts, not production data); revisit with a TTL on `ShareLink` or a dev-only sweep if this becomes a real nuisance.

### Decision: `getFanGameView` stays FAN-only; B2 gets its own `getStatTrackerView`

The original draft flagged this as an open question for this review round to resolve. **Resolved: separate queries, not one type-gated operation.** Reasoning: the two consumers need meaningfully different payloads (Fan Mode needs only on-field players, fully anonymized; the Stat Tracker needs the full active roster for its player picker, `playerId`s included) — gating one shared custom type on `type` would make half its fields nullable-by-convention and force defensive branching into every poll of *either* page. Worse, `playerId`s are the same stable UUIDs the authenticated app uses internally; putting them in a payload anyone holding a screenshotted/forwarded Fan Mode link can read is a gratuitous identifier leak this milestone's own privacy design (first-name + last-initial only) explicitly tries to avoid — and nothing in `FanGameView`'s spec needs them. This is exactly why `FanGameViewResult` above has no `playerId` field. The shared `shareLinkAccess.ts` module (above) is what keeps this from meaning two independently-drifting security-critical code paths — B2's `getStatTrackerView` composes the same validation pipeline instead of copying it.

### Tests

- `generate-share-link` / `revoke-share-link` / `list-team-share-links` / `get-fan-game-view` handler tests: coach-authorization checks, archived-team rejection, token validation (valid/missing/revoked/wrong-type), `type` argument validation on `generateShareLink`, create-before-revoke ordering, both rate-limit dimensions (per-identity and per-token) independently, and the full 4-branch game-selection algorithm (in-progress/halftime preferred; a same-day-recent completed game preferred over a future one; a future-only game renders as "next game," not "no game yet"; no games at all falls back correctly).
- `shareLinkAccess.ts` — its own unit tests, since both B1 and (later) B2 depend on it.
- `delete-team-safe` / `archive-team` handler tests — new `ShareLink` cascade/revoke coverage.
- `gameClock.ts` — unit tests for the extracted formula (running/paused/halftime), plus a regression test confirming `useGameSubscriptions.ts` still behaves identically after the extraction.
- `FanGameView.test.tsx` — all six named states (invalid-link, next-game, finished-with-date, no-games-yet, no-game-right-now, rate-limited); polling under fake timers, pause-on-hidden, and immediate re-poll on visibility-resume.
- `main.tsx`/routing — a test confirming the `Suspense` fallback actually renders during the lazy `AppRoot` chunk load (regression guard for the bug this round caught).
- `InvitationManagement.test.tsx` — generate/copy/revoke controls for the Fan link, including the now-required standalone Revoke confirmation.

---

## Milestone B2 — Sideline Stat Tracker (public write)

**This section has its own dedicated `architect-reviewer` + `ui-reviewer` round**, run after Milestone A and B1 were both implemented, reviewed, and committed. Milestone A and B1 are real code now, not plans — this round checked B2's text against what's actually shipped (not what B1's plan *said* it would build) and found B2 had gone stale in several places, plus one genuinely open architectural question this repo has hit before: **this codebase previously evaluated and explicitly rejected** the Lambda-side IAM-authenticated data-client pattern B2 depends on for its AppSync-write fix, for lack of any in-repo precedent (`docs/plans/TEAM-ARCHIVE-STEP11-GAME-CREATE-CONVERSION-PART1.md`, "Decision 0"). B2 is the first case where the tradeoff genuinely flips (a live subscription is the whole point here, unlike that earlier decision). A validation spike was run against a real deployed sandbox before any of the rest of B2 was built — it confirmed the mechanism works, and also caught that the exact grant shape originally planned doesn't exist in this Amplify version, requiring a wider (schema-level, not per-model) grant than intended; both are folded in below, along with every other finding from this section's review round.

### Data model

**No new rate-limit table.** The original draft's `ShareLinkRateLimit` (`[token, minuteBucket]`, per-token only) is dropped entirely — it diverges from what B1 actually shipped (`FanViewRateLimit`, keyed on a generic `limiterKey` covering both per-identity and per-token dimensions) and is flatly incompatible with the shared `shareLinkAccess.ts` module B2 is supposed to compose: `checkAndIncrementRateLimit` already issues `UpdateCommand`s keyed `{ limiterKey, minuteBucket }` against `FanViewRateLimit` specifically — pointing it at a `token`-keyed table would be a `ValidationException` on every single call.

**Reuse `FanViewRateLimit`, with a distinct key prefix for writes.** A helper's rapid tapping and their own passive polling would otherwise share the same `identity#<id>`/`token#<token>` budget as every read-only fan watching the same team — cannibalizing each other's limits. Extend `shareLinkAccess.ts`'s rate-limit helpers to take a `dimension: 'read' | 'write'` parameter that prefixes the key (`read#identity#…`/`write#identity#…`, `read#token#…`/`write#token#…`) and give writes their own, tighter ceilings: ~20 writes/min per identity (generous for a helper's actual tapping rate), ~400 writes/min per token (billing circuit-breaker, same rationale as B1's read-path ceiling — an attacker can mint fresh guest identities, so this number exists to cap runaway cost, not to police normal use).

### Shared module changes (`amplify/functions/shared/shareLinkAccess.ts`)

Two fixes here benefit both B1 and B2, since both compose this module:

- **Rate-limit dimension parameter**, per the data-model change above. `resolveShareLinkAccess` already threads `checkRateLimits` internally and is already called by the shipped `get-fan-game-view` handler — give the new `dimension` parameter a default of `'read'` so that existing call site (and its existing tests in `shareLinkAccess.test.ts`) needs no changes; only `submit-stat-event`'s new call site passes `'write'` explicitly.
- **Deterministic tiebreak among multiple "live" games — corrected after a first attempt got this wrong.** `selectGameForFan`'s live branch currently does `games.find(g => g.status === 'in-progress' || g.status === 'halftime')` against an unordered GSI query result. Nothing in this app auto-completes a game — `status` stays `in-progress` indefinitely until a coach explicitly ends it — so a team with one abandoned/never-completed game *and* today's actual live game has two matches, and the `find()` winner is arbitrary per invocation. For B1 (read-only) this was a cosmetic wrong-scoreboard risk; for B2 it's a silent-data-corruption risk with no undo: a helper's taps could write `Goal`/`Shot`/`Save` rows onto last month's abandoned game, never show up on the coach's actual live screen (so nobody notices mid-game), and there's no way for the helper to tell.
  - **Do not rank on `gameDate`.** An earlier revision of this fix proposed "prefer the most recent `gameDate`, then `updatedAt`" — but `Game.gameDate` is optional (`a.datetime()`, no `.required()`), `create-game-safe/handler.ts` writes it as `null` when a coach leaves the field blank, and a dateless in-progress game is exactly the case B1's own `Game` index design was built around accommodating. Ranking on a field that's routinely absent on precisely the abandoned/quickly-created games this needs to disambiguate doesn't fix the race, it just makes it depend on which game happens to have a date.
  - **Rank on `lastStartTime` instead, then `updatedAt`, with `gameDate` as a lower-priority tiebreak only.** `lastStartTime` is only ever set when a game has actually been started (the client-side timer's own invariant — see CLAUDE.md's game-timer section), so it's a signal that's actually present on a genuinely-live game, unlike `gameDate`. A candidate with no `gameDate` never sorts last purely for lacking one. Add `updatedAt` to `shareLinkAccess.ts`'s `GameRecord` interface (it isn't there today).
  - **The "belt-and-suspenders" check must actually check something.** Checking only that "the *selected* game's `status !== 'in-progress'`" is inert — every live candidate passes that by construction; it can't catch the wrong-game race at all. Give `submitStatEvent` a real target-echo check instead: `StatTrackerViewResult.gameId` (already planned below) is what the helper's UI last polled as the current game; add an `expectedGameId` argument to `submitStatEvent`, populated from that value, and reject with its own `SubmitStatEventResult.reason` (e.g. `'GAME_CHANGED'`) when it doesn't match what the Lambda resolves server-side at submit time — this is what actually protects against a helper's tap landing on a different game than the one they were looking at.

### `getStatTrackerView` — fully specified (the original draft only referenced this by name)

The previous draft assumed this operation without ever defining it — no query block, no custom type, no Lambda, no auth mode, no roster-fetch mechanism. It's straightforward to build (the shared module already does the hard part), but every piece needs to actually be named:

```ts
StatTrackerPlayer: a.customType({
  id: a.string().required(),      // included here — getFanGameView's payload deliberately omits it,
  firstName: a.string().required(), // this is the whole reason B1's review round split the two
  lastName: a.string().required(),  // queries apart. Full last name too (not last-initial) — this
  positionName: a.string(),         // payload is for the helper's own player picker, not a public
}),                                  // display; the anonymization requirement was specific to Fan Mode.

StatTrackerViewResult: a.customType({
  state: a.string().required(),      // same discriminator pattern as FanGameViewResult.state —
                                      // mirrors its branch values (INVALID_LINK, RATE_LIMITED,
                                      // NO_GAMES_YET, NO_GAME_RIGHT_NOW, NEXT_GAME, FINISHED, LIVE)
  teamName: a.string(),
  opponentName: a.string(),          // needed for the Us/Opponent tap-flow labels — the Frontend
                                      // section below assumed this came from FanGameViewResult,
                                      // which StatTrackerView never actually receives; it's here instead.
  status: a.string(),
  currentHalf: a.integer(),
  gameId: a.string(),                // the resolved game's id — submitStatEvent doesn't take a
                                      // gameId argument (derived server-side, see below), but the
                                      // UI needs it to know a submission's target didn't change
                                      // between polls, for the mid-session-revocation UX.
  roster: a.ref('StatTrackerPlayer').array(), // the team's active roster (not just on-field —
                                                // a helper needs the bench too, e.g. to log a save
                                                // by a keeper who just subbed on).
}),

getStatTrackerView: a.query()
  .arguments({ token: a.string().required() })
  .returns(a.ref('StatTrackerViewResult'))
  .authorization((allow) => [allow.guest(), allow.authenticated('identityPool')])
  .handler(a.handler.function(getStatTrackerView)),
```

**Roster fetch** — `get-fan-game-view` never needed this (its `onFieldPlayers` comes from open `PlayTimeRecord` rows), so it's new plumbing, not a reused path. The in-repo precedent is `revoke-coach-access/handler.ts`'s `Team` → roster traversal: query the implicit relationship GSI by its **physical** name `gsi-Team.roster` (see `coachArraySync.ts`'s rationale for why relationship GSIs are queried by physical name from a raw-SDK Lambda), then batch-fetch `Player` rows for the returned `TeamRoster` entries. This needs its own `addToRolePolicy` entry and `TEAM_ROSTER_TABLE`/`PLAYER_TABLE` env vars in `amplify/backend.ts`, matching the grant shape `revoke-coach-access` already has. Use `BatchGetItem`, not one `GetCommand` per player (see the `get-fan-game-view` efficiency note below — don't repeat that pattern here on a page that polls even more frequently). **"Active roster" needs one pinned definition**, not an implicit one — both `TeamRoster.isActive` and `Player.isActive` exist and can disagree for a given player; filter on `TeamRoster.isActive` (it's the roster-membership flag; `Player.isActive` governs a different concern) so the helper's picker shows the same set the coach's own lineup UI does. Like `get-fan-game-view`, this Lambda's `resource.ts` needs `resourceGroupName: 'data'` (every existing data-touching function in this repo sets it — omitted from the original draft of this bullet).

**Auth**: `allow.guest()` **and** `allow.authenticated('identityPool')`, same as `getFanGameView` — a coach opening their own freshly-generated Stat Tracker link to confirm it works is exactly as real a first-touch scenario here as it was for Fan Mode.

### `submitStatEvent` — the write path, designed around the subscription finding

```ts
submitStatEvent: a.mutation()
  .arguments({
    token: a.string().required(),
    eventType: a.string().required(),   // 'GOAL' | 'SHOT' | 'SAVE'  (see Assist note below) —
                                         // validate against this allowlist explicitly in the handler,
                                         // mirroring generate-share-link's isValidType check; the arg
                                         // is a.string().required(), nothing else enforces it.
    playerId: a.string(),               // scorer (GOAL), shooter (SHOT), keeper (SAVE) — "Us" only
    assistPlayerId: a.string(),         // optional, GOAL + "Us" only
    forUs: a.boolean().required(),      // generic "this event belongs to our side" flag —
                                         // written to Goal.scoredByUs / Shot.takenByUs /
                                         // Save.byUs depending on eventType. One arg name,
                                         // three differently-named target fields; state this
                                         // mapping explicitly in the handler, don't rename the
                                         // model fields to match — they're each named for
                                         // what reads correctly on that specific model.
                                         // Required, not optional: Goal/Shot/Save's corresponding
                                         // fields are all `.required()` on the model, and a silent
                                         // default here (e.g. defaulting to true) would be a
                                         // score-corruption path — an opponent goal miscoded as
                                         // ours gets reconciled straight into Game.ourScore.
    onTarget: a.boolean(),               // SHOT only, both "Us" and "Opponent" — required when
                                         // eventType === 'SHOT' regardless of forUs, reject the
                                         // submission otherwise. (The UI section below adds the
                                         // missing tap step for this — the original draft required
                                         // this argument but never gave the helper a way to supply it.)
    clientEventId: a.string(),           // client-generated (e.g. crypto.randomUUID() in the
                                         // browser), optional but recommended — see the idempotency
                                         // note below.
    expectedGameId: a.string(),          // the gameId the helper's UI last polled as current
                                         // (StatTrackerViewResult.gameId, below) — this is the real
                                         // guard against the wrong-game race described in the shared
                                         // module section above, not the inert status-only check an
                                         // earlier draft of this section relied on. Optional so a
                                         // first-ever poll's submission (no prior gameId to echo)
                                         // isn't blocked, but require it once the client has seen a
                                         // gameId at all — enforce this client-side, not server-side,
                                         // since the server can't distinguish "never polled" from
                                         // "chose to omit it."
  })
  .returns(a.ref('SubmitStatEventResult'))  // NOT a.boolean() — see below.
  .authorization((allow) => [allow.guest(), allow.authenticated('identityPool')])
  .handler(a.handler.function(submitStatEvent)),

SubmitStatEventResult: a.customType({
  ok: a.boolean().required(),
  reason: a.string(),   // set when ok===false: 'INVALID_LINK' | 'RATE_LIMITED' | 'GAME_NOT_LIVE' |
                         // 'GAME_CHANGED' (expectedGameId mismatch — the wrong-game-race guard) |
                         // 'VALIDATION_FAILED' — a plain a.boolean() return can't distinguish these,
                         // and the UI needs to (rate-limited vs. link-revoked-mid-session vs.
                         // game-ended-while-you-were-mid-tap are three different messages).
}),
```

**`ASSIST` is not an independent event** — `Goal.assistId` is a field on a `Goal`, not a standalone record (confirmed `resource.ts:327-328`). The Stat Tracker UI's "Assist" tap is step two of the Goal flow (pick scorer, then optionally pick an assisting player), producing one `Goal` write with both fields set — not a second event type.

**Validation rules, stated completely, not partially:**
- **Opponent path** (`forUs === false`): reject if `playerId` or `assistPlayerId` is present — an opponent event never carries a player attribution, since this app has no opposing roster to validate against.
- **"Us" path, `playerId` supplied**: validate it belongs to the token's team roster before writing — without this, a leaked token plus a hand-crafted GraphQL call can attribute a `Goal`/`Shot`/`Save` to an arbitrary or another team's player UUID, stamped with this team's real `coaches[]`, silently polluting season-report and per-player derivations. Same check applies to `assistPlayerId` when present, plus **assist must not equal scorer** (`assistPlayerId !== playerId`).
- **"Us" `SHOT` with no `playerId`**: **allowed, deliberately** — Milestone A's coach-side `ShotSaveTracker.tsx` requires a player for an "Us" Shot (mirroring `Goal`'s required scorer), but B2's "skip / unknown player" affordance (Frontend section below) needs to work for every picker a helper sees mid-play, including Shot's. This is a stated inconsistency between the two entry points, not an oversight: the coach reviewing/editing afterward can fill in the player Milestone A's UI required them to supply anyway (`ShotSaveTracker.tsx` already renders a null-`playerId` row correctly). Don't "fix" this into requiring a player here — that would break the skip affordance for exactly the event type most likely to be tapped mid-action.
- **`eventType`**: reject anything outside `['GOAL', 'SHOT', 'SAVE']`.

**`coaches[]` must be populated explicitly — this is not automatic just because the write goes through AppSync.** Per CLAUDE.md, omitting `coaches` on any new record is the single most common way to lock a coach out, and here the failure mode is worse than usual: it would be silent, and it would lock out *every* coach on the team, including the one who generated the link. The handler must read the team's **current** `coaches` array (fresh, not cached from `ShareLink`) and set it explicitly on the created `Goal`/`Shot`/`Save` record — this applies identically to opponent-side events, which still belong to (and must be visible to) the team's coaches.

**Idempotency for a retried submit** — the duplicate-tap guard below stops a double *tap*; it doesn't cover a write that actually succeeded but whose response was lost on a bad connection, which the Frontend section's "inline error + manual retry" path can turn into a genuine duplicate on resubmission. Use the optional `clientEventId` argument: if supplied, the handler does a conditional write keyed on it (e.g. a short-lived dedup record, or a conditional-put pattern) so a retried submission with the same id is a no-op rather than a second row. If this is judged too much complexity for v1, the plan must say so explicitly as an accepted gap (alongside the already-accepted multi-helper-duplicates tradeoff below) rather than leave it unaddressed by omission.

**Game-clock contract**: `gameSeconds`/`half` are **not** supplied by the untrusted public client. The Lambda derives them server-side from the team's current `Game` (`elapsedSeconds`, `lastStartTime`, `status`, `currentHalf`). **This is now a mirror-only task, not an extraction** — Milestone B1 already did the client-side extraction: `src/utils/gameClock.ts` exists, is tested, and `useGameSubscriptions.ts` already calls it (the original draft's "extract this before B2" instruction and its `useGameSubscriptions.ts:229-239` pointer are both stale; that inline code no longer exists). B2's actual remaining work is the **Lambda-side mirror** at `amplify/functions/shared/gameClock.ts` (a Lambda can't import from `src/`), with a parity test asserting identical output to `src/utils/gameClock.ts` for the same inputs. One fact the extraction surfaced that's worth recording here rather than re-discovering: `elapsedSeconds` **accumulates across both halves** — `handleStartSecondHalf` writes `elapsedSeconds: resumeTime` (`GameManagement.tsx`), it does not reset to 0 — so a second-half `gameSeconds` value from this Lambda is directly comparable to a coach-logged one with no extra adjustment. Also confirm the Lambda's derivation uses the same running-vs-paused branch as the client (frozen at `elapsedSeconds` when `lastStartTime` is null, even while `status === 'in-progress'`), not a literal read of the possibly-stale persisted value. Reject the submission (`GAME_NOT_LIVE`) if the *selected* game's `status !== 'in-progress'`, and separately reject (`GAME_CHANGED`) if the resolved game's id doesn't match the client-supplied `expectedGameId` when one was supplied — the status check alone is inert against the wrong-game race (every live candidate trivially passes it by construction); the `expectedGameId` echo is what actually catches it, per the corrected tiebreak section above.

**Critical fix — write through AppSync, not the DynamoDB SDK.** Every other Lambda in this repo (`CalendarFeed`, `GameNote`, `archiveTeam`, etc.) writes via direct `DynamoDBDocumentClient`/`PutCommand`, which is correct for those because none of them need a live subscriber to see the write instantly. This one does: the whole point of the Stat Tracker is that the coach's `GameManagement.tsx` screen (subscribed to `Goal`/`Shot`/`Save` via `useAmplifyQuery`'s `observeQuery`) reflects a helper's tap in real time. A raw DynamoDB write **will not** trigger the `onCreateGoal`/`onCreateShot`/`onCreateSave` subscription event — this is the exact, already-documented hazard in `src/components/Home.tsx:135-145` (`createGameSafe`'s DynamoDB-SDK writes never fire `onCreateGame`, requiring the `pendingCreatedGames` client-side patch — which doesn't help here, since the "other browser" problem means there's no local optimistic state to patch with).

**This pattern has zero precedent anywhere in this repo, and was previously evaluated and rejected for exactly that reason.** `docs/plans/TEAM-ARCHIVE-STEP11-GAME-CREATE-CONVERSION-PART1.md`'s "Decision 0" considered `generateClient<Schema>({ authMode: 'iam' })` + `allow.resource(fn)` for restoring `onCreateGame` and explicitly declined it — no in-repo precedent, needs its own validation cycle. Confirmed still true: no `amplify/functions/**` handler configures `generateClient`/`Amplify.configure` today (only `amplify/seed/seed.ts` does, in a non-Lambda context). B2 is a legitimate case where the tradeoff flips — unlike that earlier decision, a live subscription genuinely is the point here — but that makes this a **deliberate, first-of-its-kind exception**, not a copy-paste of an established pattern, and it needs to be treated with the same care as B1's guest-auth work got.

**Validation spike — completed and conclusive.** A throwaway spike Lambda was built, deployed to a real Amplify sandbox, invoked, and the result independently verified against the live AWS account (not just the Lambda's own claimed response), then the sandbox was fully torn down (confirmed via direct `describe-stacks`/`get-function`/`describe-table` calls returning "does not exist," not just a CLI exit code). Findings:

1. **The mechanism works, live-verified.** The spike's `Goal` write via `generateClient<Schema>({ authMode: 'iam' })` persisted to DynamoDB with `coaches` exactly as supplied — no owner-field auto-population surprises. Confirmed it genuinely went through AppSync's mutation resolver, not a disguised raw write: the spike Lambda's IAM execution role was inspected directly and has **zero DynamoDB permissions of any kind** (not even the basic-execution-role's usual grants extend to data-plane access) — only `appsync:GraphQL`, `s3:GetObject` (model introspection), and `ssm:GetParameters`. A raw `PutItem` from this role would have been hard-denied by IAM; the write could only have succeeded via AppSync's own resolver pipeline (running under AppSync's separate service role). Corroborated by `__typename: "Goal"` stamped on the persisted item (an AppSync resolver artifact, not something a bare `PutCommand` produces) and CloudWatch logs showing a full GraphQL-shaped response with server-populated `id`/`createdAt`/`updatedAt`. A live Cognito-authenticated `observeQuery` subscription check specifically could not be completed (creating a test Cognito user was blocked by this environment's own permission classifier, not an AWS or code issue) — but since `observeQuery` subscribes to exactly this class of real `createGoal` GraphQL mutation, subscription delivery follows from the mutation being genuine, not a separate unverified leap.
2. **The exact grant shape in the original draft doesn't exist — corrected during the spike, verified live.** `allow.resource(fn).to(['create'])` on a model's own `.authorization()` array does not typecheck against this repo's installed `@aws-amplify/data-schema` version: `resource` is only exposed on the *schema-level* `AllowModifier` (`a.schema({...}).authorization(...)`), and that level's operations vocabulary is `['query', 'mutate', 'listen']` — there is no `create`/`update`/`delete` distinction available at all, at any level. The deployable, now-live-verified form is:
   ```ts
   // in amplify/data/resource.ts, on the schema itself — not on Goal/Shot/Save individually:
   const schema = a.schema({ /* ...every model... */ })
     .authorization((allow) => [allow.resource(submitStatEvent).to(['mutate'])]);
   ```
   **This means the grant can't be narrowed to `Goal`/`Shot`/`Save`-only, or to `create`-only — it's schema-wide (every model) and verb-wide (`mutate` covers create/update/delete together) by construction.** This is a materially wider IAM blast radius than the original draft assumed, and it isn't a wiring mistake to fix — it's a hard limit of the `allow.resource()` primitive in this Amplify version. **Accepted, with the real narrowing moved to where it actually lives**: `submitStatEvent`'s own handler code is a small, fixed, reviewed surface — it never accepts an arbitrary GraphQL operation from the caller (the public mutation's arguments are `token`/`eventType`/`playerId`/etc., typed and validated; the caller has no way to choose *which* underlying model/verb the handler's `generateClient` call targets) — so the handler's own hardcoded `.create()` call sites on `Goal`/`Shot`/`Save` are the actual boundary, the same way this repo already accepts that IAM is coarser than the real access-control contract for `get-fan-game-view` in B1 (security-reviewer's own language there: "the privacy guarantee rests entirely on handler curation, not on IAM... worst case from a handler bug is [X], never [Y]" — here, worst case from a handler bug in this one Lambda is a write to an unintended model, not an externally-triggerable one, since nothing about the public API surface lets a caller influence which mutation the handler issues). Document this explicitly in the code and in the ARCHITECTURE.md entry below — including that this grant is IAM-role-scoped (to this one Lambda's role, not to guest/public callers directly) and neither team-scoped nor model/verb-scoped beyond what the DSL allows.
3. **Full wiring, confirmed working as deployed** (not just planned — this is what the spike actually ran): the Lambda's `resource.ts` needs `resourceGroupName: 'data'` (every function in this repo that touches data sets this — see `get-fan-game-view/resource.ts`). Inside the handler, use `getAmplifyDataClientConfig(env)` from `@aws-amplify/backend/function/runtime` to obtain both `resourceConfig` and `libraryOptions`, and call `Amplify.configure(resourceConfig, libraryOptions)` with both — not just the GraphQL endpoint URL alone. The schema-level grant above goes in `amplify/data/resource.ts` (not `backend.ts`, which is where table grants/env vars go, not schema authorization rules).
4. **The spike's own throwaway code lives in an isolated worktree, not this branch** — `amplify/functions/spike-iam-write-test/` plus the matching `backend.ts`/`resource.ts` wiring, never merged, to be discarded rather than referenced. The real `submitStatEvent` implementation follows the same shape but as a first-class, reviewed part of this milestone.

This also resolves the score-consistency concern cleanly: since the `Goal` write goes through the real `createGoal` mutation, `GameManagement.tsx`'s existing subscription-fed derivation of `ourScore`/`opponentScore` during play, and its existing completion-time reconciliation, both see the record exactly as they would a coach-submitted one — no special-casing needed after all, but only *because* of the AppSync-write fix above, not by default.

### Lifecycle wiring

- `generate-share-link` (already handles both link types from B1) and `submit-stat-event` both reject `team.status === 'archived'`.
- `archive-team`'s `ShareLink`-revoking sweep already landed in B1 (moved there during B1's own review round, since `ShareLink` exists starting in that milestone) — nothing further needed here. (Confirmed still accurate against the real, committed `archive-team/handler.ts`.)

### Frontend

- `src/components/FanMode/StatTrackerView.tsx` — reuses the curated roster payload from its own `getStatTrackerView` query, fully specified above (B1's review round decided this stays a separate operation from `getFanGameView` rather than a type-gated shared one — see B1's "Decision" section; both compose the shared `shareLinkAccess.ts` validation pipeline). Large tap targets (Goal / Shot / Save, with Assist as Goal's second step per above). **Every tap opens with an Us/Opponent choice before anything else** — `opponentName` comes from `StatTrackerViewResult` (not `FanGameViewResult`, which this page never receives — the original draft's cross-reference was wrong), so this reads naturally as e.g. "Riverside Rovers" vs. "Lakeside FC," not a generic "Us/Them." Picking "Us" proceeds into the existing player-picker flow (scorer/shooter/keeper, then assist for Goal); picking "Opponent" skips straight to a lighter confirm — no player picker, since this app has no opposing roster to attribute it to. **A `SHOT` tap — either side — needs its own on-target/off-target step**, not just the player picker: the mutation's `onTarget` argument is required for `eventType === 'SHOT'` regardless of `forUs`, and the original draft's interaction description never included a UI step to supply it, meaning a helper had no way to produce a valid Shot submission for either path. Add this as a simple two-option choice (matching the mockup's "Did it beat our keeper?" framing for the Opponent case) immediately after the Us/Opponent choice (Opponent path) or after the player picker (Us path).
- **Page-level heading, matching B1's fix**: `StatTrackerView` needs the same real `<h1>` before any `<h2>`s that `FanGameView`'s review round required and shipped (`UI-SPEC.md` §7.14's Accessibility subsection) — state this explicitly now rather than let it be independently rediscovered (or missed) during implementation, since this is a sibling public page sharing the same accessibility bar.
- **Instant-feedback + duplicate-tap guard, borrowing `LineupPanel.tsx`'s `pendingRemovalIds` pattern (PR #172) — including its failure/rollback half, not just the optimistic half.** On tap, immediately disable that target and show a visible "logged!" confirmation (plus an `aria-live="polite"` announcement) before the mutation round-trips — an unauthenticated sideline helper has no other way to confirm a tap landed, and unlike a coach, no self-serve undo if it fires twice. **On a genuine failure** (rate-limited, `GAME_NOT_LIVE` because the game ended mid-tap, mid-session revocation, dropped connection), the target must **re-enable and show a visible inline error** — mirroring exactly what `LineupPanel.tsx:126-148` actually does on a real failure (restore + `handleApiError`), not just the "conflict/already-gone is silently fine" half of that precedent. A false-positive "logged!" on a genuine failure is a *worse* outcome than the duplicate-tap problem this guard exists to solve in the first place — it's a silently lost stat event the helper believes succeeded, with no coach able to recover it since it never got written. No delete/undo for the helper — the coach corrects mistakes via the Milestone A `ShotSaveTracker`/existing `GoalTracker` edit UI, which needs a small "via helper" badge added when `loggedVia === 'HELPER'` (see file list below — neither component has this today; Milestone A only ever wrote `loggedVia: 'COACH'`).
- Tap targets are **56×56px minimum with 12px gaps** between adjacent Goal/Shot/Save targets — deliberately larger than the app's generic 44×44px floor (§4), since this screen's mis-tap cost (no self-serve undo, one-handed, standing) is higher than the app's baseline; this sizing already has an in-repo precedent at UI-SPEC §9.5's bottom-sheet rows.
- Player pickers (Goal scorer/assist, Shot shooter, Save keeper) need an explicit "skip / unknown player" affordance, since `playerId` is optional in the mutation for every event type (see the validation rules above) — a helper shouldn't be stuck trying to identify a jersey number mid-play.
- Poll `getStatTrackerView` (same 10-15s/visibility-paused/resume-repoll cadence as `FanGameView`, per B1's established pattern) rather than loading once at mount, so a helper who opens the link before kickoff sees the tap UI unlock without a manual reload, and a mid-game substitution appears in the picker promptly. **Decouple roster refresh from game-state polling cadence where practical** — a team's active roster changes far less often than the game clock; polling it at the same 10-15s cadence as everything else is not wrong, just an efficiency note carried over from `get-fan-game-view`'s own roster-fetch cost concern (below).
- Handle **mid-session token revocation** explicitly (not just an initial-load rejection) — if the coach regenerates the `STAT_TRACKER` link while a helper's page is open, the next poll should surface a clear "this link is no longer active" state (the `INVALID_LINK` branch of `StatTrackerViewResult.state`), not a silent stall. Explicit "game not in progress" gate before the tap UI is shown at all, driven by the same `state` discriminator — mirror `FanGameView`'s pattern of deriving UI state from a server-supplied discriminator rather than ad-hoc client-side status checks.
- **Stylesheet**: extends `src/components/FanMode/FanMode.css` (already written generically enough for this — see its own header comment) — **not** a new stylesheet, and definitely not `App.css`, for the same code-splitting reason B1 established.
- **Responsive behavior**: follow/extend UI-SPEC §7.14's existing Responsive subsection (phone full-width single column; tablet+ content max-width 640px centered) rather than leaving tablet-width behavior for the tap grid, the Us/Opponent sheet, and the player pickers as an implementation-time judgment call.
- File list, complete (the original draft's was incomplete): `src/components/FanMode/StatTrackerView.tsx` (new), `src/components/FanMode/FanMode.css` (extend), `src/AppRouter.tsx` (add the `/track/:token` route — B1 only shipped `/watch/:token`; confirm `main.tsx`'s GA-exclusion regex already covers `/track/` as a bonus check, it should since it matches a `/watch|track/` prefix pattern), `src/components/GameManagement/GoalTracker.tsx` and `ShotSaveTracker.tsx` (add the "via helper" badge — neither has any `HELPER` handling today), `src/types/schema.ts` (re-export the new result types).
- `src/components/InvitationManagement.tsx` — add the `STAT_TRACKER` half of the Share Links section (generate/copy/revoke), completing the UI started in B1, including the same regenerate-confirmation requirement B1 specifies and shipped (more urgent here, since this is the write-capable link) — confirmed B1's `FAN`-link implementation is a faithful, extensible precedent to follow verbatim for copy/variant conventions.

### Docs

- `README.md` — Data Model: **no** `ShareLinkRateLimit` entry (dropped — see Data model above; `FanViewRateLimit` was already added in B1's Docs pass). Features: add "Sideline Stat Tracking (public helper-submitted stats)."
- `CLAUDE.md` — B1 added a guest-auth exception paragraph here that currently states `getFanGameView` "is the first genuinely public/unauthenticated operation in the app," that `ShareLink`/`FanViewRateLimit` "stay fully closed... no client, guest or coach, ever reads/writes them directly," and that "every other model/operation is untouched by this exception." B2 makes every one of those sentences misleading the moment it ships: it adds the app's first unauthenticated **write**, a second guest-reachable query, and `allow.resource()` IAM grants on three coach-owned models (`Goal`/`Shot`/`Save`) that are a real, if narrow, exception to "untouched." Update this paragraph to describe the full, post-B2 picture — this file is the first one every future agent in this pipeline reads, so it can't be allowed to drift stale here specifically. **Missing from the original draft's Docs list entirely.** Same edit pass, second fix: CLAUDE.md's game-timer section currently says "the actual conversion formula lives in `src/utils/gameClock.ts`" (true, from B1) but doesn't yet mention the Lambda-side mirror this milestone adds at `amplify/functions/shared/gameClock.ts` — add one sentence noting the mirror + its parity test, so this section doesn't go one file behind the moment B2 ships.
- `docs/ARCHITECTURE.md` — more than the two items the original draft named: extend the guest-auth exception note to cover `submitStatEvent`/`getStatTrackerView`; document the `allow.resource()` grant pattern — schema-wide and mutate-verb-wide by construction (not per-model, not per-CRUD-verb; the DSL doesn't support finer scoping in this Amplify version, confirmed by the validation spike), with the handler's own fixed call sites as the real boundary — as the reason helper writes appear in real time; add `### Lambda Functions` entries for `submit-stat-event`/`get-stat-tracker-view` (B1 added its four the same way); add `### GraphQL Operations` entries for the two new operations; add `/track/:token` to the `### Navigation Structure` tree (which currently enumerates `/watch/:token` — B2 would otherwise silently leave the tree one route behind).
- `docs/specs/UI-SPEC.md` — mirror §7.14's actual template structure (Route/File/Stylesheet/Layout/Named-states table/Accessibility/Responsive), not just "add an entry" — a Named-States table (matching §7.14's format: state, trigger, copy) covering at minimum game-not-live, mid-session-revocation, rate-limited, and invalid-link is expected as a table, the same way B1's was, not prose. Also: add `/track/:token` to §6's routes table (started in B1 for `/watch/:token`); complete the `STAT_TRACKER` half of §7.9's Share Links subsection; add a `/track/:token` row to §9.4's Help FAB visibility table (B1's own review round explicitly predicted this exact recurrence — "the same gap will recur for `/track/:token` in B2" — so this isn't a new finding, it's the predicted one showing up); add a §13 subsection for the `loggedVia === 'HELPER'` badge (now needed on **both** `GoalTracker.tsx` and `ShotSaveTracker.tsx`, per the file-list fix above), structurally identical to the existing §13.5 "Edited Indicator" pattern.

### Risks / edge cases carried into security + UI review

- Token leakage (screenshot/forwarded link) — mitigated by revoke; consider a shorter default lifetime for `STAT_TRACKER` links specifically, since it's the write-capable one.
- Multiple simultaneous helpers on one link — no locking for v1; duplicate entries are a coach cleanup task via existing edit/delete UI.
- Offline/dropped connection on a public link — no Cognito session means no `useOfflineMutations` queuing; show an inline error + manual retry per the duplicate-tap-guard failure behavior above, don't silently queue. The `clientEventId` idempotency mechanism (or its explicitly-accepted absence) governs what a subsequent retry actually does.
- The `accept-invitation`/`revoke-coach-access` `coaches[]`-backfill gap that `Shot`/`Save` inherit is recorded in Milestone A (where those tables start existing), not here — see that section.
- The `allow.resource()` grant is schema-wide and mutate-verb-wide (every model, create/update/delete together) — not scoped to `Goal`/`Shot`/`Save`, not scoped to `create`, and not team-scoped (see the "Validation spike" section above for why this is a hard DSL limit, confirmed live, not a wiring oversight). This is an accepted, necessary tradeoff of the AppSync-write fix, flagged explicitly for security-reviewer's attention rather than left implicit — the real narrowing is `submitStatEvent`'s own fixed handler code, which never lets a caller choose which model/mutation it targets.

### Tests

- **The validation spike is complete** (see "Validation spike — completed and conclusive" above) — the IAM-authed `generateClient` write mechanism is live-verified against a real deployed sandbox, since torn down. No further spike work gates implementation; `coding-agent` builds the real `submitStatEvent` using the corrected schema-level grant shape directly.
- `submit-stat-event` handler tests: token validation, both rate-limit dimensions (write-prefixed), `GAME_NOT_LIVE` gating (including against the specific tiebroken game, not just "any live game exists"), `GAME_CHANGED` rejection when `expectedGameId` doesn't match the server-resolved game (this is the test that actually exercises the wrong-game-race fix — the `GAME_NOT_LIVE` check alone can't), server-derived `gameSeconds`/`half` correctness (including the paused-within-a-half and halftime cases), `eventType` allowlist rejection, explicit assertion that `coaches[]` is populated from the team's current array (including for opponent-side events), rejection when `forUs === false` but a `playerId`/`assistPlayerId` is supplied, rejection when `forUs === true` and `playerId`/`assistPlayerId` doesn't belong to the token's team roster or when `assistPlayerId === playerId`, and the `SubmitStatEventResult.reason` value for each rejection path.
- `get-stat-tracker-view` handler tests: same token/type/rate-limit/game-selection coverage pattern as `get-fan-game-view`'s tests, plus roster-fetch correctness (`BatchGetItem`, not per-id `GetCommand`).
- `shareLinkAccess.ts` — new tests for the rate-limit dimension parameter (default `'read'` preserves `get-fan-game-view`'s existing tests unchanged) and the corrected live-game tiebreak: two live candidates where the one that should win has no `gameDate` at all (the exact case the first, wrong version of this fix would have gotten backwards), ranked correctly by `lastStartTime`/`updatedAt` instead.
- Parity test for the extracted `gameClock.ts` shared function (client `src/utils/gameClock.ts` vs. Lambda `amplify/functions/shared/gameClock.ts`) — same inputs, identical output, covering running/paused/halftime cases.
- `StatTrackerView.test.tsx` — tap-to-submit flow (including the Goal→Assist two-step and the Shot on/off-target step for both Us and Opponent), the duplicate-tap guard's **both halves** (rapid double-tap produces one submission; a genuine failure re-enables the target and shows a visible error, not a false "logged!"), disabled state when not in-progress, mid-session revocation surfacing, rate-limit error surfacing, page-level `<h1>` present.
- `GameManagement.test.tsx` / `GoalTracker.test.tsx` / `ShotSaveTracker.test.tsx` — "via helper" badge rendering, on both components.
- The write's real-time subscription delivery (the whole point of the AppSync-write fix) is **not** a Vitest-mockable unit test — `observeQuery` delivery is a live-stack behavior. Don't list it as a unit test requirement; it belongs in the Verification section's manual two-browser check below, which already covers it.

## Verification

- `npm run gate:commit` (lint → test:run → build) must be green before each milestone's commit.
- The validation spike (above) is complete and its outcome recorded — B2's real implementation can proceed directly to the write-path mechanism using the corrected grant shape.
- Manually drive both public pages end-to-end in the browser preview: generate a Fan link and a Stat Tracker link from `InvitationManagement.tsx`, open each in a fresh (unauthenticated) browser context, submit a stat from the tracker page, and confirm it appears **live** (no refresh) on a separately-open coach `GameManagement.tsx` session — this specifically proves the AppSync-write fix in the real implementation (the spike already proved the underlying mechanism in isolation; this proves the full feature), not just that data lands in DynamoDB.
- Confirm a revoked, garbage, or never-existent token all render the same generic "this link isn't valid" state instead of an unhandled error, on both public pages.
- Confirm a `SHOT` submission actually requires and correctly persists `onTarget` for both the Us and Opponent paths, end to end through the real UI (not just the handler test) — this was the missing UI step this review round caught.
- Confirm the unauthenticated IAM role's AppSync policy is scoped to the specific field ARNs (`getFanGameView`, `submitStatEvent`) before merging B1/B2 — this check is a merge gate, not a nice-to-have.

## Next step

All three milestones are architecture/security-relevant multi-file changes — run each through the full `dev-pipeline` skill (plan-writer → architect-reviewer → ui-reviewer → coding-agent → parallel validation/security/UI review → commit gate).

**Current status**: **Milestones A and B1 are both implemented, reviewed, and committed** (branch `fan-mode-stat-tracking`). Both went through: a dedicated pre-implementation `architect-reviewer` + `ui-reviewer` round (plus, for A, an extra scoped correction round on a mount-site mislabeling; for B1, a scoped follow-up confirming its fixes) → `coding-agent` implementation → parallel `validation-reviewer`/`security-reviewer`/`ui-reviewer` against the actual diff (B1's security review independently verified the guest-auth IAM scoping against a real local CDK synth) → real, blocking bugs found and fixed post-implementation (A: none at this stage; B1: a poll-error-masks-valid-view bug and a missing page-level heading, both fixed and re-verified) → clean `npm run gate:commit` → commit.

**Milestone B2 has now completed its own dedicated `architect-reviewer` + `ui-reviewer` round, plus a scoped follow-up on both** (Round 6 above), and this revision folds in every finding from both passes. The follow-up caught that the first attempt at the live-game tiebreak fix was itself wrong — it ranked on `gameDate`, which is routinely absent on exactly the abandoned/quickly-created games the fix needs to disambiguate, and its accompanying "belt-and-suspenders" check was inert (every live candidate passed it by construction). Corrected to rank on `lastStartTime`/`updatedAt` instead, with a real `expectedGameId`-echo check on the mutation itself as the actual guard. `ui-reviewer`'s follow-up pass found all five of its original Major findings genuinely resolved with no new issues — clean go.

**The required validation spike has since run to completion** (see B2's "Validation spike — completed and conclusive" section) — deployed to a real Amplify sandbox, verified live (the write persists correctly and demonstrably goes through AppSync's real resolver, confirmed via direct IAM-permission inspection since a full authenticated-subscription check was blocked by this environment, not by AWS or the code), and the sandbox was torn down and independently confirmed gone. The spike also caught and corrected one thing the plan had wrong: the exact `allow.resource(fn).to(['create'])` grant shape doesn't exist in this Amplify version — the deployable form is schema-wide (`a.schema({...}).authorization(...)`) and verb-wide (`mutate`, no per-CRUD-verb distinction), which is now the plan's stated design with the resulting wider IAM blast radius explicitly accepted and reasoned through (the handler's own fixed, reviewed call sites are the real boundary, not IAM — same class of tradeoff this repo already accepted for B1's `get-fan-game-view`). **Milestone B2 is now fully ready for `coding-agent`** — no further `architect-reviewer`/`ui-reviewer` round is needed.
