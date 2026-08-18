# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

TeamTrack — a mobile-first PWA for soccer coaches to manage teams, plan rotations, run games from the sideline, and track fair play time. React 19 + TypeScript + Vite frontend, AWS Amplify Gen2 backend (Cognito, AppSync/GraphQL, DynamoDB, Lambda, SES). Full feature list and data model summary: [README.md](README.md). Detailed architecture (entity relationships, authorization model, Lambda functions, key design decisions): [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Commands

```bash
npm run dev                # Start dev server (localhost:5173)
npm run build               # tsc + vite build (also regenerates amplify_outputs via prebuild)
npm run lint                 # ESLint, zero warnings allowed
npm run test:run             # Run all unit tests once (Vitest)
npm test                     # Vitest watch mode
npx vitest run path/to/File.test.tsx        # Run a single test file
npx vitest run -t "test name substring"     # Run tests matching a name
npm run test:coverage        # Vitest with v8 coverage report
npm run test:e2e:smoke       # Playwright smoke subset
npm run test:e2e             # Playwright full suite (project=full)
npm run test:e2e:ui          # Playwright UI mode for debugging one spec
npm run gate:commit          # Runs lint -> test:run -> build in sequence; must be green before every commit
npm run knip                 # Find unused files/exports/deps
```

Unit tests are colocated with source as `*.test.ts(x)` (jsdom environment, setup in `src/test/setup.ts`). E2E specs live in `e2e/`. `npm run gate:commit` is the single authoritative pre-commit check — don't substitute separate lint/test/build calls except when isolating which step of a failing gate to fix.

## Architecture

### Authorization pattern (applies to every data model)
Every Amplify model carries a `coaches: string[]` field and uses `allow.ownersDefinedIn('coaches')`. There is no separate permissions table — multi-coach team sharing works by appending the accepting coach's user ID to `coaches` on the team and all related records (done by the `accept-invitation` Lambda). **Any new mutation that creates a record must populate `coaches` from the team's existing `coaches` array** — omitting this is the most common way to accidentally lock a co-coach out of a record.

### Two position models — don't conflate them
- `FormationPosition` — template positions on a reusable `Formation` (e.g. "GK" in a "4-3-3" template).
- `FieldPosition` — team-specific runtime positions actually used for lineups, substitutions, and `PlayTimeRecord`s.
A `Formation` can be shared across teams; each team's `FieldPosition` rows are its own.

### Game timer is client-side, synced periodically
Current game time = `elapsedSeconds + (now - lastStartTime)` when running; `elapsedSeconds` alone when `lastStartTime` is null (paused). Auto-pauses at `halfLengthMinutes * 60`. Any code touching timer/halftime/rotation logic needs to reason in game-clock seconds, not wall-clock time — `gameTimeUtils.ts` and `gameCalculations.ts` hold the conversion logic.

### Play time is derived from granular enter/exit records
`PlayTimeRecord` stores individual `(player, position, startGameSeconds, endGameSeconds)` rows rather than aggregated totals — this is the source of truth for all play-time math (`playTimeCalculations.ts`) and the fair-rotation algorithm (`rotationPlannerService.ts`). When changing substitution or lineup code, make sure `PlayTimeRecord` writes stay consistent with `Substitution` and `LineupAssignment` writes — they're meant to move together.

### `GameManagement.tsx` state machine
The live game screen is one orchestrator driven by `Game.status`: `scheduled` -> pregame layout, `in-progress` -> tabbed layout, `halftime` -> halftime layout, `completed` -> completed layout. `CommandBand` (sticky header: score + timer + rotation info) is mounted across all in-game states; `RotationWidget` and `SubstitutionPanel` are always-mounted modal-only components. Z-index stack: `.bottom-nav` 100 < `.game-tab-nav` 190 < `.command-band` 200 < `.modal-overlay` 1000 < notifications 9999+.

### Styling and types
All CSS lives in the single `src/App.css` (~4500+ lines) — append new sections at the bottom rather than creating per-component stylesheets. Theme values are CSS custom properties on `:root` in `src/index.css` (`--primary-green`, `--card-background`, `--border-color`, `--text-secondary`, `--accent-green`, `--light-green`, `--background`, `--text-primary`, `--danger-red`, `--hover-background`). `src/components/GameManagement/types.ts` re-exports from the canonical `src/types/schema.ts` — import from there rather than duplicating shape definitions.

### Amplify v6 auth gotcha
Amplify v6 sends the Cognito **access token** to AppSync, not the ID token. The access token's `username` claim is an internal Cognito UUID, not the email, and it carries no `email` claim. Any Lambda resolver that needs a coach's email (e.g. for notifications) must call `cognito-idp:AdminGetUser` with that UUID — see `update-issue-status` for the reference pattern. This requires a `USER_POOL_ID` env var and the matching IAM permission wired in `amplify/backend.ts`.

## Development workflow (agent pipeline)

This repo has a staged, multi-agent development workflow, with two parallel implementations of the *same* pipeline:

- **Claude Code (native)** — subagents in [.claude/agents/](.claude/agents/) (`plan-writer`, `architect-reviewer`, `ui-reviewer`, `coding-agent`, `validation-reviewer`, `security-reviewer`) plus orchestration skills in [.claude/skills/](.claude/skills/) (`dev-pipeline`, `defect-triage`, `review-rubric`). **Use these when working in Claude Code** — load the `dev-pipeline` skill for non-trivial multi-file work, or `defect-triage` for a numbered GitHub issue.
- **GitHub Copilot** — custom agents in [.github/agents/](.github/agents/) (`coordinator-agent`, `implementation-planner`, `architect-agent`, `ui-designer`, `coding-agent`, `validation-agent`, `security-engineer`, `defect-triage-agent`), summarized in [.github/copilot-instructions.md](.github/copilot-instructions.md). This is what Copilot uses in this repo; it is not wired into Claude Code.

The two mirror each other stage-for-stage, but the Claude Code version has no separate "coordinator" agent — the invoking thread itself owns workflow state (it already holds full context across every stage, unlike a coordinator that is itself a stateless LLM call), and no subagent is ever given the Agent/Task tool, so a pipeline stage can't recursively spawn its own sub-pipeline. The `dev-pipeline` skill also defines explicit loop caps (max plan↔architecture revision rounds, max Stage 5 fix→re-review rounds, one round of bundled clarification questions) — read it before running the pipeline if you haven't.

**Stage sequence** (skip a stage only when it's explicitly optional below):

```
plan -> architecture review -> [UI review, if UI/UX/accessibility/layout impact] -> implement -> parallel (validation review + security review + [UI review if UI-impacting]) -> commit gate
```

1. **Plan** — file-by-file change list, data model/API impact, risks, edge cases, test strategy.
2. **Architecture review** — check plan for architectural fit, reuse opportunities, coupling/migration/performance risk; fold corrections back into the plan before coding.
3. **UI review** (only for UI-impacting changes) — check against `docs/specs/UI-SPEC.md`, app-wide consistency, accessibility, responsive behavior; reviewer-only, fold findings into the plan. The Claude Code `ui-reviewer` can render the app in a real browser (mobile viewport included) rather than reviewing code alone.
4. **Implement** — execute the finalized plan; report files changed, tests added, commands run.
5. **Parallel reviews** — validation (requirement coverage, regressions, test gaps) + security (authz/authn, data handling, injection, unsafe workflows) + UI review again if UI-impacting. **Major or Critical findings from any reviewer block progression** until fixed and that reviewer re-runs; Minor/informational findings are recorded but non-blocking. In Claude Code, spawn these as parallel Agent calls in one message.
6. **Commit gate** — `npm run gate:commit` must pass before every commit, run once at the end (not on every review round).

**Defect fix pipeline:**
- Small (1–2 files, no architecture change): implement -> validation review -> commit gate.
- Larger (3+ files, architecture/UI/security-relevant): use the full new-feature pipeline above.

**Assigned GitHub issue triage**: reproduce with a failing test first, fix, prove with before/after test results, never close the issue yourself (developer sign-off only), always cite the commit SHA in the resolution comment. In Claude Code, use the `defect-triage` skill (`gh` CLI for issue comments/labels); Copilot uses `.github/agents/defect-triage.agent.md` and the `/list-issues`, `/fix-issue <N>`, `/triage-issues` prompts.
