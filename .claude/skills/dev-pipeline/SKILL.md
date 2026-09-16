---
name: dev-pipeline
description: Staged multi-agent workflow for shipping a feature or larger defect fix in this repo — risk-tiered: a lean deterministic-gates-plus-single-reviewer path for standard changes, the full plan/architecture/parallel-review pipeline reserved for changes touching timer/play-time/rotation math, the data model, or auth. Use when starting non-trivial multi-file work; skip for a quick 1-2 file fix (just fix it directly, or see the defect-triage skill's small-fix path).
---

# Dev pipeline

You (the current thread) are the coordinator — there is no separate coordinator subagent in this repo. Unlike each subagent, you keep full conversation context across every stage, so pass **concrete artifacts** into every subagent prompt: full plan text, actual diffs, exact prior findings. Subagents start cold with zero shared memory beyond what you write into the prompt — a summary of a summary is how stages drift from reality.

See [docs/COORDINATOR-WORKFLOW-EVALUATION.md](../../../docs/COORDINATOR-WORKFLOW-EVALUATION.md) for why this pipeline is risk-tiered rather than uniform: applying the full multi-reviewer pipeline to every change is process weight most changes don't need, and file count alone is a poor proxy for which changes are actually risky.

## Risk tiers

Classify the change **mechanically, before choosing a stage set** — don't self-assess risk by reading the diff and guessing. Run:

```
npm run classify:risk-tier -- --base origin/main
```

This reports Tier 0/1/2 based on which files changed, not how many. Trust its Tier 2 result unconditionally — if it flags a high-risk path, treat the change as Tier 2 even if it looks small. Its Tier 0/1 split is a starting point you can upgrade (never downgrade) based on judgment: a large or architecturally unclear standard-tier change can still warrant Tier 2 treatment.

- **Tier 0 — trivial** (docs/markdown-only): skip the agent pipeline entirely. `npm run gate:commit` is the only requirement.
- **Tier 1 — standard** (most feature/bugfix work): the lean sequence below.
- **Tier 2 — high-risk**: any change touching `src/utils/gameTimeUtils.ts`, `src/utils/gameCalculations.ts`, `src/utils/playTimeCalculations.ts`, `src/services/rotationPlannerService.ts`, `amplify/data/resource.ts`, `amplify/backend.ts`, `amplify/auth/**`, or `amplify/functions/**`. Runs the full pipeline below.

## Stage sequence (Tier 2 — high-risk)

```
plan-writer -> architect-reviewer -> [ui-reviewer, if UI/UX/layout/accessibility impact]
  -> coding-agent
  -> validation-reviewer + security-reviewer + [ui-reviewer if UI-impacting]   (parallel: one message, multiple Agent calls)
  -> architect-reviewer (diff-vs-plan reconciliation, capped at 1 round)
  -> npm run gate:commit
```

1. **Plan** (`plan-writer`) — give it the request, acceptance criteria, and any constraints already known. Have it state the risk tier and why in its plan output.
2. **Architecture review** (`architect-reviewer`) — give it the full plan text. Fold required changes back into the plan yourself (or re-run `plan-writer` for large revisions) before moving on.
3. **UI review** (`ui-reviewer`), only if the change touches UI/UX/layout/accessibility/interaction — give it the plan.
4. **Implement** (`coding-agent`) — give it the finalized plan plus every review finding already resolved into it. Don't make it re-derive decisions already made.
5. **Parallel review** — spawn `validation-reviewer`, `security-reviewer`, and (if UI-impacting) `ui-reviewer` together, in the same response, as independent Agent calls. Give each the plan, the requirements, and the actual diff/file list — not a summary of what `coding-agent` claimed to do. When the change touches the timer/play-time files listed above, `validation-reviewer` owns the runtime-correctness/resilience checklist in `review-rubric` (background-tab throttling, clock drift, refresh/offline recovery, `PlayTimeRecord`/`Substitution`/`LineupAssignment` consistency) as part of its review — this is a correctness concern, not a "performance" one, so don't route it to a separate performance-only reviewer.
6. **Diff-vs-plan reconciliation** — after Stage 5 findings are resolved, re-run `architect-reviewer` once against the real final diff and the originally-approved plan, specifically checking whether `coding-agent`'s implementation-time assumptions (it's allowed to make small ones — see `coding-agent`'s charter) drifted from what architecture review actually approved. **Capped at 1 round**: if it still finds a Major/Critical architectural deviation after the one fix, stop and put the disagreement to the user rather than looping again.
7. **Required deterministic gates** — `npm run knip` and `npm run check:bundle-size` (see Tier 1 below) must also pass for Tier 2; they're not advisory here.
8. **Mandatory e2e for UI-impacting changes** — if the change is UI-impacting, run `npm run test:e2e:smoke` and it must pass before the commit gate. This is a required step, not left to `ui-reviewer`'s discretion.
9. **Commit gate** — `npm run gate:commit` once, after every Stage 5/Stage 6 Major/Critical finding is resolved.

## Stage sequence (Tier 1 — standard)

Most feature and bugfix work. Optimizes for the common case: deterministic checks catch what tooling catches reliably and cheaply, one reviewer with full-diff context catches what tooling can't.

```
[plan-writer -> architect-reviewer, if large/cross-cutting]
  -> coding-agent
  -> npm run knip && npm run check:bundle-size
  -> validation-reviewer (solo: correctness + security + UX in one pass)
  -> [npm run test:e2e:smoke, if UI-impacting]
  -> npm run gate:commit
```

1. **Implement directly**, or run `plan-writer` -> `architect-reviewer` first only if the change is large/cross-cutting enough to need one (your judgment — err toward skipping for a well-understood standard change).
2. **Deterministic gates** — `npm run knip` and `npm run check:bundle-size` must pass before the reviewer stage. These catch unused exports and bundle-size regressions more reliably and cheaply than a reviewer reading a diff; don't ask a reviewer to check for them.
3. **Single reviewer pass** — spawn `validation-reviewer` alone, but tell it explicitly to also flag obvious security issues (injection, data exposure, authz gaps) and UX regressions it notices while reviewing, not just requirement coverage. If it surfaces something security-shaped it's not confident about, escalate that one finding to `security-reviewer` rather than re-running the whole change through Tier 2.
4. **Mandatory e2e for UI-impacting changes** — same as Tier 2: `npm run test:e2e:smoke` is required, not optional, before the commit gate.
5. **Commit gate** — `npm run gate:commit` once, after every Major/Critical finding is resolved.

If a Tier 1 change turns out to be more architecturally significant than it looked (the solo reviewer flags something structural, or you realize mid-implementation it touches more than expected), escalate to the Tier 2 sequence rather than pushing through — that's what the reviewer's judgment call in step 3 is for.

## Loop caps — no stage cycles indefinitely

- **Plan ↔ architecture revision** (Tier 2): cap at 2 revision rounds. If `architect-reviewer` is still blocking after round 2, stop looping — put the disagreement to the user directly with both positions summarized.
- **Stage 5 fix → re-review** (Tier 2): cap at 3 rounds per reviewer. If a reviewer still reports a Major/Critical finding on round 3, stop, summarize the outstanding finding and what was tried, and ask the user how to proceed rather than routing back to `coding-agent` again.
- **Diff-vs-plan reconciliation** (Tier 2): cap at 1 round — see Stage 6 above.
- **Clarification questions**: bundle everything a blocked stage needs into one round. If you still don't have what's needed after one round of user answers, that's a sign the ask itself needs to change — say so instead of asking again.
- **coding-agent self-correction**: `coding-agent` already caps itself at 3 attempts per failing check. Don't override that by re-prompting it to "just try again" a 4th time — treat a 3rd failure as a blocker for you to look at directly.

Every cap exists because an isolated subagent has no sense of how many rounds have already happened — only you do. Track it explicitly (a short running note, or TodoWrite) rather than trusting a subagent to self-limit across calls it can't see. Revisit these caps and the Tier 2 high-risk path list periodically (e.g. quarterly) against how they actually played out, rather than treating them as permanent — see the review-effectiveness note described in `docs/COORDINATOR-WORKFLOW-EVALUATION.md` §6.

## Review consistency

All four reviewer subagents (`architect-reviewer`, `ui-reviewer`, `validation-reviewer`, `security-reviewer`) load the `review-rubric` skill themselves for severity definitions — you don't need to restate the rubric in your prompts to them, just tell them what changed and what to check. When running `validation-reviewer` solo (Tier 1) or on the timer/play-time resilience checklist (Tier 2), tell it explicitly which mode applies — its default charter doesn't assume either.

## Defect pipelines

- **Small** (1-2 files, no architecture change, not touching a Tier 2 path): `coding-agent -> validation-reviewer -> commit gate`. No plan or architecture stage. This is the Tier 1 lean sequence's minimal case.
- **Larger** (3+ files, or architecture/UI/security-relevant, or touching any Tier 2 path): full Tier 2 pipeline above.

## Isolation

For a `coding-agent` invocation you want cleanly reversible (large speculative refactor, or a parallel work stream alongside other edits), spawn it with `isolation: "worktree"`. Default (no isolation) is fine for most single-thread work in this repo.

## What not to do

- **Don't give any subagent the Agent/Task tool.** Orchestration stays in this thread only — a subagent that can spawn subagents is how a 6-stage pipeline turns into an unbounded tree that nobody is tracking loop counts for.
- **Don't ask `coding-agent` to review its own work.** Stage 5 (Tier 2) / the solo reviewer pass (Tier 1) is deliberately a different, fresh-context reviewer — that's what catches what the implementer's own reasoning rationalized away.
- **Don't re-run the full test suite or `npm run build` at every review round.** Targeted checks during iteration; `npm run gate:commit` once at the end.
- **Don't skip the mandatory e2e smoke run for a UI-impacting change** because a reviewer didn't happen to exercise that flow manually — it's a required step at Tier 1 and Tier 2, not reviewer discretion.
- **Don't self-assign the risk tier by reading the diff and guessing.** Run `npm run classify:risk-tier` first; its Tier 2 result is never downgraded.
