# Rotation Planner Defect-Fix Plan Revision

## Objective
Revise the rotation-planner defect-fix plan so implementation follows the architect-reviewed ownership boundaries, preserves the canonical halftime sentinel contract, and closes Issues #6, #83, #115, and #119 with the right tests in the right layers.

## Architect Constraints Incorporated
- `src/utils/halftimeProjectionUtils.ts` remains canonical for halftime planner identity: the sentinel stays `half: 2`, `gameMinute: 0`, `rotationNumber: 0`, key `H2:M00:HT`.
- Issue #119 must be fixed through a projection-only normalization path before `calculatePlayTime`, likely in `src/components/GameManagement/PlanTab.tsx` or a new projection-specific helper. No global identity or canonical-key changes are allowed.
- `validateRotationPlan` in `src/services/rotationPlannerService.ts` remains a static plan-shape validator. Live stale/conflict ownership stays in `GameManagement.tsx` plus `src/utils/rotationConflictUtils.ts`.
- The plan now includes an explicit issue-to-layer ownership matrix so implementation and validation know exactly where each rule and regression belongs.
- Issue #115 requires an invariant-based applied-lineup regression harness that simulates each generated interval and checks exact field count, unique occupancy, and no non-halftime goalie substitution across scheduled and live recalculation scenarios.
- Rule 4.4 coverage must validate the first regenerated live rotation through the same UI conflict path used in production, not through a duplicated raw-membership-only assertion.

## Requirements Gaps And Assumptions
- Assumption: the planner halftime sentinel is a persistence and identity artifact only; projected playtime may use a normalized view model as long as persisted planner rows and canonical keys remain unchanged.
- Assumption: Issue #119 is confined to projected planner minutes in `PlanTab` and does not affect actual game-clock play-time calculations in `src/utils/playTimeCalculations.ts`.
- Assumption: Rule 4 live-generation behavior is already orchestrated from `GameManagement.tsx`, so any new service tests for Section 4 should stay limited to pure generation invariants and not attempt to own stale detection.
- Gap: the current plan did not define where Rule 4.4 passes or fails are asserted. This revision assigns that requirement to the live UI conflict path in `GameManagement`.
- Gap: the current plan did not require post-generation lineup simulation. This revision makes applied-lineup invariants mandatory for Issue #115 and goalie-lock regressions.

## Issue-To-Layer Ownership Matrix

| Issue / Rule | Owning layer | Why it belongs there | Required test surface |
| --- | --- | --- | --- |
| Issue #119 projected playtime distortion | `PlanTab` projection path plus optional projection helper | The bug is caused by feeding planner projection data into `calculatePlayTime`; persisted halftime identity must stay canonical | `src/components/GameManagement/PlanTab.test.tsx` integration regression, plus focused `calculatePlayTime` unit coverage in `src/services/rotationPlannerService.test.ts` for normalized input |
| Halftime sentinel identity | `src/utils/halftimeProjectionUtils.ts` and `src/utils/plannerKeyUtils.ts` | This is canonical planner identity and must not change to solve a projection bug | No behavior change; add or retain sentinel-contract assertions only if needed |
| Issue #6 large-bench minimum playtime and fairness | `src/services/rotationPlannerService.ts` | Pure rotation-generation logic and fairness rules live in the planner service | `src/services/rotationPlannerService.test.ts` |
| Issue #115 duplicate occupancy / goalie changes during generated rotations | `src/services/rotationPlannerService.ts` for generation plus applied-lineup harness in tests | The generator owns the produced schedule; correctness must be proven by simulating the resulting lineup state after each interval | `src/services/rotationPlannerService.test.ts` applied-lineup invariant harness |
| Issue #83 live recalculation respecting GK and hard constraints | `GameManagement.tsx` orchestration into `calculateFairRotations` | Live inputs, current-game history seeding, and persistence path are orchestrated in GameManagement | `src/components/GameManagement/GameManagement.test.tsx` |
| Rule 4.1 live lineup baseline | `GameManagement.tsx` | The live `LineupAssignment` state is assembled there before calling the planner | `src/components/GameManagement/GameManagement.test.tsx` |
| Rule 4.2 current-game playtime seeding | `GameManagement.tsx` | `PlayTimeRecord` accumulation is gathered there before calling the planner | `src/components/GameManagement/GameManagement.test.tsx` |
| Rule 4.3 future-only generation | `GameManagement.tsx` | Current clock and rotation window filtering are orchestration concerns | `src/components/GameManagement/GameManagement.test.tsx` |
| Rule 4.4 immediate compatibility with live field state | `GameManagement.tsx` plus `src/utils/rotationConflictUtils.ts` | The production stale/conflict path already exists there and must remain the source of truth | `src/components/GameManagement/GameManagement.test.tsx` through the same conflict path used by UI |
| Rule 4.5 hard constraints before fairness in live mode | `GameManagement.tsx` calling `calculateFairRotations` | Live recalculation must prove orchestration preserves hard constraints while still using service output | `src/components/GameManagement/GameManagement.test.tsx` |
| Static plan-shape validation | `src/services/rotationPlannerService.ts` `validateRotationPlan` | This remains a structural validator, not a live stale detector | `src/services/rotationPlannerService.test.ts` only for static-plan cases |

## Root Cause Summary

### Issue #119
- `projectHalftimeRotation` intentionally emits a canonical halftime sentinel with `gameMinute: 0`.
- `PlanTab` currently appends that sentinel directly into the projected-playtime input list.
- `calculatePlayTime` uses `gameMinute` deltas to accumulate minutes, so a canonical sentinel minute of `0` corrupts second-half interval math when treated as a real elapsed minute.

### Issue #115
- Existing large-format regressions primarily assert substitution tuples, not the applied lineup state after each generated interval.
- That misses the higher-value invariants that expose actual user-facing failure: duplicate occupancy, wrong field count, and goalie substitutions outside halftime.

### Issues #83 and Rule 4.x live behavior
- The live path already owns stale detection and effective-execution nuance in `GameManagement.tsx` with `rotationConflictUtils`.
- Regressions here are more likely to come from orchestration inputs and validation path mismatch than from redefining service-layer validation.

## Implementation Strategy

### 1. Preserve canonical halftime identity and introduce projection-only normalization
- Do not change `projectHalftimeRotation` or canonical planner keys.
- Add a projection-only normalization step before `calculatePlayTime` so synthetic halftime rows are interpreted at the actual halftime minute for projection math while retaining sentinel identity for persistence and planner selection.
- Keep the normalization local to `PlanTab` or extract a new projection-specific helper used only by `PlanTab`.
- Ensure empty synthetic halftime rows are still omitted from projected-playtime calculations.

### 2. Strengthen service tests around generated schedule invariants
- Keep Issue #6 and other fairness tests in `src/services/rotationPlannerService.test.ts`.
- Add a reusable test harness that starts from the initial lineup, applies each generated interval in order, and asserts after every step:
  - field occupancy count equals `maxPlayersOnField`
  - each field player is unique
  - no non-halftime substitution targets the goalkeeper position
- Run that harness for the 9v9 and 11v11 regressions implicated by Issue #115, including halftime transitions.
- Add focused `calculatePlayTime` unit tests covering normalized halftime input and same-rotation position changes, but keep those tests scoped to projection math rather than UI orchestration.

### 3. Keep live stale/conflict behavior in GameManagement
- Do not extend `validateRotationPlan` to accept live lineup state or conflict ownership.
- Add or refine `GameManagement` tests that prove:
  - live lineup overrides the saved pre-game baseline for recalculation
  - current-game `PlayTimeRecord` rows are the only source for seeded committed minutes
  - only future rotations are regenerated
  - the first regenerated rotation passes through the same `getPlanConflicts` path used by the UI and does not produce the Rule 4.4 live conflicts the UI flags
  - hard constraints, especially goalkeeper restrictions, win over fairness during live recalculation

## File-By-File Change List

### `docs/plans/ROTATION-PLANNER-TEST-COVERAGE-PLAN.md`
- Replace the earlier plan with this architect-aligned revision.
- Document ownership boundaries, sequencing, and mandatory invariant-based regression coverage.

### `docs/specs/Rotation-Algorithm-Requirements.md`
- No spec rewrite planned.
- Use as the validation source of truth for Rule 1.1, 1.2, 1.4, 1.5, 3.3, 3.4, and 4.1 through 4.5 during implementation and review.

### `src/utils/halftimeProjectionUtils.ts`
- No contract change planned.
- Preserve `gameMinute: 0` and sentinel identity.
- Optionally add documentation or narrow tests if implementation needs to make the projection-only boundary explicit.

### `src/utils/plannerKeyUtils.ts`
- No behavior change planned.
- Preserve `H2:M00:HT` as the canonical halftime sentinel key.

### `src/components/GameManagement/PlanTab.tsx`
- Add a projection-only normalization path before `calculatePlayTime`.
- Keep synthetic halftime insertion for projection purposes, but ensure the row fed into playtime math carries the effective halftime elapsed minute without mutating planner identity.
- Keep the existing merge of end-of-first-half lineup with explicit halftime overrides.

### `src/services/rotationPlannerService.ts`
- Keep `validateRotationPlan` scoped to static structural checks.
- Only update `calculatePlayTime` if needed to support normalized projection inputs or strengthen same-rotation position-change accounting.
- Do not add live stale/conflict detection here.

### `src/services/rotationPlannerService.test.ts`
- Retain the valid large-bench fairness regressions.
- Remove or rename mislabeled Section 4 tests that imply live-orchestration ownership.
- Add the invariant-based applied-lineup regression harness for Issue #115.
- Add focused projection-math tests for normalized halftime input.

### `src/components/GameManagement/PlanTab.test.tsx`
- Add an integration regression for Issue #119 proving projected minutes remain correct when the synthetic halftime row is present.
- Cover both the baseline split-goalie case and the changed-second-half-goalie case described in the defect.
- Assert rendered projected minutes, not just raw helper output, so the UI seam is protected.

### `src/components/GameManagement/GameManagement.tsx`
- No ownership expansion into `validateRotationPlan`.
- Implementation work should stay in the live recalculation and conflict-check path already present here.

### `src/components/GameManagement/GameManagement.test.tsx`
- Add or refine live recalculation tests for Rules 4.1 through 4.5 with emphasis on Rule 4.4 using the existing conflict path.
- Add a test that the first regenerated rotation is run through `getPlanConflicts` semantics and does not yield `on-field` or stale-flow conflicts.
- Include halftime and live recalculation scenarios in coverage for Issue #115 where relevant.

### `src/utils/rotationConflictUtils.ts`
- No ownership change planned.
- Use the existing utility as part of live conflict-path validation rather than duplicating logic elsewhere.

### `RotationPlannerDefects.txt`
- No source change planned.
- Use it as the implementation checklist for issue reproduction and expected outcomes.

## Data Model / API Impacts
- No Amplify schema changes.
- No GraphQL contract changes.
- No changes to persisted `PlannedRotation` identity, `GamePlan` structure, or canonical planner keys.
- Any new helper introduced for Issue #119 must be projection-only and non-persistent.

## Risks, Edge Cases, And Sequencing

### Risks and edge cases
- Highest risk: accidentally “fixing” Issue #119 by mutating persisted halftime identity, which would create planner-key and deduplication regressions outside the projection bug.
- Service tests can still miss Issue #115 if they only assert substitution tuples rather than simulating field state after each interval.
- Rule 4.4 can be falsely validated if tests only inspect the first generated substitutions directly instead of routing them through the same conflict path the UI uses.
- Halftime-specific regressions need cases with both explicit halftime overrides and inherited end-of-H1 positions.
- Same-rotation position changes remain a special case for `calculatePlayTime`; projection normalization must not regress that behavior.

### Required sequencing
1. Revise the test inventory so each regression sits in its owning layer.
2. Add the Issue #119 `PlanTab` integration regression before changing projection behavior.
3. Add the service-level applied-lineup invariant harness for Issue #115 before adjusting generator behavior.
4. Add or refine `GameManagement` Rule 4.4 coverage through the existing UI conflict path.
5. Implement the projection-only normalization and any minimal service fixes exposed by the focused tests.
6. Re-run the focused suites for `rotationPlannerService`, `PlanTab`, and `GameManagement`.
7. Run `npm run gate:commit` after the focused suites pass.

## Test Strategy

### Service tests: `src/services/rotationPlannerService.test.ts`
- Keep Issue #6 fairness and large-bench coverage.
- Add an invariant-based applied-lineup harness for Issue #115 across 9v9 and 11v11 fixtures.
- Add focused `calculatePlayTime` unit tests for normalized halftime projection input and same-rotation position changes.
- Keep `validateRotationPlan` tests limited to static shape validation.

### PlanTab tests: `src/components/GameManagement/PlanTab.test.tsx`
- Reproduce Issue #119 at the rendered projected-playtime level.
- Verify the baseline split-goalie schedule and the second-half goalie change produce the expected minute totals.
- Verify synthetic halftime rows with no actual halftime changes remain excluded from playtime projection.

### GameManagement tests: `src/components/GameManagement/GameManagement.test.tsx`
- Verify Rule 4.1 live lineup baseline override.
- Verify Rule 4.2 current-game-only playtime seeding.
- Verify Rule 4.3 future-only generation.
- Verify Rule 4.4 by sending the first regenerated live rotation through the existing conflict-detection path and asserting no immediate conflict is surfaced.
- Verify Rule 4.5 by proving a single eligible goalkeeper remains locked despite fairness pressure.

### Final validation
- Focused test runs for the touched suites first.
- `npm run gate:commit` only after those suites pass.
