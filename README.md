# TeamTrack

**A Game Management App for Coaches and Team Managers**

A progressive web app (PWA) designed for coaches to manage teams, players, and game day operations. Built with React, TypeScript, Vite, and AWS Amplify Gen2.

## Overview

TeamTrack helps coaches organize their teams and manage games from the sideline. Track lineups, monitor play time, make substitutions, and ensure fair playing time distribution across your roster—all from your mobile device or desktop.

## Features

### Team Management
- **Season Organization**: Create and manage multiple seasons
- **Formation Templates**: Define reusable formations with position abbreviations and names
- **Global Player Pool**: Manage all players across teams with central player database
- **Team Rosters**: Assign players to teams with jersey numbers and preferred positions
- **Roster Editing**: Edit player details, numbers, and position preferences directly from team rosters

### Game Day Management
- **Game Scheduling**: Track upcoming games with opponent, home/away status, and date/time
- **Game Timer**: Automatic timer with configurable half lengths (default 30 minutes)
- **Auto-Pause**: Timer automatically pauses at halftime
- **Position-Based Lineup**: Assign players to specific positions on the field

### Play Time Tracking
- **Automatic Tracking**: Records start/end times for each player in each position
- **Live Display**: Shows current play time for active players during the game
- **Substitution Management**: Easy substitution interface with play time visibility
- **Fair Play Statistics**: View total play time per player to ensure equitable distribution
- **Position History**: Track which positions each player has played

### Season Reports
- **Team Statistics**: View cumulative stats across all games in a season
- **Player Details**: Drill down into individual player performance
- **Play Time by Position**: See where each player has played and for how long
- **Goals & Assists**: Track scoring statistics and gold stars
- **Real-time Updates**: Reports automatically update as games are played

## Technology Stack

- **Frontend**: React 18.2.0 + TypeScript
- **Build Tool**: Vite 5.4.10 with PWA plugin
- **Backend**: AWS Amplify Gen2
- **Authentication**: Amazon Cognito
- **API**: GraphQL endpoint with AWS AppSync
- **Database**: Real-time database powered by Amazon DynamoDB
- **Hosting**: AWS Amplify Hosting

## Getting Started

### Prerequisites
- Node.js (v18 or later)
- npm or yarn
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

### Using the App

1. **Sign up/Sign in** using the authentication form
2. **Create a Season** to organize your coaching year
3. **Create a Formation** template with positions (e.g., GK, LB, CB, RB, CM, FWD, etc.)
4. **Add a Team** with formation, field size, and half length
5. **Add Players** to the global player pool
6. **Build Team Roster** by assigning players with jersey numbers and preferred positions
7. **Schedule Games** from the Home page with opponent, location, and date/time
8. **Manage Game Day**:
   - Click the game to open game management
   - Assign starting lineup by position
   - Start the game timer
   - Make substitutions during the game
   - View live play time statistics
   - Record goals and game notes
   - End game when complete
9. **View Season Reports** to analyze player statistics and play time distribution

## Data Models

- **Season**: Container for teams in a specific time period
- **Formation**: Reusable position templates (e.g., 4-3-3, 3-3-1)
- **FormationPosition**: Individual positions within a formation (abbreviation, name)
- **Team**: Configuration and formation reference (name, field size, half length)
- **Player**: Global player pool (first name, last name)
- **TeamRoster**: Junction table linking players to teams with jersey numbers and preferred positions
- **Game**: Scheduled matches with opponent, location, and date/time
- **LineupAssignment**: Current player-to-position assignments for a game
- **Goal**: Goal records with scorer, assists, and game time
- **GameNote**: Game events (gold stars, yellow/red cards)
- **PlayTimeRecord**: Granular tracking of when players enter/exit positions with game seconds

## Deploying to AWS

For detailed instructions on deploying your application, refer to the [deployment section](https://docs.amplify.aws/react/start/quickstart/#deploy-a-fullstack-app-to-aws) of the Amplify documentation.

### Quick Deploy
```bash
npm run deploy
```

## Progressive Web App (PWA)

This app is installable on mobile devices and desktops:
- **iOS**: Open in Safari, tap Share → Add to Home Screen
- **Android**: Open in Chrome, tap menu → Install App
- **Desktop**: Look for the install icon in the browser address bar