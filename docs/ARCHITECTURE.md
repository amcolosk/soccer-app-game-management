# TeamTrack Architecture

**Last Updated**: February 2026

## Table of Contents
- [System Overview](#system-overview)
- [Authorization Model](#authorization-model)
- [Data Architecture](#data-architecture)
- [Frontend Architecture](#frontend-architecture)
- [Backend Architecture](#backend-architecture)
- [Key Design Decisions](#key-design-decisions)
- [Technology Stack](#technology-stack)

## System Overview

TeamTrack is a Progressive Web App (PWA) for soccer coaches to manage teams, track player participation, and run games from the sideline. The application uses a formation-based architecture with a global player pool, enabling efficient team management and fair play time distribution.

### Core Capabilities
- **Team & Roster Management**: Create teams, assign players with jersey numbers and preferred positions
- **Pre-Game Planning**: Mark player availability, build rotation plans, drag-and-drop lineup builder
- **Real-time Game Management**: Live lineup management, substitutions, and play time tracking
- **Statistics & Reporting**: Season reports with play time distribution by player and position
- **Multi-Coach Collaboration**: Invite other coaches to co-manage teams via email invitations

## Authorization Model

All data models use `allow.ownersDefinedIn('coaches')` — every record has a `coaches: string[]` field containing the user IDs of coaches who can access it. This enables multi-coach team sharing: when a second coach accepts an invitation, their user ID is appended to the `coaches` array on the team and all related records.

```typescript
// Pattern used on every model
.authorization((allow) => [allow.ownersDefinedIn('coaches')])
```

When creating any record, always populate `coaches` with the current user's ID:
```typescript
await client.models.Team.create({
  name: "Eagles",
  coaches: [currentUserId],
  // ...
});
```

## Data Architecture

### Entity Relationship Model

```
Formation ──────< FormationPosition   (reusable position templates)
Formation <────── Team
                  Team ──────< TeamRoster >────── Player
                  Team ──────< FieldPosition      (team-specific positions)
                  Team ──────< Game
                                 │
                                 ├──< PlayerAvailability >────── Player
                                 ├──< GamePlan ──────< PlannedRotation
                                 ├──< LineupAssignment >──── Player, FieldPosition
                                 ├──< Substitution >──── Player (in/out), FieldPosition
                                 ├──< PlayTimeRecord >──── Player, FieldPosition
                                 ├──< Goal >──── Player (scorer, assist)
                                 └──< GameNote >──── Player
                  Team ──────< TeamInvitation
```

### Data Models

#### **Formation**
Reusable position template (e.g., "4-3-3", "3-3-1") that can be assigned to multiple teams.
- `name`: String — e.g., "4-3-3"
- `playerCount`: Int — number of field players
- `sport`: String — default "Soccer"
- `coaches`: String[] — user IDs with access

**Relationships**: Has many `FormationPosition`, has many `Team`

---

#### **FormationPosition**
Individual position within a formation template.
- `formationId`: ID (FK)
- `positionName`: String — e.g., "Left Forward"
- `abbreviation`: String — e.g., "LF"
- `sortOrder`: Int
- `coaches`: String[]

**Note**: This is the *template* position. `FieldPosition` (below) is the team-specific runtime position.

---

#### **Team**
A team with formation reference and configuration.
- `name`: String
- `formationId`: ID (FK, optional)
- `maxPlayersOnField`: Int
- `halfLengthMinutes`: Int — default 30
- `sport`: String — default "Soccer"
- `gameFormat`: String — default "Halves"
- `coaches`: String[] — all coaches with access

**Relationships**: Belongs to `Formation`, has many `TeamRoster`, `FieldPosition`, `Game`, `TeamInvitation`

---

#### **Player**
Global player pool — players are not scoped to a team, they're shared via `TeamRoster`.
- `firstName`, `lastName`: String
- `isActive`: Boolean — default true
- `birthYear`: Int — optional (used for age-group filtering on roster)
- `coaches`: String[]

**Relationships**: Has many `TeamRoster`, `LineupAssignment`, `Substitution` (in/out), `PlayTimeRecord`, `Goal` (scorer/assist), `GameNote`, `PlayerAvailability`

---

#### **TeamRoster**
Junction table linking a `Player` to a `Team` with team-specific data.
- `teamId`, `playerId`: ID (FKs)
- `playerNumber`: Int — jersey number
- `preferredPositions`: String — comma-separated `FieldPosition` IDs
- `isActive`: Boolean
- `coaches`: String[]

---

#### **FieldPosition**
Team-specific positions used for lineups and play time tracking. Unlike `FormationPosition` (which is a reusable template), these are created per team.
- `teamId`: ID (FK)
- `positionName`: String — e.g., "Forward"
- `abbreviation`: String — e.g., "FW"
- `sortOrder`: Int
- `coaches`: String[]

**Relationships**: Has many `LineupAssignment`, `Substitution`, `PlayTimeRecord`

---

#### **Game**
Scheduled match with opponent info and live timer state.
- `teamId`: ID (FK)
- `opponent`: String
- `isHome`: Boolean
- `gameDate`: DateTime
- `status`: String — `scheduled | in-progress | halftime | completed`
- `currentHalf`: Int — 1 or 2
- `elapsedSeconds`: Int — paused elapsed game time
- `lastStartTime`: String — ISO timestamp when timer last started (null = paused)
- `ourScore`, `opponentScore`: Int
- `coaches`: String[]

**Timer logic**: Current game time = `elapsedSeconds + (now - lastStartTime)` when running; `elapsedSeconds` alone when paused.

---

#### **PlayerAvailability**
Records each player's availability status for a specific game.
- `gameId`, `playerId`: ID (FKs)
- `status`: String — `available | absent | injured | late-arrival`
- `markedAt`: DateTime
- `notes`: String (optional)
- `coaches`: String[]

---

#### **GamePlan**
Pre-game rotation strategy.
- `gameId`: ID (FK)
- `rotationIntervalMinutes`: Int
- `totalRotations`: Int
- `startingLineup`: JSON — array of `{playerId, positionId}`
- `coaches`: String[]

**Relationships**: Has many `PlannedRotation`

---

#### **PlannedRotation**
One planned substitution interval within a `GamePlan`.
- `gamePlanId`: ID (FK)
- `rotationNumber`: Int
- `gameMinute`: Int — when this rotation should occur
- `half`: Int — 1 or 2
- `plannedSubstitutions`: JSON — array of `{playerOutId, playerInId, positionId}`
- `viewedAt`: DateTime — when coach last viewed this during the game
- `coaches`: String[]

---

#### **LineupAssignment**
Tracks which player is assigned to which position in a game (active lineup).
- `gameId`, `playerId`, `positionId`: ID (FKs)
- `isStarter`: Boolean
- `coaches`: String[]

---

#### **Substitution**
Records an actual substitution event during a game.
- `gameId`: ID (FK)
- `playerOutId`, `playerInId`: ID (FKs to Player)
- `positionId`: ID (FK to FieldPosition)
- `gameSeconds`: Int
- `half`: Int
- `timestamp`: DateTime
- `coaches`: String[]

---

#### **PlayTimeRecord**
Granular tracking of when a player entered/exited a position. This is the source of truth for all play time calculations.
- `gameId`, `playerId`, `positionId`: ID (FKs)
- `startGameSeconds`: Int — game clock when player entered
- `endGameSeconds`: Int — game clock when player left (null if still playing)
- `coaches`: String[]

Secondary index: `gameId` → `listPlayTimeRecordsByGameId`

---

#### **Goal**
A goal scored during a game.
- `gameId`: ID (FK)
- `scoredByUs`: Boolean — true = our team scored, false = opponent
- `gameSeconds`: Int
- `half`: Int
- `scorerId`, `assistId`: ID (FKs to Player, both optional)
- `notes`: String
- `timestamp`: DateTime
- `coaches`: String[]

---

#### **GameNote**
A notable event during a game (gold star, card, etc.).
- `gameId`: ID (FK)
- `noteType`: String — `gold-star | yellow-card | red-card | other`
- `playerId`: ID (FK, optional)
- `gameSeconds`, `half`: Int
- `notes`: String
- `timestamp`: DateTime
- `coaches`: String[]

---

#### **TeamInvitation**
Email-based invitation for a coach to join a team.
- `teamId`: ID (FK)
- `teamName`: String — denormalized for display during acceptance
- `email`: String
- `role`: Enum — `OWNER | COACH | PARENT`
- `status`: Enum — `PENDING | ACCEPTED | DECLINED | EXPIRED`
- `invitedBy`: String — userId of sender
- `invitedAt`, `expiresAt`: DateTime — invitations expire after 7 days
- `acceptedAt`: DateTime, `acceptedBy`: String
- `coaches`: String[]

Secondary index: `email + status` → `listInvitationsByEmail`

---

#### **Issue** / **IssueCounter**
In-app bug/feature request tracking. `IssueCounter` is Lambda-only (no client access). `Issue` is read-only for authenticated users and allows public API key reads.

---

## Frontend Architecture

### Navigation Structure

Tab-based navigation with four top-level tabs:
```
App.tsx
└── Authenticator (AWS Cognito)
    └── Main Application
        ├── Games Tab (default)
        │   ├── Team selector
        │   ├── Game list (upcoming + completed)
        │   ├── Schedule new game
        │   └── [Click game] → GameManagement
        │
        ├── Reports Tab
        │   └── SeasonReport
        │
        ├── Manage Tab
        │   └── Management
        │       ├── Teams (expandable: roster, sharing)
        │       ├── Formations
        │       └── Players
        │
        └── Profile Tab
            ├── User settings
            └── Pending invitations
```

Active game state is persisted to `localStorage` so a page refresh returns to the open game.

### Component Overview

| Component | Description |
|---|---|
| `GameManagement.tsx` | Live game operations: timer, lineup, substitutions, goals, notes |
| `GamePlanner.tsx` | Pre-game rotation planning interface |
| `LineupBuilder.tsx` | Drag-and-drop lineup assignment for each rotation slot |
| `PlayerAvailabilityGrid.tsx` | Mark players available/absent/late before a game |
| `SeasonReport.tsx` | Team stats and play time reports |
| `Management.tsx` | Team/player/formation administration |
| `InvitationManagement.tsx` | Send and manage team sharing invitations |

### Services (Business Logic)

| Service | Description |
|---|---|
| `rotationPlannerService.ts` | Fair rotation algorithm based on player availability and preferred positions |
| `substitutionService.ts` | Manages substitutions and play time records |
| `invitationService.ts` | Team invitation workflow |

### Utility Functions

Pure functions in `src/utils/`, each with a colocated `.test.ts` file:

| File | Purpose |
|---|---|
| `gameCalculations.ts` | Game timer, half detection, score tracking |
| `playTimeCalculations.ts` | Aggregate play time per player |
| `lineupUtils.ts` | Lineup validation and transformations |
| `gameTimeUtils.ts` | Convert between real time and game seconds |
| `validation.ts` | Form validation helpers |
| `playerUtils.ts` | Player name formatting, jersey number sorting |
| `rosterFilterUtils.ts` | Filter players by birth year |

### State Management

- **Component state** (`useState`): Form inputs, UI toggles, ephemeral filter state
- **Reducers** (`useReducer`): Complex forms like roster management
- **Custom hooks**: `useTeamData.ts` loads team with roster, positions, and games
- **Amplify client**: `generateClient<Schema>()` for all data operations
- **`localStorage`**: Active game/team persistence across page refreshes

## Backend Architecture

### AWS Amplify Gen2

Infrastructure as code defined in the `amplify/` directory.

**Configuration files:**
- `amplify/backend.ts` — wires up all backend resources and Lambda functions
- `amplify/data/resource.ts` — complete GraphQL schema with all data models
- `amplify/auth/resource.ts` — Cognito authentication configuration

### Lambda Functions

| Function | Trigger | Purpose |
|---|---|---|
| `send-invitation-email` | DynamoDB Stream on `TeamInvitation` | Sends styled HTML invitation emails via SES |
| `accept-invitation` | Custom GraphQL mutation | Adds accepting user's ID to `coaches` array on team and all related records (requires elevated IAM permissions) |
| `get-user-invitations` | Custom GraphQL query | Returns all invitations for the current user's email |
| `send-bug-report` | Custom GraphQL mutation | Creates an `Issue` record and sends notification email |
| `update-issue-status` | Custom GraphQL mutation | Updates issue status (accessible to both authenticated users and public API key) |

### GraphQL Operations

Standard CRUDL auto-generated by Amplify (`list`, `get`, `create`, `update`, `delete`) plus custom operations:
- `acceptInvitation` mutation — adds user to team coaches
- `getUserInvitations` query — fetches invitations by email
- `submitBugReport` mutation — creates issue with email notification
- `updateIssueStatus` mutation — updates issue status

### Data Consistency

DynamoDB uses eventual consistency. Mitigations in place:
- `observeQuery()` used in `GameManagement` and `SeasonReport` for reactive real-time updates
- `PlayTimeRecord` has a secondary index on `gameId` for efficient per-game queries
- E2E tests include wait times for data propagation

## Key Design Decisions

### 1. `coaches` Array for Multi-User Authorization
Every model carries a `coaches: string[]` field. This enables Amplify's `ownersDefinedIn` authorization to work for shared teams without a separate permission table. When a coach accepts an invitation, the `accept-invitation` Lambda appends their user ID to every relevant record.

### 2. Two Position Models: FormationPosition vs FieldPosition
- **`FormationPosition`**: Template positions in a reusable formation (e.g., the "GK" in the "4-3-3" template).
- **`FieldPosition`**: Team-specific runtime positions used for actual lineups, substitutions, and play time tracking.

This separation allows formation templates to be shared and reused while giving each team control over their actual playing positions.

### 3. Global Player Pool
Players are global entities linked to teams via `TeamRoster`. A player can appear on multiple teams without duplication. Team-specific data (jersey number, preferred positions) lives on the `TeamRoster` record.

### 4. Client-Side Timer
The game timer runs client-side and syncs to DynamoDB periodically:
- `lastStartTime` (ISO string) + `elapsedSeconds` = current game time when running
- `lastStartTime = null` = timer paused; `elapsedSeconds` is the ground truth
- Auto-pauses when `elapsedSeconds` reaches `halfLengthMinutes * 60`

### 5. Granular PlayTimeRecord
Individual enter/exit records rather than aggregated totals. This provides a complete audit trail, enables per-position breakdowns, and powers the fair play algorithm. Records store game clock seconds (not wall clock) for accuracy across pauses.

### 6. Pre-Game Rotation Planning
`GamePlan` and `PlannedRotation` store a complete rotation schedule before the game starts. The `rotationPlannerService` generates balanced rotations that equalize play time across available players while respecting preferred positions. Coaches can accept, modify, or ignore the plan during the game.

### 7. Progressive Web App
Installable on mobile and desktop. Service worker caching via Workbox enables offline access for in-progress games. Coaches often have limited connectivity on the sideline.

## Technology Stack

### Frontend
- **React 18** + **TypeScript**
- **Vite** — build tool with PWA plugin (Workbox)
- **AWS Amplify JS** — data client and authentication

### Backend
- **Amazon Cognito** — authentication
- **AWS AppSync** — GraphQL API
- **Amazon DynamoDB** — database (with Streams for Lambda triggers)
- **AWS Lambda** — custom business logic
- **Amazon SES** — transactional email
- **AWS Amplify Hosting** — CI/CD and hosting at coachteamtrack.com

### Testing
- **Vitest** — unit tests (colocated with source)
- **Playwright** — E2E tests (`e2e/` directory)
- **ESLint** — linting

---

**Last Review**: February 2026
