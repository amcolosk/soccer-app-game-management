---
name: github-issue-triage-update
description: "Standardize GitHub defect triage communication: claim, progress, fixed-with-sha, and blocked-investigation comments plus status label transitions. Use for consistent issue history and handoff clarity."
user-invocable: false
---

# GitHub Issue Triage Update

Use this skill to keep issue updates consistent, concise, and actionable during defect triage.

## Goal

- Maintain clear issue state and ownership.
- Provide reproducible technical updates, not vague status notes.
- Enforce fixed-proof requirements before `status:fixed`.

## Label and State Rules

- On claim: add `status:in-progress`.
- On verified fix: add `status:fixed`, remove `status:in-progress`.
- On inconclusive root cause: keep `status:in-progress` and post investigation packet.
- Never close issues as an agent unless explicit project policy allows it.

## Comment Templates

### 1. Claim

Claiming this issue for investigation.

- Scope snapshot: <one line>
- Next step: create/identify reproducer test and verify fail-before-fix.

### 2. Progress (in flight)

Investigation update:

- Reproducer test: <file>::<test name> (<status>)
- Current hypothesis: <one line>
- Next action: <one line>

### 3. Fixed (only with proof)

Fixed in <sha>.

- Root cause: <one line>
- Change summary: <one to three bullets>
- Reproducer: <file>::<test name>
- Pre-fix: FAIL (<command>)
- Post-fix: PASS (<command>)
- Additional validation: <command + result>

### 4. Blocked, root cause inconclusive

Investigation could not confirm root cause yet. Keeping this issue in progress.

- What was attempted: <bullets>
- Instrumentation added: <files/flags>
- Data to collect: <commands/artifacts>
- Where to attach evidence: <issue attachments/log links>
- Next owner/action: <who does what>

## Quality Rules

- Keep updates factual and test-backed.
- Avoid ambiguous phrases like "seems fixed".
- Include commands and exact test identifiers in technical updates.
- Redact secrets and sensitive data.
