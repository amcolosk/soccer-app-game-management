## Development Workflow

### New Feature Pipeline

Every new feature must go through this agent pipeline in order. Do not skip stages or proceed to the next stage until the current one is complete.

```
coordinator-agent → implementation-planner → architect-agent → [ui-designer] → coding-agent → validation-agent + security-engineer + [ui-designer for UI-impacting changes] → commit gate
```

`coordinator-agent` is the entry point for this workflow. It owns workflow state, gathers context, delegates to the stage-specific agents below, and requires structured responses before advancing stages.

**Stage 1 — Plan** (`implementation-planner` agent)
- Research the codebase and produce a detailed implementation plan
- Output must include:
- Requirements gaps and assumptions made
- Risks, dependencies, sequencing, and edge cases
- File-by-file change list
- Data model and API impacts
- Test strategy and any plan documents created or updated
- If blocked: `Status: blocked`, `Required Next Step: ask-user`, and only the minimum non-obvious clarification questions needed to finish the plan

**Stage 2 — Architect Review** (`architect-agent` agent)
- Reviews the plan for correctness, architectural fit, and risks
- Output must include:
- Architectural findings with severity and rationale
- Reuse opportunities, dependency concerns, migration risks, and missing design decisions
- Approved architecture decisions and any rejected or deferred approaches
- Required plan changes that must be incorporated before moving on
- If blocked: `Status: blocked`, `Required Next Step: ask-user`, and only the minimum non-obvious clarification questions needed to unblock the design review

**Stage 3 — UI Design** (`ui-designer` agent) *(skip if no UI changes)*
- Reviews the plan and produces UI/UX guidance aligned with `docs/specs/UI-SPEC.md`
- Output must include:
- UI and UX findings with severity and rationale
- Missing states, accessibility concerns, responsive layout risks, and interaction issues
- Screen or component-specific guidance
- UI-SPEC alignment notes and unresolved design decisions
- All proposed changes must be incorporated into the plan before moving on

**Stage 4 — Implement** (`coding-agent` agent)
- Executes the finalized plan
- Output must include:
- Files changed
- Tests added or updated
- Commands run and their outcomes
- Plan items completed, remaining gaps, and any deviations from plan with rationale
- Review hotspots, blockers, or unresolved issues

**Stage 5 — Parallel Reviews** (`validation-agent` + `security-engineer` + `[ui-designer for UI-impacting changes]` agents, run in parallel)
- All participating Stage 5 reviewers independently review the implementation
- `ui-designer` runs in Stage 5 only for UI-impacting changes and is reviewer-only (does not implement code changes)
- `validation-agent` output must include:
- Validation findings with severity and rationale
- Requirement gaps, behavioral regressions, and test coverage gaps
- Files reviewed, tests or commands executed, and pass/fail summary against requirements and plan
- `security-engineer` output must include:
- Security findings with severity and rationale
- Authentication, authorization, data handling, injection, or unsafe workflow risks
- Files reviewed, checks executed, residual risks, and pass/fail summary for major security areas reviewed
- If any Stage 5 reviewer finds a **Major or higher severity issue**, the `coding-agent` must fix it and the blocking reviewer must re-run until no Major+ issues remain
- Minor/informational findings are recorded but do not block progress

**Stage 6 — Commit gate**
- `npm run gate:commit` — local fail-fast commit gate (lint → test:run → build); must pass before committing
- Only commit after all checks are green

**Communication contract**
- `coordinator-agent` passes stage, requirements, relevant files, risks, and success criteria into every sub-agent call
- `coordinator-agent` must reference `npm run gate:commit` as the only local commit-gate command in implementation/review handoffs; do not request separate `npm run lint`, `npm run test:run`, and `npm run build` unless troubleshooting a failing gate step.
- Every sub-agent response must include: `Status`, `Findings`, `Artifacts`, `Required Next Step`, and `Handoff Prompt`
- If a sub-agent omits any required section, `coordinator-agent` must request a restated response before continuing
- If a sub-agent needs more information, it must return `Status: blocked`, `Required Next Step: ask-user`, and the minimum clarification questions needed to unblock the stage
- Major/Critical findings from review stages block progression until `coding-agent` resolves them and the blocking reviewer re-runs

**Read-only command approval policy**
- Treat read-only terminal commands as pre-approved when possible
- Examples: `git status`, `git diff`, `git show`, `git log`, `git branch`, `rg` searches, file listing commands, and targeted test-run commands
- Mutating or destructive commands still require explicit approval
- Batch read-only commands together when practical to reduce prompt noise

**Clarification loop**
- Sub-agents do not ask the user questions directly
- When a stage is blocked on missing information, the sub-agent returns `Status: blocked` and `Required Next Step: ask-user`
- The blocked sub-agent must include `Questions for User:` with only the minimum questions needed to continue
- `coordinator-agent` asks the user those questions and then re-runs the same stage with the clarified context

### Defect Fix Pipeline

For a simple defect fix touching **one or two files**:

```
coordinator-agent → coding-agent → validation-agent → commit gate
```

1. `coordinator-agent` gathers scope and routes the fix to `coding-agent`
2. `validation-agent` reviews the changed files
3. If Major+ issues are found, fix them and re-run the agent
4. `npm run gate:commit` must pass before committing

> For defect fixes spanning more than two files, or that require architectural changes, use the full New Feature Pipeline instead. Mark issue as fixed using github hash.
