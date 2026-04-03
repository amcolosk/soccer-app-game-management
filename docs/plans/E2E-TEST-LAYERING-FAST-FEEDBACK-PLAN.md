# E2E Test Layering and Fast Feedback Plan

Status: Stage 1 planning artifact (enhanced for executable Increment 1)
Date: 2026-04-03

## Objective
Reduce default developer feedback time by shifting broad UI behavior coverage from Playwright to faster Vitest integration tests, while retaining a small browser smoke lane that protects real frontend-backend/auth integration.

## Increment 1 Scope (single coding pass)
Increment 1 is intentionally limited to harness and execution-path changes plus the first migration slice (management UI behaviors). It does not include contract-test migration for data isolation/safe deletes yet.

### CI lane ownership and mapping (pinned for Increment 1)
1. `.github/workflows/ci.yml` changes are out of scope for Increment 1. Existing CI lane ownership remains unchanged:
  - `quality` job owns lint/typecheck/unit/build.
  - `smoke-e2e` job owns browser smoke lane.
  - `full-e2e` job owns full browser regression lane.
2. Increment 1 must map local scripts to CI lane semantics without ambiguity:
  - `npm run test:fast` -> local fast feedback lane (Vitest only; no browser).
  - `npm run test:e2e:smoke` -> local equivalent of CI `smoke-e2e` intent.
  - `npm run test:e2e:full` -> local equivalent of CI `full-e2e` intent.
  - `npm run gate:commit` remains the local commit gate and is not redefined.

### What Increment 1 will deliver
1. Fast-run path and smoke-run path commands in package scripts.
2. Playwright project split into smoke/full without changing backend contracts.
3. Concurrency safety guard: management smoke specs remain serial (`workers: 1`) until data partitioning/isolation is implemented in a later increment.
4. UI integration test harness additions in `src/test` for management workflows.
5. Migration of highest-volume management form/state assertions from browser tests into Vitest integration tests.
6. Reduction of corresponding Playwright files to smoke assertions only, with required retained create and destructive confirmation assertions per spec.
7. Documentation updates for the new testing workflow and runtime expectations.

### Increment 1 architecture guardrail (required)
1. Increment 1 must not modify Vitest include/exclude discovery globs or global test-boundary configuration.
2. `test:fast` must be implemented through script-level targeting/filtering only.
3. Validation for Increment 1 must include an explicit checkpoint confirming no Vitest discovery-config changes were made.

### Out of scope for Increment 1
1. GraphQL schema or Amplify model changes.
2. Contract-test suite for ownership boundaries and safe delete guards.
3. Planner/mobile direct-note migration.
4. Auth storage-state reuse and deep helper refactors beyond low-risk cleanup.

## Requirements Gaps and Assumptions

### Gaps
1. No explicit current runtime baseline is documented in repo for `npm run test:e2e` and `npm run test:run`.
2. No formal rule exists for which assertions must remain browser-only versus integration-eligible.
3. Current smoke runtime and flake baseline for management specs is not yet captured in this plan as a measured checkpoint.

### Assumptions
1. Existing Amplify-backed E2E environment remains unchanged for Increment 1.
2. `npm run gate:commit` remains the only local commit gate command.
3. Integration tests can mock Amplify client interactions via existing React testing setup without introducing new external libraries.
4. Management smoke specs must stay serial in Increment 1 because test data isolation/partitioning work is deferred.

## Layering Strategy (target state)
1. Layer A: Unit/service tests for deterministic business logic.
2. Layer B: Vitest + Testing Library integration tests for UI behavior and state transitions.
3. Layer C: Contract tests for API shape/authorization boundaries (planned in later increment).
4. Layer D: Minimal Playwright smoke tests for cross-system browser confidence.

## Increment 1 File-by-File Change List (exact)

### Plan/doc artifacts
1. `docs/plans/E2E-TEST-LAYERING-FAST-FEEDBACK-PLAN.md`
  - Update with executable increment details, metrics, and backlog.
2. `e2e/README.md`
  - Add smoke/full run model and default developer workflow.

### Command and config updates
3. `package.json`
  - Add scripts:
    - `test:fast` (Vitest run path; excludes browser).
    - `test:e2e:smoke` (Playwright smoke project).
    - `test:e2e:full` (existing comprehensive project behavior).
  - Keep `gate:commit` unchanged.
4. `playwright.config.ts`
  - Add Playwright projects/tags for smoke vs full selection.
  - Keep management smoke execution serial in Increment 1 (`workers: 1` for smoke selection) to avoid shared-data races.
  - Preserve CI retries/timeouts and safety controls.
5. `.github/workflows/ci.yml`
  - No changes in Increment 1 (explicitly out of scope; mapping-only documentation update).

### New integration harness utilities
6. `src/test/renderWithProviders.tsx` (new)
  - Shared integration harness entry point that owns provider composition and exports a single render API.
7. `src/test/mockAmplifyClient.ts` (new)
  - Shared Amplify mocking setup consumed through the same harness contract (not directly ad-hoc per test file).
8. `src/test/fixtures/managementFixtures.ts` (new)
  - Shared fixture builders for team/player/formation test data used by the single harness contract.

### Harness contract and migration rule
1. Increment 1 defines one shared integration harness API surface that combines:
   - provider rendering,
   - Amplify client mocking/setup,
   - deterministic fixture builders.
2. Management integration tests must consume only this shared harness surface.
3. Existing Management tests must be migrated to that harness or wrapped by it in Increment 1 so dual harness patterns are not left in place.

### New/updated integration tests (first migration slice)
9. `src/components/Management.integration.test.tsx` (new or split into domain files if preferred)
  - Cover migrated assertions from management CRUD/browser specs:
    - validation failures and messages,
    - create/edit mode transitions,
    - cancel/reset behavior,
    - template/custom formation selection UX,
    - delete-confirmation decision behavior at component level.
10. `src/components/Management.test.tsx`
  - Keep or trim existing tests to avoid duplicated assertions with new integration file.

### Browser smoke reductions
11. `e2e/formation-management.spec.ts`
  - Reduce to smoke-level assertions while retaining:
    - at least one create-path assertion,
    - at least one destructive delete flow with both confirm and cancel assertions.
12. `e2e/team-management.spec.ts`
  - Reduce to smoke-level assertions while retaining:
    - at least one create-path assertion,
    - at least one destructive delete flow with both confirm and cancel assertions.
13. `e2e/player-management.spec.ts`
  - Reduce to smoke-level assertions while retaining:
    - at least one create-path assertion,
    - at least one destructive delete flow with both confirm and cancel assertions.
14. `e2e/helpers.ts`
  - Optional low-risk wait cleanup only where needed by reduced smoke specs (no broad refactor in Increment 1).

## Data Model and API Impact
1. Amplify schema/data models: no changes.
2. API contracts/mutations/queries: no functional changes in Increment 1.
3. Test-only mocking surface expands in `src/test` to simulate existing API responses.

## Dependencies and Sequencing
1. Update scripts/config first (`package.json`, `playwright.config.ts`) so new commands exist before migration work.
2. Add integration harness and fixtures (`src/test/*`) second.
3. Implement migrated management integration tests third.
4. Reduce overlapping Playwright assertions fourth.
5. Update docs and verify command matrix last.

## Revised Increment 1 sequencing (ready for coding-agent)
1. Update `package.json` and `playwright.config.ts` with explicit smoke/full commands and serial-smoke safety.
2. Keep Vitest discovery include/exclude globs and global test-boundary configuration unchanged; implement `test:fast` via script-level targeting/filtering only.
3. Implement shared integration harness contract in `src/test/renderWithProviders.tsx`, `src/test/mockAmplifyClient.ts`, and `src/test/fixtures/managementFixtures.ts`.
4. Migrate management integration coverage to the shared harness, and align `src/components/Management.test.tsx` + `src/components/Management.integration.test.tsx` to avoid dual harness usage.
5. Trim management Playwright specs to smoke matrix minimums (create path + destructive confirm/cancel) in each reduced spec.
6. Update docs (`docs/plans/...`, `e2e/README.md`) to lock lane mapping and developer workflow.
7. Validate with `npm run test:fast`, `npm run test:e2e:smoke`, `npm run test:e2e:full`, then `npm run gate:commit`.

## Risks and Edge Cases for Increment 1
1. Risk: Integration tests diverge from real API behavior.
  - Mitigation: keep CRUD happy paths in Playwright smoke and align fixtures with real model fields.
2. Risk: Parallel management smoke execution causes cross-test data interference.
  - Mitigation: keep management smoke serial (`workers: 1`) until explicit data partitioning/isolation lands.
3. Risk: Duplicate assertions increase maintenance during transition.
  - Mitigation: remove or trim browser assertions in same pass as migration and enforce single shared harness usage.
4. Edge case: Modal overlays (PWA/welcome) still intercept smoke interactions.
  - Mitigation: keep existing helper closures and only reduce waits where evidence shows stability.
5. Edge case: Management integration tests rely on asynchronous subscription-like updates.
  - Mitigation: use deterministic mocked responses and `findBy*`/`waitFor` assertions.

## Increment 1 Test Strategy
1. Add integration tests for management behavior migration targets and run with `npm run test:fast`.
2. Implement `test:fast` using script-level targeting/filtering only; do not alter Vitest include/exclude discovery globs or global test-boundary config.
3. Keep a reduced smoke browser subset for management domains via `npm run test:e2e:smoke`.
4. Enforce smoke assertion matrix per reduced management spec:
  - at least one create-path assertion,
  - at least one destructive delete-confirm assertion,
  - at least one destructive delete-cancel assertion.
5. Validate no regression in full suite by running `npm run test:e2e:full` at least once before merge.
6. Add explicit validation checkpoint: verify Increment 1 did not change Vitest discovery include/exclude globs or global test-boundary config.
7. Final quality gate remains `npm run gate:commit`.

## Increment 1 Success Metrics
1. Runtime metric: `npm run test:e2e:smoke` completes at least 40% faster than current full `npm run test:e2e` baseline measured on the same machine.
2. Coverage migration metric: at least 30 assertions moved from management Playwright specs to Vitest integration tests.
3. Stability metric: management smoke specs run serially with no worker-related data race failures across 20 local reruns.
4. Harness metric: management integration tests use one shared harness contract with no remaining dual-harness pattern in Management test files.
5. Developer workflow metric: lane mapping is documented (`test:fast` -> fast local, `test:e2e:smoke` -> smoke lane intent, `test:e2e:full` -> full lane intent) with no Increment 1 changes to `.github/workflows/ci.yml`.

## Backlog After Increment 1

### Increment 2: Contract test lane
1. Add `src/services/contracts/data-isolation.contract.test.ts`.
2. Add `src/services/contracts/safe-delete.contract.test.ts`.
3. Reduce `e2e/data-isolation.spec.ts` and `e2e/safe-deletes.spec.ts` to smoke-level UX wiring only.

### Increment 3: Planner and note-flow migration
1. Migrate deterministic planner behavior from `e2e/game-planner.spec.ts` into integration tests.
2. Migrate non-viewport-dependent note modal assertions from `e2e/game-management-direct-note.mobile.spec.ts`.
3. Keep one browser path per critical planner/note user journey.

### Increment 4: Browser hardening and CI policy
1. Replace remaining fixed sleeps in `e2e/helpers.ts` with state-driven waits.
2. Add auth storage-state reuse for smoke lane.
3. Finalize CI cadence for full-browser regression (nightly + release or nightly-only).

## Validation Commands (planning target)
1. `npm run test:fast`
2. `npm run test:e2e:smoke`
3. `npm run test:e2e:full`
4. `npm run gate:commit`

## Browser-retained assertion matrix (Increment 1 minimum)
1. `e2e/formation-management.spec.ts`
  - Create path: retain one formation create assertion.
  - Destructive path: retain delete-confirm and delete-cancel assertions.
2. `e2e/team-management.spec.ts`
  - Create path: retain one team create assertion.
  - Destructive path: retain delete-confirm and delete-cancel assertions.
3. `e2e/player-management.spec.ts`
  - Create path: retain one player add/create assertion.
  - Destructive path: retain delete-confirm and delete-cancel assertions.

## Open Questions
1. Should full Playwright run in CI on every PR to `main`, or nightly/release-only after smoke passes?
2. Is there a preferred naming convention for smoke-only grep tags (`@smoke`) versus explicit file targeting for Increment 1?