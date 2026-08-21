# Team Archive — Step 11, Part 1: Lambda-Backed `Game.create` (No Archived Check Yet)

Status: Draft plan — revised after architecture review round 1, ready for round 2
Date: 2026-08-21 (revised; originally 2026-08-20)
Parent plan: [TEAM-ARCHIVE-PLAN.md](TEAM-ARCHIVE-PLAN.md) — "Next Steps (ordered)" item 11 (Phase 8), sub-step 1 only.
Prior slices: [TEAM-ARCHIVE-STEP1-BACKEND-WIRING.md](TEAM-ARCHIVE-STEP1-BACKEND-WIRING.md) (Lambda-mutation-returning-model conventions, IAM grant conventions), [TEAM-ARCHIVE-STEP5-FRONTEND-UX.md](TEAM-ARCHIVE-STEP5-FRONTEND-UX.md) (`teamLifecycleOverrides` — the precedent this slice's insertion-side equivalent is modeled on, and the finding that AppSync `list`/`observeQuery`'s initial resolution is an eventually-consistent Scan, not just "no subscription event"), [TEAM-ARCHIVE-STEP8-SERVER-ENFORCEMENT.md](TEAM-ARCHIVE-STEP8-SERVER-ENFORCEMENT.md) (error-message-passthrough defect class, `deleteGameSafe`'s archived-guard precedent reused conceptually in Part 2).

## Revision history

**Round 1 (2026-08-21), responding to architecture review:**
- **Decision 0 (new, most consequential change in this round):** evaluated writing `createGame` through AppSync's Data client (IAM auth, `allow.resource(createGame).to(['mutate'])`) instead of the raw DynamoDB SDK, specifically to restore `onCreateGame` subscription firing. **Decision: keep the raw DynamoDB SDK write**, consistent with every other Lambda in this feature. See Decision 0 below for the full weighing of both sides. This was the single most consequential decision in this revision and should get explicit reviewer confirmation.
- Because Decision 0 kept the raw-SDK mechanism, `pendingCreatedGames` (Decision 3) is retained, and its gaps are fixed directly: added `gameRefreshKey` (mirroring `Management.tsx`'s `teamRefreshKey`) bumped in `handleCreateGame`'s `finally` block and on window focus/tab-visibility (new mitigation for cross-coach lag, see Decision 0 and Risks); added explicit delete-of-a-pending-game and edit-of-a-pending-game handling in `handleDeleteGameFromHome`/`handleSaveEditGame`; added a unit test for delete-of-a-pending-game.
- Added `isSubmittingGame` state to `handleCreateGame`, mirroring the existing `isSavingEdit` pattern exactly (disables Create/Cancel, swaps label to "Creating…"); added a unit test for the disabled/re-enabled window.
- Fixed the planned `Home.test.tsx` reconciliation test to specify **reassignment** (`gameQueryResult.data = [...]`) rather than in-place mutation, matching this file's actual established pattern.
- Added an explicit setup requirement (a matching team must be seeded) to the "game appears immediately" test description.
- Added a note to confirm `Game: { update: ... }` stays present in the `Home.test.tsx` client mock after `Game: { create }` is removed.
- Added `ConsistentRead: true` to the Lambda's `Team` `GetCommand`.
- Extracted a shared `assertMutationResult` helper (`src/services/amplifyMutationResult.ts`) used by both the new `gameService.ts` and (retrofitted) `teamLifecycleService.ts`; documented why `cascadeDeleteService.ts`'s `assertMutationSuccess` is left as-is (materially different contract — void return + AWSJSON string-parsing).
- Added a small in-scope doc fix to `docs/SHARING-PERMISSIONS.md`'s now-stale game-creation sentence (full reclassification remains Part 2's job).
- Rescoped Finding 12/the e2e-safety claim to the same-mount case only; navigate-away-and-back still depends on the raw list, same as today (neutral, not a regression).
- Restated the real-time validation checklist's item 4 precisely (no "catch-up on re-render/interaction" — only remount/refresh/focus reveals a cross-coach change) and noted Step 10's two-coach e2e harness as a future automation candidate.
- De-emphasized "review load" as one of the four reasons for the two-doc split (reviewer found it doesn't carry real weight); the other three reasons stand unchanged.
- No changes made to: Decision 1, Decision 4, Decision 5, the Lambda's plain-JS authorization check (no `ConditionExpression`/`TransactWriteItems`), the `resource.safe-delete-policy.test.ts` assertions, the IAM/env wiring shape, or Findings 1, 2, 3, 8, 9, 10, 11 — all independently confirmed correct by the reviewer.

**Companion doc:** [TEAM-ARCHIVE-STEP11-GAME-CREATE-CONVERSION-PART2.md](TEAM-ARCHIVE-STEP11-GAME-CREATE-CONVERSION-PART2.md) — adds the archived-team check once this part is landed and validated. See "Why this is split into two docs" below.

## Why this is split into two docs

The parent plan's Phase 8 text is explicit that sub-step 1 (conversion) must be "landed and validated independently" **before** sub-step 2 (the archived-team check) is added, so that a regression is attributable to exactly one change. This slice makes that a hard boundary — two separate plan docs, two separate implementation passes, two separate `npm run gate:commit` + sandbox-smoke-test cycles, two separate commits — rather than one plan with two sequenced code sections in a single PR.

**Reasons to split, not just sequence within one doc:**

1. **This is explicitly named the single largest regression-risk slice in the whole parent plan** ("real-time sync, demo seeding, e2e coverage"). Every other slice in this feature that carried comparable risk shipped as an independently reviewed, independently committed unit — Step 1 (backend wiring, no archived enforcement at all) landed and was sandbox-validated before Step 8 (the first slice to add any archived-team *guards*) was even planned. That is the same "prove the mechanism, then add the policy check on top of a known-good mechanism" discipline this split reproduces, just compressed into one named phase instead of two.
2. **Attribution.** If something regresses after Part 1 ships (real-time sync breaks for some coach, some game silently fails to appear, an e2e spec flakes), the archived-team guard is provably not the cause — it doesn't exist yet. If both landed in one commit, a regression report would require bisecting within the change instead of just reading the diff.
3. **Independent value.** Part 1 alone is a complete, shippable improvement in its own right: it converts a client-direct-write to a validated, Lambda-mediated create with server-derived `coaches` population (closing a real, if minor, trust gap — see Decision 2 below) and improves e2e reliability for game-creation assertions (see Risks). It does not need Part 2 to be worth shipping, exactly as the parent plan states ("gates nothing else").
4. ~~**Review load.** Prior slices in this feature routinely needed 1–2 architecture review rounds each. A combined doc covering both the mechanism and the policy change invites conflating "is the real-time-sync fix correct" review comments with "is the archived-team condition expression correct" review comments — splitting keeps each review pass legible.~~ *(De-emphasized per architecture review round 1: this reason doesn't independently carry real weight — reasons 1–3 above are sufficient justification for the split on their own.)*

Part 2 is intentionally small — a well-understood, mechanical addition (see `TEAM-ARCHIVE-STEP8-SERVER-ENFORCEMENT.md`'s `deleteGameSafe` guard for the shape) — once this part's Lambda, IAM wiring, and local-state reconciliation are proven correct on a real sandbox.

## Goal

Convert `Game.create` from a direct client-side `client.models.Game.create()` call to a Lambda-backed `createGame` custom mutation, with **no archived-team check in this part** — that is Part 2's entire content. This part's job is narrower and higher-risk: prove the Lambda-backed create mechanism itself is correct, including the two real-time-sync consumers that depend on `Game`'s `observeQuery` stream.

**Definition of done:**
- `npm run gate:commit` passes (lint → typecheck:amplify → test:run → build).
- Every unit test file identified below is updated and green.
- The manual sandbox verification checklist at the bottom passes, including the real-time-sync checklist for both `Home.tsx` and (if reachable) a second coach's session.
- `docs/plans/TEAM-ARCHIVE-PLAN.md`'s Implementation Status is updated to record Part 1 as landed, with Part 2 still open.
- `docs/SHARING-PERMISSIONS.md`'s now-stale game-creation sentence is amended (File-by-File item 9).

## Scope

### In scope
- `amplify/data/resource.ts` — remove `create` from `Game`'s model-level authorization grant; declare the `createGame` Lambda-backed mutation.
- `amplify/functions/create-game/` (new) — `handler.ts`, `resource.ts`, `package.json`, `handler.test.ts`.
- `amplify/backend.ts` — import, register, least-privilege IAM grants (`Game` read/write, `Team` read-only), env vars.
- `amplify/data/resource.safe-delete-policy.test.ts` — update the `Game` model-authorization assertion (currently pinned to the full `create/read/update` grant, which this slice removes `create` from); add an assertion for the new `createGame` mutation declaration.
- `src/services/amplifyMutationResult.ts` (new) — shared `assertMutationResult` helper, extracted from `teamLifecycleService.ts`'s near-identical private helper (see File-by-File item 5a).
- `src/services/gameService.ts` (new) — thin wrapper around `client.mutations.createGame`, following `teamLifecycleService.ts`'s convention exactly, using the shared `assertMutationResult` helper.
- `src/services/teamLifecycleService.ts` — retrofitted to import and use the shared `assertMutationResult` helper instead of its own private `assertLifecycleResult` (removes the duplication `gameService.ts` would otherwise have introduced a third copy of).
- `src/components/Home.tsx` — `handleCreateGame` converted to call the new service, gated by a new `isSubmittingGame` in-flight state (mirroring the existing `isSavingEdit` pattern); a local insertion-side reconciliation mechanism (`pendingCreatedGames` + `gameRefreshKey`) so the newly created game renders immediately without waiting for `observeQuery`'s eventually-consistent initial Scan or a subscription event that will never arrive for this write path, with the raw `Game` query re-subscribing after every create attempt and on window focus/tab-visibility; every downstream consumer of the raw `games` array switched to the merged `gamesForDisplay`; `handleDeleteGameFromHome` and `handleSaveEditGame` updated to keep `pendingCreatedGames` consistent when a pending game is deleted or edited before the raw list catches up.
- `src/services/demoDataService.ts` — `createDemoTeam`'s `Game.create` call converted in lockstep (required — the direct client call fails outright once `create` is removed from the model grant), via the same `gameService.ts` wrapper.
- `docs/SHARING-PERMISSIONS.md` — one-line amendment to the now-stale game-creation sentence (see File-by-File item 9; full reclassification remains Part 2's job).
- Test updates: `src/components/Home.test.tsx`, `src/services/demoDataService.test.ts`, `src/services/teamLifecycleService.test.ts` (if it asserts on the private helper directly — confirm during implementation), new `src/services/gameService.test.ts`, new `src/services/amplifyMutationResult.test.ts`.
- `docs/plans/TEAM-ARCHIVE-PLAN.md` — Implementation Status update recording Part 1 landed.

### Explicitly out of scope (Part 2's content)
- Any archived-team check inside the new `createGame` Lambda.
- `docs/SHARING-PERMISSIONS.md`'s full "UI-only enforced" → "server-side enforced" reclassification of game creation (Part 2's job) — **distinct from** the small, in-scope, one-line factual amendment this part makes to that doc's now-stale conversion-status sentence (see File-by-File item 9 / Minor finding 9). Part 1 only fixes what becomes actively wrong the moment it ships; the reclassification itself is still Part 2's.
- The error-message passthrough fix for `handleCreateGame`'s catch block (relevant once there's a new server-side rejection reason to surface — see Part 2).

### Explicitly out of scope (not this phase at all)
- `useGameSubscriptions.ts` — confirmed unaffected (see Findings). No change.
- `SeasonReport.tsx` / `SeasonReportRoute.tsx` — confirmed no game-creation affordance reachable from that surface (see Findings). No change.
- `GameManagementRoute.tsx` — confirmed unaffected; its direct-URL fallback uses `client.models.Game.get()`, a strongly-consistent `GetItem`, not `list()`/`observeQuery` (see Findings). No change.
- Any change to `useOfflineMutations.ts` — confirmed `Game` is only offline-queued for `'update'` operations (timer/score sync), never `'create'`; game creation has never been offline-queueable and this slice doesn't change that (see Findings).

## Findings from reading the codebase

**Finding 1 — exactly two `client.models.Game.create()` call sites exist, matching the parent plan's claim.** Confirmed by a full-repo grep: `src/components/Home.tsx:366` (`handleCreateGame`) and `src/services/demoDataService.ts:86` (`createDemoTeam`). No other component, service, or hook creates a `Game` directly.

**Finding 2 — `createDemoTeam` is currently dead code, not reachable from any rendered UI path.** Grepped every `.tsx`/`.ts` file under `src/` for `createDemoTeam`: it is exported from `demoDataService.ts`, imported only by its own test file and mocked (unused) in `Home.test.tsx`'s module mock. No component calls it. (`docs/specs/ONBOARDING-SPEC.md` and `docs/plans/test-coverage-80-plan.md` both reference a `handleLoadDemoData` call site that does not exist anywhere in `src/` today.) This is a real, previously-undocumented finding: the parent plan's "demo seeding" risk category for this conversion is **structurally lower than the plan's own framing implies** — there is no live component rendering the result of a `createDemoTeam` call today, so the real-time-sync risk for that specific call site is a lockstep-compilation and unit-test requirement, not a live-UX risk. (Still must be converted — the function is exported and must keep working, and the requirement is explicit: "not optionally bypassed.") This doesn't change scope, just risk weighting — flagged so a reviewer doesn't spend review budget hunting for a live demo-data render path that isn't there.

**Finding 3 — `handleCreateGame`'s full current shape** (`src/components/Home.tsx:324-377`):
```ts
const gameData: any = {
  teamId: selectedTeamForGame,
  opponent,
  isHome,
  coaches: coachesArray, // client-side "team.coaches, defensively including currentUserId if stale" workaround
};
if (gameDate) {
  gameData.gameDate = new Date(gameDate).toISOString();
}
await client.models.Game.create(gameData);
```
`status`, `currentHalf`, `elapsedSeconds`, `ourScore`, `opponentScore` are never set — they rely entirely on the schema's field-level `.default(...)` values, which AppSync applies for a normal client-side `create` but which a Lambda writing directly via the DynamoDB SDK does **not** get for free. The new Lambda must set all of these explicitly (see File-by-File below).

**Finding 4 — `demoDataService.ts`'s call passes `status: 'scheduled'` explicitly** (the one field `handleCreateGame` omits), plus `teamId`, `opponent: 'Lions'`, `isHome: true`, `gameDate`, `coaches: [currentUserId]`. Since the new Lambda always writes `status: 'scheduled'` at creation (Decision 1 below — there is no "create a game already in progress" path anywhere in this app), this argument becomes redundant and is dropped from the call, not from the schema default — the Lambda's behavior already matches what `demoDataService.ts` asks for today.

**Finding 5 — the standing `coaches`-population rule (CLAUDE.md) is currently satisfied client-side, defensively, not server-side.** `handleCreateGame`'s comment says as much: *"Ensure current user is included in coaches array — this handles cases where the team data might be slightly stale."* This is a workaround for a real problem (client-side `teams` state can lag), not a robust fix — and it trusts the client to send the correct `coaches` array at all, which a malicious or buggy client isn't obligated to do. See Decision 2.

**Finding 6 — `useAmplifyQuery('Game')` in `Home.tsx` (line 68) has no filter — an unfiltered, client-sorted list, using a `sort` function currently defined inline as part of the hook call.** This sort function needs to be reusable outside the hook call (see Decision 3), so it must be lifted to a named, module-scope comparator.

**Finding 7 — `SeasonReport.tsx`'s Game query is real and is filtered, but the surface never creates games.** `useAmplifyQuery('Game', { filter: { teamId: { eq: team.id } } }, [team.id])` (line 89) is a real `observeQuery` subscription, so it has the identical "Lambda write triggers no subscription event" characteristic Team lifecycle mutations do. But confirmed by reading `SeasonReportRoute.tsx` and `SeasonReport.tsx` (`TeamReport`) in full (this was also independently confirmed in Step 9's investigation): **neither renders any game-creation affordance.** The only way a new game could be "missing" from an open Season Report is if it were created *elsewhere* (e.g., `Home.tsx` in another browser tab, or by another coach) while the report is already open and mounted — the exact same class of staleness Step 9 already documented and accepted for `ArchivedTeamBanner` (mid-session archive by another coach not reflected until re-entry). **Decision: no code change to `SeasonReport.tsx`/`SeasonReportRoute.tsx` in this slice** — see Decision 4.

**Finding 8 — `useGameSubscriptions.ts` is confirmed unaffected, not just assumed.** Read in full: its `Game.observeQuery({ filter: { id: { eq: game.id } } })` subscription (line 131) only ever runs after a `Game` object (with a known `id`) has already been passed into `GameManagement` as a prop — either from `location.state` (in-app navigation) or from `GameManagementRoute.tsx`'s direct-URL fallback fetch (below). It observes an *existing* game's field-level changes (timer, score, status) going forward; it has no code path that depends on `Game.create` triggering anything. Confirmed correct, not just trusted from the parent plan's own claim.

**Finding 9 — `GameManagementRoute.tsx`'s direct-URL fallback uses `client.models.Game.get({ id: gameId })`, a `GetItem`, not `list()`.** DynamoDB `GetItem` reads are strongly consistent against the same table/partition a preceding `PutCommand` just wrote to — unlike `observeQuery`'s *initial* resolution, which Step 5's own investigation established is an eventually-consistent Scan. So even a same-session direct-URL/refresh load immediately after Lambda-creating a game will correctly find it. No fix needed here.

**Finding 10 — `useOfflineMutations.ts`'s `ALLOWED_MODELS` includes `'Game'`, but only for `'update'` operations** (`updateGame`, line ~508, used for timer/score sync inside `GameManagement.tsx`). `handleCreateGame` in `Home.tsx` does not go through `useOfflineMutations` at all — it is a plain `try`/`catch` around a direct client call, with no offline-queue wrapping. Confirmed by reading `Home.tsx`'s imports: `useOfflineMutations` is not imported there. Game creation has never been offline-queueable; this conversion does not change that.

**Finding 11 — `resource.safe-delete-policy.test.ts` currently pins `Game`'s full authorization grant and will break the moment `create` is removed.** Its `'does not grant model delete to Formation, Team, Player, Game, or GameNote'` test asserts, for every model in its list except `GameNote`, that the block matches `allow.ownersDefinedIn('coaches').to(['create', 'read', 'update'])`. `Game` is in that list. Once `create` is removed from `Game`'s grant, this regex stops matching and the test fails — correctly, since it exists precisely to pin authorization-sensitive grant text, but it must be updated as part of this slice, not left to fail on the next unrelated PR. Must add a `Game`-specific branch (mirroring the existing `GameNote` special case) expecting `.to(['read', 'update'])`.

**Finding 12 — e2e specs that create games through the UI are not at risk of the kind of breakage Step 5's swipe-delete removal caused (mock-shape/selector breakage); if anything, this conversion should make them *more* reliable.** Grepped `e2e/` for `Schedule New Game`/game-creation flows: `e2e/full-workflow.spec.ts`, `e2e/game-planner.spec.ts`, `e2e/team-management.spec.ts`, `e2e/team-sharing.spec.ts`, `e2e/game-management-direct-note.mobile.spec.ts`, `e2e/auth.spec.ts` all create a game via the UI as setup, then assert the game card is visible in the list — today, that assertion's reliability depends on `observeQuery`'s scan-based initial-or-updated resolution timing (generally fast in practice, but not guaranteed). After this conversion, with the `pendingCreatedGames` local-state merge (Decision 3), the newly created game appears in `gamesForDisplay` **synchronously**, from the Lambda's own return value, with no dependency on subscription/scan timing at all — **but only for the same-component-mount case** (a game created and immediately checked for within the same page load, which is what every listed spec does as setup). This scoping is narrower than the original plan's blanket claim: any e2e flow that navigates away from `Home.tsx` and back (remounting it) still depends on the raw list resolving correctly on that fresh mount, exactly as it did before this conversion — `pendingCreatedGames` is component-local state and does not survive an unmount. This is **neutral, not a regression** (that path was never protected by anything before this slice either, and `gameRefreshKey`'s window-focus/visibility bump doesn't change a remount's own initial resolution), but the plan's claim is corrected here to be precise rather than overstated. The one existing full-page-reload assertion (`full-workflow.spec.ts`, ~line 939-958, after game completion) is unaffected either way — a reload always re-resolves from a fresh scan regardless of write path, and by the time of a reload after a completed game, this is not a practically observable risk (consistent with this feature's existing accepted risk framing elsewhere, e.g. Step 5's Team list). No e2e spec is expected to need updating for mock-shape or selector reasons (unlike Step 5's swipe-delete removal) — this is a behavioral risk area, not a locator-breakage one, and it is the specific risk this slice's real-time-sync fix (Decision 3) is designed to close for the same-mount case.

**Finding 13 — `handleApiError` (`src/utils/errorHandler.ts`) discards the real server error message**, exactly the defect class Step 8 found and fixed at `deleteGameCascade`'s call sites. `handleCreateGame`'s existing catch block (`catch (error) { handleApiError(error, 'Failed to create game'); }`) already has this bug today, independent of this slice. **Not fixed in Part 1** — there is no new server-side rejection reason to surface yet (the only failure modes today are "not authenticated," "team not found," "not a coach on this team," none of which existed as user-reachable errors before either, since the client already checks these defensively). Tracked for Part 2, where the archived-team rejection makes the passthrough fix load-bearing (mirroring Step 8's Decision 4 exactly).

## Decisions

### Decision 0: write path — raw DynamoDB SDK, not AppSync's Data client (most consequential decision in this revision)

Architecture review round 1 asked whether `createGame` should write through AppSync's Data client (`generateClient<Schema>({ authMode: 'iam' })` inside the Lambda, calling `client.models.Game.create(...)`, authorized via `allow.resource(createGame).to(['mutate'])` on the `Game` model) instead of a raw `PutCommand`. If correct and available, this would make the create a genuine, second AppSync mutation invocation — which *would* fire `onCreateGame` for every existing subscriber (`Home.tsx`, `SeasonReport.tsx`) — and would eliminate `pendingCreatedGames`/`gamesForDisplay` (Decision 3) entirely, since real-time sync would no longer need a client-side patch.

**This was evaluated seriously, not rubber-stamped. Both sides:**

**For adopting it:** it would preserve real-time sync for free on every subscriber, and it would delete an entire novel client-side reconciliation mechanism — the same mechanism this round's Required Changes 2 and 3 found real gaps in (delete/edit of a pending game, no in-flight submit guard). Fewer moving parts genuinely is fewer places for bugs, and "eliminate the mechanism instead of patching it" is the more elegant fix if it's actually available.

**Against adopting it (decisive):**
- **Zero precedent anywhere in this codebase.** Every existing Lambda that writes application data — `archive-team`, `restore-team`, `assign-team-owner`, `delete-team-safe`, `delete-game-safe`, `delete-player-safe`, `delete-formation-safe`, `accept-invitation`, `create-game-note`, `update-game-note`, `delete-game-note`, `upsert-coach-profile` — writes via the raw DynamoDB SDK (`PutCommand`/`UpdateCommand`/`TransactWriteItems`), never via a Lambda-internal Data client call. This repo has never proven the Lambda-calls-its-own-Data-client pattern once.
- **A real, checked-not-assumed technical constraint.** Every single one of those Lambdas' `resource.ts` files sets `resourceGroupName: 'data'`, and `get-user-invitations/resource.ts` states the reason explicitly in a comment: *"Assign to data stack to avoid circular dependency."* `createGame` itself already needs `resourceGroupName: 'data'` for the same reason (it's a custom-mutation resolver, declared via `.handler(a.handler.function(createGame))` in `amplify/data/resource.ts`, which imports the function — a circular reference at the CDK-stack level if the function weren't grouped into the same stack as the data resources). Whether that same `resourceGroupName: 'data'` grouping is what's *required* to make `env()`-based Data-client calls resolve at runtime (per Amplify Gen2's documented "call Data resources from custom business logic" pattern, which pairs `$amplify/env/<function-name>` + `getAmplifyDataClientConfig(env)` with a function that already lives in the data resource group) is a real, non-obvious mechanical question this codebase has never had to answer, because nothing here has ever tried. Reasoning through the docs suggests it should work, but "should work by reasoning from documentation never exercised in this repo" is exactly the category of risk Step 1's Correction 3 (field-level auth) had to burn a dedicated go/no-go sandbox cycle to retire — and that was for a *lower*-stakes slice than this one.
- **This is explicitly the single largest regression-risk slice in the whole parent feature.** Introducing a brand-new, unvalidated write pattern *in* that slice — rather than proving it first on some lower-stakes mutation — cuts directly against the incremental-proof discipline that justified splitting Step 11 into Part 1/Part 2 in the first place (see "Why this is split into two docs," reasons 1–3). If the pattern doesn't work as expected in this specific Amplify Gen2 version/setup, Part 1 would stall mid-implementation on a mechanism problem unrelated to game creation itself.
- **Schedule cost.** Adopting it honestly would require its own go/no-go sandbox validation step before any of the rest of Part 1 could be trusted, plus at least one additional architecture-review round to check the new pattern's mechanics (the IAM grant shape, the generated-env import, the runtime auth mode) on top of everything else this plan already needs reviewed. This feature has already gone through ten committed, reviewed steps; a novel pattern here is the most expensive place in the whole feature to introduce one.

**Decision: keep the raw DynamoDB SDK write (option (b))**, unchanged from the original plan's Lambda shape (File-by-File item 2 below is unchanged). This keeps `createGame` consistent with every other Lambda in this feature and defers any future exploration of the Data-client-from-Lambda pattern to a lower-stakes slice where a failed validation cycle doesn't block the highest-risk conversion in the feature. `pendingCreatedGames` (Decision 3) is therefore retained, and its two gaps found by architecture review (delete/edit of a pending game, no post-mutation refresh trigger) are fixed directly below rather than avoided by eliminating the mechanism.

**Honest reframing of the resulting regression (this corrects the original plan's Risks section, which understated this):** the original plan characterized the cross-coach propagation lag as "inherent to every Lambda-direct-DynamoDB-write mutation already shipped in this feature... not new to this slice." That is true of the *write pattern* in the abstract, but false as *applied here*. The Team lifecycle mutations (`archiveTeam`/`restoreTeam`/`assignTeamOwner`, Step 1) converted operations that were never real-time-synced to begin with — there was no prior working subscription behavior to lose. `Game.create` is different: today, `client.models.Game.create()` **does** fire `onCreateGame` for every subscriber. This conversion is a genuine, new regression on a previously-working real-time path, not a continuation of an already-accepted tradeoff. See Risks and Edge Cases below for the corrected framing and the concrete mitigation this revision adds (a `gameRefreshKey`-driven re-list on window focus/tab-visibility, on top of the existing `pendingCreatedGames` patch and Team-lifecycle-style accepted-risk documentation).

**Flag for the next architecture review round:** confirm this decision explicitly — it is the single most consequential change in this revision, and if the reviewer disagrees with the against-arguments' weight, option (a) (Data-client write, with its own go/no-go sandbox step) is the documented alternative to fall back to, not a new idea to reintroduce from scratch.

### Decision 1: `createGame`'s arguments omit `status`, `coaches`, and every other schema-defaulted field — the Lambda derives them, not the caller

**Arguments:** `teamId` (required), `opponent` (required), `isHome` (required), `gameDate` (optional). Nothing else.

Rationale: every field the client previously either omitted (relying on `.default()`) or defensively recomputed (`coaches`) is now a server responsibility. `status` is always `'scheduled'` at creation — there is no code path anywhere in this app that creates a game already in-progress/halftime/completed. `currentHalf: 1`, `elapsedSeconds: 0`, `ourScore: 0`, `opponentScore: 0`, `lastStartTime: null`, `halfLengthMinutes: null` all match the schema's own `.default()`/absent values and require no caller input. This is a strict simplification, not a feature change.

### Decision 2: `coaches` is derived from the freshly-fetched `Team.coaches`, not accepted as a client argument — closes Finding 5's trust gap as a side effect

The Lambda fetches `Team` by `teamId` anyway (it needs to for the coach-membership authorization check, and will need to for Part 2's archived check). Once fetched, `team.coaches` is the authoritative source — using it directly for the new `Game.coaches` removes both:
- the possibility of a client sending a stale or incomplete `coaches` array (the exact problem `handleCreateGame`'s existing defensive workaround was papering over client-side), and
- the possibility of a client sending an arbitrary `coaches` array unrelated to the team's real membership (not currently exploitable in a meaningful way, since `Game`'s model-level `create` grant already restricted this to a signed-in `ownersDefinedIn('coaches')` caller, but a server-derived value is strictly more correct and is exactly what CLAUDE.md's standing rule asks for: "populate coaches from the team's existing coaches array").

`handleCreateGame`'s `coachesArray` computation block (lines 347-352) is deleted entirely — no client-side replacement needed.

### Decision 3: the real-time-sync fix is an **insertion-side** reconciliation state, not a reuse of `teamLifecycleOverrides`'s update-side merge shape — now with a refresh trigger and explicit delete/edit handling (revised per architecture review)

`teamLifecycleOverrides` (`Management.tsx`, Step 5) solves "this existing row's fields are stale" by keying an override map on `id` and splicing matching fields over the raw list. That shape doesn't fit here as-is: game creation adds a **new** row with an id the raw `games` list has never seen, not a stale version of a row already present. The insertion-side merge (`pendingCreatedGames`/`gamesForDisplay`) is unchanged in shape from the original plan, but architecture review found two real gaps in how it converges and interacts with delete/edit, both fixed below. The fix borrows the *other* half of the `teamLifecycleOverrides` precedent that the original plan only partially copied: `Management.tsx` doesn't just splice an override over a stale list and wait — it also bumps `teamRefreshKey` (a `useAmplifyQuery` dep) after every lifecycle mutation so the raw list actually re-resolves promptly, rather than relying on "eventually, on its own." `gameRefreshKey` is the direct equivalent here.

```ts
// src/components/Home.tsx, near the existing games query
const [pendingCreatedGames, setPendingCreatedGames] = useState<Game[]>([]);
const [gameRefreshKey, setGameRefreshKey] = useState(0);
const [isSubmittingGame, setIsSubmittingGame] = useState(false);

// Module-scope comparator (lifted out of the useAmplifyQuery call so it can
// be reapplied after merging in a pending addition — see gamesForDisplay).
// (Existing sort body from the current inline `sort:` option, unchanged.)
function compareGamesForHomeDisplay(a: Game, b: Game): number { /* ...unchanged body... */ }

// `gameRefreshKey` as a dep forces useAmplifyQuery to unsubscribe and
// re-subscribe with a fresh observeQuery — the same mechanism
// Management.tsx's `teamRefreshKey` already relies on (confirmed by reading
// useAmplifyQuery.ts: `deps` drives the `filterBox` useMemo, whose identity
// change is the effect's only re-subscription trigger). Bumped in three
// places: after handleCreateGame settles (below), after a successful
// delete/edit of a pending game (defensive — see below), and on window
// focus / tab-visibility (see the effect after this block — this is this
// revision's concrete mitigation for Decision 0's accepted cross-coach lag).
const { data: games, isSynced: isGamesSynced } = useAmplifyQuery('Game', {
  sort: compareGamesForHomeDisplay,
}, [gameRefreshKey]);

// createGame writes via the DynamoDB SDK directly inside its Lambda handler —
// like archiveTeam/restoreTeam/assignTeamOwner (Step 1) and unlike a plain
// client.models.Game.create() call, it never triggers an onCreateGame AppSync
// subscription event (see Decision 0 — this was evaluated and deliberately
// not changed). `games` (from useAmplifyQuery/observeQuery) can lag a
// just-created game until the next re-subscription. `pendingCreatedGames`
// layers the Lambda's own returned Game on top of `games` until the raw list
// independently picks it up, at which point the addition is dropped and
// `games` alone becomes authoritative for that id again. See
// docs/plans/TEAM-ARCHIVE-STEP11-GAME-CREATE-CONVERSION-PART1.md, Decision 3.
const gamesForDisplay = useMemo(() => {
  const additions = pendingCreatedGames.filter(
    (pending) => !games.some((g) => g.id === pending.id)
  );
  if (additions.length === 0) return games;
  return [...games, ...additions].sort(compareGamesForHomeDisplay);
}, [games, pendingCreatedGames]);

// Reconciler: once the raw `games` list independently contains a pending
// addition's id, drop it from the override set — self-heals with no further
// action once the eventually-consistent list catches up, mirroring
// Management.tsx's teamLifecycleOverrides reconciliation effect.
useEffect(() => {
  setPendingCreatedGames((prev) => {
    if (prev.length === 0) return prev;
    const next = prev.filter((pending) => !games.some((g) => g.id === pending.id));
    return next.length === prev.length ? prev : next;
  });
}, [games]);

// New in this revision: re-list on window focus / tab visibility. This is
// the concrete mitigation for Decision 0's accepted cross-coach propagation
// lag — a coach who leaves Home.tsx mounted in a background tab and later
// refocuses it (or switches back from another app) gets a fresh
// observeQuery scan without needing a full remount. It does NOT make the
// lag disappear (a coach who stays focused on Home.tsx the whole time still
// won't see another coach's newly created game until they navigate away and
// back or refocus) — see the Real-Time-Sync Validation Checklist item 4 and
// Risks below for the precise, honest claim.
useEffect(() => {
  const bump = () => setGameRefreshKey((k) => k + 1);
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') bump();
  };
  window.addEventListener('focus', bump);
  document.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    window.removeEventListener('focus', bump);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}, []);
```

Every existing consumer of the raw `games` variable in `Home.tsx` (the checklist-completion computation, the debug snapshot, the `firstScheduledGame`/`firstGame` lookups used for onboarding CTAs, the `inProgressGames`/`scheduledGames`/`completedGames` groupings, the `<QuickStartChecklist games={games} />`-adjacent `games.length === 0` empty-state check) is renamed to read `gamesForDisplay` instead, so a just-created game is reflected everywhere in the component consistently, not just in one list. `games` itself (the raw hook result) is no longer referenced directly outside the `gamesForDisplay`/reconciliation block.

**`handleCreateGame`'s new body** — adds `isSubmittingGame` (mirroring the existing `isSavingEdit` pattern exactly, see below) and bumps `gameRefreshKey` in a `finally` block so the raw list re-resolves promptly after every create attempt, success or failure:
```ts
const handleCreateGame = async () => {
  if (!currentUserId) {
    showError('User not found. Please refresh.');
    return;
  }
  if (!opponent.trim() || !selectedTeamForGame) {
    showWarning('Please enter opponent name and select a team');
    return;
  }

  const team = teams.find(t => t.id === selectedTeamForGame);
  if (!team) {
    showError('Team not found');
    return;
  }
  if (!isTeamActive(team)) {
    showError('Cannot schedule a game for an archived team.');
    return;
  }

  setIsSubmittingGame(true);
  try {
    const created = await createGame({
      teamId: selectedTeamForGame,
      opponent,
      isHome,
      gameDate: gameDate ? new Date(gameDate).toISOString() : undefined,
    });
    setPendingCreatedGames((prev) => [...prev, created]);
    setOpponent('');
    setGameDate('');
    setIsHome(true);
    setSelectedTeamForGame('');
    setIsCreatingGame(false);
    trackEvent(AnalyticsEvents.GAME_CREATED.category, AnalyticsEvents.GAME_CREATED.action);
  } catch (error) {
    handleApiError(error, 'Failed to create game');
  } finally {
    setIsSubmittingGame(false);
    setGameRefreshKey((k) => k + 1);
  }
};
```
(`createGame` imported from the new `src/services/gameService.ts`.) The `isTeamActive(team)` client-side early-return stays exactly where it is today (fast, cheap fail before any round trip) — Part 2 adds the authoritative server-side check behind it, it does not replace this one. Note the validation checks (team lookup, `isTeamActive`) are moved ahead of `setIsSubmittingGame(true)` so the button never shows a loading state for a request that will never be sent — this is a deliberate refinement over the original draft, not a behavior change for the success/failure paths.

**Create button loading state** (Required Change 3 — no in-flight guard existed in the original plan; `isCreatingGame` only ever meant "the form is open," never "a request is in flight"). Mirrors the existing `isSavingEdit`/`handleSaveEditGame` Save-button treatment in the same file exactly — same `disabled` convention, same label-swap convention, not a new visual pattern:
```tsx
<button onClick={handleCreateGame} className="btn-primary" disabled={isSubmittingGame}>
  {isSubmittingGame ? 'Creating…' : 'Create'}
</button>
<button
  onClick={() => {
    setIsCreatingGame(false);
    setOpponent('');
    setGameDate('');
    setIsHome(true);
    setSelectedTeamForGame('');
  }}
  className="btn-secondary"
  disabled={isSubmittingGame}
>
  Cancel
</button>
```
Because this is a direct mirror of the already-approved `isSavingEdit` pattern (same disabled/label convention, no new visual treatment), a fresh `ui-reviewer` pass is not required for this specific change. If implementation ends up diverging from a straight mirror (different label wording, a spinner, etc.), it should get a `ui-reviewer` pass before merging.

**Delete-of-a-pending-game and edit-of-a-pending-game (Required Change 2)** — a pending (just-created, not-yet-reconciled) game can be deleted or edited before the raw `games` list ever includes it. Neither the delete nor the edit path invalidates `pendingCreatedGames` today, so both are now handled explicitly rather than left to the reconciliation effect (which can never fire for a deleted game's id, since `games` will never contain it):

`handleDeleteGameFromHome` — remove the id from `pendingCreatedGames` immediately on a successful delete, regardless of whether it was actually present (no-op if not):
```ts
const handleDeleteGameFromHome = useCallback(async (game: Game) => {
  closeSwipe();
  const confirmed = await confirm({
    title: 'Delete Game',
    message: 'Are you sure you want to delete this game? This action cannot be undone.',
    confirmText: 'Delete',
    variant: 'danger',
  });
  if (!confirmed) return;
  try {
    await deleteGameCascade(game.id);
    setPendingCreatedGames((prev) => prev.filter((g) => g.id !== game.id));
    trackEvent(AnalyticsEvents.GAME_DELETED.category, AnalyticsEvents.GAME_DELETED.action);
  } catch (error) {
    console.error('Failed to delete game', error);
    showError(error instanceof Error ? error.message : 'Failed to delete game');
  }
}, [closeSwipe, confirm]);
```

`handleSaveEditGame` — update the pending entry's fields directly (don't wait for the raw list to pick up the edit; whether `observeQuery` upserts an id absent from its current snapshot is undocumented Amplify behavior this plan makes no claim about):
```ts
const handleSaveEditGame = useCallback(async () => {
  if (!editingGameId) return;
  if (!editOpponent.trim()) {
    showWarning('Please enter an opponent name');
    return;
  }
  setIsSavingEdit(true);
  const timeoutId = setTimeout(() => {
    setIsSavingEdit(false);
    showError('Could not confirm save — check your connection and try again.');
  }, 5000);
  try {
    await client.models.Game.update({
      id: editingGameId,
      opponent: editOpponent.trim(),
      isHome: editIsHome,
      gameDate: editGameDate ? new Date(editGameDate).toISOString() : null,
    });
    clearTimeout(timeoutId);
    setPendingCreatedGames((prev) => prev.map((g) =>
      g.id === editingGameId
        ? { ...g, opponent: editOpponent.trim(), isHome: editIsHome, gameDate: editGameDate ? new Date(editGameDate).toISOString() : null }
        : g
    ));
    trackEvent(AnalyticsEvents.GAME_UPDATED.category, AnalyticsEvents.GAME_UPDATED.action);
    setEditingGameId(null);
    setIsSavingEdit(false);
  } catch (error) {
    clearTimeout(timeoutId);
    setIsSavingEdit(false);
    handleApiError(error, 'Failed to update game');
  }
}, [editingGameId, editOpponent, editIsHome, editGameDate]);
```
(Both handlers' bodies are otherwise unchanged from the current file — only the `pendingCreatedGames` line is new in each.)

### Decision 4: no code change to `SeasonReport.tsx` / `SeasonReportRoute.tsx`

Per Finding 7, there is no game-creation affordance on that surface, so there is no local "just-created game" to reconcile — the only staleness risk is a game created *elsewhere* while the report is already open, which is the same class of already-accepted, already-documented risk as Step 9's banner staleness (mid-session external change not reflected until re-entry/remount). Building a parallel reconciliation mechanism for a surface that never itself triggers the write would be speculative scope creep with no create-time observable to key it on. If this becomes a real complaint in practice, it is a `SeasonReport`-specific follow-up, not part of closing out `Game.create`'s conversion.

### Decision 5: `demoDataService.ts` uses the same `gameService.ts` wrapper, with no local-state reconciliation of its own

Per Finding 2, nothing renders `createDemoTeam`'s result today, so there is no UI state to patch. The conversion here is purely: replace `client.models.Game.create({...})` with `await createGame({...})`, drop the now-redundant `status: 'scheduled'` argument (Decision 1), and let the existing `try`/`catch`-based rollback (already present around the whole `createDemoTeam` body) continue to work unchanged — a thrown error from the new mutation is caught by the same outer `catch` that already triggers `deleteTeamCascade`/`deletePlayerCascade` cleanup today.

## File-by-File Changes

### 1. `amplify/data/resource.ts`

**a. Import** (after the `assignTeamOwner` import, matching double-quoted style):
```ts
import { createGame } from "../functions/create-game/resource";
```

**b. `Game` model-level authorization** — remove `'create'`, update the comment:
```ts
      // Create is intentionally routed through the Lambda-backed createGame
      // mutation (TEAM-ARCHIVE-STEP11), so coaches-population and (from Part
      // 2) the archived-team check happen server-side. Delete is separately
      // disallowed on the model — use deleteGameSafe.
      allow.ownersDefinedIn('coaches').to(['read', 'update']),
```

**c. New mutation declaration** — insert after the `assignTeamOwner` block (end of the `Team` lifecycle group) or immediately after the `Game` model block; either is fine since declaration order in this file does not need to match model order (confirmed by `archiveTeam` et al. already living well after `Team`). Follows `createSecureGameNote`'s shape most closely (a Lambda-backed *create*, not an update-in-place like the Team lifecycle mutations):
```ts
  // Lambda-backed game creation (TEAM-ARCHIVE-STEP11 Part 1). Derives
  // `coaches` from the team's own coaches array server-side rather than
  // trusting a client-supplied array (CLAUDE.md's standing coaches-population
  // rule). No archived-team check yet — see Part 2.
  createGame: a
    .mutation()
    .arguments({
      teamId: a.string().required(),
      opponent: a.string().required(),
      isHome: a.boolean().required(),
      gameDate: a.datetime(),
    })
    .returns(a.ref('Game'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(createGame)),
```

### 2. `amplify/functions/create-game/` (new)

**`resource.ts`:**
```ts
import { defineFunction } from '@aws-amplify/backend';

export const createGame = defineFunction({
  name: 'create-game-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});
```

**`package.json`** — identical shape to `create-game-note/package.json` (same two runtime deps, same `@types/aws-lambda` dev dep).

**`handler.ts`** — follows `create-game-note/handler.ts`'s structure closely (fetch the parent record for its `coaches`, authorize, `PutCommand` a fully-formed item, return it):
```ts
import type { Schema } from '../../data/resource';
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

type Handler = Schema['createGame']['functionHandler'];

export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito;
  const callerSub = identity?.sub;
  if (typeof callerSub !== 'string' || callerSub.length === 0) {
    throw new Error('User not authenticated');
  }

  const { teamId, opponent, isHome, gameDate } = event.arguments;

  if (typeof opponent !== 'string' || opponent.trim().length === 0) {
    throw new Error('opponent is required');
  }

  const gameTable = process.env.GAME_TABLE;
  const teamTable = process.env.TEAM_TABLE;
  if (!gameTable || !teamTable) {
    throw new Error('Required environment variables are not set');
  }

  const teamResponse = await docClient.send(new GetCommand({
    TableName: teamTable,
    Key: { id: teamId },
    ProjectionExpression: 'id, coaches',
    // Strongly consistent (TEAM-ARCHIVE-STEP11 revision, architecture review
    // finding): GetCommand defaults to eventually-consistent reads. Decision
    // 2 removes the client-side defensive "include currentUserId even if
    // team.coaches looks stale" compensation in favor of trusting this read.
    // Without ConsistentRead, a coach who just accepted a team invitation
    // and immediately tries to schedule a game could hit a stale replica and
    // get a hard "Access denied" error on a team visible in their own UI —
    // a worse failure mode than the silent/permissive behavior it replaces.
    // Cost: one extra RCU, no meaningful latency impact on a write path.
    ConsistentRead: true,
  }));

  const team = teamResponse.Item as { id: string; coaches?: string[] } | undefined;
  if (!team) {
    throw new Error('Team not found');
  }

  // TEAM-ARCHIVE-STEP11 Part 1: coaches derived server-side from the team's
  // own coaches array (Decision 2) — not accepted as a client argument. This
  // both closes the population rule (CLAUDE.md) and is the authorization
  // check: a caller not in `team.coaches` cannot create a game for it.
  const coaches = team.coaches ?? [];
  if (!coaches.includes(callerSub)) {
    throw new Error('Access denied: caller is not a coach on this team');
  }

  // No archived-team check in this part — see
  // TEAM-ARCHIVE-STEP11-GAME-CREATE-CONVERSION-PART2.md.

  const now = new Date().toISOString();
  const id = randomUUID();

  const item = {
    id,
    __typename: 'Game',
    teamId,
    opponent: opponent.trim(),
    isHome,
    gameDate: gameDate ?? null,
    status: 'scheduled',
    currentHalf: 1,
    elapsedSeconds: 0,
    lastStartTime: null,
    halfLengthMinutes: null,
    ourScore: 0,
    opponentScore: 0,
    coaches,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({
    TableName: gameTable,
    Item: item,
  }));

  return item;
};
```

**`handler.test.ts`** (new) — follows `create-game-note/handler.test.ts`'s mocking convention. Cases:
- creates a game with all default fields set correctly when the caller is a coach on the team.
- derives `coaches` from the team record, ignoring anything the caller might otherwise try to influence (there is no `coaches` argument to even attempt this with — the test documents that omission is deliberate).
- rejects when the caller is not authenticated (`identity.sub` missing).
- rejects when `teamId` does not resolve to an existing team.
- rejects when the caller is not in `team.coaches`.
- rejects when `opponent` is empty/whitespace-only.
- omits `gameDate` correctly when not supplied (`null`, not `undefined`, matching the schema field's nullable-not-required shape).

### 3. `amplify/backend.ts`

**a. Import** (after `assignTeamOwner`):
```ts
import { createGame } from './functions/create-game/resource';
```
**b. `defineBackend`** — add `createGame,` after `assignTeamOwner,`.

**c. Grants and env vars**, least-privilege, matching Step 1's `PolicyStatement` convention (not `grantReadWriteData`, since this Lambda never deletes from either table) — `gameTable` and `teamTable` are already declared at module scope:
```ts
// Grant table access for createGame Lambda (TEAM-ARCHIVE-STEP11 Part 1)
backend.createGame.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['dynamodb:PutItem'],
    resources: [gameTable.tableArn],
  })
);
backend.createGame.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['dynamodb:GetItem'],
    resources: [teamTable.tableArn],
  })
);
backend.createGame.addEnvironment('GAME_TABLE', gameTable.tableName);
backend.createGame.addEnvironment('TEAM_TABLE', teamTable.tableName);
```

### 4. `amplify/data/resource.safe-delete-policy.test.ts`

**a.** Update the `'does not grant model delete to Formation, Team, Player, Game, or GameNote'` test — `Game` now needs its own branch, same shape as the existing `GameNote` special case:
```ts
  it('does not grant model delete to Formation, Team, Player, Game, or GameNote; Game also has no model-level create (TEAM-ARCHIVE-STEP11)', () => {
    const blockedDeleteModels = ['Formation', 'Team', 'Player', 'Game', 'GameNote'];

    for (const modelName of blockedDeleteModels) {
      const block = extractBlock(modelName);

      if (modelName === 'GameNote') {
        expect(block).toMatch(/allow\.ownersDefinedIn\('coaches'\)\.to\(\['read'\]\)/);
      } else if (modelName === 'Game') {
        expect(block).toMatch(/allow\.ownersDefinedIn\('coaches'\)\.to\(\['read', 'update'\]\)/);
      } else {
        expect(block).toMatch(/allow\.ownersDefinedIn\('coaches'\)\.to\(\['create', 'read', 'update'\]\)/);
      }
    }
  });
```

**b.** New test asserting the `createGame` mutation shape, matching the style of the existing `'declares owner-authorized lifecycle mutations returning Team'` test:
```ts
  it('declares a Lambda-backed createGame mutation returning Game with no client-supplied coaches argument', () => {
    const block = extractBlock('createGame');

    expect(block).toContain('.mutation()');
    expect(block).toContain('teamId: a.string().required()');
    expect(block).toContain('opponent: a.string().required()');
    expect(block).toContain('isHome: a.boolean().required()');
    expect(block).not.toContain('coaches:');
    expect(block).toContain(".returns(a.ref('Game'))");
    expect(block).toContain('allow.authenticated()');
    expect(block).toContain('a.handler.function(createGame)');
  });
```
(The `.not.toContain('coaches:')` assertion directly pins Decision 2 — a future edit that "helpfully" adds a client-supplied `coaches` argument back would fail this test loudly.)

### 5. `src/services/gameService.ts` (new), plus a shared helper extraction (revised per architecture review — Minor finding 8)

**Finding confirmed by reading the actual current files:** `teamLifecycleService.ts` already has a private `assertLifecycleResult<T>` helper that is structurally identical to what the original plan proposed writing a third time as `gameService.ts`'s own `assertMutationResult`:
```ts
// src/services/teamLifecycleService.ts, current shape
function assertLifecycleResult<T>(
  result: { data?: T | null; errors?: Array<{ message?: string }> },
  fallbackMessage: string,
): NonNullable<T> {
  if (result.errors && result.errors.length > 0) {
    throw new Error(result.errors[0]?.message || fallbackMessage);
  }
  if (!result.data) {
    throw new Error(fallbackMessage);
  }
  return result.data as NonNullable<T>;
}
```
`cascadeDeleteService.ts`'s `assertMutationSuccess` is a *third*, related-but-not-identical variant — its contract genuinely diverges (`void` return, not `NonNullable<T>` passthrough; it also unwraps an AWSJSON-encoded string via a `while (typeof parsedData === 'string') JSON.parse(...)` loop that the other two don't need, because `archiveTeam`/`restoreTeam`/`assignTeamOwner`/`createGame` all `.returns(a.ref(...))` a typed model, not `a.json()`). **Decision: consolidate the two identical-shape helpers (`teamLifecycleService.ts`'s and the new `gameService.ts`'s), leave `cascadeDeleteService.ts`'s `assertMutationSuccess` as its own, separate helper** — its divergent contract is a real reason to keep it distinct, not an oversight.

**5a. `src/services/amplifyMutationResult.ts` (new)** — the extracted, shared helper:
```ts
/**
 * Shared result-unwrapping helper for Amplify Gen2 custom mutations that
 * `.returns(a.ref(<Model>))` a typed model (not `a.json()` — see
 * cascadeDeleteService.ts's assertMutationSuccess for the AWSJSON-string
 * variant, which has a genuinely different contract and is not consolidated
 * here). Used by teamLifecycleService.ts and gameService.ts.
 */
export function assertMutationResult<T>(
  result: { data?: T | null; errors?: Array<{ message?: string }> },
  fallbackMessage: string,
): NonNullable<T> {
  if (result.errors && result.errors.length > 0) {
    throw new Error(result.errors[0]?.message || fallbackMessage);
  }
  if (!result.data) {
    throw new Error(fallbackMessage);
  }
  return result.data as NonNullable<T>;
}
```
**`src/services/amplifyMutationResult.test.ts` (new)** — three cases (success returns `data`; `errors` present throws the server message; falsy `data` with no errors throws the fallback), effectively the test coverage `teamLifecycleService.test.ts` already exercises indirectly through its three public functions, now given a direct, dedicated test.

**5b. `src/services/teamLifecycleService.ts` (retrofit)** — delete the private `assertLifecycleResult` function; import and use the shared helper instead:
```ts
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { assertMutationResult } from './amplifyMutationResult';

const client = generateClient<Schema>();

export async function archiveTeam(teamId: string): Promise<NonNullable<Schema['archiveTeam']['returnType']>> {
  const result = await client.mutations.archiveTeam({ teamId });
  return assertMutationResult(result, 'Failed to archive team');
}
// ...restoreTeam, assignTeamOwner unchanged except for the same substitution.
```
No behavior change — `teamLifecycleService.test.ts`'s existing assertions (all against the three public functions, not the private helper) should pass unmodified; confirm during implementation that no test imports the now-removed private helper directly.

**5c. `src/services/gameService.ts` (new)** — follows `teamLifecycleService.ts`'s convention exactly, using the shared helper:
```ts
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { assertMutationResult } from './amplifyMutationResult';

const client = generateClient<Schema>();

export interface CreateGameInput {
  teamId: string;
  opponent: string;
  isHome: boolean;
  gameDate?: string;
}

/**
 * Any coach on the team. Lambda-backed (TEAM-ARCHIVE-STEP11) so `coaches`
 * population happens server-side from the team's own coaches array, not from
 * a client-supplied value. No archived-team check until Part 2.
 */
export async function createGame(input: CreateGameInput): Promise<NonNullable<Schema['createGame']['returnType']>> {
  const result = await client.mutations.createGame(input);
  return assertMutationResult(result, 'Failed to create game');
}
```

### 6. `src/components/Home.tsx`

- New import: `import { createGame } from '../services/gameService';`.
- `compareGamesForHomeDisplay` lifted to module scope (unchanged body, moved out of the inline `useAmplifyQuery` call).
- New state: `pendingCreatedGames`, `gameRefreshKey`, `isSubmittingGame` (revised — the original plan only had `pendingCreatedGames`).
- `useAmplifyQuery('Game', { sort: compareGamesForHomeDisplay }, [gameRefreshKey])` — `gameRefreshKey` added as a dep (was previously called with no `deps` argument at all).
- `gamesForDisplay` memo + reconciliation effect, per Decision 3 (unchanged shape from the original plan).
- New effect: window `focus` + `document` `visibilitychange` listeners bumping `gameRefreshKey` (revised — new in this round, see Decision 3's code block and Decision 0's mitigation).
- `handleCreateGame` rewritten per Decision 3 — `coachesArray` computation block deleted; validation moved ahead of `setIsSubmittingGame(true)`; `gameRefreshKey` bumped in a `finally` block.
- Create-form button JSX updated: `disabled={isSubmittingGame}` on both Create and Cancel, `{isSubmittingGame ? 'Creating…' : 'Create'}` label swap — mirrors the existing `isSavingEdit`/Save-button treatment exactly (see Decision 3).
- `handleDeleteGameFromHome` — one new line filtering the deleted game's id out of `pendingCreatedGames` on success (see Decision 3).
- `handleSaveEditGame` — one new block updating the matching pending game's fields on success (see Decision 3).
- Every other reference to the raw `games` variable (checklist completion at lines ~130-136, debug snapshot at ~199-204, `firstScheduledGame`/`firstGame` lookups at ~252-261, the three status groupings at ~491-496, the `<QuickStartChecklist games={...}>` prop and empty-state check at ~515/591, group headers/renders at ~599-733) renamed to `gamesForDisplay`.

### 7. `src/services/demoDataService.ts`

- New import: `import { createGame } from './gameService';` (relative import within `src/services/`).
- Replace:
```ts
    await client.models.Game.create({
      teamId,
      opponent: 'Lions',
      isHome: true,
      gameDate: gameDate.toISOString(),
      status: 'scheduled',
      coaches: [currentUserId],
    });
```
with:
```ts
    await createGame({
      teamId,
      opponent: 'Lions',
      isHome: true,
      gameDate: gameDate.toISOString(),
    });
```
(`status` and `coaches` arguments dropped — Decisions 1 and 2. The surrounding `try`/`catch` rollback is untouched; a thrown error from `createGame` is caught exactly like a rejected `client.models.Game.create()` promise was.)
- The mock `Game: { create: mockGameCreate }` in `demoDataService.ts`'s own client-generation is no longer called from this file at all (the `Game.create` model call site is gone); `demoDataService.ts` no longer imports `generateClient`'s `Game` model member for this purpose. (Team/Player/TeamRoster direct-client calls are all unaffected and unchanged.)

### 8. Test updates

**`src/services/amplifyMutationResult.test.ts` (new)** — three cases per File-by-File item 5a: success returns `result.data`; `result.errors` present → throws with the server's message; `result.data` falsy with no errors → throws the fallback message.

**`src/services/teamLifecycleService.test.ts`** — no behavior change expected; confirm no test imports the now-removed private `assertLifecycleResult` directly (all existing assertions go through the three public functions). If none do, no edit needed beyond the source retrofit itself.

**`src/services/gameService.test.ts` (new)** — mirrors `teamLifecycleService.test.ts`'s convention exactly (`vi.hoisted` mock for `client.mutations.createGame`, `vi.mock('aws-amplify/data', ...)`; imports `assertMutationResult` behavior indirectly through `createGame`, not re-tested here since it has its own dedicated test file). Cases: success returns `result.data`; `result.errors` present → throws with the server's message; `result.data` falsy with no errors → throws the fallback message.

**`src/components/Home.test.tsx`:**
- The `vi.mock('aws-amplify/data', ...)` block's `Game: { create: mockGameCreate }` entry is removed (no longer called). **`Game: { update: mockGameUpdate }` (or equivalent) must be added/confirmed present** in that same mock block — `handleSaveEditGame` calls `client.models.Game.update` directly (unchanged by this slice) and the new edit-of-a-pending-game test below exercises it; read the actual current mock shape during implementation to confirm whether an `update` entry already exists or needs adding (the `CoachProfile: { get: mockCoachProfileGet }` sibling entry is the shape to match).
- `mockGameCreate` is replaced with a new hoisted `mockCreateGame` mocking `../services/gameService`'s `createGame` export directly (matching how other service-level mocks in this file are structured, e.g. the `demoDataService` mock at line 110-113) rather than mocking the low-level Amplify client.
- The existing test `'does not call Game.create when currentUserId is unresolved'` (line 298) is renamed to `'does not call createGame when currentUserId is unresolved'` and its assertion changes from `expect(mockGameCreate).not.toHaveBeenCalled()` to `expect(mockCreateGame).not.toHaveBeenCalled()`.
- **New test:** `'adds the newly created game to the list immediately, without waiting for the Game query to refresh'` — requires a matching team seeded in `teamQueryResult.data` (e.g. `{ id: 'team-1', name: 'Eagles', coaches: ['test-user-id'] }`) **before** the game is created, since `Home.tsx`'s game-card rendering does `const team = getTeam(game.teamId); if (!team) return null;` — without a matching team, the new card would silently fail to render and the test would give a confusing false failure. Mock `mockCreateGame` to resolve with a fully-formed `Game` object whose `id` is not present in `gameQueryResult.data` and whose `teamId` matches the seeded team; submit the create-game form; assert the new game's opponent name appears in the rendered list without re-rendering or advancing `gameQueryResult`. This is the test that actually proves Decision 3's mechanism, not just that the mutation was called.
- **New test:** `'stops showing a pending game once the Game query independently includes it'` — set up a pending game via the create flow (same team-seeding requirement as above), then **reassign** `gameQueryResult.data = [...]` to a fresh array containing a game with the same `id` (simulating the raw query catching up) — **not an in-place mutation** (e.g. `.push(...)`); this file's established pattern throughout (see every existing `teamQueryResult.data = [...]`/`gameQueryResult.data = [...]` assignment) is reassignment, and production code (`useAmplifyQuery`) always sets a fresh array too, so `useMemo`/`useEffect` dependency arrays keyed on `games` correctly detect the change only when the array reference itself changes; re-render; assert only one card for that game is shown (proves the reconciliation effect, not just the addition side).
- **New test (Required Change 2):** `'removes a pending game from the list when it is deleted before the raw Game query catches up'` — create a game via the create flow (`mockCreateGame` resolving with an id not present in `gameQueryResult.data`, same team-seeding requirement as above); confirm the pending card is rendered; trigger the delete flow for that card (`mockDeleteGameCascade` — currently `../services/cascadeDeleteService`'s `deleteGameCascade` mock — resolving successfully). Note: this file's existing `vi.mock('./ConfirmModal', ...)` hardcodes `useConfirm` to always resolve `false` (decline); this test needs the confirmation to resolve `true`, so the mock needs to move to a hoisted, per-test-overridable function (e.g. `mockConfirm` set up via `vi.hoisted`, defaulting to `false`, overridden with `mockConfirm.mockResolvedValueOnce(true)` in this specific test) rather than the current inline `() => vi.fn().mockResolvedValue(false)` factory — confirm this restructuring against the file's actual current mock during implementation. After the delete resolves, assert the card is gone and does **not** reappear (proves the phantom-card gap architecture review found is closed: without this fix, `games` never contains the deleted id, so the reconciliation effect could never remove it on its own).
- **New test (Required Change 3):** `'disables the Create button while game creation is in flight and re-enables it after'` — use a controllable/deferred promise for `mockCreateGame` (e.g. resolve manually rather than via `mockResolvedValue`); click Create; assert the Create button is `disabled` while the promise is pending; resolve the promise; assert the button is re-enabled (or the form has closed, per the success path). Mirrors how `isSavingEdit`'s existing disabled-state behavior would be tested, if it has a test — confirm during implementation whether an analogous existing test for `isSavingEdit` exists to pattern-match against.

**`src/services/demoDataService.test.ts`:**
- The `vi.mock('aws-amplify/data', ...)` block's `Game: { create: mockGameCreate }` entry is removed; a new hoisted `mockCreateGame` mocks `./gameService`'s `createGame` export via a new `vi.mock('./gameService', () => ({ createGame: mockCreateGame }))`.
- Existing assertions that inspect `mockGameCreate`'s call arguments are updated to inspect `mockCreateGame`'s call arguments instead, with the expected payload shape reduced (no `status`, no `coaches` — Decisions 1/2).
- Existing failure-path test (`'cleans up partial data on API error'`, per `docs/plans/test-coverage-80-plan.md`'s item 9, if present under a similar name) is updated to reject via `mockCreateGame.mockRejectedValueOnce(...)` instead of `mockGameCreate`.

### 9. `docs/SHARING-PERMISSIONS.md` (new — Minor finding 9)

The doc currently states (line ~160):
> Game creation, until Phase 8's `Game.create` Lambda conversion lands (still not done). Archived teams are filtered from the Schedule Game dropdown (`src/components/Home.tsx`) with a defensive client-side re-check in `handleCreateGame`, but a raw GraphQL call is not blocked.

Both halves become false the moment Part 1 ships: the conversion has landed (not "still not done"), and a raw `client.models.Game.create()` call **is** now blocked (model-level `create` grant removed, Decision 2/File-by-File item 1). The archived-team check itself genuinely remains unenforced server-side until Part 2 — that half doesn't change. This is a one-line amendment, not the full "UI-only enforced" → "server-side enforced" reclassification (that stays Part 2's job per the existing "Explicitly out of scope" list):
> Game creation — the `Game.create` Lambda conversion (Phase 8 Part 1) has landed: a raw `client.models.Game.create()` call is now rejected outright. Archived teams are still filtered from the Schedule Game dropdown (`src/components/Home.tsx`) with a client-side `isTeamActive` check, but the `createGame` Lambda does not yet enforce the archived-team check server-side — that is Phase 8 Part 2, still pending.

## Test Plan

**Unit (Vitest, `npm run test:run`):**
- `amplify/functions/create-game/handler.test.ts` (new, see File-by-File item 2).
- `amplify/data/resource.safe-delete-policy.test.ts` (updated, see item 4).
- `src/services/amplifyMutationResult.test.ts` (new, see item 5a).
- `src/services/teamLifecycleService.test.ts` (confirm unaffected, see item 5b).
- `src/services/gameService.test.ts` (new, see item 5c).
- `src/components/Home.test.tsx` (updated + 4 new tests, see item 8).
- `src/services/demoDataService.test.ts` (updated, see item 8).

**E2E (Playwright) — audited, not expected to need changes; re-run to confirm:**
- `e2e/full-workflow.spec.ts`, `e2e/game-planner.spec.ts`, `e2e/team-management.spec.ts`, `e2e/team-sharing.spec.ts`, `e2e/game-management-direct-note.mobile.spec.ts`, `e2e/auth.spec.ts` (all create a game via the UI as setup). Per Finding 12, these should become more reliable, not less, but must be run as part of this slice's verification (`npm run test:e2e:smoke` at minimum; `npm run test:e2e` for the full set before considering this part done) rather than assumed safe from static reading alone.

**Backend typecheck:** `npx tsc -p amplify/tsconfig.json --noEmit` — must be clean; this is the stage that would have caught a bad `Schema['createGame']` reference the way it caught the original three lifecycle-mutation declarations in Step 1.

## Real-Time-Sync Validation Checklist (manual, against a real sandbox — required before this part is considered done)

Matching the rigor the parent plan explicitly demands for this exact risk: *"create a game and verify it appears without a manual page refresh, including for other coaches/subscribed views, before the archived-team check is added."*

1. **Single coach, same session, `Home.tsx`.** Sign in, open "Schedule New Game," create a game. Confirm the new game card appears in the appropriate group (Upcoming/Active) **without a page reload**, immediately after the create button's loading state clears.
2. **Single coach, direct navigation into the new game.** From step 1's result, click the new game card. Confirm `GameManagementRoute` renders the game correctly (proves Finding 9 — the `location.state`-carried object from step 1 is used directly, no fetch needed).
3. **Single coach, hard refresh immediately after creation.** After step 1, hard-refresh `Home.tsx` (or open a new tab to `/`) within a few seconds of creating the game. Confirm the game is present (proves `observeQuery`'s fresh initial resolution on remount also picks it up — validates that Part 1 doesn't depend solely on the local `pendingCreatedGames` patch to be correct long-term).
4. **Two coaches, same team, real-time cross-session (revised per architecture review — the original wording described a "catch-up" mechanism that doesn't actually exist).** Coach A and Coach B both signed in, both viewing `Home.tsx` for a shared team. Coach A creates a game. **Precise expected result, tested in two parts:**
   - **Part A — genuinely untouched.** Leave Coach B's `Home.tsx` mounted and untouched (no clicks, no navigation, no tab switch, no window blur/refocus) for a real duration (a few minutes). Confirm the new game does **not** appear. `useAmplifyQuery`'s underlying `observeQuery` subscription does not re-list on its own — re-render and interaction alone do nothing, and there is no subscription event for this write path (see Decision 0). A tester who clicks around Coach B's UI and happens to see the game appear (e.g., because they navigated to a different page and back) could easily misattribute this to a working "catch-up" mechanism rather than correctly attributing it to a remount — this part of the check exists specifically to prevent that false-positive.
   - **Part B — remount or refocus.** From Part A's state, either (i) navigate away from `Home.tsx` and back (remount), (ii) hard-refresh, or (iii) switch away from the browser tab/app and back (exercises the new window-focus/visibility mitigation from Decision 3/Decision 0). Confirm the new game **now** appears in each case. Record how long a genuine remount/refocus takes to reflect the change; if `observeQuery`'s re-scan itself is slow (more than a few seconds) even after a fresh subscription, that is a finding to carry into Part 2's docs update, not a blocker for Part 1.
   
   **This is the single most important check in this list** — the parent plan's real risk callout is exactly this scenario, and it is the one case `pendingCreatedGames` (local to Coach A's own session) cannot help with by design, and the one case this revision's window-focus/visibility mitigation only partially closes (it helps once Coach B's browser regains focus, not while they remain actively focused on an untouched Home screen). This codebase has already accepted the underlying pattern's lag for Team lifecycle mutations (Step 1/Step 9's documented residual risk #2), but see Decision 0 for why this application of it is a genuine new regression on a previously-real-time path, not merely a continuation of that acceptance. **Reusable harness note:** this feature already has two-coach E2E test infrastructure from Step 10 (`e2e/team-archive-ownership.spec.ts`) that establishes the pattern for driving two authenticated browser contexts against a shared team — a future automation candidate for this exact scenario, though it is correctly left as a manual check for this slice.
5. **Demo team creation (`createDemoTeam`).** Confirm `createDemoTeam('user-1')` (invoked directly, e.g. from a scratch script or the existing unit test's real network mode if available, since no UI path reaches it — Finding 2) completes without error and the resulting `Game` row is queryable via `client.models.Game.get()` with the expected fields (`status: 'scheduled'`, correct `teamId`/`coaches`).
6. **Offline behavior unchanged.** Confirm attempting to schedule a game while offline still fails with a clear error (not a queued/deferred mutation) — proves Finding 10 (no offline-queue regression, since there was never offline-queue support for this operation to preserve or break).

## Manual Sandbox Verification Checklist

In addition to the real-time checklist above:
- [ ] `npx ampx sandbox` deploys cleanly with the new `createGame` Lambda registered and the `Game` model's authorization grant change applied.
- [ ] A direct `client.models.Game.create(...)` call (e.g., from browser devtools against a signed-in session) is rejected by AppSync's authorization layer, confirming `create` is genuinely removed from the model-level grant, not just from the UI's call sites.
- [ ] `client.mutations.createGame({...})` succeeds for a coach on the team and fails with `'Access denied: caller is not a coach on this team'` for a non-coach.
- [ ] The created `Game` row in DynamoDB (via console or `client.models.Game.get()`) has every field a normal AppSync-created row would have — `id`, `createdAt`, `updatedAt`, `status: 'scheduled'`, `currentHalf: 1`, `elapsedSeconds: 0`, `ourScore: 0`, `opponentScore: 0` — confirming Finding 3's "Lambda must replicate schema defaults" concern is actually closed, not just planned.
- [ ] CloudWatch logs for `create-game-handler` show no unexpected errors during the above.

## Risks and Edge Cases

- **The single biggest residual risk after this part ships is the same one named in the checklist item 4 above: cross-coach real-time propagation lag with no subscription-driven correction (reframed per architecture review — corrects the original plan's understated framing).** The original draft characterized this as "inherent to every Lambda-direct-DynamoDB-write mutation already shipped in this feature... not new to this slice." That is true of the *write pattern* in the abstract but false as *applied here* (see Decision 0): the Team lifecycle mutations this pattern was previously used for (Step 1/Step 9) converted operations that were never real-time-synced to begin with, so there was no prior working behavior to lose. `Game.create` is different — today, `client.models.Game.create()` **does** fire `onCreateGame` for every subscriber. This conversion genuinely regresses a previously-working real-time path on the single busiest screen in the app (`Home.tsx`, viewed constantly by every coach); it is not a continuation of an already-accepted tradeoff, even though the underlying write-pattern mechanics are the same ones this feature has used before. **Concrete mitigation added in this revision** (see Decision 3): `gameRefreshKey` re-subscribes the raw `Game` query on window focus and tab-visibility change, so a coach who leaves `Home.tsx` mounted in a background tab (or switches away and back) gets a fresh scan without a full remount. This does not eliminate the gap — a coach who stays actively focused on an untouched `Home.tsx` the whole time still will not see another coach's new game until they navigate away and back, refocus, or refresh (see the corrected Real-Time-Sync Validation Checklist item 4) — a full fix would require either a genuine AppSync subscription-triggering write path (Decision 0's rejected alternative, deferred to a future lower-stakes slice) or a polling mechanism, both materially larger changes. Documented here as an accepted, honestly-framed residual risk with a partial, concrete mitigation, not fully closed.
- **`gamesForDisplay`'s merge does not perfectly replicate `compareGamesForHomeDisplay`'s sort stability if `games` itself is mid-transition** (e.g., the raw list updates on the same render the reconciliation effect processes it) — a one-render flicker in sort position is possible but not a correctness bug (no data is lost or duplicated; `additions.filter` and the reconciliation effect's `next.filter` both key strictly on `id`, so no double-render of the same game is possible even under rapid re-renders).
- **The window-focus/visibility mitigation re-subscribes on every focus/visibility event, with no debounce.** For a coach rapidly alt-tabbing, this could churn several `observeQuery` re-subscriptions in quick succession. Each is cheap (an unsubscribe + a fresh scan), and this mirrors `teamRefreshKey`'s existing unthrottled bump pattern in `Management.tsx`, so it is not a new risk category — noted here rather than treated as a design change, since the existing precedent already accepted this tradeoff.
- **`gameService.ts`'s `NonNullable<Schema['createGame']['returnType']>` return type nominally carries `Game`'s lazy relation loaders** (`team`, `lineupAssignments`, etc.) that will not function correctly at runtime on a plain Lambda-returned object — the same caveat Step 5 documented for `Team`. Confirmed by reading every consumer of the returned object in this slice (`Home.tsx`'s `pendingCreatedGames`/`gamesForDisplay`, `handleGameClick`'s JSON round-trip): none of them invoke a lazy relation loader on a `Game` object. If a future change adds one, it will silently fail against a Lambda-created game specifically — worth a code comment at the `gameService.ts` return type, not a design change here.
- **`opponent.trim()` is applied server-side now** (previously only client-side in `handleCreateGame`'s validation, never enforced by the schema or a Lambda) — a strictly more correct behavior, but confirm no existing test or e2e spec relies on an untrimmed opponent name surviving to storage (unlikely, but worth a quick grep during implementation).
- **This part's Lambda has no archived-team check at all** — a coach can still create a game against an archived team via this new mutation, exactly as today via the direct client call. This is not a regression (today's UI-only enforcement via the Schedule Game dropdown filter and `isTeamActive` check is unchanged and still the only protection), it is Part 2's entire reason to exist. Explicitly not fixed here.

## Sequencing

1. `amplify/data/resource.ts` + `amplify/functions/create-game/` (new, including the `ConsistentRead: true` `GetCommand`) + `amplify/backend.ts`. Checkpoint: `npx tsc -p amplify/tsconfig.json --noEmit` clean, `amplify/functions/create-game/handler.test.ts` green.
2. `amplify/data/resource.safe-delete-policy.test.ts` update. Checkpoint: green.
3. `src/services/amplifyMutationResult.ts` (new) + its test; `src/services/teamLifecycleService.ts` retrofit (confirm `teamLifecycleService.test.ts` still green); `src/services/gameService.ts` (new) + its test.
4. `src/components/Home.tsx` conversion (Decision 3's full mechanism, including `gameRefreshKey`, the focus/visibility effect, `isSubmittingGame`, and the delete/edit reconciliation) + `src/components/Home.test.tsx` updates (including the new delete-of-pending-game and Create-button-disabled tests).
5. `src/services/demoDataService.ts` conversion (lockstep, Decision 5) + `src/services/demoDataService.test.ts` updates.
6. `docs/SHARING-PERMISSIONS.md` one-line amendment (File-by-File item 9).
7. `npm run gate:commit` — full pass.
8. Sandbox deploy + full Real-Time-Sync Validation Checklist (including the two-part cross-coach check, item 4) + Manual Sandbox Verification Checklist.
9. `npm run test:e2e:smoke` (minimum) against the sandbox; `npm run test:e2e` if time allows before considering Part 1 closed.
10. Update `docs/plans/TEAM-ARCHIVE-PLAN.md`'s Implementation Status: Part 1 landed, Part 2 (archived-team check) still open.
11. Only after all of the above: begin Part 2 (separate plan doc, separate implementation pass).
