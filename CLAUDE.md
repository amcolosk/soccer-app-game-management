# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TeamTrack is a progressive web app for coaches to manage teams, players, and game day operations. It tracks lineups, play time, substitutions, and ensures fair playing time distribution. Built with React 19, TypeScript, Vite, and AWS Amplify Gen2.

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

---

## Common Development Commands

### Development
```bash
npm run dev                # Start development server (http://localhost:5173)
npm run build             # Build for production (runs TypeScript + Vite)
npm run preview           # Preview production build locally
```

### Testing
```bash
npm test                  # Run unit tests in watch mode (Vitest)
npm run test:run          # Run unit tests once
npm run test:ui           # Open Vitest UI
npm run test:e2e          # Run E2E tests (Playwright)
npm run test:e2e:headed   # Run E2E tests with browser visible
npm run test:e2e:ui       # Open Playwright UI
npm run test:e2e:debug    # Debug E2E tests
npm run test:e2e:report   # Show Playwright HTML report
npm run test:e2e:setup    # Creates test user/data
```

### Code Quality
```bash
npm run lint              # Lint TypeScript/TSX files with ESLint
npm run lint:security     # Run security linting
npm run knip              # Find unused files, dependencies, and exports
npm run knip:fix          # Auto-fix unused exports
```

### Database
```bash
npm run seed              # Seed the database with sample data
```

## Architecture

### Frontend Structure

**Main Application Flow:**
- `src/App.tsx` - Root component with tab-based navigation (Games, Reports, Manage, Profile)
- `src/components/AppLayout.tsx` - Main app layout wrapper
- `src/components/Home.tsx` - Home/dashboard page
- `src/components/LandingPage.tsx` - Unauthenticated landing page
- Navigation persists active game state in localStorage for page refresh recovery
- GraphQL client generated from schema: `generateClient<Schema>()`

**Component Organization:**

`src/components/` - Feature components
- `GameManagement/` - Live game management (directory, not single file)
  - `GameManagement.tsx` - Main orchestrator; renders 4 state blocks: `scheduled`, `in-progress`, `halftime`, `completed`
  - `CommandBand.tsx` - Sticky score/timer/rotation info band (z-index 200), always visible during active game
  - `TabNav.tsx` - Tab navigation for in-progress state (Lineup, Bench, Notes tabs)
  - `BenchTab.tsx` - Bench player view tab
  - `GameHeader.tsx` - Game info header
  - `GameTimer.tsx` - Timer control (only rendered in halftime state; supports `hidePrimaryCta` prop)
  - `GoalTracker.tsx` - Score tracking
  - `LineupPanel.tsx` - Lineup display (supports `hideAvailablePlayers` prop)
  - `RotationWidget.tsx` - Rotation preview modal (controlled via props)
  - `SubstitutionPanel.tsx` - Substitution control
  - `PlayerNotesPanel.tsx` - Game notes (gold-star, yellow-card, red-card)
  - `hooks/useGameSubscriptions.ts` - Real-time DynamoDB subscriptions
  - `hooks/useGameTimer.ts` - Timer logic
  - `types.ts` - Local types (re-exports from `src/types/schema.ts`)
- `GamePlanner.tsx` - Pre-game rotation planning interface
- `LineupBuilder.tsx` - Drag-and-drop lineup assignment
- `PlayerAvailabilityGrid.tsx` - Mark players available/absent before games
- `SeasonReport.tsx` - Team statistics and play time reports
- `Management.tsx` - Team/player/formation administration
- `InvitationManagement.tsx` - Share teams with other coaches
- `BugReport.tsx` - Bug/feedback report submission UI
- `ConfirmModal.tsx` - Reusable confirmation dialog
- `UpdatePrompt.tsx` - PWA update notification
- `PlayerSelect.tsx` - Player selection dropdown
- `DevDashboard/` - Developer issue tracking dashboard
  - `DevDashboard.tsx` - Dashboard main view
  - `IssueList.tsx` - Issue list with filtering
  - `IssueDetailModal.tsx` - Issue detail view
  - `IssueStatusBadge.tsx` - Status indicator badge
- `routes/` - Route wrapper components
  - `GameManagementRoute.tsx`
  - `GamePlannerRoute.tsx`
  - `SeasonReportRoute.tsx`
  - `InvitationRoute.tsx`
  - `DevDashboardRoute.tsx`

`src/services/` - Business logic (should be pure functions, testable)
- `rotationPlannerService.ts` - Fair rotation algorithm based on player availability
- `substitutionService.ts` - Manages substitutions and play time records
- `cascadeDeleteService.ts` - Handles cascade deletion of related records
- `invitationService.ts` - Team invitation workflow

`src/utils/` - Pure utility functions (most have corresponding `.test.ts` files)
- `gameCalculations.ts` - Game timer, half detection, score tracking
- `playTimeCalculations.ts` - Calculate total play time per player
- `lineupUtils.ts` - Lineup validation and transformations
- `gameTimeUtils.ts` - Convert between real time and game seconds
- `gamePlannerUtils.ts` - Rotation planning helpers
- `playerUtils.ts` - Player-related helpers
- `rosterFilterUtils.ts` - Roster filtering and sorting
- `validation.ts` - Form validation helpers
- `analytics.ts` - Google Analytics 4 integration
- `errorHandler.ts` - Error handling utilities
- `toast.ts` - Toast notification helpers
- `viteVersion.ts` - Version info from Vite build

`src/hooks/` - Custom React hooks
- `useTeamData.ts` - Loads team with roster, positions, and games
- `useAmplifyQuery.ts` - Generic Amplify query wrapper
- `useBugReports.ts` - Bug report submission and issue management
- `useDeveloperAccess.ts` - Developer mode access control
- `useSwipeDelete.ts` - Swipe-to-delete gesture

`src/contexts/`
- `AvailabilityContext.tsx` - Player availability state context

`src/constants/`
- `gameConfig.ts` - Game configuration constants
- `ui.ts` - UI constants (z-index, breakpoints, etc.)

`src/types/`
- `schema.ts` - GraphQL schema types

### Backend (AWS Amplify Gen2)

**Configuration Files:**
- `amplify/backend.ts` - Defines backend resources and wires up Lambda functions
- `amplify/data/resource.ts` - Complete GraphQL schema with data models
- `amplify/auth/resource.ts` - Cognito authentication configuration
- `amplify/data/formation-templates.ts` - Default formation template data

**Lambda Functions** (`amplify/functions/`):
- `send-invitation-email/` - DynamoDB Stream trigger on TeamInvitation table; sends emails via SES
- `accept-invitation/` - Custom GraphQL mutation with elevated permissions to add user to team's coaches array
- `get-user-invitations/` - Custom query to fetch invitations by user email
- `send-bug-report/` - Processes bug report submissions; writes to Issue table, increments IssueCounter
- `update-issue-status/` - Custom mutation for agent-driven status updates (API key auth)

**Important Backend Patterns:**

1. **Authorization Model**: All models use `allow.ownersDefinedIn('coaches')` where `coaches` is a string array field containing user IDs. When creating records, always populate the `coaches` field with current user ID.

2. **Custom Mutations**: Some operations require elevated permissions beyond standard CRUDL. Example: `acceptInvitation` mutation updates Team.coaches array even though user isn't yet an owner. `updateIssueStatus` uses API key auth for agent access.

3. **GraphQL Client Usage**:
   ```typescript
   import { generateClient } from "aws-amplify/data";
   import type { Schema } from "../amplify/data/resource";
   const client = generateClient<Schema>();

   // Create with authorization
   await client.models.Team.create({
     name: "Team Name",
     coaches: [currentUserId], // CRITICAL: Always include coaches array
     // ... other fields
   });
   ```

### Data Model Key Relationships

**Core Hierarchy:**
- `Formation` → `FormationPosition` (reusable templates like "4-3-3")
- `Team` → references a Formation, has many `TeamRoster` entries
- `Player` → global player pool, linked to teams via `TeamRoster`
- `TeamRoster` → junction table (Player ↔ Team) with jersey number and preferred positions
- `FieldPosition` → team-specific positions

**Game Day:**
- `Game` → scheduled match, tracks timer state (status, currentHalf, elapsedSeconds, lastStartTime)
- `PlayerAvailability` → tracks which players are available/absent/late for each game
- `LineupAssignment` → current player-to-position mapping for a game
- `Substitution` → records when Player A leaves and Player B enters a position
- `PlayTimeRecord` → granular tracking (playerId, positionId, startGameSeconds, endGameSeconds); GSI on gameId
- `Goal` → goal scored/conceded with scorer and assist info
- `GameNote` → annotations per player (gold-star, yellow-card, red-card, other)

**Planning:**
- `GamePlan` → pre-game rotation strategy (rotationIntervalMinutes, startingLineup)
- `PlannedRotation` → specific substitution plan for each rotation interval

**Multi-Coach Sharing:**
- `TeamInvitation` → email-based invitations with status (PENDING/ACCEPTED/DECLINED)
- Uses secondary index on email+status for efficient queries

**Issue Tracking:**
- `IssueCounter` → sequential counter for issue numbers (no client access; Lambda only)
- `Issue` → bug/feature report tracking; GSIs on issueNumber and reporterUserId
- Status lifecycle: `OPEN → IN_PROGRESS → FIXED | DEPLOYED | CLOSED` (terminal states set `closedAt`)

**Custom Operations:**
- `acceptInvitation` - Elevated permission mutation for joining a team
- `getUserInvitations` - Query invitations by email
- `submitBugReport` - Creates Issue record with auto-incremented number
- `updateIssueStatus` - Agent-accessible mutation (API key auth + secret header)

### Game Timer Implementation

The game timer runs client-side with periodic sync to DynamoDB:
- `lastStartTime` (ISO timestamp) + `elapsedSeconds` = current game time
- Timer automatically pauses at halftime (when elapsedSeconds reaches halfLengthMinutes * 60)
- Play time records store `startGameSeconds` and `endGameSeconds` relative to game clock
- Services handle timer logic: `gameCalculations.ts`, `gameTimeUtils.ts`

### Mobile Game Management Layout

`GameManagement.tsx` renders different layouts based on game state:
- `scheduled` → pre-game layout with `PlayerAvailabilityGrid` and plan conflict banner
- `in-progress` → `CommandBand` (sticky) + `TabNav` with Lineup/Bench/Notes tabs
- `halftime` → halftime layout with `GameTimer` (hidePrimaryCta=true)
- `completed` → completed layout

`CommandBand` is always sticky at top (z-index 200) during active games. `RotationWidget` and `SubstitutionPanel` are always mounted as modal-only components.

**z-index stack:** `.bottom-nav` 100, `.command-band` 200, `.game-tab-nav` 190, `.modal-overlay` 1000, notifications 9999+

### Bug Report System

- Full issue tracking via DynamoDB `Issue` table with sequential `IssueCounter`
- Agent access: API key header + `SECRET:<AGENT_API_SECRET>|<resolution>` in resolution field
- Rate limit: 5 reports/hour/user (via `reporterUserId` GSI)
- GSI `getIssueByNumber` for direct lookup; `listIssues` for filtering by status
- Docs: `docs/BUG-REPORT-SYSTEM.md` (architecture), `docs/AGENT-ISSUE-MANAGEMENT.md` (agent workflow)
- Agent env vars: `APPSYNC_URL` (from amplify_outputs.json → data.url), `API_KEY` (data.api_key), `AGENT_API_SECRET` (AWS env, never in repo)

#### Agent Bug Triage

Agents may only set `IN_PROGRESS` or `FIXED`. `FIXED` requires a git commit SHA in the resolution. `CLOSED` and `DEPLOYED` require developer action in the dashboard.

Three slash commands for triage (run in Claude Code):

| Command | Description |
|---------|-------------|
| `/list-issues` | Display OPEN and IN_PROGRESS issues sorted by severity |
| `/fix-issue <N>` | Mark issue #N as FIXED with the current commit SHA (prompts for confirmation) |
| `/triage-issues` | Full automated loop: claim → investigate → fix → test → commit → mark FIXED |

**Env var setup:** `source .env.local && claude` (`.env.local` should export `APPSYNC_URL`, `API_KEY`, and `AGENT_API_SECRET`)

## Testing Guidelines

### Unit Tests (Vitest)
- Test files colocated with source: `*.test.ts` or `*.test.tsx`
- Focus on services and utils (business logic)
- Mock AWS Amplify client when testing components
- Run `npm test` during development for instant feedback

### E2E Tests (Playwright)
- Located in `e2e/` directory
- Config: `e2e/playwright.config.ts`
- Setup script: `npm run test:e2e:setup` (creates test user/data)
- Tests cover full user journeys (create team → add players → manage game)
- Spec files: auth, data-isolation, formation-management, full-workflow, game-planner, issue-tracking, player-management, profile, team-management, team-sharing

## Development Notes

### Working with Amplify Data

1. After modifying `amplify/data/resource.ts`, the GraphQL schema auto-updates on next build
2. TypeScript types are generated in `amplify_outputs.json`
3. To seed data: `npm run seed`

### Authorization Debugging

If queries return empty results unexpectedly:
- Check that `coaches` array field is populated with user's ID
- Verify user is authenticated (check Cognito token)
- Confirm authorization rules in schema match your use case

### Lambda Function Development

After modifying Lambda functions:
- Functions are in `amplify/functions/<function-name>/handler.ts`
- Local testing requires Amplify sandbox (consult Amplify Gen2 docs)
- DynamoDB Stream trigger (send-invitation-email) requires manual testing via AWS console

### PWA Configuration

- Service worker config: `vite.config.ts` → VitePWA plugin
- Manifest includes offline support and installability
- Workbox runtime caching configured for Amplify API (24-hour cache)
- Icons: `public/soccer_app_192.png` and `public/soccer_app_512.png`

### TypeScript Configuration

- `tsconfig.json` - App TypeScript config (target ES2020, strict mode, excludes test files)
- `tsconfig.node.json` - Vite/Node scripts config
- Strict mode enabled; prefer explicit types over `any`
- No unused locals or parameters enforced

## Common Patterns

### Creating Data with Authorization
```typescript
const currentUserId = await getCurrentUserId(); // from Cognito
await client.models.Team.create({
  name: "Eagles",
  coaches: [currentUserId], // Required for authorization
  maxPlayersOnField: 7,
  formationId: formationId,
});
```

### Fetching Related Data
```typescript
// Amplify auto-generates selection sets for relationships
const { data: team } = await client.models.Team.get({ id: teamId });
const roster = team?.roster; // May need separate query depending on lazy loading
```

### Game Timer Updates
```typescript
// Start timer
await client.models.Game.update({
  id: gameId,
  status: 'in-progress',
  lastStartTime: new Date().toISOString(),
});

// Pause timer
const elapsedSinceStart = calculateElapsedSeconds(lastStartTime);
await client.models.Game.update({
  id: gameId,
  elapsedSeconds: currentElapsedSeconds + elapsedSinceStart,
  lastStartTime: null, // null indicates paused
});
```

### Fair Rotation Algorithm
Located in `src/services/rotationPlannerService.ts`:
- Inputs: available players, positions, rotation interval, half length
- Outputs: `PlannedRotation` records with balanced substitutions
- Algorithm prioritizes equal play time across all available players
- Accounts for player preferred positions when possible
- Full requirements in `docs/specs/Rotation-Algorithm-Requirements.md`
