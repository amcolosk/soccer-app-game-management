---
name: repro-test-first
description: "Create or identify a deterministic bug reproducer test before implementing a fix, capture fail-before/pass-after evidence, and select the smallest useful test layer (unit/integration/e2e). Use for defect triage and regression-proof fixes."
user-invocable: false
---

# Repro Test First

Use this skill when fixing a defect and you need proof that the bug existed before code changes and is resolved afterward.

## Goal

- Establish a deterministic reproducer test before the fix.
- Capture evidence that the test fails pre-fix and passes post-fix.
- Keep the test as long-term regression protection.

## Workflow

### 1. Select the narrowest test layer

Choose the smallest reliable layer that can reproduce the issue:

- Unit: pure logic defects in utils/services.
- Integration: multi-module behavior without full browser flow.
- E2E: UI/workflow defects that cannot be trusted at lower layers.

Default to unit or integration unless the issue is truly UI or environment dependent.

### 2. Locate candidate test files

- Search for existing tests near impacted files first.
- Prefer extending nearby tests over creating broad new suites.
- Match naming conventions already used in this repo.

### 3. Write or adapt reproducer

- Encode the reported scenario directly from issue steps.
- Keep fixture data minimal and explicit.
- Assert on user-visible behavior or stable contract output.
- Avoid assertions on incidental implementation details.

### 4. Execute pre-fix proof

- Run only the reproducer test (or the smallest targeted subset).
- Record concise fail evidence:
- Command run
- Test file and case name
- Failing assertion summary

### 5. Implement fix

- Apply the smallest safe fix.
- Do not weaken the test just to pass.

### 6. Execute post-fix proof

- Re-run the reproducer test to confirm pass.
- Run nearby targeted tests for regression surface.
- Before final handoff, run `npm run gate:commit` when workflow requires commit readiness.

## Evidence Template

Use this structure in handoffs or issue comments:

- Reproducer: <test file>::<test name>
- Pre-fix result: FAIL
- Pre-fix command: <command>
- Failure summary: <1-2 lines>
- Post-fix result: PASS
- Post-fix command: <command>
- Additional targeted tests: <command + result>
- Recurrence defense: <what now prevents repeat>
- Defense evidence: <test/guard/validation/monitoring proof>

## Quality Rules

- Deterministic: no random timing, no flaky waits without cause.
- Minimal: only the needed scenario for this defect.
- Durable: keep reproducer test in repo unless explicitly temporary.
- Honest proof: do not claim fail-before/pass-after without actual runs.
