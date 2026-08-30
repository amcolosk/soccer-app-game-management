---
name: defect-triage
description: Work a GitHub issue in this repo end-to-end — reproduce with a failing test, fix, prove with before/after test results, comment and update labels via gh CLI. Use when asked to fix, triage, or investigate a numbered GitHub issue, or to list/prioritize open issues. Never closes issues.
argument-hint: an issue number to work, or "list" to triage open issues by severity
---

# Defect triage

Mirrors this repo's GitHub Copilot `/fix-issue`, `/list-issues`, `/triage-issues` prompts, collapsed for Claude Code: you already have the Agent tool and full conversation context, so there's no separate "coordinator" hop to make first — run the scope-appropriate `dev-pipeline` stage sequence directly.

## `list` — enumerate and prioritize

- `gh issue list --state open --json number,title,labels,createdAt`
- Sort by severity label if present, otherwise by age and apparent user impact from the title/body. Report the sorted list back; don't start fixing anything yet.

## `<N>` — work one issue

### 1. Claim

- `gh issue view <N> --json title,body,comments,labels`
- Confirm it isn't already claimed/in-progress by someone else.
- `gh issue edit <N> --add-label status:in-progress`
- `gh issue comment <N> --body "..."` — short claim note (what you understand the bug to be, what you're about to do).

### 2. Reproduce first

Before touching a fix, write or identify a deterministic test (unit if the bug is in pure logic, e2e if it's a flow/integration bug) that fails for the reason described in the issue. Capture the failing output — this is your before-evidence. "I understand the bug" is not proof; a red test is.

### 3. Fix

- Scope check: 1-2 files, no architecture change → `coding-agent -> validation-reviewer -> commit gate` directly. 3+ files, or architecture/security/UI-relevant → load the `dev-pipeline` skill and run the full stage sequence.
- Confirm: the reproducer test now passes, the broader relevant suite passes, and `npm run gate:commit` is green.

### 4. Root cause unclear fallback

If root cause isn't pinned down after a reasonable investigation, don't guess-fix. Add scoped, safe debug instrumentation (no secrets, nothing noisy left in a production code path), keep `status:in-progress`, and post an investigation-packet comment: hypotheses tried and why each was inconclusive, exact repro commands, what to collect next, and current containment/workaround if any.

### 5. Close out

- **Never close the issue yourself** — that's developer sign-off only.
- If fixed: comment with root cause summary, what changed, why recurrence risk is reduced (tests/guards added), the reproducer test path, before/after test result, and the commit SHA. Swap `status:in-progress` for `status:fixed`.
- Keep every comment factual and specific — claim, progress, outcome, next step. No secrets/tokens in any comment.

## Loop discipline

- One claim comment, one outcome comment, plus at most one interim progress comment for a long investigation. Don't comment on every intermediate step — that's noise on the issue thread.
- If reproduction itself is fighting you past a reasonable number of attempts, that's the signal to fall back to the root-cause-unclear path (step 4) rather than continuing to try approaches indefinitely.
