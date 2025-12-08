# TeamTrack

**A Game Management App for Coaches and Team Managers**

A progressive web app (PWA) designed for coaches to manage teams, players, and game day operations. Built with React, TypeScript, Vite, and AWS Amplify Gen2.

## Overview

TeamTrack helps coaches organize their teams and manage games from the sideline. Track lineups, monitor play time, make substitutions, and ensure fair playing time distribution across your roster—all from your mobile device or desktop.

## Features

### Team Management
- **Season Organization**: Create and manage multiple seasons
- **Team Roster**: Maintain player information with jersey numbers
- **Field Positions**: Define custom formations with position abbreviations and names
- **Drag & Drop**: Reorder positions to match your preferred formation layout

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
3. **Add a Team** with the number of players allowed on field and half length
4. **Add Players** to your roster with jersey numbers
5. **Define Positions** for your formation (e.g., GK, LB, CB, RB, etc.)
6. **Schedule Games** with opponent, location, and date/time
7. **Manage Game Day**:
   - Assign starting lineup by position
   - Start the game timer
   - Make substitutions during the game
   - View play time statistics
   - End game when complete

## Data Models

- **Season**: Container for teams in a specific time period
- **Team**: Roster and configuration (name, field size, half length)
- **Player**: Individual athletes with jersey numbers and names
- **FieldPosition**: Positions in the formation (abbreviation, name, order)
- **Game**: Scheduled matches with opponent and location details
- **LineupAssignment**: Current player-to-position assignments for a game
- **Substitution**: Historical record of all substitutions made
- **PlayTimeRecord**: Granular tracking of when players enter/exit positions

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