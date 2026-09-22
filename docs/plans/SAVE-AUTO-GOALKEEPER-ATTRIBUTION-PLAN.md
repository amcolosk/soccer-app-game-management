# Save Auto-Goalkeeper Attribution (Coach + Helper)

Status: Architecture-approved (round 1: 1 Major + 7 Minor folded in; round 2: 1 Major — the Option A/B fork — struck in favor of mandated Option A, confirmed as a mechanical fix not requiring further re-review) — ready for UI review, then implementation
Date: 2026-09-20
Risk tier: **Tier 2** (per the orchestrating thread's `classify:risk-tier` output — authoritative). Reasons: touches `amplify/data/resource.ts` (schema change) and `amplify/functions/**` (new Lambda read logic, new env vars, new IAM grants on the guest-auth `getStatTrackerView` path), and derives from `PlayTimeRecord`, a CLAUDE.md-documented sensitive area ("Play time is derived from granular enter/exit records").

## Critical correction to the investigation this plan was handed

The task's "already confirmed by investigation" facts state the goalkeeper role lives on `FieldPosition.role`, and that the Lambda should "query PlayTimeRecord for open records joined to FieldPosition role." **This is incorrect for how the app actually behaves at runtime**, and the distinction is load-bearing for this feature:

- `amplify/data/resource.ts`: `role: a.enum([...])` (the `GOALKEEPER`/`DEFENDER`/`MIDFIELDER`/`FORWARD` enum) is declared on **`FormationPosition`** (line 56), not `FieldPosition`. `FieldPosition` (lines 155–169) has no `role` field at all — never did.
- More importantly, `FieldPosition` is **not actually populated by any current create path** in this codebase. I grepped `src/` for `models.FieldPosition` (the Amplify client call that would create/read it) and found zero *write* call sites. It is, however, still **read** — `src/components/SeasonReport.tsx:92` does `useAmplifyQuery('FieldPosition', { filter: { teamId: { eq: team.id } } }, [team.id])` as one half of its dual legacy/current-era position-map merge (see next bullet). So `FieldPosition` is legacy-read-only, not dead — a future reader should not conclude it's safe to delete the model. `useTeamData.ts` — the hook `GameManagement.tsx` uses for its `positions` variable — subscribes to `client.models.FormationPosition.observeQuery(...)`, not `FieldPosition`. Every live-game write path that sets a `positionId` (`LineupAssignment`, `Substitution`, `PlayTimeRecord`, via `GameManagement.tsx`'s `createPlayTimeRecord` calls at lines 1534/1743, sourced from `LineupPanel`'s `positions: FormationPosition[]` prop) is populated with **`FormationPosition` ids**, despite the schema declaring `position: a.belongsTo('FieldPosition', 'positionId')` on those models.
- This drift is independently confirmed, in-repo, by `src/components/SeasonReport.tsx:139-159` (built from the `FieldPosition` query at line 92 plus a separate `FormationPosition` query): `// Support both legacy team FieldPosition ids and formation-scoped FormationPosition ids persisted in lineup/play-time records.` — it queries **both** tables and merges them into one `positionId → {positionName, sortOrder}` map, because current-era records use `FormationPosition` ids and only old/legacy data might use real `FieldPosition` ids. `docs/ARCHITECTURE.md`'s "Two Position Models" section describes the aspirational/original design (`FieldPosition` = the team-specific runtime position); the actual frontend does not follow it for any team created under the current codebase.
- Existing precedent for exactly this goalkeeper lookup already exists in `GameManagement.tsx:981`: `const goaliePos = positions.find(p => p.role === 'GOALKEEPER')`, where `positions` is the `FormationPosition[]` from `useTeamData`, and `goaliePositionId` is then compared directly against `LineupAssignment`/`PlayTimeRecord` `positionId` values inside `src/services/rotationPlannerService.ts`. That comparison only works because both sides are `FormationPosition` ids.

**Architecture review confirmed (2026-09-20): this correction is correct, no further plan change needed on this point.** Both the coach-side util and the Lambda-side mirror key their GOALKEEPER-role lookup off **`FormationPosition`**, not `FieldPosition`, as originally planned.

**Follow-up needed (not filed by this plan)** — flagging concretely, since I can't file a GitHub issue myself: `amplify/functions/get-fan-game-view/handler.ts:56-70` (`getFieldPositionsByIds`, and its call site around lines 168/184/189) queries `FIELD_POSITION_TABLE` for `onFieldPlayers[].positionName`, which is the same drift — for any current-era team, `PlayTimeRecord.positionId` holds `FormationPosition` ids, so this lookup against the `FieldPosition` table is a guaranteed-empty `GetCommand` per on-field player, and `positionName` silently degrades to `null` on the public Fan Mode view. Pre-existing, not introduced by this plan, out of scope here (it doesn't touch the Save/goalkeeper feature) — the orchestrating thread should file this as a follow-up ticket rather than let it stay an inline comment.

**Free cleanup opportunity, optional, not required by this plan:** `src/hooks/useTeamData.test.ts:153` has a test named "subscribes to FieldPosition..." for code that actually subscribes to `FormationPosition` — a stale test name unrelated to test correctness. Worth a one-line rename if the implementer happens to be in that file for this change, but not worth a special trip on its own.

## Desired behavior (unchanged from the request)

1. Coach-side `ShotSaveTracker.tsx`: pre-populate the Save entry/edit modal's goalkeeper field with the player currently occupying a GOALKEEPER-role position (per an open `PlayTimeRecord`), when unambiguous. Still a real, overridable `PlayerSelect`.
2. Helper-side: `getStatTrackerView` additionally returns `activeGoalkeeperId: string | null`; `StatTrackerView.tsx` skips straight to a confirm-with-override step for a "Us" Save when it names a roster player, else falls back to today's full picker.
3. Two separate implementations of the same concept (Lambda can't import `src/`), cross-referenced in comments, mirroring the `gameClock.ts` pairing.

## File-by-file change list

### 1. `src/utils/playTimeCalculations.ts` (coach-side derivation — new)
Add:
```ts
export interface PositionRoleLookup {
  id: string;
  role?: string | null;
}

/**
 * Determine the single player currently occupying a GOALKEEPER-role
 * position, based on currently-open (no endGameSeconds) PlayTimeRecords.
 *
 * `positions` must be FormationPosition-shaped (id + role) -- despite
 * PlayTimeRecord.positionId's schema-level `belongsTo('FieldPosition', ...)`,
 * every current-era write path (GameManagement.tsx's createPlayTimeRecord
 * calls, sourced from LineupPanel's FormationPosition-typed `positions` prop)
 * actually populates positionId with FormationPosition ids -- same precedent
 * as GameManagement.tsx:981's `positions.find(p => p.role === 'GOALKEEPER')`
 * and SeasonReport.tsx's dual FieldPosition/FormationPosition position-map
 * merge (its own comment: "Support both legacy team FieldPosition ids and
 * formation-scoped FormationPosition ids persisted in lineup/play-time
 * records"). Do not swap this to FieldPosition without re-verifying that
 * precedent.
 *
 * Mirrors amplify/functions/shared/goalkeeper.ts's computeActiveGoalkeeperId
 * (Lambda-side pure twin, can't import from src/, so it's a separate
 * implementation of the same concept, parity-tested in goalkeeper.test.ts)
 * -- keep both in sync.
 *
 * Returns null whenever the goalkeeper is NOT unambiguous: no
 * GOALKEEPER-role position at all, no open record at one, or more than one
 * *distinct* player with an open record at a GOALKEEPER-role position
 * simultaneously. Callers fall back to their existing empty/optional picker
 * behavior in every one of those cases rather than guessing.
 *
 * PRECONDITION: `playTimeRecords` must already be scoped to a single game.
 * This function does no gameId filtering itself -- it is safe today only
 * because every current caller (useGameSubscriptions, and this feature's new
 * ShotSaveTracker call site) already passes single-game-scoped records. Its
 * Lambda-side twin (computeActiveGoalkeeperId /
 * amplify/functions/shared/goalkeeper.ts) is game-scoped by construction
 * (its records come from a per-gameId GSI query) and is not at risk of this;
 * a future coach-side caller passing multi-game records would silently get
 * permanent ambiguity/null instead of a crash, so don't relax this
 * precondition without adding an explicit gameId filter.
 */
export function getCurrentGoalkeeperId(
  playTimeRecords: PlayTimeRecord[],
  positions: PositionRoleLookup[]
): string | null {
  const goalkeeperPositionIds = new Set(
    positions.filter(p => p.role === 'GOALKEEPER').map(p => p.id)
  );
  if (goalkeeperPositionIds.size === 0) return null;

  const openGoalkeeperPlayerIds = new Set(
    playTimeRecords
      .filter(r =>
        (r.endGameSeconds === null || r.endGameSeconds === undefined) &&
        r.positionId != null &&
        goalkeeperPositionIds.has(r.positionId)
      )
      .map(r => r.playerId)
  );

  if (openGoalkeeperPlayerIds.size !== 1) return null;
  return [...openGoalkeeperPlayerIds][0];
}
```
No changes to any existing export in this file.

### 2. `src/components/GameManagement/ShotSaveTracker.tsx`
- Add `positions: FormationPosition[]` to `ShotSaveTrackerProps` (type already re-exported from `./types`, no `types.ts` edit needed).
- Import `getCurrentGoalkeeperId` from `../../utils/playTimeCalculations`.
- `handleOpenEntryModal`: when `statView === "saves" && isUs`, compute `getCurrentGoalkeeperId(playTimeRecords, positions)` and prefill `entryPlayerId` with it (else `""`, unchanged today's behavior). Shots are untouched.
- `handleOpenEditModal`: only prefill when the item being edited has **no existing** `playerId` (`item.playerId` falsy) and `statView === "saves"` — never override an already-recorded attribution. Existing edit-modal behavior (showing `item.playerId ?? ""`) is otherwise unchanged.
- No JSX/markup changes — the `PlayerSelect` stays exactly as-is; only the initial state value differs. `onFieldPlayerIds` already includes any player with an open `PlayTimeRecord` (via `isPlayerCurrentlyPlaying`), so a pre-filled goalkeeper always renders correctly under the "🟢 On Field" optgroup.
- `handleOpenEditModal` is currently a `useCallback(..., [statView])`; once it reads `playTimeRecords`/`positions` to compute the prefill, both must be added to its dependency array to satisfy the zero-warnings lint gate (`npm run lint`) — do not suppress the exhaustive-deps rule to avoid this.

### 3. `src/components/GameManagement/GameManagement.tsx`
- Add `positions` (already loaded via `useTeamData` at line 337, already used elsewhere in this file) to the `sharedGoalTrackerProps` object (~line 2159) so it flows into `ShotSaveTracker` at all three mount sites (scheduled/in-progress/completed tab panels, lines 2427/2598/2702). `GoalTracker` receives the same shared prop bag and simply ignores the added key (structurally safe, not an object literal so no excess-property error).

### 4. `amplify/data/resource.ts`
Add one field to the existing `StatTrackerViewResult` customType (no new model, no `coaches[]` implications — this is a curated Lambda-response shape, not an owned record):
```ts
StatTrackerViewResult: a.customType({
  ...
  roster: a.ref('StatTrackerPlayer').array(),
  // Id of the player currently occupying a GOALKEEPER-role position, per an
  // open PlayTimeRecord -- null when not LIVE, ambiguous, or the team has no
  // GOALKEEPER-role FormationPosition. See getCurrentGoalkeeperId
  // (src/utils/playTimeCalculations.ts, coach-side) and
  // computeActiveGoalkeeperId (amplify/functions/shared/goalkeeper.ts,
  // Lambda-side pure twin) -- same concept, two implementations, kept in
  // sync per CLAUDE.md's gameClock.ts precedent (see also goalkeeper.test.ts).
  activeGoalkeeperId: a.string(),
}),
```

### 5. `amplify/functions/shared/dynamo.ts` (extract, decided by architecture review — do not re-litigate)
Architecture review resolved the plan's open "extract vs. duplicate" question: extract into this **already-existing** file (not `shareLinkAccess.ts`, not a new `dynamoQueries.ts`) — it already holds exactly this kind of generic, docClient-parameterized DynamoDB primitive (its existing `scanAll` export). Read this file's current conventions before writing the new export so it matches.
- Add a new export, matching `scanAll`'s parameter-passing convention (doc client passed explicitly, not closed over):
  ```ts
  export async function queryAllByGameIdIndex(
    docClient: DynamoDBDocumentClient,
    tableName: string,
    indexName: string,
    gameId: string,
  ): Promise<DbItem[]>
  ```
  Body is `get-fan-game-view/handler.ts`'s current local `queryAllByGameIdIndex` (lines ~72-92), moved verbatim except that its module-level `docClient` closure becomes this explicit first parameter. Needs `QueryCommand` added to this file's existing `@aws-sdk/lib-dynamodb` import.
- **Reword the file's doc comment.** It currently scopes the whole file as "Used by the new calendar-import Lambdas only" (or equivalent) — that scope guard describes `scanAll` specifically (a real per-team full-table scan, acceptable only for that Lambda's usage pattern per its own comment), not the file. Move/rephrase so the file-level comment doesn't imply the new `queryAllByGameIdIndex` export inherits a "calendar-import only" restriction it doesn't have — it needs to be genuinely reusable by `get-fan-game-view` and `get-stat-tracker-view` too.
- Out of scope for this plan (architecture review's explicit ruling, do not fold in here): `shareLinkAccess.ts`'s `queryAllGamesByTeamId` stays separate — different key/branch semantics, and merging it would touch all three guest Lambdas rather than just these two. At most worth a separate future follow-up, not part of this change.

### 6. `amplify/functions/shared/goalkeeper.ts` (new — pure Lambda-side mirror, Major finding)
Architecture review's Major finding: the originally-planned `computeActiveGoalkeeperId` living inside `get-stat-tracker-view/handler.ts` and doing its own DynamoDB I/O would be untestable for parity against the pure coach-side `getCurrentGoalkeeperId` — that breaks CLAUDE.md's actual `gameClock.ts` precedent, which is a **pure** module parity-tested via `it.each` against the `src/` copy. Fix: split into a pure function here, with a thin I/O wrapper left in the handler.
```ts
export interface PlayTimeRecordLike {
  playerId: string;
  positionId?: string | null;
  endGameSeconds?: number | null;
}

export interface PositionRoleLike {
  id: string;
  role?: string | null;
}

/**
 * Lambda-side twin of src/utils/playTimeCalculations.ts's
 * getCurrentGoalkeeperId -- same signature shape, same semantics, kept in
 * sync per goalkeeper.test.ts's parity table (mirrors gameClock.ts /
 * gameClock.test.ts's existing pure-module parity-test precedent). A Lambda
 * can't import from src/, hence the separate copy.
 *
 * Ambiguity is judged on distinct PLAYERS, not distinct positions (one
 * player at two GOALKEEPER-role positions simultaneously is still
 * unambiguous). endGameSeconds is treated as "open" only when null or
 * undefined -- explicitly NOT a falsy check, since endGameSeconds === 0
 * (closed at kickoff) must count as closed, not open.
 *
 * PRECONDITION: `playTimeRecords` must already be scoped to a single game.
 * Safe by construction here -- the handler's caller queries PlayTimeRecord
 * via the gameId GSI before calling this.
 */
export function computeActiveGoalkeeperId(
  playTimeRecords: PlayTimeRecordLike[],
  positions: PositionRoleLike[],
): string | null {
  // identical body/logic to src/utils/playTimeCalculations.ts's
  // getCurrentGoalkeeperId -- see that file for the annotated version.
}
```
- The I/O wrapper (query PTR by gameId GSI, collect distinct `positionId`s, `BatchGetCommand` on `FormationPosition` for their roles) stays in `get-stat-tracker-view/handler.ts` (see §8 below) and calls this pure function with the assembled arrays.

### 7. `amplify/functions/shared/goalkeeper.test.ts` (new — required parity test, Major finding)
`it.each` parity table importing **both** copies — the new pure `computeActiveGoalkeeperId` from `./goalkeeper` and `getCurrentGoalkeeperId` from `../../../src/utils/playTimeCalculations` — asserting identical output for the same input pair, mirroring `gameClock.test.ts`'s existing "parity with src/utils/gameClock.ts" describe block. Required cases:
- No GOALKEEPER-role position at all → `null`.
- Exactly one open record at a GOALKEEPER-role position → that player's id.
- Two different players with open records at two different GOALKEEPER-role positions → `null` (ambiguous).
- One player with open records at two different GOALKEEPER-role positions simultaneously → that player's id (still unambiguous — same player, proves ambiguity is judged on distinct players, not distinct positions).
- A closed record (`endGameSeconds` set to a real number) at a GOALKEEPER-role position is excluded from consideration.
- `endGameSeconds === 0` is treated as closed, not open — explicit regression case for the "not a falsy check" rule; a naïve `!record.endGameSeconds` check would wrongly treat this as open and this case must fail against that implementation.
- `positionId` null/undefined on a record → excluded, doesn't crash.
- Empty `playTimeRecords` and/or empty `positions` arrays → `null`, doesn't crash.

### 8. `amplify/functions/get-stat-tracker-view/handler.ts`
- Add env vars read: `PLAY_TIME_RECORD_TABLE`, `FORMATION_POSITION_TABLE` (added to the existing required-env-var guard).
- Import `queryAllByGameIdIndex` from `../shared/dynamo` (passing this file's module-level `docClient`, `PLAY_TIME_RECORD_TABLE`, the confirmed physical index name `playTimeRecordsByGameId`, and `game.id`) instead of a local copy.
- Add `batchGetFormationPositionRoles(table, ids): Promise<Map<string, {role?: string|null}>>` — same chunked `BatchGetCommand` pattern already used in this file for `batchGetPlayers`, projecting `id, role`.
- Thin I/O wrapper `computeActiveGoalkeeperId` (handler-local name is fine even though it now delegates to the shared pure function of almost the same name — rename the local wrapper to something like `fetchActiveGoalkeeperId` to avoid the collision, and call `computeActiveGoalkeeperId` from `../shared/goalkeeper` inside it):
  1. Query `PlayTimeRecord` by `gameId` via `queryAllByGameIdIndex`.
  2. Filter to open records (`endGameSeconds` null/undefined).
  3. Collect distinct `positionId`s from those, batch-get their `role` from `FormationPosition` via `batchGetFormationPositionRoles`.
  4. Call the pure `computeActiveGoalkeeperId` (from `../shared/goalkeeper`) with the open records and the fetched position-role map/array.
  - Comment cross-references both `getCurrentGoalkeeperId` in `src/utils/playTimeCalculations.ts` and the shared pure twin.
- **Gate on `game.status === 'in-progress'`, not `selection.branch === 'LIVE'`** (architecture review Minor finding — tightened from the original plan). `LIVE` also covers `halftime` (see `shareLinkAccess.ts`'s `selectGameForFan`), and halftime closes every open `PlayTimeRecord` — gating on `LIVE` would mean every helper poll during halftime wastes a GSI query + `BatchGetItem` that's guaranteed to return `null`, while the Stat Tracker's own tap UI is already locked at halftime anyway (`StatTrackerView.tsx`'s `tapUiUnlocked` already keys off `data?.status === 'in-progress'`). Every branch that isn't `in-progress` (`NO_GAMES_YET`, `NO_GAME_RIGHT_NOW`, `NEXT_GAME`, `FINISHED`, halftime, `INVALID_LINK`, `RATE_LIMITED`) returns `activeGoalkeeperId: null` without the extra query.
- **Parallelize the new round-trip with the existing roster fetch** (architecture review Minor finding). Today's handler does sequential awaits: `queryActiveRosterByTeamId` then `batchGetPlayers`. Issue the new PlayTimeRecord GSI query concurrently with `queryActiveRosterByTeamId` via `Promise.all` (follow `get-fan-game-view/handler.ts`'s existing `Promise.all` pattern for its own PTR/goals/substitutions queries). The `FormationPosition` `BatchGetCommand` depends on the PTR query's result (needs its distinct `positionId`s first), so it can't join that same `Promise.all` — run it right after the roster/PTR pair resolves, then call `batchGetPlayers` and the goalkeeper derivation off those results.
- Add `activeGoalkeeperId: null` to `emptyResult()` and the no-game return branch; add the computed value to the final return branch.

### 9. `amplify/functions/get-fan-game-view/handler.ts` (now touched by this plan — architecture review Item 2)
Extracting `queryAllByGameIdIndex` into `shared/dynamo.ts` (§5) means this file's own copy must be deleted and its three call sites updated, since two near-identical copies is exactly the duplication the extraction was meant to remove:
- Delete the local `queryAllByGameIdIndex` function (current lines ~72-92).
- Import `queryAllByGameIdIndex` from `../shared/dynamo` instead.
- Update its three call sites (current lines ~168-170, the `Promise.all` for `openPlayTimeRecordsRaw`/`goalsRaw`/`substitutionsRaw`) to pass this file's existing module-level `docClient` as the new first argument.
- No behavior change intended — same table names, same index names, same query semantics, just sourced from the shared module.

### 10. `amplify/functions/get-fan-game-view/handler.test.ts` (now touched by this plan — architecture review Item 2)
No new test cases required by this plan (this file's behavior is unchanged) — flagging it as touched because the underlying helper it exercises moves modules. Existing tests mock `send` on the doc-client instance already, so they should keep passing once `docClient` is threaded through as an explicit parameter rather than closed over. **This needs verifying during implementation** — if any existing test mocked the old module-local `queryAllByGameIdIndex` directly (rather than mocking `docClient.send`), it will need updating to match the new shared-module shape.

### 11. `amplify/backend.ts`
In the existing "get-stat-tracker-view" grants block (~line 605-628):
- `playTimeRecordTable.grantReadData(backend.getStatTrackerView.resources.lambda);`
- `formationPositionTable.grantReadData(backend.getStatTrackerView.resources.lambda);` (plain table read — `BatchGetItem` on the base table, same as the existing `playerTable.grantReadData` line; no extra `PolicyStatement` needed for this one, only for GSI `Query`s)
- Extend the existing `PolicyStatement({ actions: ['dynamodb:Query'], resources: [...] })` array to add `` `${playTimeRecordTable.tableArn}/index/playTimeRecordsByGameId` ``.
- `backend.getStatTrackerView.addEnvironment('PLAY_TIME_RECORD_TABLE', playTimeRecordTable.tableName);`
- `backend.getStatTrackerView.addEnvironment('FORMATION_POSITION_TABLE', formationPositionTable.tableName);`
- Update the existing comment block above this section to mention the new reads.
- Both `playTimeRecordTable` and `formationPositionTable` are already declared earlier in this file (lines 120 and 117 respectively) — no new `backend.data.resources.tables[...]` lookups needed.
- No IAM changes needed for `get-fan-game-view` (§9/§10) — its existing grants already cover `PlayTimeRecord`/`Goal`/`Substitution` reads; only the helper function it calls moved modules.

### 12. `src/components/FanMode/StatTrackerView.tsx`
- Extend `FlowStep` union with `'confirmKeeper'`.
- Compute `activeGoalkeeperPlayer = roster.find(p => p.id === data?.activeGoalkeeperId) ?? null;` (roster is already the null-filtered array).
- `chooseSide(forUs: boolean)`: when `forUs && flow.eventType === 'SAVE' && activeGoalkeeperPlayer`, set `{ ...flow, forUs, playerId: activeGoalkeeperPlayer.id, step: 'confirmKeeper' }` instead of the existing unconditional `step: 'player'`. All other event types/paths unchanged.
- Add `pickDifferentKeeper()`: `setFlow({ ...flow, playerId: null, step: 'player' })`.
- Pass `activeGoalkeeperPlayer` and `onPickDifferentKeeper` down to `StatFlowSheet`.
- In `StatFlowSheet`, add a `flow.step === 'confirmKeeper'` branch: heading/prompt showing `{activeGoalkeeperPlayer.firstName} {activeGoalkeeperPlayer.lastName} made the save?`, a primary "Yes, log it" button (`onSubmit({})`, reusing the existing submit path since `flow.playerId` is already set), and a secondary "Not right? Pick another keeper" button (`onPickDifferentKeeper`) that drops into the existing `'player'` step / `PlayerPickerStep` (unfiltered roster, so the guessed keeper can also just be re-confirmed there if genuinely correct but the coach still wants to browse).
- No changes to `GOAL`/`SHOT` flows, no changes to the Opponent-side Save flow (still `side → confirm` directly, no player attribution).

### 13. Test files (existing, all need new coverage)

**`src/components/GameManagement/ShotSaveTracker.test.tsx`**
- Add `positions: [] as any[]` to `defaultProps` (new required prop).
- New cases:
  - Entry modal pre-fills the goalkeeper `PlayerSelect` with the player holding an open `PlayTimeRecord` at a GOALKEEPER-role position (assert `screen.getByTestId("savesPlayer")` has that value before any interaction).
  - No pre-fill when no position has `role: 'GOALKEEPER'` (falls back to `""`, matches today's existing "optional" test).
  - No pre-fill when two different players simultaneously hold open records at (two) GOALKEEPER-role positions (ambiguous → `""`).
  - No pre-fill when the sole open GOALKEEPER-role record's player also happens to double up at a second GOALKEEPER-role position (still exactly one distinct player → pre-filled) — i.e., prove ambiguity is judged on distinct *players*, not distinct positions.
  - Entry modal does **not** pre-fill for Shots (statView === "shots") even with a resolvable goalkeeper.
  - Edit modal: opening an existing Save with `playerId: null` pre-fills the derived goalkeeper; opening one with an existing `playerId` keeps that value untouched even when a different player currently holds the open GK record (never clobber an explicit prior attribution).
  - Coach can still override the pre-filled value via the `PlayerSelect` and submit that override (`createSave`/`updateSave` called with the coach's chosen id, not the derived one).
  - **Required (architecture review Minor finding 3)**: `gameState.status === 'completed'` — opening the entry modal for a Save (if reachable at all in this state) or the edit modal does not crash and produces no pre-fill (`entryPlayerId`/edit value stays `""`/unaffected), since `handleEndGame` closes every open `PlayTimeRecord`, so `getCurrentGoalkeeperId` always returns `null` in this state by construction. This is a required regression/no-crash guard regardless of which option below implementation picks for edit-modal retro-edits.

**`amplify/functions/shared/goalkeeper.test.ts`** (new — see §7 above for the full required case list; not repeated here.)

**`amplify/functions/get-fan-game-view/handler.test.ts`**
- No new test cases required (behavior unchanged) — verify during implementation that all existing tests still pass once `queryAllByGameIdIndex` is sourced from `../shared/dynamo` with `docClient` passed explicitly rather than closed over. If any test mocks the old local function directly instead of `docClient.send`, it needs updating to match.

**`amplify/functions/get-stat-tracker-view/handler.test.ts`**
- `setEnv()` needs `PLAY_TIME_RECORD_TABLE` / `FORMATION_POSITION_TABLE` added — every existing test breaks without this (new required env vars).
- New cases:
  - LIVE (`status: 'in-progress'`) game, one open `PlayTimeRecord` at a `role: 'GOALKEEPER'` `FormationPosition` → `activeGoalkeeperId` equals that record's `playerId`.
  - LIVE game, no `FormationPosition` has `role: 'GOALKEEPER'` → `activeGoalkeeperId: null`.
  - LIVE game, two open records at two different GOALKEEPER-role positions with two different players → `activeGoalkeeperId: null` (ambiguous).
  - LIVE game, a closed record (`endGameSeconds` set) at a GOALKEEPER-role position is excluded — only open records count.
  - `status: 'halftime'` (still branch `LIVE` per `selectGameForFan`) → `activeGoalkeeperId: null` **and no `PlayTimeRecord`/`FormationPosition` query is issued** — required case per architecture review Minor finding 5 (the gate is now `game.status === 'in-progress'`, not `selection.branch === 'LIVE'`, specifically to exclude halftime; this is the case that would have silently passed under the old, looser gate).
  - NO_GAMES_YET / NO_GAME_RIGHT_NOW / NEXT_GAME / FINISHED branches → `activeGoalkeeperId: null` and no `PlayTimeRecord`/`FormationPosition` query is issued (assert `mockSend` wasn't called with those table names — cheap way to confirm the gate actually short-circuits, not just returns null coincidentally).
  - RATE_LIMITED / INVALID_LINK → unchanged (`activeGoalkeeperId: null` implicitly via `emptyResult()`).

**`src/components/FanMode/StatTrackerView.test.tsx`**
- New cases:
  - `baseLiveData({ activeGoalkeeperId: 'p1' })`, tap Save → Us → lands directly on a "Sam Jones made the save?" confirm step (no `PlayerPickerStep` list rendered) → tapping "Yes, log it" submits with `playerId: 'p1'`.
  - Same setup, tapping "Not right? Pick another keeper" transitions to the existing full player-picker (`Which keeper?`), and choosing a different player submits that player's id instead.
  - `activeGoalkeeperId` absent/`null` (today's `baseLiveData()`) → unchanged existing behavior, full picker shown (regression guard for the existing "shows a logged confirmation" and duplicate-tap-guard tests, which must keep passing unmodified).
  - `activeGoalkeeperId` set to an id **not present** in `roster` → falls back to the full picker (stale/mismatched data guard).
  - Opponent-side Save flow is unaffected by `activeGoalkeeperId` being set (still `side → confirm`, no player step at all).
  - GOAL and SHOT flows are unaffected by `activeGoalkeeperId` being set (only SAVE's "Us" path branches on it).

### 14. `CLAUDE.md`
The "Game timer is client-side, synced periodically" section's last sentence currently names only the `gameClock.ts`/`gameClock.test.ts` pair as CLAUDE.md's Lambda-side-mirror precedent. Future agents read this paragraph as the index before touching either copy of *any* src/-vs-Lambda mirrored logic, so it needs to also name this feature's `goalkeeper.ts`/`goalkeeper.test.ts` pair. Add a sentence after the existing gameClock one, e.g.: "The same pure-module-plus-parity-test pattern is used for goalkeeper attribution: `src/utils/playTimeCalculations.ts`'s `getCurrentGoalkeeperId` and its Lambda-side twin `amplify/functions/shared/goalkeeper.ts`'s `computeActiveGoalkeeperId`, parity-tested in `goalkeeper.test.ts` — keep both in sync on any change to GOALKEEPER-role derivation semantics."

## Data / API impact summary
- **Schema**: one new optional `a.string()` field on an existing `customType` (`StatTrackerViewResult`) — no new model, no migration, no `coaches[]` concern (customTypes aren't owned records).
- **Lambda**: `get-stat-tracker-view` gains two new table reads (`PlayTimeRecord` via its existing `playTimeRecordsByGameId` GSI, `FormationPosition` via `BatchGetItem`), both read-only, both scoped to ids already known from the already-validated team/game (no new attack surface on the guest-auth boundary — `ShareLink`/`FanViewRateLimit` access patterns are untouched, no new write path, ties into the existing `resolveShareLinkAccess` gate before any of this runs). Gated on `game.status === 'in-progress'` (not the broader `LIVE` branch), so halftime polls issue neither query.
- **Second guest-auth Lambda touched (architecture review Item 2, called out explicitly for validation/security review visibility)**: `get-fan-game-view/handler.ts` is also modified in this plan — purely a refactor (its local `queryAllByGameIdIndex` moves to the new shared `amplify/functions/shared/dynamo.ts` export, called with the same table/index names and an explicit `docClient` argument). No behavior change, no new IAM grants for this Lambda, but it's a second guest-auth-path file changed by this plan and should not be discovered mid-implementation.
- **IAM**: two new `grantReadData` calls + one GSI ARN added to an existing `PolicyStatement`, all scoped to `getStatTrackerView`'s own Lambda role, no widening of `submitStatEvent`'s existing schema-wide `mutate` grant. No new IAM for `get-fan-game-view` (its existing grants already cover the tables the moved helper queries).

## Edge cases (explicit)
- **No GK on field / team not using the role system**: `getCurrentGoalkeeperId`/`computeActiveGoalkeeperId` both return `null`; today's empty/optional picker behavior is preserved exactly.
- **Multiple simultaneous GK-role open records, different players**: ambiguous → `null` (ambiguity is judged on distinct *player ids*, not distinct *position ids*, so one player oddly holding two GK-role records still resolves unambiguously).
- **Mid-half keeper substitution**: handled by construction — the derivation reads "currently open" records at query/pre-fill time, so a sub that closes the old keeper's record and opens a new one is reflected on the very next entry-modal open / next helper poll, with no special-casing needed.
- **Editing a Save logged earlier in the game, after a keeper substitution since then**: the edit modal pre-fills with the *current* goalkeeper, not whoever was actually in goal at that save's `gameSeconds` — this matches the request's literal "currently occupying" wording, and only applies when the item has no existing `playerId` to begin with; the coach can always override. Flagging as an accepted, documented simplification rather than silently "fixing" it into a point-in-time lookup (which `getAttributedPlayTimeRecord` in the same file could do, but the request didn't ask for that, and it would change behavior more than requested).
- **The prefill can never fire in the `completed` game layout (architecture review round-1 Minor finding 3 — corrects the implication above)**: `ShotSaveTracker`'s entry buttons render whenever `gameState.status !== 'scheduled'`, which includes `completed`, but `handleEndGame` closes every open `PlayTimeRecord` when a game ends. So for a `completed` game, `getCurrentGoalkeeperId`'s "currently open record" derivation always returns `null` — there is no live prefill in this state, full stop, contradicting any reading of the "current goalkeeper" language above as applying universally. This is a required, explicit limitation, not an oversight: a `completed`-game no-prefill-and-no-crash test case is required (see Test files §13).
  - **Mandated behavior (architecture review round-2 Major finding — the round-1 plan's Option A/Option B fork is struck)**: the edit modal's "currently occupying" derivation is used as-is, unconditionally, via `getCurrentGoalkeeperId` — no point-in-time variant. In `completed` games it simply never prefills (falls back to `""`/existing `playerId`), same as today's behavior. No new logic beyond the one derivation function. This is the only implementation option; it is required because a point-in-time alternative would (a) require an unspecified new derivation function (`getAttributedPlayTimeRecord` is module-private and answers a different question — "which record covered this known player at time T", not "which player held a GK-role position at time T"), (b) contradict this plan's own required edit-modal test case above ("never clobber an existing `playerId`... even when a different player currently holds the open GK record"), (c) contradict the README/UI-SPEC wording this plan mandates ("pre-populated with the *current* on-field goalkeeper"), and (d) introduce a third, unmirrored semantics that the `goalkeeper.ts`/`goalkeeper.test.ts` parity suite does not cover.
  - **Deferred follow-up (not filed by this plan, not in scope)**: a point-in-time retro-edit attribution for completed games (looking up who was in goal at a given Save's `gameSeconds` rather than "currently") would need its own new, tested derivation function and its own plan — noted here alongside the `get-fan-game-view`/`FieldPosition` drift follow-up (see "Critical correction" section above) for the orchestrating thread to file if wanted.
- **Stale/cached roster or goalkeeper on the helper page**: the confirm-keeper step is a snapshot taken at tap-time (`chooseSide`); a poll that lands mid-flow doesn't retroactively mutate an open flow's captured selection — same non-live-patching behavior the roster list and every other in-flight flow field already has. If the guessed keeper was subbed out between the last poll and the tap, the helper can still catch it via "Not right? Pick another keeper," and any residual wrong attribution is coach-correctable afterward via the existing "Logged via helper" edit path (§7.15 of UI-SPEC, unchanged).
- **`activeGoalkeeperId` naming a player no longer on the roster** (deactivated, or a data mismatch): frontend-side `roster.find(...)` guard falls back to the full picker; the Lambda deliberately does not pre-filter against roster membership itself, keeping the two checks (LIVE-gated derivation vs. roster-membership display guard) independently simple and colocated with where each is naturally needed.
- **Legacy `FieldPosition`-id-keyed `PlayTimeRecord`s** (very old teams, pre-`FormationPosition` era, per `SeasonReport.tsx`'s documented dual-lookup): both the coach util and the Lambda only consult `FormationPosition`, so a legacy record's `positionId` simply won't match any GOALKEEPER-role id and the derivation degrades to `null` — identical, harmless fallback to "ambiguous/unknown," not a regression (this feature only matters for currently-*live* games, which by construction use current-era `FormationPosition` ids).

## Docs impact (required, not optional)
- **`docs/specs/UI-SPEC.md`**:
  - §7.4 (In-Progress tabs table, line 399): the "Goals" row's "a Save's player (goalkeeper) stays optional either way" sentence needs a clause added noting it's pre-populated with the current on-field goalkeeper when unambiguous, still overridable/clearable.
  - §7.15 (Sideline Stat Tracker): the "Us path" bullet (line 997, "player picker (scorer for Goal, shooter for Shot, keeper for Save)...") needs a carve-out describing the new Save-specific confirm-with-override step, and the interaction-model comment block above `StatFlowSheet` in the component itself should get a one-line addition (it already documents the deliberate-divergence-from-coach-side rationale).
- **`README.md`** (both bullets need a clause — architecture review Minor finding 1 caught that the original plan only updated the helper-flow line, missing the coach-side capability bullet describing the same behavior change):
  - **Line 43** (coach-side "Shot & Save Tracking" Features bullet, "Log shots (on/off target) and saves for either team from the same Goals tab, via a Goals/Shots/Saves segmented control"): needs a clause noting a Save's goalkeeper field is pre-populated with the current on-field goalkeeper when unambiguous, still an overridable/clearable picker.
  - **Line 53** ("Goal / Shot / Save tap flow: every tap starts with an Us/Opponent choice, then (for 'Us') an optional player picker with a skip affordance...") needs a clause noting Save's player picker is skipped in favor of a confirm step when the current goalkeeper is known.
- **`docs/ARCHITECTURE.md` (architecture review Minor finding 2 — this plan does touch it, correcting the original plan's "not touched" call)**:
  - The `get-stat-tracker-view` row in the "Lambda Functions" table (~line 444) currently describes exactly what the handler reads today ("batch-fetches the team's active roster... into a curated `StatTrackerViewResult` payload"); it needs a clause added noting it now also queries `PlayTimeRecord`'s `playTimeRecordsByGameId` GSI and batch-gets `FormationPosition` (when the game is `in-progress`) to derive `activeGoalkeeperId`, with two new env vars/IAM grants (per `amplify/backend.ts` §11 above).
  - Optional, one line: near where `StatTrackerViewResult`'s shape is described (~line 332, the "StatTrackerPlayer / StatTrackerViewResult / SubmitStatEventResult" section), mention the new `activeGoalkeeperId` field alongside the existing roster description.
  - The "Two Position Models" section itself stays untouched — reconciling the broader `FieldPosition`/`FormationPosition` drift is a separate, out-of-scope cleanup (see the follow-up callout in the investigation section above); only the `get-stat-tracker-view` description needs updating here.

## Test strategy summary
See the itemized new cases under "Test files" above; no existing test is expected to change behavior except the two `setEnv()` additions in `get-stat-tracker-view/handler.test.ts` (required, not optional — new env vars are read unconditionally) and the new `positions` prop in `ShotSaveTracker.test.tsx`'s `defaultProps`. Existing `StatTrackerView.test.tsx` cases that don't set `activeGoalkeeperId` must keep passing unmodified — that's the explicit regression guard for backward compatibility of this change. `get-fan-game-view/handler.test.ts`'s existing suite must also keep passing unmodified once its `queryAllByGameIdIndex` call sites are re-pointed at the shared module (needs verifying, not just assuming, during implementation — see §10). The new `amplify/functions/shared/goalkeeper.test.ts` parity suite is required, not optional, per the Major finding (§6/§7 above) — it is the only thing that keeps the coach-side and Lambda-side goalkeeper derivations from silently drifting apart the way `gameClock.ts`'s parity test protects the timer logic.

## Next step
Implementation. Architecture review (2026-09-20) confirmed the FormationPosition-vs-FieldPosition correction, decided the `queryAllByGameIdIndex` extraction into `amplify/functions/shared/dynamo.ts`, and required the pure-module split for the goalkeeper derivation (§6/§7) plus the seven Minor findings folded in above — see this doc's revision history in the findings sections. UI review still recommended given the new confirm-keeper step on the public Stat Tracker page (touches §7.15 of `docs/specs/UI-SPEC.md` and introduces a new interaction step), though the coach-side change is a same-shape, no-new-markup tweak.
