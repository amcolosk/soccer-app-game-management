# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Feature Development Workflow

**IMPORTANT**: When implementing any new feature, you MUST follow this agent pipeline in order. Do not skip steps or reorder them.

1. **planner** — Research requirements and produce a detailed implementation plan with tasks.
2. **plan-architect** — Review the plan for feasibility, completeness, risk, and best practices. Revise if needed.
3. **ui-designer** — Design the UI: wireframes, layout, component structure, mobile/desktop considerations.
4. **implementer** — Write the code following the approved plan and UI design.
5. **security-reviewer** — Review the implemented code for security vulnerabilities (OWASP Top 10, auth, data handling).
6. **validation-engineer** — Review test coverage, identify gaps, and ensure tests properly validate the feature.

Use the `Task` tool to invoke each agent in sequence, passing the outputs from prior stages as context to each subsequent agent. Do not proceed to the next stage until the current agent has completed its work.

## Project Overview

TeamTrack is a progressive web app for coaches to manage teams, players, and game day operations. It tracks lineups, play time, substitutions, and ensures fair playing time distribution. Built with React, TypeScript, Vite, and AWS Amplify Gen2.

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
npm run test:e2e:ui       # Open Playwright UI
npm run test:e2e:debug    # Debug E2E tests
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
npx ampx seed             # Seed the database with sample data
```

## Architecture

### Frontend Structure

**Main Application Flow:**
- `src/App.tsx` - Root component with tab-based navigation (Games, Reports, Manage, Profile)
- Navigation persists active game state in localStorage for page refresh recovery
- GraphQL client generated from schema: `generateClient<Schema>()`

**Component Organization:**
- `src/components/` - Feature components
  - `GameManagement.tsx` - Live game management with timer and substitutions
  - `GamePlanner.tsx` - Pre-game rotation planning interface
  - `LineupBuilder.tsx` - Drag-and-drop lineup assignment
  - `PlayerAvailabilityGrid.tsx` - Mark players available/absent before games
  - `SeasonReport.tsx` - Team statistics and play time reports
  - `Management.tsx` - Team/player/formation administration
  - `InvitationManagement.tsx` - Share teams with other coaches

- `src/services/` - Business logic (should be pure functions, testable)
  - `rotationPlannerService.ts` - Fair rotation algorithm based on player availability
  - `substitutionService.ts` - Manages substitutions and play time records
  - `invitationService.ts` - Team invitation workflow

- `src/utils/` - Pure utility functions (all have corresponding .test.ts files)
  - `gameCalculations.ts` - Game timer, half detection, score tracking
  - `playTimeCalculations.ts` - Calculate total play time per player
  - `lineupUtils.ts` - Lineup validation and transformations
  - `gameTimeUtils.ts` - Convert between real time and game seconds
  - `validation.ts` - Form validation helpers

- `src/hooks/` - Custom React hooks
  - `useTeamData.ts` - Loads team with roster, positions, and games

### Backend (AWS Amplify Gen2)

**Configuration Files:**
- `amplify/backend.ts` - Defines backend resources and wires up Lambda functions
- `amplify/data/resource.ts` - Complete GraphQL schema with data models
- `amplify/auth/resource.ts` - Cognito authentication configuration

**Lambda Functions** (`amplify/functions/`):
- `send-invitation-email/` - DynamoDB Stream trigger on TeamInvitation table; sends emails via SES
- `accept-invitation/` - Custom GraphQL mutation with elevated permissions to add user to team's coaches array
- `get-user-invitations/` - Custom query to fetch invitations by user email

**Important Backend Patterns:**

1. **Authorization Model**: All models use `allow.ownersDefinedIn('coaches')` where `coaches` is a string array field containing user IDs. When creating records, always populate the `coaches` field with current user ID.

2. **Custom Mutations**: Some operations require elevated permissions beyond standard CRUDL. Example: `acceptInvitation` mutation updates Team.coaches array even though user isn't yet an owner.

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

**Game Day:**
- `Game` → scheduled match, tracks timer state (status, currentHalf, elapsedSeconds, lastStartTime)
- `LineupAssignment` → current player-to-position mapping for a game
- `Substitution` → records when Player A leaves and Player B enters a position
- `PlayTimeRecord` → granular tracking (playerId, positionId, startGameSeconds, endGameSeconds)

**Planning:**
- `GamePlan` → pre-game rotation strategy (rotationIntervalMinutes, startingLineup)
- `PlannedRotation` → specific substitution plan for each rotation interval
- `PlayerAvailability` → tracks which players are available/absent/late for each game

**Multi-Coach Sharing:**
- `TeamInvitation` → email-based invitations with status (PENDING/ACCEPTED/DECLINED)
- Uses secondary index on email+status for efficient queries

### Game Timer Implementation

The game timer runs client-side with periodic sync to DynamoDB:
- `lastStartTime` (ISO timestamp) + `elapsedSeconds` = current game time
- Timer automatically pauses at halftime (when elapsedSeconds reaches halfLengthMinutes * 60)
- Play time records store `startGameSeconds` and `endGameSeconds` relative to game clock
- Services handle timer logic: `gameCalculations.ts`, `gameTimeUtils.ts`

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

## Development Notes

### Working with Amplify Data

1. After modifying `amplify/data/resource.ts`, the GraphQL schema auto-updates on next build
2. TypeScript types are generated in `amplify_outputs.json`
3. To seed data: `npx ampx seed` (uses seed data defined in amplify config)

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
- Icons: `public/soccer_app_192.png` and `public/soccer_app_512.png`

### TypeScript Configuration

- `tsconfig.json` - App TypeScript config
- `tsconfig.node.json` - Vite/Node scripts config
- Strict mode enabled; prefer explicit types over `any`

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
