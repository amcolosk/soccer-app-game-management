# TeamTrack

**A Game Management App for Coaches and Team Managers**

A progressive web app (PWA) designed for coaches to manage teams, players, and game day operations. Built with React, TypeScript, Vite, and AWS Amplify Gen2.

**Live at [coachteamtrack.com](https://coachteamtrack.com)**

## Overview

TeamTrack helps coaches organize their teams and manage games from the sideline. Track lineups, monitor play time, make substitutions, and ensure fair playing time distribution across your roster—all from your mobile device or desktop.

## Features

### Team & Roster Management
- **Formation Templates**: Define reusable formations with position abbreviations and names (e.g., 4-3-3, 3-3-1)
- **Global Player Pool**: Manage all players across teams with a central player database
- **Team Rosters**: Assign players to teams with jersey numbers and preferred positions
- **Birth Year Filtering**: Filter the player pool by one or more birth years when adding players to a roster
- **Roster Editing**: Edit player details, numbers, and position preferences directly from team rosters
- **Multi-Coach Sharing**: Invite other coaches to co-manage a team via email invitations; removing a coach cascades server-side, revoking their access to that team's roster, lineup positions, and games, and closing the invitation-reversibility hole for a target with at least one accepted invitation on the team (see `docs/SHARING-PERMISSIONS.md`)

### Calendar Feed Import
- **Link a Team Calendar**: Import a schedule from a PlayMetrics (or generic RFC-5545) `.ics` feed by URL, or upload an `.ics` file directly
- **Preview Before Applying**: A dry-run shows exactly what will change — games created, updated, linked from hand-entered games, or flagged cancelled — before anything is written
- **Auto-Sync, Protect Live Games**: Re-syncing never touches a game that's in progress or completed; a game the feed marks cancelled is flagged, never deleted
- **Adopts Hand-Entered Games**: A game already typed in that matches a feed event gets linked to the feed instead of duplicated
- **Secure by Design**: The feed URL is stored as a Lambda-only secret no client can read back — only the hostname is ever shown

### Pre-Game Planning
- **Player Availability**: Mark players as available, absent, or late before each game
- **Game Planner**: Build a pre-game rotation plan with configurable rotation intervals
- **Lineup Builder**: Drag-and-drop interface to assign players to positions for each rotation slot
- **Fair Rotation Algorithm**: Automatically generate balanced rotation plans that distribute play time equitably based on player availability and preferred positions

### Game Day Management
- **Game Timer**: Automatic timer with configurable half lengths
- **Auto-Pause at Halftime**: Timer pauses when the half ends; resume manually to start the second half
- **Timer Gap Confirmation**: If a device loses timer continuity (crash, backgrounding, browser close) and comes back to an anomalous elapsed-time gap, the coach is asked to confirm or adjust it before it's applied
- **Position-Based Lineup**: Assign players to specific positions on the field
- **Substitution Management**: Easy substitution interface with live play time visibility
- **Halftime Lineup Changes**: Modify the lineup between halves
- **Score Tracking**: Record goals with scorer, assist, and game time
- **Unified Shot Outcome Tracking**: Log a shot for either team via a single "Log Shot – Us"/"Log Shot – Them" entry point, then pick what happened — Goal, Saved, Blocked, or Wide — which drives one Shot record plus (for Goal/Saved) a linked Goal or Save record; picking a shooter is optional (skippable) for both an "Us" Goal and an "Us" Shot of any outcome. A Saved-by-us keeper field is pre-populated with the current on-field goalkeeper when unambiguous, still an overridable/clearable picker. The Goals and Shots/Saves lists remain separate, read-only-entry tabs (list/edit/delete only) fed by this one flow
- **Game Notes**: Log events such as gold stars and cards

### Fan Mode (public read-only live game view)
- **One persistent public link per team**: generate/copy/revoke a `/watch/:token` link from Sharing & Permissions — no account needed to view it
- **Live score, clock, and lineup**: a fan opens the link and sees the current score, running game clock, half, on-field lineup (first name + last initial only), and a recent-events feed
- **State-aware**: distinguishes "game finished" (with the date), "next game" (with the scheduled date/time), and "no game right now" from an outright invalid/revoked link

### Sideline Stat Tracking (public helper-submitted stats)
- **A second, separate, write-capable link**: generate/copy/revoke a `/track/:token` link from Sharing & Permissions — lets a non-coach helper (parent/assistant) log stats from the sideline with no account needed
- **Unified shot-outcome tap flow**: tap "Log Shot – Us" or "Log Shot – Them", optionally pick the shooter (Us only, skippable), then pick the outcome — Goal, Saved, Blocked, or Wide. Blocked/Wide log immediately; Goal and Saved always route through an explicit confirm step first (with an assist step for an "Us" Goal). A "Them" Saved pre-populates the keeper field with the current on-field goalkeeper when unambiguous, still overridable via a full player picker
- **Real-time**: a logged stat appears live on the coach's own game screen, the same way a coach-entered one would — no refresh needed
- **Rows the coach logged are marked "Logged via helper"** in the Goals/Shots/Saves lists, and can be corrected or deleted from the coach's own tracker UI (the helper's page has no edit/undo)
- **Field-layout "On the Field" view**: on-field players render on a visual soccer pitch (reusing the coach app's lineup-shape layout), each shown as a jersey-number-forward node (e.g. "#8") with name and position abbreviation secondary — plus a separate **Bench** section for off-field players, and jersey numbers on the Goal/Shot/Save player-picker buttons too, so a helper can match a called-out number to a name at every step

### Play Time Tracking
- **Automatic Tracking**: Records start/end game seconds for each player in each position
- **Live Display**: Shows current play time for active players during the game
- **Fair Play Statistics**: View total play time per player to ensure equitable distribution
- **Position History**: Track which positions each player has played throughout a game

### Season Reports
- **Team Statistics**: Cumulative stats across all games in a season
- **Player Details**: Drill down into individual player performance
- **Play Time by Position**: See where each player has played and for how long
- **Goals & Assists**: Track scoring statistics and gold stars
- **Real-time Updates**: Reports automatically update as games are played

## Technology Stack

- **Frontend**: React 18 + TypeScript
- **Build Tool**: Vite with PWA plugin
- **Backend**: AWS Amplify Gen2
- **Authentication**: Amazon Cognito
- **API**: GraphQL with AWS AppSync
- **Database**: Amazon DynamoDB
- **Email**: Amazon SES (team invitation emails)
- **Hosting**: AWS Amplify Hosting

## Getting Started

### Prerequisites
- Node.js (v18 or later)
- npm
- AWS Account (for deployment)

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/amcolosk/soccer-app-game-management.git
   cd soccer-app-game-management
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the development server**
   ```bash
   npm run dev
   ```

4. **Open your browser**
   Navigate to `http://localhost:5173`

### Common Commands

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run test         # Run unit tests (watch mode)
npm run test:run     # Run unit tests once
npm run test:e2e     # Run E2E tests (Playwright)
npm run test:e2e:field-conditions  # WebKit + mobile-viewport E2E (pre-release lane, see e2e/README.md)
npm run lint         # Lint TypeScript/TSX files
```

### Using the App

1. **Sign up / Sign in** at [coachteamtrack.com](https://coachteamtrack.com) or on your local dev server
2. **Create a Formation** template with positions (e.g., GK, LB, CB, RB, CM, FWD)
3. **Add a Team** with formation, field size, and half length
4. **Add Players** to the global player pool
5. **Build Your Roster**: Assign players to the team with jersey numbers and preferred positions (filter by birth year to find the right players quickly)
6. **Invite Co-Coaches** if needed — they'll receive an email invitation and gain full access to the team
7. **Schedule Games** from the Games tab with opponent, location, and date/time — or **Import from Calendar** to link a PlayMetrics/`.ics` feed and populate the schedule automatically
8. **Pre-Game**:
   - Mark player availability (available / absent / late)
   - Use the Game Planner to build a rotation schedule
   - Drag players into positions in the Lineup Builder
9. **Game Day**:
   - Open the game and assign your starting lineup
   - Start the game timer
   - Make substitutions with play time visible for each player
   - Record goals and game notes
   - At halftime, adjust the lineup for the second half
   - End the game when complete
10. **Season Reports**: Analyze play time distribution and player statistics

## Data Model

- **Formation / FormationPosition**: Reusable position templates
- **Team**: Configuration, formation reference, and coach list
- **Player**: Global player pool (name, birth year, active status)
- **TeamRoster**: Links players to teams with jersey numbers and preferred positions
- **PlayerAvailability**: Per-game availability status for each player
- **Game**: Scheduled matches with opponent, location, timer state, and score — optionally carrying calendar-feed provenance (external UID, venue, arrive-by time, cancelled/adopted flags)
- **CalendarFeed**: A team's linked calendar feed URL (Lambda-only; never exposed to any client)
- **GamePlan / PlannedRotation**: Pre-game rotation strategy
- **LineupAssignment**: Player-to-position assignments for a game
- **Substitution**: Records when a player enters/exits a position
- **PlayTimeRecord**: Granular tracking (player, position, start/end game seconds)
- **Goal / GameNote**: Scoring and event records
- **Shot / Save**: Per-shot stat events (`outcome`: `GOAL`/`SAVED`/`BLOCKED`/`WIDE`) attributable to either team, plus per-save records linked only by shared `gameId`/`gameSeconds` (no foreign key) for an `outcome: SAVED` shot; both carry a `loggedVia` (`COACH`/`HELPER`) flag
- **TeamInvitation**: Email-based coach invitations with status tracking
- **ShareLink**: A public, unguessable token granting either `FAN` (read-only) or `STAT_TRACKER` (write) access to a team — Lambda-only, zero direct client grants
- **FanViewRateLimit**: Rate limiting shared by both public link types, keyed on the viewer's guest identity and the shared token, with a `dimension` prefix (`read` for Fan Mode's `getFanGameView`/Stat Tracker's `getStatTrackerView`, `write` for `submitStatEvent`'s own, tighter ceiling) so a helper's tapping and a fan's polling never share a budget; also doubles as `submitStatEvent`'s resumable idempotency row for a retried `clientEventId` (`pending` → `shot-written` → `succeeded`, released only once the whole write has made no progress, never mid-write)

## Deploying to AWS

Refer to the [Amplify Gen2 deployment docs](https://docs.amplify.aws/react/start/quickstart/#deploy-a-fullstack-app-to-aws) for full instructions.

## Progressive Web App

TeamTrack is installable on any device:
- **iOS**: Open in Safari → Share → Add to Home Screen
- **Android**: Open in Chrome → menu → Install App
- **Desktop**: Click the install icon in your browser's address bar
