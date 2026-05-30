---
name: review-findings-rubric
description: "Standardize reviewer severity judgments and evidence quality for architecture, validation, security, and UI findings."
user-invocable: false
---

# Review Findings Rubric

Use this skill when producing or evaluating review findings.

## Goal

- Normalize severity decisions across review agents.
- Improve signal quality in findings and reduce subjective variance.

## Severity Levels

- Critical: Exploitable security flaw, data loss/corruption risk, or release-blocking failure with immediate user/system impact.
- Major: Requirement-breaking behavior, high-likelihood regression, or significant security/control gap that must be fixed before progression.
- Minor: Valid quality concern with limited impact or acceptable workaround.
- Informational: Improvement suggestion or observation with no immediate correctness or safety risk.

## Blocking Rule

- Return `Status: needs-revision` when any finding is Critical or Major.
- Minor and Informational findings do not block progression.

## Minimum Finding Structure

For each finding, include:

- Severity
- Affected files or surface area
- Concrete rationale tied to requirement/plan/security/UI expectation
- Verification path (test/check/manual step)
- Required remediation when blocking

## Evidence Expectations

- Cite exact commands/checks executed when applicable.
- Distinguish observed behavior vs inferred risk.
- Include requirement/plan mapping in pass/fail summary.
- If evidence is incomplete, state uncertainty explicitly.

## Reviewer Checklist

- Confirm requirement coverage first.
- Check regression risk around changed boundaries.
- Verify tests are targeted and adequate.
- Record residual risks even when status is success.
