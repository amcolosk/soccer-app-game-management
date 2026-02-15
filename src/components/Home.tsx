import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateClient } from 'aws-amplify/data';
import { getCurrentUser } from 'aws-amplify/auth';
import type { Schema } from '../../amplify/data/resource';
import type { Game, Team } from '../types/schema';
import { showError, showWarning } from '../utils/toast';
import { handleApiError, logError } from '../utils/errorHandler';
import { useAmplifyQuery } from '../hooks/useAmplifyQuery';

const client = generateClient<Schema>();

export function Home() {
  const navigate = useNavigate();
  const [teams, setTeams] = useState<Team[]>([]);
  const [isCreatingGame, setIsCreatingGame] = useState(false);
  const [selectedTeamForGame, setSelectedTeamForGame] = useState('');
  const [opponent, setOpponent] = useState('');
  const [gameDate, setGameDate] = useState('');
  const [isHome, setIsHome] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string>('');

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

  useEffect(() => {
    loadCurrentUser();
    loadTeams();
  }, []);

  async function loadCurrentUser() {
    try {
      const user = await getCurrentUser();
      setCurrentUserId(user.userId);
    } catch (error) {
      logError('getCurrentUser', error);
    }
  }

  async function loadTeams() {
    try {
      const teamsResponse = await client.models.Team.list();
      setTeams(teamsResponse.data || []);
    } catch (error) {
      handleApiError(error, 'Failed to load teams');
    }
  }

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
    navigate(`/game/${game.id}`, {
      state: JSON.parse(JSON.stringify({ game, team: team || null })),
    });
  };

  const handlePlanClick = (game: Game) => {
    const team = getTeam(game.teamId);
    navigate(`/game/${game.id}/plan`, {
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

  return (
    <div className="home">

      {!isCreatingGame && (
        <button onClick={() => setIsCreatingGame(true)} className="btn-primary">
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
