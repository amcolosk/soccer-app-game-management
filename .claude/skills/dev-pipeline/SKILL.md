---
name: dev-pipeline
description: Staged multi-agent workflow for shipping a feature or larger defect fix in this repo — plan, architecture review, optional UI review, implementation, parallel validation/security/UI review, commit gate. Use when starting non-trivial multi-file work; skip for a quick 1-2 file fix (just fix it directly, or see the defect-triage skill's small-fix path).
---

# Dev pipeline

You (the current thread) are the coordinator — there is no separate coordinator subagent in this repo. Unlike each subagent, you keep full conversation context across every stage, so pass **concrete artifacts** into every subagent prompt: full plan text, actual diffs, exact prior findings. Subagents start cold with zero shared memory beyond what you write into the prompt — a summary of a summary is how stages drift from reality.

## Stage sequence

```
plan-writer -> architect-reviewer -> [ui-reviewer, if UI/UX/layout/accessibility impact]
  -> coding-agent
  -> validation-reviewer + security-reviewer + [ui-reviewer if UI-impacting]   (parallel: one message, multiple Agent calls)
  -> npm run gate:commit
```

1. **Plan** (`plan-writer`) — give it the request, acceptance criteria, and any constraints already known.
2. **Architecture review** (`architect-reviewer`) — give it the full plan text. Fold required changes back into the plan yourself (or re-run `plan-writer` for large revisions) before moving on.
3. **UI review** (`ui-reviewer`), only if the change touches UI/UX/layout/accessibility/interaction — give it the plan.
4. **Implement** (`coding-agent`) — give it the finalized plan plus every review finding already resolved into it. Don't make it re-derive decisions already made.
5. **Parallel review** — spawn `validation-reviewer`, `security-reviewer`, and (if UI-impacting) `ui-reviewer` together, in the same response, as independent Agent calls. Give each the plan, the requirements, and the actual diff/file list — not a summary of what `coding-agent` claimed to do.
6. **Commit gate** — `npm run gate:commit` once, after every Stage 5 Major/Critical finding is resolved.

## Loop caps — no stage cycles indefinitely

- **Plan ↔ architecture revision**: cap at 2 revision rounds. If `architect-reviewer` is still blocking after round 2, stop looping — put the disagreement to the user directly with both positions summarized.
- **Stage 5 fix → re-review**: cap at 3 rounds per reviewer. If a reviewer still reports a Major/Critical finding on round 3, stop, summarize the outstanding finding and what was tried, and ask the user how to proceed rather than routing back to `coding-agent` again.
- **Clarification questions**: bundle everything a blocked stage needs into one round. If you still don't have what's needed after one round of user answers, that's a sign the ask itself needs to change — say so instead of asking again.
- **coding-agent self-correction**: `coding-agent` already caps itself at 3 attempts per failing check. Don't override that by re-prompting it to "just try again" a 4th time — treat a 3rd failure as a blocker for you to look at directly.

Every cap exists because an isolated subagent has no sense of how many rounds have already happened — only you do. Track it explicitly (a short running note, or TodoWrite) rather than trusting a subagent to self-limit across calls it can't see.

## Review consistency

All four reviewer subagents (`architect-reviewer`, `ui-reviewer`, `validation-reviewer`, `security-reviewer`) load the `review-rubric` skill themselves for severity definitions — you don't need to restate the rubric in your prompts to them, just tell them what changed and what to check.

## Defect pipelines

- **Small** (1-2 files, no architecture change): `coding-agent -> validation-reviewer -> commit gate`. No plan or architecture stage.
- **Larger** (3+ files, or architecture/UI/security-relevant): full pipeline above.

## Isolation

For a `coding-agent` invocation you want cleanly reversible (large speculative refactor, or a parallel work stream alongside other edits), spawn it with `isolation: "worktree"`. Default (no isolation) is fine for most single-thread work in this repo.

## What not to do

- **Don't give any subagent the Agent/Task tool.** Orchestration stays in this thread only — a subagent that can spawn subagents is how a 6-stage pipeline turns into an unbounded tree that nobody is tracking loop counts for.
- **Don't ask `coding-agent` to review its own work.** Stage 5 is deliberately a different, fresh-context reviewer per concern — that's what catches what the implementer's own reasoning rationalized away.
- **Don't re-run the full test suite or `npm run build` at every review round.** Targeted checks during iteration; `npm run gate:commit` once at the end.
