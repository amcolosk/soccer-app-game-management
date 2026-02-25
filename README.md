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
- **Multi-Coach Sharing**: Invite other coaches to co-manage a team via email invitations

### Pre-Game Planning
- **Player Availability**: Mark players as available, absent, or late before each game
- **Game Planner**: Build a pre-game rotation plan with configurable rotation intervals
- **Lineup Builder**: Drag-and-drop interface to assign players to positions for each rotation slot
- **Fair Rotation Algorithm**: Automatically generate balanced rotation plans that distribute play time equitably based on player availability and preferred positions

### Game Day Management
- **Game Timer**: Automatic timer with configurable half lengths
- **Auto-Pause at Halftime**: Timer pauses when the half ends; resume manually to start the second half
- **Position-Based Lineup**: Assign players to specific positions on the field
- **Substitution Management**: Easy substitution interface with live play time visibility
- **Halftime Lineup Changes**: Modify the lineup between halves
- **Score Tracking**: Record goals with scorer, assist, and game time
- **Game Notes**: Log events such as gold stars and cards

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
npm run lint         # Lint TypeScript/TSX files
```

### Using the App

1. **Sign up / Sign in** at [coachteamtrack.com](https://coachteamtrack.com) or on your local dev server
2. **Create a Formation** template with positions (e.g., GK, LB, CB, RB, CM, FWD)
3. **Add a Team** with formation, field size, and half length
4. **Add Players** to the global player pool
5. **Build Your Roster**: Assign players to the team with jersey numbers and preferred positions (filter by birth year to find the right players quickly)
6. **Invite Co-Coaches** if needed — they'll receive an email invitation and gain full access to the team
7. **Schedule Games** from the Games tab with opponent, location, and date/time
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
- **Game**: Scheduled matches with opponent, location, timer state, and score
- **GamePlan / PlannedRotation**: Pre-game rotation strategy
- **LineupAssignment**: Player-to-position assignments for a game
- **Substitution**: Records when a player enters/exits a position
- **PlayTimeRecord**: Granular tracking (player, position, start/end game seconds)
- **Goal / GameNote**: Scoring and event records
- **TeamInvitation**: Email-based coach invitations with status tracking

## Deploying to AWS

Refer to the [Amplify Gen2 deployment docs](https://docs.amplify.aws/react/start/quickstart/#deploy-a-fullstack-app-to-aws) for full instructions.

## Progressive Web App

TeamTrack is installable on any device:
- **iOS**: Open in Safari → Share → Add to Home Screen
- **Android**: Open in Chrome → menu → Install App
- **Desktop**: Click the install icon in your browser's address bar
