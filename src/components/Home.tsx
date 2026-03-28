import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import type { Game } from '../types/schema';
import { showError, showWarning, showSuccess } from '../utils/toast';
import { trackEvent, AnalyticsEvents } from '../utils/analytics';
import { handleApiError } from '../utils/errorHandler';
import { useAmplifyQuery } from '../hooks/useAmplifyQuery';
import { useHelpFab } from '../contexts/HelpFabContext';
import { buildFlatDebugSnapshot } from '../utils/debugUtils';
import type { HomeDebugContext } from '../types/debug';
import { useOnboarding } from '../contexts/OnboardingContext';
import { createDemoTeam, removeDemoData } from '../services/demoDataService';
import { WelcomeModal } from './Onboarding/WelcomeModal';
import { QuickStartChecklist } from './Onboarding/QuickStartChecklist';

const client = generateClient<Schema>();

export function Home() {
  const navigate = useNavigate();
  const { user, authStatus } = useAuthenticator((context) => [context.user, context.authStatus]);
  const { setHelpContext, setDebugContext } = useHelpFab();
  const { welcomed, dismissed, collapsed, markWelcomed, expand, dismiss } = useOnboarding();

  // Register 'home' help context while this screen is mounted
  useEffect(() => {
    setHelpContext('home');
    return () => setHelpContext(null);
  }, [setHelpContext]);

  const [isCreatingGame, setIsCreatingGame] = useState(false);
  const [selectedTeamForGame, setSelectedTeamForGame] = useState('');
  const [opponent, setOpponent] = useState('');
  const [gameDate, setGameDate] = useState('');
  const [isHome, setIsHome] = useState(true);
  const [isDemoLoading, setIsDemoLoading] = useState(false);

  const scheduleGameButtonRef = useRef<HTMLButtonElement>(null);

  const currentUserId = user?.userId;

  // Subscribe to teams, roster, and gamePlans for onboarding progress
  const { data: teams, isSynced: isTeamsSynced } = useAmplifyQuery('Team');

  // Auto-welcome users who already had teams before the onboarding feature launched.
  // Once teams have fully synced and the user has at least one team, skip the WelcomeModal.
  // This prevents existing coaches from accidentally loading unwanted demo data.
  useEffect(() => {
    if (!welcomed && isTeamsSynced && teams.length > 0) {
      markWelcomed();
    }
  }, [welcomed, isTeamsSynced, teams.length, markWelcomed]);

  const { data: teamRosters } = useAmplifyQuery('TeamRoster');
  // Only subscribe to GamePlan if onboarding is not dismissed (optimization)
  const { data: gamePlans } = useAmplifyQuery('GamePlan', {}, [dismissed ? 'skip' : '']);

  const { data: games } = useAmplifyQuery('Game', {
    sort: (a, b) => {
      const statusA = a.status || 'scheduled';
      const statusB = b.status || 'scheduled';

      const getPriority = (status: string) => {
        if (status === 'in-progress' || status === 'halftime') return 1;
        if (status === 'scheduled') return 2;
        return 3; // completed
      };

      const priorityA = getPriority(statusA);
      const priorityB = getPriority(statusB);

      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }

      // Within same priority, sort by date
      const dateA = a.gameDate ? new Date(a.gameDate).getTime() : 0;
      const dateB = b.gameDate ? new Date(b.gameDate).getTime() : 0;

      if (statusA === 'completed') {
        // Completed: most recent first
        if (!dateA) return 1;
        if (!dateB) return -1;
        return dateB - dateA;
      }

      // In-progress/scheduled: upcoming first
      return dateB - dateA;
    },
  });

  const homeDebugContext = useMemo((): HomeDebugContext => ({
    teamCount: teams.length,
    gameCount: games.length,
    scheduledCount: games.filter(g => g.status === 'scheduled' || !g.status).length,
    inProgressCount: games.filter(g => g.status === 'in-progress' || g.status === 'halftime').length,
    completedCount: games.filter(g => g.status === 'completed').length,
    isCreatingGame,
  }), [teams, games, isCreatingGame]);

  const homeDebugSnapshot = useMemo(
    () => buildFlatDebugSnapshot('Home Debug Snapshot', { ...homeDebugContext }),
    [homeDebugContext]
  );

  useEffect(() => {
    setDebugContext(homeDebugSnapshot);
    return () => setDebugContext(null);
  }, [homeDebugSnapshot, setDebugContext]);

  // Read demo team ID from localStorage
  const demoTeamId = typeof window !== 'undefined' ? localStorage.getItem('onboarding:demoTeamId') : null;

  // Handle demo data loading
  const handleLoadDemoData = async () => {
    if (!navigator.onLine) {
      showError('Demo data requires an internet connection');
      return;
    }

    setIsDemoLoading(true);
    try {
      await createDemoTeam(currentUserId);
      showSuccess('Demo team created!');
      markWelcomed();
      expand();
    } catch (error) {
      handleApiError(error, 'Failed to create demo team');
    } finally {
      setIsDemoLoading(false);
    }
  };

  const handleRemoveDemoData = async () => {
    if (!demoTeamId) return;
    try {
      await removeDemoData(demoTeamId);
    } catch (error) {
      handleApiError(error, 'Failed to remove demo data');
      throw error; // re-throw so checklist stays open if removal fails
    }
  };

  // Handle navigation from checklist
  const handleNavigateFromChecklist = (stepId: number) => {
    switch (stepId) {
      case 1:
        void navigate('/manage?section=teams');
        break;
      case 2:
        void navigate('/manage?section=players');
        break;
      case 3:
        void navigate('/manage?section=teams');
        break;
      case 4:
        // Scroll to Schedule Game button
        scheduleGameButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        scheduleGameButtonRef.current?.focus();
        break;
      case 5: {
        // Navigate to first scheduled game's plan
        const firstScheduledGame = games.find(g => (g.status || 'scheduled') === 'scheduled');
        if (firstScheduledGame) {
          void navigate(`/game/${firstScheduledGame.id}/plan`);
        }
        break;
      }
      case 6: {
        // Navigate to first in-progress or scheduled game
        const firstGame = games.find(g => g.status === 'in-progress' || g.status === 'halftime') ||
                          games.find(g => (g.status || 'scheduled') === 'scheduled');
        if (firstGame) {
          void navigate(`/game/${firstGame.id}`);
        } else {
          // Fallback: scroll to step 4 button
          scheduleGameButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          scheduleGameButtonRef.current?.focus();
        }
        break;
      }
    }
  };

  const handleOpenQuickStart = () => {
    markWelcomed();
    expand();
  };

  const getTeam = (teamId: string) => {
    return teams.find(t => t.id === teamId);
  };

  const handleCreateGame = async () => {
    if (!opponent.trim() || !selectedTeamForGame) {
      showWarning('Please enter opponent name and select a team');
      return;
    }

    try {
      const team = teams.find(t => t.id === selectedTeamForGame);
      if (!team) {
        showError('Team not found');
        return;
      }

      // Ensure current user is included in coaches array
      // This handles cases where the team data might be slightly stale
      // and not yet reflect the user's addition to the coaches array
      const coachesArray = currentUserId && team.coaches && !team.coaches.includes(currentUserId)
        ? [...team.coaches, currentUserId]
        : team.coaches || [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gameData: any = {
        teamId: selectedTeamForGame,
        opponent,
        isHome,
        coaches: coachesArray,
      };

      if (gameDate) {
        gameData.gameDate = new Date(gameDate).toISOString();
      }

      await client.models.Game.create(gameData);
      setOpponent('');
      setGameDate('');
      setIsHome(true);
      setSelectedTeamForGame('');
      setIsCreatingGame(false);
      trackEvent(AnalyticsEvents.GAME_CREATED.category, AnalyticsEvents.GAME_CREATED.action);
      console.log('✓ Game created successfully:', gameData);
    } catch (error) {
      handleApiError(error, 'Failed to create game');
    }
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    
    // Compare calendar dates, not time differences
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const nowOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffMs = dateOnly.getTime() - nowOnly.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return `Today at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } else if (diffDays === 1) {
      return `Tomorrow at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } else if (diffDays === -1) {
      return `Yesterday at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } else if (diffDays > 1 && diffDays < 7) {
      return date.toLocaleDateString('en-US', { 
        weekday: 'long',
        hour: 'numeric',
        minute: '2-digit'
      });
    }
    
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (status: string | null | undefined) => {
    if (!status || status === 'scheduled') return '📅 Scheduled';
    if (status === 'in-progress') return '⚽ In Progress';
    if (status === 'halftime') return '⏸️ Halftime';
    if (status === 'completed') return '✅ Completed';
    return status;
  };

  const handleGameClick = (game: Game) => {
    const team = getTeam(game.teamId);
    // Amplify model instances contain lazy-loader functions for relations
    // which cannot be structured-cloned by history.pushState. JSON round-trip
    // strips those non-serializable properties.
    void navigate(`/game/${game.id}`, {
      state: JSON.parse(JSON.stringify({ game, team: team || null })),
    });
  };

  const handlePlanClick = (game: Game) => {
    const team = getTeam(game.teamId);
    void navigate(`/game/${game.id}/plan`, {
      state: JSON.parse(JSON.stringify({ game, team: team || null })),
    });
  };

  // Group games by status
  const inProgressGames = games.filter(g => {
    const status = g.status || 'scheduled';
    return status === 'in-progress' || status === 'halftime';
  });
  const scheduledGames = games.filter(g => (g.status || 'scheduled') === 'scheduled');
  const completedGames = games.filter(g => g.status === 'completed');

  // Guard: user object may be undefined briefly during the authenticated→app
  // transition (Amplify Authenticator context race).
  if (!user) {
    if (authStatus !== 'authenticated') return null;
    // Auth confirmed but user object not yet populated — show loading state
    return <div className="loading-state" aria-label="Loading..." role="status">Loading...</div>;
  }

  return (
    <div className="home">
      {/* Show WelcomeModal only once we know the user has no existing teams,
          preventing a flash for existing users being auto-welcomed */}
      {!welcomed && isTeamsSynced && (
        <WelcomeModal
          onClose={markWelcomed}
          onLoadDemoData={handleLoadDemoData}
          onOpenQuickStart={handleOpenQuickStart}
          isDemoLoading={isDemoLoading}
        />
      )}

      {/* Show QuickStartChecklist if not dismissed */}
      {!dismissed && welcomed && (
        <QuickStartChecklist
          teams={teams}
          games={games}
          teamRosters={teamRosters}
          gamePlans={gamePlans}
          collapsed={collapsed}
          demoTeamId={demoTeamId}
          onDismiss={dismiss}
          onExpand={expand}
          onNavigate={handleNavigateFromChecklist}
          onRemoveDemoData={demoTeamId ? handleRemoveDemoData : undefined}
        />
      )}

      {!isCreatingGame && (
        <button
          ref={scheduleGameButtonRef}
          onClick={() => setIsCreatingGame(true)}
          className="btn-primary"
        >
          + Schedule New Game
        </button>
      )}

      {isCreatingGame && (
        <div className="create-form">
          <h3>Schedule New Game</h3>
          <select
            value={selectedTeamForGame}
            onChange={(e) => setSelectedTeamForGame(e.target.value)}
          >
            <option value="">Select Team *</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Opponent Team Name *"
            value={opponent}
            onChange={(e) => setOpponent(e.target.value)}
          />
          <input
            type="datetime-local"
            value={gameDate}
            onChange={(e) => setGameDate(e.target.value)}
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={isHome}
              onChange={(e) => setIsHome(e.target.checked)}
            />
            Home Game
          </label>
          <div className="form-actions">
            <button onClick={handleCreateGame} className="btn-primary">
              Create
            </button>
            <button
              onClick={() => {
                setIsCreatingGame(false);
                setOpponent('');
                setGameDate('');
                setIsHome(true);
                setSelectedTeamForGame('');
              }}
              className="btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {games.length === 0 && !isCreatingGame && (
        <div className="empty-state">
          <p>No games scheduled yet.</p>
          <p>Click the button above to schedule your first game, or go to the Manage tab to create seasons and teams.</p>
        </div>
      )}

      {inProgressGames.length > 0 && (
        <div className="games-group">
          <h3 className="games-group-title">Active Games</h3>
          {inProgressGames.map((game) => {
            const team = getTeam(game.teamId);
            if (!team) return null;
            
            return (
              <div 
                key={game.id} 
                className="game-card active-game"
                onClick={() => handleGameClick(game)}
              >
                <div className="game-status">
                  {getStatusBadge(game.status)}
                </div>
                <div className="game-info">
                  <h4>{team.name} vs {game.opponent}</h4>
                  <p className="game-meta">
                    {game.isHome ? '🏠 Home' : '✈️ Away'}
                    {game.gameDate && ` • ${formatDate(game.gameDate)}`}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {scheduledGames.length > 0 && (
        <div className="games-group">
          <h3 className="games-group-title">Upcoming Games</h3>
          {scheduledGames.map((game) => {
            const team = getTeam(game.teamId);
            if (!team) return null;
            
            return (
              <div 
                key={game.id} 
                className="game-card"
              >
                <div 
                  className="game-card-content"
                  onClick={() => handleGameClick(game)}
                >
                  <div className="game-status">
                    {getStatusBadge(game.status)}
                  </div>
                  <div className="game-info">
                    <h4>{team.name} vs {game.opponent}</h4>
                    <p className="game-meta">
                      {game.isHome ? '🏠 Home' : '✈️ Away'}
                      {game.gameDate && ` • ${formatDate(game.gameDate)}`}
                    </p>
                  </div>
                </div>
                <div className="game-card-actions">
                    <button
                      className="plan-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlanClick(game);
                      }}
                    >
                      📋 Plan Game
                    </button>
                    <button
                      className="open-game-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        trackEvent(AnalyticsEvents.GAME_OPENED.category, AnalyticsEvents.GAME_OPENED.action);
                        handleGameClick(game);
                      }}
                    >
                      ▶ Open Game
                    </button>
                  </div>
              </div>
            );
          })}
        </div>
      )}

      {completedGames.length > 0 && (
        <div className="games-group">
          <h3 className="games-group-title">Past Games</h3>
          {completedGames.map((game) => {
            const team = getTeam(game.teamId);
            if (!team) return null;
            
            return (
              <div 
                key={game.id} 
                className="game-card completed-game"
                onClick={() => handleGameClick(game)}
              >
                <div className="game-status">
                  {getStatusBadge(game.status)}
                </div>
                <div className="game-info">
                  <h4>{team.name} vs {game.opponent}</h4>
                  <p className="game-meta">
                    {game.isHome ? '🏠 Home' : '✈️ Away'}
                    {game.gameDate && ` • ${formatDate(game.gameDate)}`}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
