import { useState, useEffect } from "react";
import { useAuthenticator } from '@aws-amplify/ui-react';
import { generateClient } from "aws-amplify/data";
import { Home } from "./components/Home";
import { GameManagement } from "./components/GameManagement";
import { GamePlanner } from "./components/GamePlanner";
import { UserProfile } from "./components/UserProfile";
import { TeamReport } from "./components/SeasonReport";
import { Management } from "./components/Management";
import InvitationAcceptance from "./components/InvitationAcceptance";
import type { Schema } from "../amplify/data/resource";
import { trackPageView } from "./utils/analytics";
import "./App.css";

const client = generateClient<Schema>();

type Team = Schema['Team']['type'];
type Game = Schema['Game']['type'];
type NavigationTab = 'home' | 'reports' | 'manage' | 'profile';

function App() {
  const { signOut } = useAuthenticator();
  const handleSignOut = () => {
    console.log('Sign out requested');
    signOut();
  };
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [planningGame, setPlanningGame] = useState<Game | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [activeNav, setActiveNav] = useState<NavigationTab>('home');
  
  // Track page views when navigation changes
  useEffect(() => {
    if (selectedGame) {
      trackPageView('/game-management');
    } else {
      trackPageView(`/${activeNav}`);
    }
  }, [activeNav, selectedGame]);

  // Initialize invitation ID directly from URL
  const getInvitationIdFromUrl = () => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('invitationId');
  };
  const [invitationId, setInvitationId] = useState<string | null>(getInvitationIdFromUrl());

  const handleGameSelect = (game: Game, team: Team) => {
    setSelectedGame(game);
    setSelectedTeam(team);
    setPlanningGame(null);
  };

  const handlePlanGame = (game: Game, team: Team) => {
    setPlanningGame(game);
    setSelectedTeam(team);
    setSelectedGame(null);
  };

  const handleBackToHome = () => {
    setSelectedGame(null);
    setPlanningGame(null);
    setSelectedTeam(null);
    localStorage.removeItem('activeGame');
  };

  // Restore navigation state from localStorage on mount
  useEffect(() => {
    const restoreState = async () => {
      try {
        const activeGameData = localStorage.getItem('activeGame');
        if (activeGameData) {
          const { teamId, gameId } = JSON.parse(activeGameData);
          
          const teamResponse = await client.models.Team.get({ id: teamId });
          const gameResponse = await client.models.Game.get({ id: gameId });
          
          if (teamResponse.data && gameResponse.data) {
            setSelectedTeam(teamResponse.data as Team);
            setSelectedGame(gameResponse.data as Game);
          }
        }
      } catch (error) {
        console.error('Error restoring state:', error);
        localStorage.removeItem('activeGame');
      } finally {
        setIsRestoring(false);
      }
    };

    restoreState();
  }, []);

  const handleInvitationComplete = () => {
    // Remove invitation ID from URL and state
    setInvitationId(null);
    window.history.replaceState({}, '', window.location.pathname);
    // Refresh the page to reload teams
    window.location.reload();
  };

  if (isRestoring) {
    return (
      <main className="app-container">
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <p>Loading...</p>
        </div>
      </main>
    );
  }

  // Show invitation acceptance UI if invitationId is present
  if (invitationId) {
    console.log('Rendering invitation acceptance UI for:', invitationId);
    return (
      <main className="app-container">
        <header className="app-header">
          <div className="app-branding">
            <h1>⚽ TeamTrack</h1>
            <p className="app-tagline">Game Management for Coaches</p>
          </div>
        </header>
        <InvitationAcceptance 
          invitationId={invitationId} 
          onComplete={handleInvitationComplete}
        />
      </main>
    );
  }

  return (
    <main className="app-container">
      <header className="app-header">
        <div className="app-branding">
          <h1>⚽ TeamTrack</h1>
          <p className="app-tagline">Game Management for Coaches</p>
        </div>
      </header>

      {activeNav === 'home' && !selectedGame && !planningGame && (
        <Home 
          onGameSelect={handleGameSelect}
          onPlanGame={handlePlanGame}
        />
      )}

      {activeNav === 'home' && selectedGame && selectedTeam && !planningGame && (
        <GameManagement
          game={selectedGame}
          team={selectedTeam}
          onBack={handleBackToHome}
        />
      )}

      {activeNav === 'home' && planningGame && selectedTeam && !selectedGame && (
        <GamePlanner
          game={planningGame}
          team={selectedTeam}
          onBack={handleBackToHome}
        />
      )}

      {activeNav === 'reports' && selectedTeam && (
        <TeamReport team={selectedTeam} />
      )}

      {activeNav === 'reports' && !selectedTeam && (
        <div className="empty-state">
          <p>Please select a game from the Home tab to view reports for that team.</p>
        </div>
      )}

      {activeNav === 'manage' && (
        <Management />
      )}

      {activeNav === 'profile' && (
        <UserProfile onSignOut={handleSignOut} />
      )}

      <nav className="bottom-nav">
        <button 
          className={`nav-item ${activeNav === 'home' ? 'active' : ''}`}
          onClick={() => setActiveNav('home')}
          aria-label="Games"
        >
          <span className="nav-icon">⚽</span>
          <span className="nav-label">Games</span>
        </button>
        <button 
          className={`nav-item ${activeNav === 'reports' ? 'active' : ''}`}
          onClick={() => setActiveNav('reports')}
          aria-label="Reports"
          disabled={!selectedTeam}
        >
          <span className="nav-icon">📊</span>
          <span className="nav-label">Reports</span>
        </button>
        <button 
          className={`nav-item ${activeNav === 'manage' ? 'active' : ''}`}
          onClick={() => setActiveNav('manage')}
          aria-label="Manage"
        >
          <span className="nav-icon">⚙️</span>
          <span className="nav-label">Manage</span>
        </button>
        <button 
          className={`nav-item ${activeNav === 'profile' ? 'active' : ''}`}
          onClick={() => setActiveNav('profile')}
          aria-label="Profile"
        >
          <span className="nav-icon">👤</span>
          <span className="nav-label">Profile</span>
        </button>
      </nav>
    </main>
  );
}

export default App;
