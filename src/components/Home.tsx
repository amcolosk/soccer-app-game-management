import { useState, useEffect } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

type Game = Schema['Game']['type'];
type Team = Schema['Team']['type'];

interface HomeProps {
  onGameSelect: (game: Game, team: Team) => void;
}

export function Home({ onGameSelect }: HomeProps) {
  const [games, setGames] = useState<Game[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  useEffect(() => {
    const gameSub = client.models.Game.observeQuery().subscribe({
      next: (data) => {
        // Sort games: in-progress/halftime first, then scheduled, then completed
        const sortedGames = [...data.items].sort((a, b) => {
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
        });
        setGames(sortedGames);
      },
    });

    const teamSub = client.models.Team.observeQuery().subscribe({
      next: (data) => setTeams([...data.items]),
    });

    return () => {
      gameSub.unsubscribe();
      teamSub.unsubscribe();
    };
  }, []);

  const getTeam = (teamId: string) => {
    return teams.find(t => t.id === teamId);
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

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
    if (team) {
      onGameSelect(game, team);
    }
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
      <h2>🏠 Home</h2>

      {games.length === 0 && (
        <div className="empty-state">
          <p>No games scheduled yet.</p>
          <p>Go to the <strong>Manage</strong> tab to create seasons, teams, and games.</p>
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
