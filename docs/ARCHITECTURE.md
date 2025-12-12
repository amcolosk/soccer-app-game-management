# TeamTrack Architecture

**Last Updated**: December 12, 2025

## Table of Contents
- [System Overview](#system-overview)
- [Data Architecture](#data-architecture)
- [Frontend Architecture](#frontend-architecture)
- [Backend Architecture](#backend-architecture)
- [Navigation Flow](#navigation-flow)
- [Key Design Decisions](#key-design-decisions)
- [Technology Stack](#technology-stack)

## System Overview

TeamTrack is a Progressive Web App (PWA) designed for soccer coaches to manage teams, track player participation, and run games from the sideline. The application uses a formation-based architecture with a global player pool, enabling efficient team management across multiple seasons.

### Core Capabilities
- **Multi-season Management**: Coaches can organize teams across different seasons
- **Formation Templates**: Reusable position configurations shared across teams
- **Global Player Pool**: Central player database that can be assigned to multiple teams
- **Real-time Game Management**: Live lineup management, substitutions, and play time tracking
- **Statistics & Reporting**: Comprehensive season reports with play time distribution

## Data Architecture

### Entity Relationship Model

```
Season (1) ──────< (Many) Team
                           │
Formation (1) ────< (Many) Team
    │
    └──────< (Many) FormationPosition
                           
Player (Global Pool)
    │
    └──────< (Many) TeamRoster >────── (Many) Team
                           │
                           └──────< (Many) LineupAssignment >────── (Many) Game
                                                                        │
                                                                        ├──< Goal
                                                                        ├──< GameNote
                                                                        └──< PlayTimeRecord
```

### Data Models

#### **Season**
Top-level organizational container for teams within a coaching period.
- `id`: String (Primary Key)
- `name`: String
- `userId`: String (Owner)
- `createdAt`: DateTime
- `updatedAt`: DateTime

**Relationships**: Has many Teams

---

#### **Formation**
Reusable position template (e.g., "4-3-3", "3-3-1") that can be assigned to multiple teams.
- `id`: String (Primary Key)
- `name`: String
- `playersOnField`: Int (number of positions)
- `userId`: String (Owner)
- `createdAt`: DateTime
- `updatedAt`: DateTime

**Relationships**: 
- Has many FormationPositions
- Has many Teams (that reference this formation)

---

#### **FormationPosition**
Individual position within a formation template.
- `id`: String (Primary Key)
- `formationId`: String (Foreign Key)
- `abbreviation`: String (e.g., "GK", "CB", "FWD")
- `name`: String (e.g., "Goalkeeper", "Center Back")
- `createdAt`: DateTime
- `updatedAt`: DateTime

**Relationships**: Belongs to Formation

---

#### **Team**
Represents a team within a season with configuration and formation reference.
- `id`: String (Primary Key)
- `seasonId`: String (Foreign Key)
- `formationId`: String (Foreign Key)
- `name`: String
- `playersOnField`: Int
- `halfLength`: Int (minutes)
- `userId`: String (Owner)
- `createdAt`: DateTime
- `updatedAt`: DateTime

**Relationships**: 
- Belongs to Season
- References Formation
- Has many TeamRoster entries
- Has many Games

---

#### **Player**
Global player pool accessible across all teams and seasons.
- `id`: String (Primary Key)
- `firstName`: String
- `lastName`: String
- `userId`: String (Owner)
- `createdAt`: DateTime
- `updatedAt`: DateTime

**Relationships**: Has many TeamRoster entries (many-to-many with Teams)

---

#### **TeamRoster**
Junction table linking Players to Teams with team-specific data.
- `id`: String (Primary Key)
- `teamId`: String (Foreign Key)
- `playerId`: String (Foreign Key)
- `playerNumber`: Int (jersey number)
- `preferredPositions`: String[] (array of position abbreviations)
- `userId`: String (Owner)
- `createdAt`: DateTime
- `updatedAt`: DateTime

**Relationships**: 
- Belongs to Team
- Belongs to Player
- Has many LineupAssignments

---

#### **Game**
Scheduled match with opponent and timing information.
- `id`: String (Primary Key)
- `teamId`: String (Foreign Key)
- `opponent`: String
- `date`: String (ISO date)
- `location`: String (enum: "home" | "away")
- `status`: String (enum: "scheduled" | "in-progress" | "completed")
- `userId`: String (Owner)
- `createdAt`: DateTime
- `updatedAt`: DateTime

**Relationships**: 
- Belongs to Team
- Has many LineupAssignments
- Has many Goals
- Has many GameNotes
- Has many PlayTimeRecords

---

#### **LineupAssignment**
Current player-to-position assignment for a game (active lineup).
- `id`: String (Primary Key)
- `gameId`: String (Foreign Key)
- `teamRosterId`: String (Foreign Key)
- `formationPositionId`: String (Foreign Key)
- `userId`: String (Owner)
- `createdAt`: DateTime
- `updatedAt`: DateTime

**Relationships**: 
- Belongs to Game
- References TeamRoster
- References FormationPosition

---

#### **Goal**
Goal scored during a game.
- `id`: String (Primary Key)
- `gameId`: String (Foreign Key)
- `scorerId`: String (Foreign Key to TeamRoster)
- `assistId`: String (Optional, Foreign Key to TeamRoster)
- `gameSeconds`: Int (time in game when scored)
- `userId`: String (Owner)
- `createdAt`: DateTime
- `updatedAt`: DateTime

**Relationships**: 
- Belongs to Game
- References TeamRoster (scorer)
- Optionally references TeamRoster (assist)

---

#### **GameNote**
Special events during a game (gold stars, cards).
- `id`: String (Primary Key)
- `gameId`: String (Foreign Key)
- `teamRosterId`: String (Foreign Key)
- `type`: String (enum: "gold-star" | "yellow-card" | "red-card")
- `note`: String (optional description)
- `gameSeconds`: Int (time in game)
- `userId`: String (Owner)
- `createdAt`: DateTime
- `updatedAt`: DateTime

**Relationships**: 
- Belongs to Game
- References TeamRoster

---

#### **PlayTimeRecord**
Granular tracking of when a player entered/exited a position.
- `id`: String (Primary Key)
- `gameId`: String (Foreign Key)
- `teamRosterId`: String (Foreign Key)
- `formationPositionId`: String (Foreign Key)
- `startSeconds`: Int (game time when player entered position)
- `endSeconds`: Int (Optional, game time when player left position)
- `userId`: String (Owner)
- `createdAt`: DateTime
- `updatedAt`: DateTime

**Relationships**: 
- Belongs to Game
- References TeamRoster
- References FormationPosition

## Frontend Architecture

### Component Hierarchy

```
App.tsx (Root)
├── Authenticator (AWS Cognito)
└── Main Application
    ├── Header (with Logout)
    ├── Home (Game List)
    │   ├── SeasonSelector
    │   ├── TeamSelector
    │   └── GameList
    │       └── [Click Game] → GameManagement
    │
    ├── GameManagement (In-game operations)
    │   ├── Lineup Management
    │   ├── Game Timer
    │   ├── Substitution Interface
    │   ├── Goal Tracking
    │   └── Game Notes
    │
    ├── Management (Admin Interface)
    │   ├── Seasons Tab
    │   ├── Teams Tab (with expandable rosters)
    │   ├── Formations Tab
    │   └── Players Tab
    │
    ├── Reports (Season Statistics)
    │   └── SeasonReport
    │       ├── Team Statistics
    │       └── Player Details (expandable)
    │
    ├── Profile (User Settings)
    └── Bottom Navigation
```

### Key Components

#### **Home.tsx**
Entry point showing game list with season/team filtering.
- Displays upcoming and completed games
- "Schedule New Game" button
- Click game → navigates to GameManagement

#### **GameManagement.tsx**
Core game day operations component.
- **Lineup Management**: Drag players to positions using team's formation
- **Game Timer**: Automatic timer with half-time pause
- **Substitutions**: Click position to substitute with play time tracking
- **Goals & Notes**: Record scoring and special events
- **Real-time PlayTimeRecords**: Creates records when players enter/exit positions

**Data Loading**:
- Uses `observeQuery()` for reactive game data updates
- Loads FormationPositions from team's formation

#### **Management.tsx**
Administrative interface with tabs for different entity types.
- **Seasons**: Create/delete seasons
- **Teams**: Create teams, expand to edit rosters
  - Inline editing of player names, numbers, positions
  - Delete players from roster
- **Formations**: Create formation templates with positions
- **Players**: Global player pool management

#### **SeasonReport.tsx**
Statistics and analytics for completed games.
- **Data Loading**: Uses `observeQuery()` for reactive PlayTimeRecords
- **Calculations**: Aggregates play time, goals, assists by player
- **Display**: Expandable player cards showing position breakdowns
- **Real-time**: Automatically updates as games complete

**Important**: Uses `observeQuery()` instead of `.list()` to handle DynamoDB eventual consistency.

### State Management

#### Local Component State (useState)
Most components use React's `useState` for:
- Form inputs
- UI toggles (modals, accordions)
- Temporary edit states

#### AWS Amplify DataStore Queries
Data fetching patterns:
- **`.list()`**: Snapshot queries for initial loads
- **`observeQuery()`**: Reactive queries that re-fire when data changes
  - Used in GameManagement for real-time game updates
  - Used in SeasonReport for live statistics
  - Critical for handling DynamoDB eventual consistency

### Utility Functions

Located in `src/utils/`:
- **gameCalculations.ts**: Play time calculations, time formatting
- **gameTimeUtils.ts**: Game timer utilities, seconds conversion
- **lineupUtils.ts**: Lineup validation and management
- **playerUtils.ts**: Player name formatting, jersey numbers
- **playTimeCalculations.ts**: Aggregate play time statistics
- **validation.ts**: Form validation helpers

## Backend Architecture

### AWS Amplify Gen2

The backend uses AWS Amplify Gen2 with Infrastructure as Code (IaC) approach.

**Configuration Location**: `amplify/backend.ts`

#### Authentication
- **Provider**: Amazon Cognito
- **Configuration**: `amplify/auth/resource.ts`
- **Features**: 
  - Email/password authentication
  - User registration and sign-in
  - Password reset flows

#### Data Layer
- **API**: GraphQL via AWS AppSync
- **Database**: Amazon DynamoDB
- **Configuration**: `amplify/data/resource.ts`
- **Schema**: Defined with `a.schema()` in TypeScript

**Authorization Rules**:
```typescript
// All models use owner-based authorization
.authorization((allow) => [allow.owner()])
```
Each user can only access their own data via `userId` field.

#### Schema Definition Pattern
```typescript
const schema = a.schema({
  Season: a.model({
    name: a.string().required(),
    userId: a.string().required(),
    teams: a.hasMany('Team', 'seasonId'),
  }).authorization((allow) => [allow.owner()]),
  
  // ... other models
});
```

#### GraphQL Operations
Auto-generated by Amplify:
- **Queries**: `list<Model>`, `get<Model>`
- **Mutations**: `create<Model>`, `update<Model>`, `delete<Model>`
- **Subscriptions**: `onCreate<Model>`, `onUpdate<Model>`, `onDelete<Model>`

### Data Consistency

**Challenge**: DynamoDB uses eventual consistency, which can cause:
- Newly created records not immediately appearing in queries
- Race conditions in rapid create-then-read operations

**Solution**: 
- Use `observeQuery()` for components that need real-time data
- E2E tests include wait times for data propagation
- SeasonReport uses `observeQuery()` to catch late-arriving PlayTimeRecords

## Navigation Flow

### Primary User Journey

```
1. Login/Signup (Authenticator)
   ↓
2. Home Page
   ├─→ Select Season (dropdown)
   ├─→ Select Team (dropdown)
   └─→ View Games List
       │
       ├─→ [Click "Schedule New Game"]
       │   ├─→ Fill form (opponent, date, location)
       │   ├─→ Submit
       │   └─→ Return to Home
       │
       └─→ [Click Game Card]
           ↓
3. Game Management
   ├─→ Set Lineup (drag players to positions)
   ├─→ Start Game Timer
   ├─→ Make Substitutions (click position, select player)
   ├─→ Record Goals (scorer, assist)
   ├─→ Record Notes (gold stars, cards)
   ├─→ End Game
   └─→ [Back Button] → Home

4. Bottom Navigation (always accessible)
   ├─→ Home
   ├─→ Management
   │   ├─→ Seasons Tab
   │   ├─→ Teams Tab (expand for roster editing)
   │   ├─→ Formations Tab
   │   └─→ Players Tab
   ├─→ Reports
   │   └─→ Season Statistics (select season/team)
   └─→ Profile
```

### Removed Components
- **TeamManagement.tsx**: Previously existed but removed as redundant
  - Originally had tabs for Players/Positions/Games
  - After architecture change, functionality merged into Home and Management

### App State Management

**Selected Game/Team** stored in:
- `App.tsx` component state
- `localStorage` for persistence across refreshes

**Navigation Logic**:
```typescript
// Selecting a game
setSelectedGame(game);
setSelectedTeam(team);
localStorage.setItem('activeGame', JSON.stringify({ game, team }));

// Back from game
setSelectedGame(null);
setSelectedTeam(null);
localStorage.removeItem('activeGame');
```

## Key Design Decisions

### 1. Formation-Based Architecture
**Decision**: Use reusable formation templates instead of team-specific positions

**Rationale**:
- Reduces data duplication (same formation used by multiple teams)
- Easier to manage positions centrally
- Allows teams to switch formations mid-season
- Simplifies position consistency across teams

### 2. Global Player Pool
**Decision**: Players are global entities linked to teams via TeamRoster junction table

**Rationale**:
- Players can be reused across seasons (e.g., travel team + recreational team)
- Easier to track player history across multiple teams
- Single source of truth for player identity
- Team-specific data (jersey number, preferred positions) stored in TeamRoster

### 3. Direct Game Navigation
**Decision**: Home → GameManagement (direct) without intermediate team page

**Rationale**:
- Faster workflow for coaches (one less click)
- Most common use case is clicking a game to start managing it
- Team management moved to dedicated Management section
- Cleaner separation of concerns (operations vs. admin)

### 4. Reactive Data with observeQuery()
**Decision**: Use `observeQuery()` in GameManagement and SeasonReport

**Rationale**:
- DynamoDB eventual consistency requires reactive patterns
- Game data changes frequently during active games
- Season reports need to update as games complete
- Prevents stale data issues in critical views

### 5. Position References via FormationPosition
**Decision**: LineupAssignment and PlayTimeRecord reference FormationPosition, not custom positions

**Rationale**:
- Ensures consistency with team's formation
- Position data persists even if formation is modified later
- Enables accurate reporting of which position player occupied
- Simplifies lineup validation (can only assign to formation positions)

### 6. PlayTimeRecord Granularity
**Decision**: Store individual enter/exit records rather than aggregated totals

**Rationale**:
- Provides complete audit trail of all substitutions
- Enables detailed analysis (when did player play, how long in each position)
- Supports future features (substitution patterns, position heatmaps)
- Can aggregate for summary views in reports

### 7. Progressive Web App (PWA)
**Decision**: Build as installable PWA with offline capabilities

**Rationale**:
- Coaches need access on sideline (potentially poor connectivity)
- Mobile-first design for phone/tablet use
- Native app experience without app store complexity
- Service worker caching for offline game management

### 8. Mobile-First Responsive Design
**Decision**: Horizontally scrollable tabs with hidden scrollbar on mobile

**Rationale**:
- Limited screen width on phones requires space-efficient navigation
- Swipe gestures natural on mobile devices
- Hidden scrollbar reduces visual clutter while maintaining functionality
- Negative margins provide edge-to-edge feel

## Technology Stack

### Frontend
- **React**: 18.2.0
- **TypeScript**: 5.5.3
- **Vite**: 5.4.10 (build tool)
- **PWA Plugin**: @vite-pwa/vite-plugin
- **Service Worker**: Workbox

### Backend (AWS Amplify Gen2)
- **Authentication**: Amazon Cognito
- **API**: AWS AppSync (GraphQL)
- **Database**: Amazon DynamoDB
- **Hosting**: AWS Amplify Hosting
- **File Storage**: Amazon S3 (for static assets)

### Development Tools
- **Testing**: 
  - Vitest (unit tests)
  - Playwright (E2E tests)
- **Linting**: ESLint
- **Package Manager**: npm

### Deployment
- **CI/CD**: AWS Amplify Hosting (automatic deploys from git)
- **Environments**: Separate backend environments per git branch
- **Domain**: Custom domain support via Amplify Hosting

---

## Future Considerations

### Potential Enhancements
1. **Multi-user Teams**: Allow assistant coaches to collaborate on team management
2. **Advanced Analytics**: Heat maps, substitution patterns, position optimization
3. **Export/Import**: Season data backup and migration
4. **Offline Sync**: Full offline game management with background sync
5. **Communication**: Team announcements, game reminders
6. **Photo Upload**: Player photos, action shots during games

### Scalability Notes
- Current architecture supports unlimited users (data isolated by userId)
- DynamoDB auto-scales with usage
- Cognito handles authentication at scale
- AppSync provides GraphQL query optimization and caching

### Technical Debt
- **PlayTime Calculation**: 45m + 45m currently shows 50m instead of 1h 30m (needs investigation)
- **TeamManagement.tsx**: File exists but redundant, consider removal
- **Debug Logging**: Some console.log statements remain in SeasonReport
- **Test Flakiness**: E2E tests require explicit waits for eventual consistency

---

**Document Maintained By**: Development Team  
**Last Review**: December 12, 2025  
**Next Review**: As needed for major architectural changes
