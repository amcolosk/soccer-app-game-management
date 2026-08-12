## Plan: Explicit Formation Position Roles

Introduce explicit role typing for each formation position to eliminate substitution and layout errors caused by inferring role from coach-entered names/abbreviations.

## Objective

Ensure substitution and planner behavior uses a stable, explicit role value per formation position.

## Scope

In scope:
- Add a persisted role field for formation positions.
- Require role assignment in formation editor before formation can be used in planner.
- Enforce goalkeeper substitution constraints as hard rules.
- Keep defender/midfielder/forward role use as soft recommendation for sorting/suggestions.
- Replace label/abbreviation-based role inference in planner and lineup shape logic.

Out of scope:
- New role taxonomies beyond four approved roles.
- Team-specific custom role definitions.
- Broader redesign of substitution UX unrelated to role correctness.

## Decisions Locked

- Roles: Goalkeeper, Defender, Midfielder, Forward.
- Enforcement: hard rule for Goalkeeper only; soft guidance for other roles.
- Editing surface: formation editor only.
- Persistence: backend additive optional field is allowed, on `FormationPosition` only (`FieldPosition` is a legacy, unused-for-write model with no editor surface and no runtime consumption path — out of scope).
- Legacy behavior: planner cannot run until all positions have assigned roles.
- Rollout: no backfill script or migration utility. Enforcement goes live immediately on deploy; small user base will manually complete role assignment on existing formations via the formation editor.

## Implementation Plan

**Phase 1: Data Model and Contract**
1. Add optional enum role field on the FormationPosition model only in Amplify schema. (FieldPosition is a legacy, write-path-unused model with no editor and no runtime consumption — excluded from scope.)
2. Regenerate/update frontend schema types and role-aware type aliases.
3. Ensure formation query/mutation selections include role wherever positions are loaded/saved.

Dependency notes:
- Step 2 and Step 3 depend on Step 1.

**Phase 2: Formation Editor Role Assignment**
4. Add required Role selector to each position row/card in formation create/edit UI.
5. Add validation: save/update blocked if any position is missing role.
6. Add clear inline plus form-level error messaging to guide coaches to complete role assignment.

Dependency notes:
- Phase 3 planner gating depends on this phase.

**Phase 3: Runtime Behavior Changes**
7. Update substitution logic to consume explicit role values instead of parsing labels/abbreviations.
8. Apply mixed enforcement:
   - Goalkeeper positions can only match goalkeeper-eligible substitution flow.
   - Defender/Midfielder/Forward affect recommendation/sorting only.
9. Update planner load flow to compute role completeness and block planner entry when incomplete, with link/path back to formation editor.

Parallelism notes:
- Step 7 and Step 9 can proceed in parallel after Phase 2 contracts are available.

**Phase 4: Shape/Determinism Cleanup**
10. Replace lane inference by text parsing with direct role-to-lane mapping in lineup shape determinism logic.
11. Retain temporary fallback guards only where unavoidable during rollout, but do not allow planner progression with missing role.

**Phase 5: Test and Validation**
12. Update unit tests for substitution rules and role-aware decision paths.
13. Update component tests for formation editor required-role validation and planner block messaging.
14. Update determinism tests to verify explicit role controls lane grouping.
15. Update e2e workflow tests for:
   - Custom position names with correct role behavior.
   - Planner blocked when any position role is missing.
   - Planner unblocked once role assignment is complete.
16. Run final commit gate command.

## Relevant Files

- c:/Users/amcol/Documents/GitHub/soccer-app-game-management/amplify/data/resource.ts
- c:/Users/amcol/Documents/GitHub/soccer-app-game-management/src/types/schema.ts
- c:/Users/amcol/Documents/GitHub/soccer-app-game-management/src/components/FormationVisualEditor.tsx
- c:/Users/amcol/Documents/GitHub/soccer-app-game-management/src/utils/formationUtils.ts
- c:/Users/amcol/Documents/GitHub/soccer-app-game-management/src/components/GameManagement/PlanTab.tsx
- c:/Users/amcol/Documents/GitHub/soccer-app-game-management/src/components/GameManagement/SubstitutionPanel.tsx
- c:/Users/amcol/Documents/GitHub/soccer-app-game-management/src/services/rotationPlannerService.ts
- c:/Users/amcol/Documents/GitHub/soccer-app-game-management/src/components/GameManagement/shape/lineupShapeDeterminism.ts
- c:/Users/amcol/Documents/GitHub/soccer-app-game-management/src/components/GameManagement/PlanTab.test.tsx
- c:/Users/amcol/Documents/GitHub/soccer-app-game-management/src/components/GameManagement/SubstitutionPanel.test.tsx
- c:/Users/amcol/Documents/GitHub/soccer-app-game-management/src/components/GameManagement/shape/lineupShapeDeterminism.test.ts
- c:/Users/amcol/Documents/GitHub/soccer-app-game-management/e2e/formation-management.spec.ts
- c:/Users/amcol/Documents/GitHub/soccer-app-game-management/e2e/full-workflow.spec.ts

## Verification

1. Targeted unit/component test run for edited planner, substitution, and formation editor modules.
2. Determinism/shape tests confirm role-driven lane outcomes.
3. E2E verification for missing-role block and successful post-assignment flow.
4. Manual smoke check with coach-custom labels to confirm no name-based role leakage.
5. Final gate: npm run gate:commit.

## Risks and Mitigations

- Risk: Existing formations without role become unusable in planner immediately upon deploy (no backfill; accepted trade-off given small user base).
  - Mitigation: clear blocking message and direct edit path from planner to formation editor so coaches can complete role assignment on demand.
- Risk: Hidden inference paths remain and create mixed behavior.
  - Mitigation: grep-driven sweep for label/abbreviation role parsing and dedicated regression tests.
- Risk: UX friction during initial adoption.
  - Mitigation: sensible defaults in editor UI if available, but explicit confirmation required.

## Acceptance Criteria

1. No substitution path uses position name/abbreviation to determine goalkeeper behavior.
2. Goalkeeper substitution constraints are consistently enforced in planner runtime.
3. Formations missing any role cannot proceed in planner and show actionable guidance.
4. Formation editor requires role assignment for all positions before save.
5. Regression suite includes custom-label scenarios proving behavior no longer depends on text naming.
