# Implementation Plan: Pitch Reliability Hardening

**Source:** Architecture review + independent verification by two model reviews (see conversation log; not checked into the repo). Four findings were confirmed/refined against the code as of this branch.

**Scope:** This plan addresses four architectural weaknesses in live-game handling under poor sideline connectivity. It does not re-litigate the findings — see the "Root cause" subsection of each issue for the verified chain of evidence.

---

## Priority & Sequencing

| # | Issue | Priority | Risk of fix | Pipeline |
|---|---|---|---|---|
| A | Orphaned `PlayTimeRecord` silently over-credits play time (offline sub + offline halftime) | **P0 — active data-integrity bug** | Low-medium (contained to offline reconciliation path) | Full dev-pipeline (touches offline architecture) |
| B | Game clock can't be stopped by a crash/forgotten pause; unstoppable drift feeds bad data into `PlayTimeRecord` | **P1 — data-integrity safety net** | Medium (new UX surface) | Full dev-pipeline (UI-impacting) |
| C | Ref-guard sprawl patching subscription/local-state races (8+ refs, 3 past issues: #49, #31, #177) | **P2 — maintainability** | Low if done as pure refactor with characterization tests first | Defect-fix pipeline, refactor-only |
| D | No transactional guarantee across `PlayTimeRecord`/`LineupAssignment`/`Substitution` writes | **P3 — structural, high value, high cost** | High (new Lambda, new auth surface, offline-queue redesign for this path) | Needs its own plan-writer + architect-reviewer pass before implementation; **not scoped for full implementation in this plan** |

Recommended order: **A → C → B → D**. A is a live bug affecting fairness data today and is the most contained. C is a low-risk refactor that also makes B's implementation easier to land safely (fewer ad hoc guards to reconcile against). D is deliberately deferred to its own follow-up plan given its size — see "Issue D" below for why.

---

## Issue A — Orphaned PlayTimeRecord over-credits play time

### Root cause (verified chain)
1. `closeActivePlayTimeRecords` (`src/services/substitutionService.ts`) does a `PlayTimeRecord.list()` read as a two-phase safety net for records not present in local state.
2. Offline, that read fails; the failure is swallowed rather than surfaced (`substitutionService.ts:67-69`).
3. Because nothing throws, the caller believes closing succeeded. `halftimePtrClosePendingRef` (`GameManagement.tsx:1624-1626`) is never set, so no retry is scheduled on reconnect.
4. The subbed-in player's `PlayTimeRecord` (itself sitting in the offline queue, not yet in DynamoDB or React state) never gets `endGameSeconds` set at the halftime boundary.
5. At end-game, `closeActivePlayTimeRecords` runs again, finds the still-open record, and closes it using `endGameTime` — silently crediting the player for time they didn't play (spanning the halftime break and, if never subbed again, into the second half).
6. `SeasonReport.tsx:377-396` back-fills unclosed records for *display*, but this doesn't touch the live rotation math (`rotationPlannerService.ts`), so the bad data feeds the fair-rotation algorithm for the rest of the season.

### Proposed fix
1. **Stop swallowing the offline read failure.** In `closeActivePlayTimeRecords`, distinguish "no records needed closing" from "couldn't check" — on a failed/offline read, set a pending-compensation flag and **do not** let the caller treat the halftime close as complete.
2. **Persist the intended close time, not "now."** The compensation record must carry the game-clock second at which the close *should have happened* (captured at the moment halftime/end was triggered), so a delayed retry doesn't stamp the wrong boundary. Store this alongside the pending flag (component state is enough if the retry is driven from the same session; if it must survive a reload, persist it in IndexedDB next to the offline mutation queue).
3. **Actually re-run the close on reconnect.** Add a reconciliation step to the drain sequence (`useOfflineMutations.ts` / `useOfflineQueueDrain.ts`) that, after mutations drain, re-invokes `closeActivePlayTimeRecords` for any pending compensation using the persisted close time.
4. **Regression test the exact chain:** offline substitution → offline halftime → reconnect → assert the subbed-in player's `PlayTimeRecord.endGameSeconds` equals the halftime boundary, not the later end-game time.
5. **Secondary safety net (optional, recommend including):** add a sanity check in `playTimeCalculations.ts` or `rotationPlannerService.ts` that flags (log/console warn, not silent) a `PlayTimeRecord` whose span crosses a half boundary without a corresponding `Substitution` — makes any future recurrence of this bug class visible instead of silently absorbed into stats.

### Files
- `src/services/substitutionService.ts` — stop swallowing the read failure, add compensation metadata
- `src/hooks/useOfflineMutations.ts` and/or `src/hooks/useOfflineQueueDrain.ts` — reconciliation step post-drain
- `src/components/GameManagement/GameManagement.tsx` — `halftimePtrClosePendingRef` logic
- `src/utils/playTimeCalculations.ts` or `src/services/rotationPlannerService.ts` — optional sanity check
- Tests: `substitutionService.test.ts`, `useOfflineMutations.test.ts`, `useOfflineQueueDrain.test.ts`, `offlineQueueService.test.ts`

### Edge cases
- Multiple offline substitutions before an offline halftime — compensation must handle N pending records, not just one.
- Reconnect happens mid-drain and the app is closed again before reconciliation runs — pending state must survive a reload (IndexedDB, not just a React ref).
- Coach never reconnects until well after the game (next day) — reconciliation should still apply the persisted halftime-boundary time, not "now."

---

## Issue B — Unstoppable clock drift during unrecorded stoppages

### Root cause (verified)
`lastStartTime` is a wall-clock anchor with no upper bound: if the coach doesn't tap pause before an app crash, force-quit, or extreme backgrounding (injury stoppage, halftime the coach forgot to end manually before locking the phone, etc.), elapsed wall-clock time keeps accruing against that anchor with nothing to arrest it. This is the actual risk — not the previously-assumed "clock freezes for a second coach," which the wall-clock-anchor design already handles correctly via `useGameSubscriptions.ts:234-239`.

### Proposed fix
1. On resume/reconnect — where `useGameSubscriptions.ts` recomputes `elapsedSeconds + (now - lastStartTime)` — detect anomalously large gaps (e.g., threshold well beyond a normal substitution/halftime window, configurable, starting conservatively) between `lastStartTime` and the recompute time.
2. When detected, don't silently apply the full gap. Surface a confirmation modal: "The game clock advanced by X minutes while the app was closed — was play stopped during this time?" with options to accept the full elapsed time or adjust it (e.g., "back-date" the resume to when play actually restarted).
3. Persist an audit trail of any manual correction (e.g., a `GameNote` or a dedicated field) so it's visible in game history and doesn't look like silent data tampering.
4. This is a coach-facing UX feature, not just a bug fix — treat it as such: needs a UI review pass (per `docs/specs/UI-SPEC.md`) since it's a new modal in the live-game flow.

### Files
- `src/components/GameManagement/hooks/useGameSubscriptions.ts` — gap detection at reconnect
- New confirmation modal component under `src/components/GameManagement/`
- `src/components/GameManagement/GameManagement.tsx` — wiring
- `docs/specs/Game-Management-Spec.md` — document the new behavior
- Tests: gap-detection unit tests with mocked `Date.now()`, modal component test, integration test for the correction flow

### Edge cases
- Gap spans exactly the auto-halftime boundary — must not double-trigger both the halftime auto-pause logic and the gap-correction modal.
- Coach dismisses the modal without choosing — need a safe default (don't silently accept an implausible gap; default to "needs review" rather than either extreme).
- Threshold tuning — too low and it nags on ordinary substitution delays; too high and it misses real crashes. Start conservative and make it a named constant, not a magic number, so it's easy to tune from data later.

---

## Issue C — Consolidate the ref-guard race-patching pattern

### Root cause (verified)
At least eight refs (`manuallyPausedRef`, `isRunningRef`, `gameStateRef`, `lineupSyncInProgressRef`, `halftimeTriggeredRef`, `endGameTriggeredRef`, `halftimeInProgressRef`, `endGameInProgressRef`) plus five inline stale-update checks inside one `setGameState` call (`useGameSubscriptions.ts:156-206`) exist to resolve races between local intent and incoming `observeQuery` updates. Each was added issue-by-issue (#49, #31, #177) rather than as a single reconciliation design.

### Proposed fix
**Refactor only — no behavior change in this pass.** The guards work today; the risk is in the *next* race, not the current ones.
1. Write characterization tests first: capture current behavior for every guarded transition (pause, resume, halftime, end-game, stale-score, stale-second-half) so a refactor can be verified byte-for-byte against today's behavior before any guard logic changes.
2. Extract the scattered inline checks into one named function, e.g. `shouldAcceptRemoteGameUpdate(local, remote, guards): boolean`, called from the single `observeQuery` callback instead of five ad hoc inline conditions.
3. Document each guard's purpose and originating issue in one place (a comment block at the top of `useGameSubscriptions.ts` or a short section in `docs/ARCHITECTURE.md`), so a future contributor extends the reconciliation helper instead of adding a ninth ref.
4. Add a note to `CLAUDE.md`'s "Game timer is client-side" section: any new local/subscription race must go through this helper, not a new ad hoc ref.

### Files
- `src/components/GameManagement/hooks/useGameSubscriptions.ts` — extraction, no logic change
- `docs/ARCHITECTURE.md`, `CLAUDE.md` — documentation
- Tests: new characterization tests in `useGameSubscriptions.test.ts` before the refactor; same suite re-run after to prove equivalence

### Edge cases
- This is the one item in the plan where the primary risk *is* the fix itself (regression in a load-bearing, already-hardened state machine). Do not combine with Issue B's changes in the same PR — land this first, in isolation, so any regression is easy to bisect.

---

## Issue D — No transactional guarantee across substitution writes (deferred)

### Root cause (verified)
`executeSubstitution` issues five sequentially awaited mutations (close PTR, delete assignment, create assignment, create PTR, create Substitution) with no compensation — a failure after step 2 leaves a position with no assigned player. The repo already has a working `TransactWriteItems` pattern (`accept-invitation` Lambda, IAM wired in `amplify/backend.ts:152`), so this is an inconsistency, not a platform limitation.

### Why this is not scoped for implementation in this plan
Moving substitution writes to a single transactional Lambda mutation is the highest-leverage fix of the four, but also the highest-risk and highest-cost:
- Requires a new Lambda (`execute-substitution` or similar), custom GraphQL mutation, and IAM wiring.
- The offline queue currently replays individual per-model mutations (`GameMutationInput` in `useOfflineMutations.ts`); a transactional path needs a new queue-entry shape (one atomic custom-mutation call instead of five model calls) — a real change to `offlineQueueService.ts`'s contract, not an additive one.
- Authorization currently rides on AppSync's per-model `ownersDefinedIn('coaches')` checks; a Lambda-side transact write bypasses that, so the Lambda must independently verify the caller is in the game's team `coaches` array before writing — this is exactly the class of authorization gap CLAUDE.md calls out as the most common way to accidentally break access control, and it deserves a dedicated security review, not a rider on this plan.
- Adds Lambda round-trip latency to the substitution path, which is used dozens of times per game from the sideline — needs to be measured, not assumed acceptable.

### Recommendation
Treat this as its own plan. Before writing it: (1) confirm via `docs/plans/pwa-reliability-plan.md`'s precedent that the offline-queue contract change is feasible without breaking existing queued-mutation replay for other models, and (2) get an explicit architecture-reviewer pass on the new Lambda's authorization model before any code is written. Issue A's fix (above) closes the specific, currently-observed failure mode from this gap (the halftime-orphan case); Issue D would close the general case for any future partial-failure sequence, at meaningfully higher cost.

---

## Open questions for human sign-off

1. **Issue B's gap threshold** — what counts as "anomalously large"? Needs a coach-facing product decision, not just an engineering one (proposed starting point: something well past the longest plausible in-game stoppage, e.g. 10 minutes, but this should be confirmed against real game data if available).
2. **Issue D** — confirm the team wants to invest in the transactional-Lambda path at all, versus accepting Issue A's targeted fix as sufficient for the observed failure mode and revisiting D only if a new partial-failure case surfaces.
3. **Sequencing** — confirm A → C → B → D ordering, or reprioritize if the team considers the maintainability risk in C more urgent than the UX work in B.
