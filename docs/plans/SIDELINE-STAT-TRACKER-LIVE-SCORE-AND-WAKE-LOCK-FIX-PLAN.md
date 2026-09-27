# Sideline Stat Tracker: Live Score Fix + Screen Wake Lock

Status: Revised after architecture review round 1 — both Major findings (over-provisioned IAM grant; a breaking existing test) and all four Minor findings folded in. Ready for UI review (Bug 2 only), then implementation.
Date: 2026-09-22
Risk tier: **Tier 2**. Per the dev-pipeline skill's Tier-2 path list, this touches `amplify/backend.ts` (new IAM grant + env var), `amplify/functions/**` (new shared module, two handler changes), and `src/utils/gameCalculations.ts` (an explicit Tier-2 path). Bug 2 in isolation (`StatTrackerView.tsx` + its test only) would not qualify for Tier 2 on its own, but it ships in the same change set as Bug 1, so the whole change is planned and reviewed at Tier 2. Treat Bug 2 as UI-review-required regardless (interaction-behavior change on a public page), per the task's explicit flag.

## Summary

Two independent, unrelated fixes bundled into one plan because they land on the same two files/pages:

1. **Bug 1**: `getFanGameView` and `getStatTrackerView` both read `Game.ourScore`/`Game.opponentScore` straight off the DB row, which is only ever written at game creation (0/0) and at game completion (final snapshot) — never during an in-progress/halftime game. Both public pages show a frozen 0-0 for the entire live game. Root cause is pre-existing and already confirmed (not re-derived here); this plan implements the fix.
2. **Bug 2**: `/track/:token` (`StatTrackerView.tsx`) has no screen-wake-lock handling, so a helper's phone sleeps mid-game. `src/hooks/useWakeLock.ts` **already exists** (added for `GameManagement.tsx`, mounted there as `useWakeLock(status === 'in-progress' || status === 'halftime')`, documented in `docs/specs/Game-Management-Spec.md` §6, fully unit-tested in `src/hooks/useWakeLock.test.ts`) — this is a reuse, not a new hook. Grepping `wakeLock` across the repo before writing anything found this hook; the task's own instruction to check for a pre-existing pattern before writing a new one is satisfied by using it as-is.

## Bug 1: file-by-file change list

### 1. `src/utils/gameCalculations.ts` (existing file — export the extracted helper)
Add:
```ts
import type { Goal } from "../types/schema"; // already imported in this file if not already present as a named type

/**
 * Derives the current score from Goal records. This is the single source of
 * truth for "what is the score right now" while a game is active — Game.ourScore/
 * opponentScore in the DB is NOT kept live; it's only written at game creation
 * (0/0) and at game completion (final snapshot, GameManagement.tsx's completed-
 * state reconciliation effect). Any live-score display (CommandBand, Fan Mode,
 * Sideline Stat Tracker) must derive from Goal records, not the Game row, while
 * status is 'in-progress' or 'halftime'.
 *
 * Mirrored by amplify/functions/shared/score.ts's Lambda-side twin (a Lambda
 * can't import from src/) — parity-tested in
 * amplify/functions/shared/score.test.ts. Keep both in sync on any change,
 * same convention as gameClock.ts/gameClock.test.ts and
 * goalkeeper.ts/goalkeeper.test.ts.
 */
export function computeScoreFromGoals(goals: Array<{ scoredByUs: boolean }>) {
  return {
    ourScore: goals.filter(g => g.scoredByUs).length,
    opponentScore: goals.filter(g => !g.scoredByUs).length,
  };
}
```
This corrects the CLAUDE.md-documented "score/half-detection logic lives in `gameCalculations.ts`" convention (and matches `docs/ARCHITECTURE.md`'s own file-purpose table, which already lists `gameCalculations.ts` as owning "score tracking") — today the function actually lives as a private, non-exported copy inside `GameManagement.tsx`. This is a pure move + export, not a behavior change.

### 2. `src/components/GameManagement/GameManagement.tsx` (existing file — remove private copy, import instead)
- Delete the local `computeScoreFromGoals` function (lines ~130–139).
- Add `computeScoreFromGoals` to the existing import from `../../utils/gameCalculations` (check the file's current import list — it likely does not yet import from `gameCalculations.ts` at all, since the function was previously local; add a new import line if so).
- No call-site changes: all three call sites (line ~569 active-state derivation, ~591 completed-state reconciliation, ~1792 `handleEndGame`) keep calling `computeScoreFromGoals(goals)` exactly as today.
- `buildGoalsFingerprint` (lines ~145–148) stays local to `GameManagement.tsx` — it's not needed by either Lambda and isn't part of this plan's parity-module scope.

### 3. `amplify/functions/shared/score.ts` (new file — Lambda-side twin + shared branch policy)
```ts
/**
 * Lambda-side twin of `src/utils/gameCalculations.ts`'s `computeScoreFromGoals`
 * -- IDENTICAL signature (both `{ scoredByUs: boolean }`, non-optional -- Goal.scoredByUs
 * is a.boolean().required() in the schema, so this isn't a defensive-optionality case;
 * callers cast raw Dynamo items at the call site, same as this handler already does for
 * other Goal fields) and semantics, kept in sync per `score.test.ts`'s parity table
 * (mirrors the gameClock.ts/goalkeeper.ts precedent). A Lambda can't import from `src/`,
 * hence the separate copy.
 */
export interface GoalLike {
  scoredByUs: boolean;
}

export function computeScoreFromGoals(goals: GoalLike[]): { ourScore: number; opponentScore: number } {
  return {
    ourScore: goals.filter(g => g.scoredByUs).length,
    opponentScore: goals.filter(g => !g.scoredByUs).length,
  };
}

/**
 * The shared "which score source wins" policy, single-sourced so
 * get-fan-game-view and get-stat-tracker-view can't silently diverge on it
 * (same reasoning as shareLinkAccess.ts's selectUpcomingGames reuse) --
 * LIVE branches derive live from Goal rows; every other branch (FINISHED
 * especially) reads the persisted Game-row snapshot, which is the
 * reconciled source of truth once a game is completed.
 */
export function resolveScore(
  isLive: boolean,
  persisted: { ourScore?: number | null; opponentScore?: number | null } | null,
  goals: GoalLike[],
): { ourScore: number | null; opponentScore: number | null } {
  if (isLive) return computeScoreFromGoals(goals);
  return { ourScore: persisted?.ourScore ?? null, opponentScore: persisted?.opponentScore ?? null };
}
```

### 4. `amplify/functions/shared/score.test.ts` (new file — parity test)
Same shape as `amplify/functions/shared/goalkeeper.test.ts`: a shared `cases` table (empty goals, all-us, all-opponent, mixed) run through both `computeScoreFromGoals` twins (Lambda vs. `src/utils/gameCalculations.ts`'s exported version — both now share the identical `{ scoredByUs: boolean }` signature, so every case runs through both without a cast), asserting both equal the expected value and equal each other. Also add direct (non-parity, Lambda-only) unit cases for `resolveScore`: `isLive: true` ignores `persisted` and returns the goal-derived value; `isLive: false` ignores `goals` and returns `persisted`'s values; `isLive: false` with `persisted: null` returns `{ ourScore: null, opponentScore: null }`.

### 5. `amplify/functions/get-fan-game-view/handler.ts` (existing file)
- Import `resolveScore` from `../shared/score` (not `computeScoreFromGoals` directly — the handler shouldn't re-implement the LIVE-vs-persisted branch policy, see item 3 above).
- The `goals` variable (line 153) is already queried whenever `showEvents` is true (`selection.branch === 'LIVE' || 'FINISHED'`), which is a superset of `isLive` (line 143) — no new query needed, no new env var, no new IAM grant for this handler (it already has `GOAL_TABLE` wired, per `amplify/backend.ts` lines 572/584).
- At the response object (lines 202–217):
  ```ts
  const score = resolveScore(isLive, game, goals as Array<{ scoredByUs: boolean }>);
  // ...
  ourScore: score.ourScore,
  opponentScore: score.opponentScore,
  ```
  Non-`isLive` branches (FINISHED, NO_GAMES_YET, NO_GAME_RIGHT_NOW) keep reading `game.ourScore`/`game.opponentScore` exactly as today via `resolveScore`'s `persisted` fallback — FINISHED in particular must keep using the persisted final snapshot, not a live re-derivation (goals could theoretically still exist/change post-completion via coach edits, and the persisted snapshot is the intentional source of truth once a game is completed, per `GameManagement.tsx`'s completed-state reconciliation effect).
- `goals`'s existing cast (line 153: `Array<{ scoredByUs?: boolean; ... }>`) has `scoredByUs` as optional; `computeScoreFromGoals`'s parameter type is `{ scoredByUs: boolean }` (non-optional, identical on both the client and Lambda twin — see item 3 above). Narrow at this call site: `computeScoreFromGoals(goals as Array<{ scoredByUs: boolean }>)`, consistent with how this same `goals` variable is already cast for `goalEvents` a few lines below (line 178: `g.scoredByUs && g.scorerId`). `Goal.scoredByUs` is `a.boolean().required()` in the schema (`amplify/data/resource.ts:361`), so every real row has it — no runtime coercion needed, this is a type-level cast only, same as the existing casts in this handler.

### 6. `amplify/functions/get-stat-tracker-view/handler.ts` (existing file)
- Add `GOAL_TABLE` to the destructured env vars (alongside `TEAM_ROSTER_TABLE`, `PLAY_TIME_RECORD_TABLE`, etc.) and to the required-env-var null check (line ~205–210).
- Import `resolveScore` from `../shared/score` (not `computeScoreFromGoals` directly — see item 3 above) and `queryAllByGameIdIndex` (already imported, line 6).
- Add a new `isLive` constant, **separate from the existing `isInProgress`** (line 255: `game?.status === 'in-progress'`) — per the task, do not conflate them:
  ```ts
  // Broader than isInProgress (which gates the PlayTimeRecord/goalkeeper
  // query and deliberately excludes halftime, since halftime closes all
  // open PlayTimeRecords). Score must stay live through halftime too --
  // it should not go stale/reset just because the tap UI is locked.
  const isLive = selection.branch === 'LIVE';
  ```
- Add a `goalsRaw` query gated on `isLive`, run inside the existing `Promise.all` alongside `rosterRows`/`openPlayTimeRecordsRaw` (lines 261–266) — it's independent of both:
  ```ts
  const [rosterRows, openPlayTimeRecordsRaw, goalsRaw] = await Promise.all([
    queryActiveRosterByTeamId(teamRosterTable, team.id),
    isInProgress
      ? queryAllByGameIdIndex(docClient, playTimeRecordTable, 'playTimeRecordsByGameId', (game as GameRecord).id)
      : Promise.resolve([]),
    isLive
      ? queryAllByGameIdIndex(docClient, goalTable, 'goalsByGameId', (game as GameRecord).id)
      : Promise.resolve([]),
  ]);
  ```
  (Note `game` is possibly `null` at this point in the existing code — the existing `isInProgress`/`openPlayTimeRecordsRaw` line already guards this the same way via `game?.status` and a cast; follow the same pattern for `isLive`/`goalsRaw`, i.e. compute `isLive` as `game != null && selection.branch === 'LIVE'` so the cast below it is safe, or gate the ternary on `game` directly.)
- Compute `const score = resolveScore(isLive, game, goalsRaw as Array<{ scoredByUs: boolean }>);` once, above the final `return` (after the `!game` early-return block, so `game` is non-null here — `resolveScore`'s `persisted` param accepts `null` too, for symmetry with get-fan-game-view's call site, but it's never actually null at this call site).
- The `!game` early-return block (lines 304–323) is unaffected — `isLive` is structurally false whenever `game` is null (NO_GAMES_YET/NO_GAME_RIGHT_NOW), so that block's `ourScore`/`opponentScore` stay `null` exactly as they do today; leave it as a literal `null`/`null`, no `resolveScore` call needed there (it's a different code path from the one below).
- Update the final return (lines 325–340):
  ```ts
  ourScore: score.ourScore,
  opponentScore: score.opponentScore,
  ```

### 7. `amplify/backend.ts` (existing file — new read grant for `get-stat-tracker-view`)
In the existing `get-stat-tracker-view` grant block (lines ~605–637), mirroring the pattern already used for `get-fan-game-view`'s `GOAL_TABLE`/`goalsByGameId` wiring (lines 572/584):
- Update the block's leading comment to mention the new Goal read.
- **Do NOT add `goalTable.grantReadData(...)`.** That grants full-table `Scan`/`GetItem` plus `Query` on every Goal GSI, not just `goalsByGameId` — over-provisioning a guest/identityPool-reachable Lambda whose handler only ever calls `queryAllByGameIdIndex` against that one GSI. The correct minimal form is already proven for this exact table+index at `get-fan-game-view`'s own grant block (lines 566-576): `goalsByGameId` Query via the `PolicyStatement` only, no `grantReadData` line. (Architecture review Major 1 — the base-table read isn't needed and IAM is the real scoping boundary here, unlike `submitStatEvent` where CLAUDE.md documents the handler code as the real narrowing.)
- Add `${goalTable.tableArn}/index/goalsByGameId` to the existing `dynamodb:Query` `PolicyStatement`'s `resources` array (alongside `gamesByTeamId`, `gsi-Team.roster`, `playTimeRecordsByGameId`) — this alone is sufficient.
- Add `backend.getStatTrackerView.addEnvironment('GOAL_TABLE', goalTable.tableName);` alongside the other `addEnvironment` calls for this Lambda.
- `goalTable` is already an in-scope const at module level (line 121: `const goalTable = backend.data.resources.tables['Goal'];`) — no new table lookup needed.

No `amplify/data/resource.ts` schema change is needed for Bug 1 — `getStatTrackerView`'s GraphQL return type already includes `ourScore`/`opponentScore` (it already returns them today, just from the wrong source); this is a resolver-body/IAM change only, not a shape change.

## Bug 1: data/API impact

- **No schema changes.** No new fields, no new GraphQL operations, no change to either query's return type shape.
- **New IAM grant**: `get-stat-tracker-view`'s Lambda execution role gains read-only `dynamodb:Query` on the Goal table's `goalsByGameId` GSI **only** — no `grantReadData` (no full-table `Scan`/`GetItem`, no access to any other Goal GSI). `computeScoreFromGoals` only reads `scoredByUs` off each item regardless — the response payload is unaffected either way since only two integers cross the API boundary.
- **New env var**: `GOAL_TABLE` on `get-stat-tracker-view` (mirrors the existing pattern for every other table this Lambda touches).
- Response payload shape for both operations is byte-for-byte unchanged — `ourScore`/`opponentScore` were always present fields, only their *value* changes for the live branches.

## Bug 1: risks and edge cases

- **Zero goals so far**: `computeScoreFromGoals([])` returns `{ ourScore: 0, opponentScore: 0 }` — correct, matches today's (accidentally correct) 0-0 display at kickoff. Covered by the parity test's empty-array case.
- **A goal scored by the helper itself mid-poll**: `submitStatEvent` writes the `Goal` row via a real AppSync mutation (per CLAUDE.md's guest-auth exception paragraph), so it's immediately visible to the next `goalsByGameId` Query from either Lambda — no special-casing needed; the existing polling cadence (12s primary / 5s halftime-locked) is the only latency, same as it already is for `recentEvents` on Fan Mode today.
- **Halftime with goals already scored**: `isLive` (both Lambdas) covers `selection.branch === 'LIVE'`, which per `selectGameForFan`/`shareLinkAccess.ts` covers both `in-progress` and `halftime` — so halftime correctly keeps showing the live-derived score rather than reverting to the stale `game.ourScore` snapshot (still 0/0 at that point) or freezing. This is exactly why the task calls out not conflating `isLive` with `get-stat-tracker-view`'s narrower `isInProgress`.
- **Game completes mid-poll**: on the poll immediately after `handleEndGame` persists `status: 'completed'` + the final score snapshot, `selection.branch` flips from `LIVE` to `FINISHED` (assuming it falls in the recency window), and both handlers switch back to reading `game.ourScore`/`game.opponentScore` — which is now the authoritative final snapshot, computed via the same `computeScoreFromGoals` logic at completion time, so there's no visible discontinuity (the last live-derived value and the persisted snapshot should already agree, barring a goal edited/deleted in the same instant, which is an existing, out-of-scope race already covered by `GAME-SCORE-SNAPSHOT-CONCURRENCY-PLAN.md`).
- **A goal later edited or deleted by the coach** (e.g. wrong `scoredByUs` corrected) while the game is still live: both public pages will reflect it on their next poll, same as any other live-derived field already does (on-field lineup, recent events) — this is a strict improvement over today's frozen 0-0, not a new race.
- **`FINISHED` branch with `game.ourScore`/`game.opponentScore` still null** (a pathological/legacy case where a game was marked completed before the score-snapshot reconciliation effect existed, or the reconcile write failed and the retry marker was cleared some other way): unchanged from today's existing `?? null` fallback — not something this plan introduces or needs to fix.

## Bug 1: security review flag

New read-only DynamoDB grant (Goal table, one GSI, Query verb only) added to an already-guest/identityPool-accessible Lambda (`get-stat-tracker-view`). No new mutation capability is introduced. Confirm on review:
- The query is scoped to the current game only, via the token → team → validity → rate-limit → game-selection pipeline already in place (`resolveShareLinkAccess`) — same scoping `get-fan-game-view` already relies on for its own `goalsByGameId` query, no new scoping logic invented here.
- The response payload contract doesn't grow — `computeScoreFromGoals` only ever reads `scoredByUs` off each queried `Goal` item and only ever returns two integers; no `scorerId`, `assistId`, `notes`, or other `Goal` field should be added to either handler's return object as part of this change.

## Bug 2: file-by-file change list

### 1. `src/components/FanMode/StatTrackerView.tsx` (existing file)
- Import `useWakeLock` from `../../hooks/useWakeLock` (existing hook — no new hook file).
- Mount `useWakeLock(viewState === 'LIVE')` inside the component body, alongside the existing state derivations (`viewState` is already computed at line ~204, `tapUiUnlocked` at line ~216) — placed after those so it can reference `viewState` directly. `viewState === 'LIVE'` covers both `in-progress` and `halftime` (mirrors `GameManagement.tsx`'s own `isGameActive = status === 'in-progress' || status === 'halftime'` gate for the same hook), so the lock holds through halftime too, not just while the tap UI is unlocked — a helper's phone shouldn't sleep during a halftime break they're actively waiting out on this page.
- **`FanGameView.tsx` deliberately does NOT get this hook** — a passive fan watching the score has no task a sleeping screen interrupts (unlike a helper mid-tap-sequence), and holding a wake lock for the hours a fan may leave that tab open is a real battery cost with no corresponding benefit. Scope this plan to `StatTrackerView.tsx` only; don't extend it to Fan Mode.
- No changes to the hook itself (`src/hooks/useWakeLock.ts`) — it already re-acquires on `visibilitychange → visible` and releases on `visibilitychange → hidden`/unmount/`isActive` going false, via its own internal listener (see the hook's existing doc comment and tests). This is the same shape already proven correct alongside `GameManagement.tsx`'s own separate polling/subscription `visibilitychange` handling — a second, independent `visibilitychange` listener coexisting with `StatTrackerView.tsx`'s existing polling one (lines ~145–171) is the established pattern, not a hazard; no attempt should be made to thread wake-lock acquisition through the polling effect's own `handleVisibilityChange` — that would couple two independently-testable concerns (polling cadence vs. screen wake) for no benefit.

### 2. `src/components/FanMode/StatTrackerView.test.tsx` (existing test file — add coverage)
Mirror `GameManagement.test.tsx`'s existing `useWakeLock` mock pattern (`vi.mock("../../hooks/useWakeLock", () => ({ useWakeLock: vi.fn() }))`, `const mockUseWakeLock = vi.mocked(useWakeLock)`), and add assertions that:
- `useWakeLock` is called with `true` when `viewState` is `LIVE` (both `in-progress` and `halftime` sub-cases).
- `useWakeLock` is called with `false` for the non-live states (`NEXT_GAME`, `FINISHED`, `NO_GAMES_YET`, `NO_GAME_RIGHT_NOW`, `RATE_LIMITED`, `INVALID_LINK`, `LOADING`).
No new test is needed for the hook's own acquire/release/visibilitychange internals — `src/hooks/useWakeLock.test.ts` already covers that exhaustively; re-testing it here would be redundant. Confirm this test file already exists (`StatTrackerView.test.tsx` presumably already has coverage for `viewState` branching) before assuming a full new file is needed — likely just new `describe`/`it` blocks in the existing file.

## Bug 2: risks and edge cases

- **API unsupported** (Safari desktop, Firefox, iOS < 16.4): `useWakeLock` already no-ops silently (`if (!('wakeLock' in navigator)) return;`) — no behavior change needed, already covered by the hook's existing test (`'no-ops silently when navigator.wakeLock is undefined'`).
- **Permission denied / OS reclaims the lock**: already handled by the hook's existing try/catch around `request()` and the sentinel's own `release` event listener resetting `sentinelRef.current` to `null`.
- **Rapid state transitions** (e.g. `LIVE` → `FINISHED` → back to a new `LIVE` game on the same link, or polling flicker): `useWakeLock`'s effect re-runs on every `isActive` change and is idempotent (guards on `sentinelRef.current !== null` before re-acquiring) — no new risk introduced by wiring a frequently-recomputed `viewState === 'LIVE'` boolean into it, since `GameManagement.tsx` already drives the same hook off an equally frequently-recomputed `gameState.status`.
- **Page hidden at the moment `viewState` flips to `LIVE`** (e.g. helper opens the link while phone is briefly obscured): the hook's `acquire()` checks `document.visibilityState !== 'visible'` and no-ops; its own `visibilitychange` listener picks it up on the next transition to visible, same as `GameManagement.tsx`'s existing usage.

## Docs impact

- **`docs/specs/UI-SPEC.md` §7.15 (Sideline Stat Tracker)**: add a short line documenting the wake-lock behavior, in keeping with this section's existing level of interaction detail (it already documents polling cadence precisely) and matching `docs/specs/Game-Management-Spec.md` §6's phrasing for the same hook. Suggested addition, near the polling-cadence sentence in the section's lead paragraph: "Mounts the same `useWakeLock` hook `GameManagement` uses (`src/hooks/useWakeLock.ts`), active while `state === 'LIVE'` (in-progress or halftime), to prevent the helper's screen from sleeping mid-game; no-ops silently on browsers without Wake Lock API support." No new named-state row or accessibility/responsive-behavior change is implied, so only this one line is needed.
- **`docs/specs/UI-SPEC.md` §7.14 (Fan Mode)**: no change — Bug 1 doesn't alter this page's documented behavior (§7.14 already describes "score" as live-displayed; the fix makes the implementation match the existing spec, it doesn't change the spec).
- **`README.md`**: no change. The "Fan Mode" feature bullet (line 48: "Live score, clock, and lineup") already describes the *intended* behavior Bug 1 restores — this is a correctness fix, not a new capability, so the Features/Data Model sections are already accurate and don't need editing.
- **`docs/ARCHITECTURE.md`**: the file-purpose table (line 402) needs no change (already correct, per above), but **`docs/ARCHITECTURE.md:444`, the per-Lambda data-access description for `get-stat-tracker-view`, does need one line added.** It already documents the same category of addition in the same shape for Save Auto-Goalkeeper Attribution ("when `game.status === 'in-progress'`, also queries `PlayTimeRecord`'s `playTimeRecordsByGameId` GSI and batch-gets `FormationPosition` … (two new env vars/IAM grants — see `amplify/backend.ts`)") — extend that sentence (or add a parallel one) to name the new `Goal`/`goalsByGameId` read, gated on `isLive`, with its new env var/IAM grant. This is the one place a security reviewer goes to answer "what can this unauthenticated Lambda touch?" — leaving it out makes that answer silently incomplete.
- **`CLAUDE.md`**: the "Game timer is client-side" section's parity-tested dual-copy enumeration (currently naming `gameClock.ts`↔Lambda twin and `playTimeCalculations.ts`'s `getCurrentGoalkeeperId`↔`goalkeeper.ts`'s `computeActiveGoalkeeperId`) should get a third entry for `gameCalculations.ts`'s `computeScoreFromGoals`↔`amplify/functions/shared/score.ts`'s twin — that list is what a future agent greps for the "keep both in sync" invariant.
- **`docs/specs/Game-Management-Spec.md` §6**: currently reads "`useWakeLock(isActive)` is mounted in `GameManagement`…" — add a one-clause cross-reference noting it's now also mounted in `StatTrackerView` (`docs/specs/UI-SPEC.md` §7.15), so the hook's two consumers are discoverable from either doc.
- No `docs/plans/GAME-SCORE-SNAPSHOT-CONCURRENCY-PLAN.md` conflict: that plan's §3.2 already anticipates a `computeScoreFromGoals`/`buildGoalsFingerprint` extraction inside `GameManagement.tsx`'s own scope; this plan's export to `gameCalculations.ts` is compatible with (a superset of) that.

## Test strategy

1. **`amplify/functions/shared/score.test.ts`** (new) — parity test, `computeScoreFromGoals` (Lambda twin) vs. `src/utils/gameCalculations.ts`'s exported version, same shape as `goalkeeper.test.ts`: empty goals, all-us, all-opponent, mixed, single goal.
2. **`src/utils/gameCalculations.test.ts`** (existing file, if present — check for it; create if not) — direct unit coverage of the newly-exported `computeScoreFromGoals`, since it no longer has any coverage via `GameManagement.tsx`'s existing component-level tests alone once it moves out of that file's private scope. Confirm `GameManagement.test.tsx`'s existing score-derivation assertions (around the "Active-state score derivation" and "Completed-state reconciliation" effects) still pass unmodified after the import swap — they exercise behavior, not the function's location, so they shouldn't need edits, but must be re-run to confirm the import change didn't break anything.
3. **`amplify/functions/get-fan-game-view/handler.test.ts`** (existing file) — add cases: LIVE branch with goals present returns the goal-derived score (not `game.ourScore`); LIVE branch with zero goals returns `0`/`0`; FINISHED branch still returns `game.ourScore`/`game.opponentScore` unchanged (regression guard against accidentally widening the live-derivation branch).
4. **`amplify/functions/get-stat-tracker-view/handler.test.ts`** (existing file) — add cases: `in-progress` (isLive && isInProgress) with goals returns goal-derived score; `halftime` (isLive && !isInProgress) with goals returns goal-derived score (the specific case that proves `isLive`/`isInProgress` aren't conflated); FINISHED/NEXT_GAME/no-game branches keep returning `game.ourScore`/`game.opponentScore` or `null` as today; confirm the new `GOAL_TABLE` env var is included in the test's `setEnv()` helper (required, or the handler's env-var guard throws).
   **Required rewrite (architecture review Major 2 — do not skip):** the existing test at `handler.test.ts:360-394`, `it('a LIVE in-progress game echoes elapsedSeconds/lastStartTime/halfLengthMinutes/ourScore/opponentScore')`, mocks a LIVE game with `ourScore: 3, opponentScore: 1` and no Goal-table Query response, then asserts `result.ourScore`/`opponentScore` equal `3`/`1` — that assertion is exactly the "echo the persisted field" behavior this plan removes, and will fail once the LIVE branch derives from `goalsRaw` instead. Rewrite it (rename to drop "echoes … ourScore/opponentScore" from its title, since elapsedSeconds/lastStartTime/halfLengthMinutes still *do* echo and stay in this test) to mock the Goal-table Query returning e.g. 3 `{ scoredByUs: true }` + 1 `{ scoredByUs: false }` rows, keep the mocked `game.ourScore`/`opponentScore` fields set to *different* values (e.g. `9`/`9`) specifically so the assertion proves derivation-from-goals rather than incidentally matching an echo, and assert `result.ourScore === 3` / `result.opponentScore === 1`. Note the resulting general payload-contract change: on the LIVE branch, `ourScore`/`opponentScore` are now always numbers (never `null`) even with zero goals (`resolveScore` returns `computeScoreFromGoals([])` = `{0, 0}`) — both `StatTrackerView.tsx:458` and `FanGameView.tsx:216,237,137,139` already do `data?.ourScore ?? 0`, so this has no client-side impact, but a new handler test case should assert the zero-goals LIVE case returns `0`/`0` (not `null`/`null`) to lock in the contract.
5. **`src/components/FanMode/StatTrackerView.test.tsx`** (existing file) — new `useWakeLock` mock assertions per the Bug 2 file-by-file section above.
6. `npm run gate:commit` (lint → test:run → build) once at the end, per CLAUDE.md/dev-pipeline convention — not on every intermediate step.
7. No new Playwright/e2e coverage is proposed — Wake Lock API isn't reliably scriptable in Playwright's default browser contexts without extra flags, and the live-score fix is fully covered at the handler/unit level; the existing `test:e2e:smoke` suite (if it touches `/track/:token` or `/watch/:token`) should still be re-run as a regression check but doesn't need new assertions added.

## Sequencing

1. `src/utils/gameCalculations.ts` export + `GameManagement.tsx` import swap (independent of everything else, safe to land first, zero behavior change).
2. `amplify/functions/shared/score.ts` + `score.test.ts` (depends on step 1 existing for the parity test's import).
3. `amplify/backend.ts` IAM/env grant for `get-stat-tracker-view` (must land before or alongside step 4's handler change — the handler will throw on the missing-env-var guard otherwise, though this only matters at deploy time, not for local unit tests which set env vars directly).
4. `get-fan-game-view/handler.ts` and `get-stat-tracker-view/handler.ts` changes (can happen in parallel with each other, both depend on step 2).
5. `StatTrackerView.tsx` wake-lock wiring (fully independent of steps 1–4; can land in any order relative to them).
6. Docs updates (UI-SPEC.md §7.15 line).
7. `npm run gate:commit` at the end.
