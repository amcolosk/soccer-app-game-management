# Coordinator / Dev-Pipeline Workflow Evaluation

**Date:** 2026-09-16
**Implementation status:** Steps 1–7 of the §6 plan are implemented on this branch (risk-tier classification, deterministic gates, the Tier 1 lean sequence, the Tier 2 timer/play-time resilience checklist, diff-vs-plan reconciliation, mandatory e2e for UI-impacting changes, and the non-required pipeline-drift CI check). Step 8 (a lightweight review-effectiveness log) and step 9 (this sequencing note itself) are process habits to adopt going forward rather than one-time file changes — see the updated pipeline docs for where they're referenced.
**Scope:** The staged multi-agent development workflow described in `CLAUDE.md` §"Development workflow (agent pipeline)" — the Claude Code native version (`.claude/agents/`, `.claude/skills/dev-pipeline/`, `.claude/skills/review-rubric/`) and its mirrored GitHub Copilot version (`.github/agents/`, `.github/copilot-instructions.md`).
**Method:** Direct review of the pipeline definitions, a critical evaluation against the goal of "high quality, tested, performant" code, five alternative workflow designs, and independent stress-testing ("rubber duck") of that evaluation and those alternatives by three separate models (Opus 5, Haiku 4.5, and a second independent Sonnet 5 pass — Fable 5.1 was requested but unavailable due to account usage-credit limits, so a second Sonnet 5 instance stood in as the third reviewer).

## 1. Current workflow, as built

```
plan -> architecture review -> [UI review if UI-impacting] -> implement
  -> parallel(validation review + security review + [UI review if UI-impacting])
  -> commit gate (npm run gate:commit: lint -> unit tests -> build)
```

- Every stage is a fresh-context subagent with a narrow, non-overlapping charter (planner never codes, reviewers never fix, the implementer never reviews its own work).
- A shared severity rubric (`review-rubric` skill / equivalent Copilot contract) makes Critical/Major always block and Minor/Informational non-blocking, consistently across all four reviewer roles.
- Loop caps bound the pipeline: max 2 plan↔architecture revision rounds, max 3 fix→re-review rounds per reviewer, one bundled round of clarifying questions.
- A fast path (1–2 files, no architecture change) skips straight to implement → validation review → commit gate.
- No subagent can itself spawn subagents, so the orchestration tree stays bounded and auditable by the one thread holding full context.
- `npm run gate:commit` (lint → unit tests via Vitest → build) is the single authoritative gate, run once at the end — not re-run every review round.
- The same design exists twice: once hand-written for Claude Code, once hand-written for GitHub Copilot, intended to mirror each other stage-for-stage.

This is a genuinely solid design for what it optimizes: consistent severity judgment, fresh eyes on every change, and bounded LLM-orchestration cost. The gaps below are about what it *doesn't* cover, not flaws in what it does.

## 2. Critical evaluation

1. **No reviewer is chartered for runtime correctness/resilience of the timer and play-time subsystem.** `GameManagement.tsx`'s live game screen and `gameTimeUtils.ts`/`gameCalculations.ts`/`playTimeCalculations.ts`/`rotationPlannerService.ts` are this app's highest-consequence code — a coach relies on it live, on the sideline, for an entire half. None of the four reviewer charters (architecture, validation, security, UI) explicitly covers background-tab timer throttling, drift between the synced clock and `elapsedSeconds`, state recovery after a refresh/backgrounding/offline gap, or `PlayTimeRecord` consistency with `Substitution`/`LineupAssignment` writes under those conditions. This is more precisely a **correctness/resilience** gap than a classic "performance" gap (dropped frames, bundle size) — the failure mode that actually matters here is silently wrong or lost play-time data, not jank.
2. **The test bar is inconsistently enforced.** `gate:commit` runs unit tests only; the Playwright e2e suite is never a required step, even for UI-impacting changes — it depends entirely on whether `ui-reviewer` happens to exercise the affected flow in its manual browser pass.
3. **No post-implementation reconciliation against the approved architecture.** `coding-agent`'s own charter explicitly permits it to make small deviating assumptions mid-implementation ("make the smallest reasonable assumption... state it explicitly"). Nothing re-checks the actual diff against what `architect-reviewer` approved — Stage 5 reviews correctness, security, and UI, but not architectural fit of the real code.
4. **Quantitative properties are left to LLM judgment instead of deterministic tooling.** Bundle size, unused exports (`npm run knip` exists but isn't wired into any stage), and perf budgets are the kind of thing a script checks reliably and cheaply; an LLM reviewer reading a diff is a worse and more expensive way to catch them.
5. **Two independently hand-maintained copies of the same pipeline**, with nothing enforcing they stay in sync (rubber-duck feedback was split on how serious this is in practice — see §4).
6. **No feedback loop on whether the pipeline is working.** Loop caps (2 rounds, 3 rounds) are static guesses never checked against real data — review-round counts, which reviewer actually catches what, bug-escape rate, time-to-merge.
7. **The fast-path/full-pipeline split is gated only by file count**, which is a poor proxy for risk: a one-line change to timer math is high-risk; a five-file copy-text change is low-risk.
8. **(Surfaced by rubber-duck review, not in the original draft) Proportionality.** This is a solo-maintainer project. A uniform 6-stage, up-to-4-parallel-reviewer pipeline applied to every non-trivial change — maintained in two hand-synced copies — is real LLM-call cost and latency for changes that don't need that much scrutiny. None of items 1–7 questions whether the apparatus's *default* weight matches the project's actual risk profile.

## 3. Five alternative workflow designs considered

**A. Enhanced pipeline.** Keep the current 6-stage shape; add a dedicated reviewer stage for the timer/play-time correctness concerns in item 1, a cheap post-implementation diff-vs-plan reconciliation pass by `architect-reviewer` before Stage 5, and promote `knip`/bundle-budget checks to a required deterministic gate.

**B. Fast/lean flow.** Drop the upfront plan+architecture LLM stages for most changes; rely on deterministic gates plus a single broad-context reviewer pass (correctness+security+perf+UX together, one pass, full diff) instead of narrow parallel agents. Optimizes for speed and cost over multi-angle coverage.

**C. TDD-first flow.** `plan-writer` produces failing tests before any implementation exists; `coding-agent` implements against tests it can't silently rewrite; `validation-reviewer`'s charter shifts to auditing test quality of pre-existing tests rather than judging sufficiency after the fact.

**D. Continuous/telemetry-closed-loop flow.** The pipeline doesn't end at the commit gate — changes ship behind flags/canary, and a required post-deploy monitoring stage (Core Web Vitals, crash-free sessions, DynamoDB latency) feeds back into planning, closing the loop with real production data.

**E. Risk-tiered adaptive pipeline.** Replace the binary "1–2 files = fast path" split with explicit risk tiers (trivial/copy-only, standard, high-risk — timer/auth/data-model/schema-touching) classified by *what* the change touches, each with its own stage subset and reviewer set.

## 4. Rubber-duck results (three independent models)

All three reviewers were given the full evaluation above and the five alternatives, told nothing about each other, and asked to disagree rather than validate. They converged strongly on several points despite reasoning independently:

- **All three endorsed E as the correct backbone shape**, and all three pushed back on applying the *full* heavy pipeline uniformly — reserve it for an explicitly named high-risk tier; default to something closer to B (a single broad-context review pass) for standard changes.
- **All three were skeptical of C as a blanket rule.** Opus and the Sonnet reviewer both noted a planner writing tests before the coder has picked an implementation shape either produces brittle throwaway tests or has the planner secretly doing design work; better to make test *quality* a standing `validation-reviewer` charter item and reserve genuine test-first discipline for the specific high-risk math (timer/rotation/play-time) where it pays off.
- **Opus reframed item 1 sharply**: the real sideline failure mode for a live game timer isn't frame-budget performance, it's correctness — background-tab throttling, clock drift, state loss on refresh/backgrounding/offline, lost or double-written `PlayTimeRecord`s. A reviewer chartered as "performance" would chase `useMemo` while the app silently loses a half's data. This reframing is adopted directly into the recommendation below.
- **Two of three (Opus, Sonnet) argued the single biggest blind spot in a risk-tiered design is that risk classification must be mechanical** (CI-enforced path globs — files under `gameTimeUtils.ts`, `gameCalculations.ts`, `playTimeCalculations.ts`, `rotationPlannerService.ts`, `amplify/data/resource.ts`, `amplify/backend.ts`, and anything touching `coaches[]` authorization always route to the high-risk tier), not something an LLM self-assigns at plan time, since that would make the cheapest, least-informed judgment the one thing gating how much scrutiny a change gets.
- **Opus's proposed sixth alternative** — "thin pipeline, thick machine-checkable substrate": push agents toward writing property-based/characterization tests and CI-enforced budgets rather than opinions, with one mandatory full-game Playwright smoke test on UI-impacting diffs — and **the Sonnet reviewer's proposed sixth alternative** — "deterministic-gate-first, LLM-escalation": run cheap deterministic checks first and only escalate to heavier LLM review on a gate failure or an explicit high-risk flag — are close variants of the same idea and both stronger than any of the original five taken alone.
- **Haiku flagged an unaddressed structural risk**: reconciliation loops need their own cap (it proposed max 1 round before escalating to the user) and risk-tier definitions need periodic pruning, or the "high-risk" list only grows.
- **Sonnet's distinct contribution** was proportionality (item 8 above) — this is a solo-maintainer app, and the two-copy-pipeline maintenance cost plus a uniformly heavy process is itself worth weighing, not just the gaps in coverage.
- **Opus separately noted** that nothing measures whether the four review charters actually catch anything distinct from each other — "unfalsifiable ceremony until you have escape data" — making item 6 (no feedback loop) arguably the most consequential single gap, since it's the one finding that would validate or invalidate all the others.

No reviewer disputed items 2–4 or 7 of the original evaluation; all treated them as correct as stated.

## 5. Recommendation

Not a straight pick of A–E — the rubber-duck round converged on a synthesis that none of the five alternatives capture alone. Adopt **a risk-tiered pipeline with mechanical (not self-assigned) tier classification, a lean default path, and a reserved heavy path for genuinely high-risk code**, replacing the current uniform pipeline:

- **Tier 0 — trivial** (docs/copy/config-only changes): skip the agent pipeline entirely; `gate:commit` is the only requirement.
- **Tier 1 — standard** (the current default for most feature/bugfix work): deterministic gates first (lint, typecheck, `knip`, a bundle-size diff check), then — if those pass — a single broad-context reviewer pass covering correctness, security, and UX together on the real diff, instead of three narrow parallel agents. Only escalate to the full plan → architecture-review sequence if that reviewer or the gates flag something plan-worthy, or the diff is large/cross-cutting.
- **Tier 2 — high-risk**, determined by **CI-enforced path globs**, not LLM judgment at plan time: anything touching `gameTimeUtils.ts`, `gameCalculations.ts`, `playTimeCalculations.ts`, `rotationPlannerService.ts`, `amplify/data/resource.ts`, `amplify/backend.ts`, Cognito/Lambda auth code, or the `coaches[]` authorization pattern. Runs the current full pipeline (plan → architecture review → [UI review] → implement → parallel validation + security + [UI] review → gate), with three additions:
  - A **runtime-correctness/resilience** charter item (not a generic "performance" reviewer) specifically for timer/play-time code: background-tab throttling, clock drift, state recovery after refresh/backgrounding/offline, and `PlayTimeRecord`/`Substitution`/`LineupAssignment` write consistency.
  - A **diff-vs-plan reconciliation** pass by `architect-reviewer` after implementation, capped at 1 round before escalating to the user (per Haiku's finding).
  - `knip`/bundle-size checks as a **required** gate, not advisory.
- **Test strategy**: fold test-quality/adequacy into `validation-reviewer`'s standing charter on every tier, rather than a blanket pre-implementation TDD gate. Reserve genuine test-first discipline (property-based/characterization tests written before the fix) for Tier 2 changes to timer/rotation/play-time math specifically, where it earns its cost.
- **E2E**: make `npm run test:e2e:smoke` an explicit, required step (not reviewer discretion) whenever a change is both UI-impacting and Tier 1 or above.
- **Lightweight feedback loop**: track review-round counts and Major/Critical findings per PR in a running note; revisit loop caps and the Tier-2 glob list quarterly. Add minimal production signal (Core Web Vitals + a crash-free-session proxy, checked periodically) rather than building full canary/feature-flag infrastructure — that's disproportionate for a solo-maintainer app (full alternative D was judged too heavy by two of three reviewers).
- **Two-copy maintenance**: keep the Claude Code and Copilot pipelines as separate files (rubber-duck feedback was split on how serious the drift risk is, and a shared-source-generation system is its own maintenance burden), but add a small CI check that diffs stage names/order and the severity rubric between `.claude/skills/dev-pipeline/SKILL.md` + `.claude/skills/review-rubric/SKILL.md` and `.github/copilot-instructions.md`, so drift is caught rather than silently accumulating.

## 6. Implementation plan

1. **Add CI-enforced risk-tier classification.** A small script (or CI step) that inspects the changed-file list against the Tier-2 glob list above and tags the PR/change accordingly; wire it into both `dev-pipeline` (Claude Code) and `coordinator-agent` (Copilot) as the required first step, replacing the current file-count heuristic.
2. **Wire deterministic gates into Tier 1.** Add `npm run knip` and a bundle-size-diff check (e.g. comparing `dist/` output size against the base branch) as scripts, and reference them from `dev-pipeline`/`copilot-instructions.md` as required before any LLM reviewer runs.
3. **Define the Tier 1 single-reviewer charter.** A new lean reviewer role (or a mode of `validation-reviewer`) that covers correctness + security + UX in one pass for standard changes, replacing the three-way parallel split for this tier only. Tier 2 keeps the existing parallel `validation-reviewer` + `security-reviewer` + `ui-reviewer` split.
4. **Add the runtime-correctness/resilience charter for Tier 2 timer/play-time changes.** Extend `security-reviewer` or add a narrowly-scoped check (not a generic "performance-reviewer") covering background-tab throttling, clock drift, offline/refresh recovery, and `PlayTimeRecord` consistency; document it in `review-rubric` so both tool variants share the same bar.
5. **Add diff-vs-plan reconciliation to Tier 2**, capped at 1 round, as a short additional pass by `architect-reviewer` before Stage 5 begins; update the loop-cap section of `dev-pipeline` accordingly.
6. **Make `test:e2e:smoke` required for UI-impacting Tier 1+ changes** in both pipeline definitions, instead of leaving it to `ui-reviewer` discretion.
7. **Add the pipeline-drift CI check** diffing stage structure between the Claude Code and Copilot pipeline files.
8. **Add a lightweight review-effectiveness note** (a short running log — could be a `docs/plans/` entry or a simple table) recording review-round counts and Major/Critical findings per non-trivial PR, revisited quarterly alongside the Tier-2 glob list and loop caps.
9. **Sequencing**: land 1–2 first (mechanical gating, cheap and high-value on their own), then 3 (biggest behavior change, do it once 1–2 are stable), then 4–6 (Tier-2-specific hardening), then 7–8 (process hygiene, lowest urgency).

Each step above is itself a scoped change to `.claude/skills/dev-pipeline/SKILL.md`, `.claude/skills/review-rubric/SKILL.md`, the relevant `.claude/agents/*.md` files, and their `.github/agents/`/`copilot-instructions.md` counterparts — not a rewrite of the pipeline from scratch. This document is the plan; implementing it is future work once reviewed.
