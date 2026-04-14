Status: Stage 1 Revision 2 (post-architect Major finding)

## 1) Objective

Make completed-game score snapshots concurrency-safe while preserving current active-game behavior.

Mandatory constraints implemented in this plan:
1. Single Game score writer: only GameManagement writes Game.ourScore and Game.opponentScore.
2. GoalTracker performs Goal CRUD only and never writes Game score fields.
3. Completed-state resnapshot is driven by subscribed goal state and runs on any completed-state goal change (local or remote).
4. updateGame write guard: only write when computed score differs from persisted snapshot fields.
5. Failure handling: failed resnapshot attempts remain pending and retry on next relevant state change.
6. Active-state behavior remains unchanged: in-progress/halftime score display is goal-derived; no score writes.
7. End-game transition still includes score snapshot in the same completion mutation.
8. Specs and tests updated.

## 2) Design Decisions

### 2.1 Single-writer authority
- Remove all Game score writes from GoalTracker handlers.
- Keep GoalTracker API surface focused on createGoal, updateGoal, and deleteGoal.
- Centralize score persistence in GameManagement with a dedicated reconciliation flow.

### 2.2 Goal-derived scoring source
- Define a pure score reducer in GameManagement that computes:
  - ourScore = count(goals where scoredByUs=true)
  - opponentScore = count(goals where scoredByUs=false)
- For in-progress and halftime display, UI continues reading score from computed goals (behavior already expected by prior plan).
- For completed games, Game fields remain persisted snapshot values, reconciled against goal-derived values.

### 2.3 Completed-state reconciliation strategy
- Add a completed-only effect in GameManagement that observes subscribed goals + Game snapshot fields.
- Compute desired score from goals, compare against current persisted snapshot fields, and call updateGame only on mismatch.
- Keep a pending retry flag and mismatch fingerprint to guarantee eventual convergence after transient failures.

### 2.4 Loop and storm protection
- Use deterministic dependency fingerprint for goals so effect runs only on meaningful goal changes.
- Use in-flight guard plus last-attempt fingerprint to suppress duplicate writes during bursty subscription waves.
- Rely on write guard and in-flight serialization to ensure idempotent updates.

## 3) File-by-File Change Plan

### 3.1 src/components/GameManagement/GoalTracker.tsx
- Remove Game score writes from:
  - handleRecordGoal
  - handleDeleteGoal
- Remove score callback responsibility:
  - delete onScoreUpdate prop from GoalTrackerProps and call sites.
- Keep only Goal CRUD responsibilities:
  - createGoal, updateGoal, deleteGoal
- Keep all existing modal/validation UX behavior.

Function-level approach:
- handleRecordGoal:
  - after createGoal success: close modal + analytics only.
  - no updateGame call.
- handleDeleteGoal:
  - after deleteGoal success: return without score mutation.
  - no local arithmetic decrement.

### 3.2 src/components/GameManagement/GameManagement.tsx
- Introduce centralized score utilities (inside component scope or top-level helper):
  - computeScoreFromGoals(goals)
  - buildGoalsFingerprint(goals) for effect dependency stability
- Replace sharedGoalTrackerProps to remove onScoreUpdate wiring.
- Ensure end-game mutation snapshots computed score in same mutation that sets completed status.

Function-level approach:
- handleEndGame:
  - before mutations.updateGame, compute score from current subscribed goals.
  - include ourScore/opponentScore in the same completion mutation payload.
- New completed-state reconciliation effect:
  - runs only when gameState.status === completed.
  - computes desired score from subscribed goals.
  - compares against persisted snapshot fields on gameState.
  - guarded updateGame call only when mismatch exists.

State/refs to add:
- completedScoreResyncPending: boolean state (or ref + state trigger) indicating retry needed.
- completedScoreWriteInFlightRef: boolean to serialize writes.
- lastCompletedResyncAttemptRef: string fingerprint to suppress duplicate attempts.
- lastCompletedResyncSuccessRef: string fingerprint of converged state.

### 3.3 src/components/GameManagement/GameManagement.test.tsx
- Update GoalTracker mock to capture props for assertions.
- Add tests for completed-state reconciliation behavior:
  - mismatch in completed state triggers exactly one updateGame with computed score.
  - remote goal change while completed triggers resync.
  - no write when snapshot already matches goals.
  - failed resnapshot marks pending and retries on next relevant goal-state change.
  - burst goal updates do not emit duplicate identical score writes while one is in-flight.
- Add assertion that GameManagement no longer passes onScoreUpdate to GoalTracker.
- Add end-game transition test asserting completion mutation includes score snapshot fields.

### 3.4 src/components/GameManagement/GoalTracker.test.tsx
- Remove expectations that GoalTracker calls updateGame and onScoreUpdate.
- Add/adjust tests to assert GoalTracker only calls createGoal/deleteGoal/updateGoal.
- Preserve existing CRUD, validation, and modal behavior tests.

### 3.5 docs/specs/Game-Management-Spec.md
- Add/adjust sections:
  - Score ownership: GameManagement is sole writer for Game score fields.
  - GoalTracker scope: goal CRUD only.
  - Completed-state score reconciliation: subscription-driven, guarded, eventual retry semantics.
  - End-game mutation includes score snapshot in completion write.
  - Active-state no-score-write behavior remains unchanged.

### 3.6 docs/specs/ARCHITECTURE.md (optional but recommended)
- Update responsibilities table:
  - GameManagement owns Game score persistence.
  - GoalTracker owns Goal CRUD only.

## 4) Proposed Completed-State Reconciliation Effect

Pseudo-flow (in GameManagement):
1. Derive computedScore from subscribed goals.
2. Build fingerprint from:
   - game id
   - game status
   - computedScore
   - persisted snapshot score (gameState.ourScore/opponentScore)
   - goalsFingerprint
3. Exit early when:
   - status is not completed
   - write in flight
   - no mismatch and no pending retry
   - fingerprint equals last successful converged fingerprint
4. If mismatch or pending retry:
   - set in-flight guard true
   - call mutations.updateGame(game.id, computedScore)
   - on success:
     - clear pending retry
     - store success fingerprint
   - on failure:
     - set pending retry true
     - keep mismatch unresolved for next relevant trigger
   - finally clear in-flight guard

Recommended effect dependencies:
- game.id
- gameState.status
- gameState.ourScore
- gameState.opponentScore
- goalsFingerprint
- computedOurScore
- computedOpponentScore
- mutations (stable hook output reference expected; include for correctness)

Loop-avoidance guards:
- write only on mismatch.
- in-flight guard to prevent overlapping writes.
- success fingerprint to avoid rewriting same converged snapshot.
- deterministic goals fingerprint to avoid reruns on non-score-changing object identity churn.

## 5) Write Storm Mitigation

Primary controls:
- Guarded writes only on score mismatch.
- Single in-flight write lock.
- Fingerprint dedupe of attempts and successful convergence.

Optional hardening (if observed in profiling/tests):
- micro-batch delay (50-100ms) before issuing completed-state resnapshot write.
- coalesce multiple goal subscription events into latest computed score before one write.

Expected behavior during burst events:
- Many goal events may cause many effect evaluations.
- At most one concurrent updateGame write.
- Additional evaluations become no-ops if payload unchanged or write in flight.

## 6) Failure Handling and Eventual Reconcile

Failure policy:
- If completed-state resnapshot fails, set pending retry flag.
- Retry automatically on next relevant state change trigger:
  - goal subscription update
  - game snapshot score field update
  - status re-affirmed as completed
- Do not block UI interaction in completed screen.

Observability:
- log warning with game id and expected vs persisted scores.
- optional toast suppressed unless repeated failures exceed threshold (avoid noisy UX).

## 7) Sequencing

1. Refactor GoalTracker to pure Goal CRUD.
2. Add GameManagement score helpers and remove onScoreUpdate wiring.
3. Update handleEndGame to include score snapshot in completion mutation.
4. Implement completed-state reconciliation effect with guards and pending retry.
5. Update unit/integration tests in GameManagement and GoalTracker.
6. Update specs.

## 8) Test Strategy

Unit/integration focus:
- GoalTracker:
  - create/delete/edit goal no longer calls updateGame.
- GameManagement completed reconciliation:
  - writes when completed mismatch exists.
  - no write when already matched.
  - retries after failed write when a subsequent goal change arrives.
  - remote completed-state goal change triggers mismatch write.
  - no duplicate writes under rapid goal subscription bursts.
- End-game transition:
  - completion mutation payload includes status completed + elapsedSeconds + score snapshot.

Regression coverage:
- in-progress/halftime behavior unchanged for score display and no score writes.
- existing timer/substitution/note flows unaffected.

## 9) Risks and Edge Cases

Risks:
- Subscription ordering/out-of-order events during completion transition.
- Repeated object-identity churn causing unnecessary effect runs.
- Offline queue replay ordering with completed-state writes.

Edge cases requiring explicit tests:
- Deleting goals down to zero after completion.
- Multiple remote edits to same goal sequence after completion.
- Completion triggered when local goals are stale; later remote goals arrive and must reconcile.
- Temporary updateGame failures followed by eventual success.

## 10) Scope Impact Statement

Scope impact is moderate.
- No schema, resolver, or backend contract changes.
- Behavior changes are confined to score ownership boundaries and completed-state reconciliation logic in two UI components plus tests/spec docs.
- Concurrency correctness improves significantly without broad architecture churn.
