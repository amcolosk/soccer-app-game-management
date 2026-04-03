# Issue #65 Plan Revision: Onboarding Checklist Reopen Rule

Status: Revised for architecture-required semantics
Date: 2026-04-02
Issue: #65 (amcolosk/soccer-app-game-management)

## Goal
Align checklist reopen behavior to the canonical regression rule while keeping implementation changes minimal and localized.

## Canonical Rule (Required)
Checklist reopens only when all conditions are true:
1. Checklist is currently dismissed.
2. Profile completion state is resolved.
3. A valid snapshot exists in localStorage (`onboarding:lastCompletedSteps`).
4. At least one step that was previously complete (`true`) is now incomplete (`false`).

Implications:
- Missing snapshot: no reopen.
- Malformed snapshot: no reopen.

## Current Gap
`Home.tsx` currently falls back to reopening when snapshot is missing and checklist is not fully complete. This violates the canonical rule.

## Proposed Changes (Minimal)
### 1) Reopen logic
File: `src/components/Home.tsx`
- Keep existing guards for `dismissed` and profile resolution.
- Read snapshot via existing `readDismissedStepSnapshot`.
- If snapshot is `null` (missing or malformed), return without reopening.
- Compute regression only against a valid snapshot (`some(wasComplete && !isNowComplete)`).
- Preserve existing side effect when reopening: call `clearDismissed()` and remove `onboarding:lastCompletedSteps`.

### 2) Test updates
File: `src/components/Home.test.tsx`
- Ensure the following behavioral cases are covered:
  1. dismissed + no snapshot + incomplete checklist => `clearDismissed` NOT called.
  2. dismissed + valid snapshot + regression => `clearDismissed` called; snapshot removed afterward.
  3. dismissed + valid snapshot + no regression => `clearDismissed` NOT called.
  4. dismissed + malformed snapshot => `clearDismissed` NOT called.
- Keep existing profile-resolution guard coverage.
- Keep tests deterministic by controlling profile fetch resolution and localStorage setup per test.

### 3) Spec reconciliation
Files:
- `docs/specs/ONBOARDING-SPEC.md`
- `docs/specs/UI-SPEC.md`
- `docs/specs/USER-PROFILE-SPEC.md`

Update all three docs to consistently reflect:
- Seven-step checklist model.
- Reopen semantics based on valid regression snapshot only.
- Active keys and compatibility keys exactly as implemented:
  - Welcome active key: `welcomeModalDismissed`
  - Welcome compatibility key: `onboarding:welcomed`
  - Dismissed active key: `quickStartChecklistDismissed`
  - Dismissed compatibility key: `onboarding:dismissed`
  - Collapsed key: `onboarding:collapsed`
  - Regression snapshot key: `onboarding:lastCompletedSteps`

## No Data Model / API Impact
- No Amplify schema changes.
- No GraphQL API contract changes.
- No backend/Lambda changes.

## Dependencies and Sequencing
1. Update `Home.tsx` reopen effect (single, minimal logic change).
2. Update `Home.test.tsx` to enforce all required scenarios.
3. Reconcile spec docs for 7-step model and key semantics.
4. Run commit gate once: `npm run gate:commit`.

## Risks and Edge Cases
- False reopen if fallback-to-incomplete logic remains anywhere else.
- Test fragility if async profile resolution is not controlled in mocked `CoachProfile.get`.
- Documentation drift if one of the three specs keeps legacy-only key names without active/compatibility distinction.

## Test Strategy
Primary:
- Targeted unit/component tests in `src/components/Home.test.tsx` for the four required reopen cases.

Verification:
- Ensure regression case removes `onboarding:lastCompletedSteps` after reopen.
- Ensure missing/malformed snapshot cases do not clear dismissed state.

Integration safety:
- Run full local commit gate: `npm run gate:commit`.

## Out of Scope
- Refactoring onboarding state architecture.
- Changing localStorage key names or migration behavior.
- Altering checklist step definitions beyond documentation consistency.
