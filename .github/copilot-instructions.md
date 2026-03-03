## Development Workflow

### New Feature Pipeline

Every new feature must go through this agent pipeline in order. Do not skip stages or proceed to the next stage until the current one is complete.

```
planner → plan-architect → [ui-designer] → implementer → validation-engineer + security-reviewer → commit
```

**Stage 1 — Plan** (`planner` agent)
- Research the codebase and produce a detailed implementation plan
- Output: file-by-file change list, data model impacts, edge cases

**Stage 2 — Architect Review** (`plan-architect` agent)
- Reviews the plan for correctness, architectural fit, and risks
- All issues and improvements raised must be incorporated into the plan before moving on

**Stage 3 — UI Design** (`UI designer` agent) *(skip if no UI changes)*
- Reviews the plan and produces UI/UX guidance aligned with `docs/specs/UI-SPEC.md`
- All proposed changes must be incorporated into the plan before moving on

**Stage 4 — Implement** (`implementer` agent)
- Executes the finalized plan
- Writes code, updates tests, follows existing patterns

**Stage 5 — Review** (`validation-engineer` + `security-reviewer` agents, run in parallel)
- Both agents independently review the implementation
- If either agent finds a **Major or higher severity issue**, the implementer must fix it and the reviewing agent must re-run until no Major+ issues remain
- Minor/informational findings are recorded but do not block progress

**Stage 6 — Commit gate**
- `npm run test:run` — all unit tests must pass
- `npm run build` — production build must succeed
- Only commit after both checks are green

### Defect Fix Pipeline

For a simple defect fix touching **one or two files**:

```
fix → validation-engineer → commit
```

1. Implement the fix directly
2. `validation-engineer` agent reviews the changed files
3. If Major+ issues are found, fix them and re-run the agent
4. `npm run test:run` and `npm run build` must both pass before committing

> For defect fixes spanning more than two files, or that require architectural changes, use the full New Feature Pipeline instead. Mark issue as fixed using github hash.
