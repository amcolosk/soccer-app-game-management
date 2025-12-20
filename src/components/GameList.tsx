import { useEffect, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

type Game = Schema["Game"]["type"];

interface GameListProps {
  teamId: string;
  onGameSelect: (game: Game) => void;
}

export function GameList({ teamId, onGameSelect }: GameListProps) {
  const [games, setGames] = useState<Game[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [opponent, setOpponent] = useState("");
  const [isHome, setIsHome] = useState(true);
  const [gameDate, setGameDate] = useState("");

  useEffect(() => {
    const subscription = client.models.Game.observeQuery({
      filter: { teamId: { eq: teamId } },
    }).subscribe({
      next: (data) => {
        const sortedGames = [...data.items].sort((a, b) => {
          const statusA = a.status || 'scheduled';
          const statusB = b.status || 'scheduled';
          
          // Priority order: in-progress/halftime (1), scheduled (2), completed (3)
          const getPriority = (status: string) => {
            if (status === 'in-progress' || status === 'halftime') return 1;
            if (status === 'scheduled') return 2;
            return 3;
          };
          
          const priorityA = getPriority(statusA);
          const priorityB = getPriority(statusB);
          
          if (priorityA !== priorityB) {
            return priorityA - priorityB;
          }
          
          // Within same priority, sort by date
          const dateA = a.gameDate ? new Date(a.gameDate).getTime() : 0;
          const dateB = b.gameDate ? new Date(b.gameDate).getTime() : 0;
          
          // For scheduled games, sort soonest first (ascending)
          if (statusA === 'scheduled' && statusB === 'scheduled') {
            if (!dateA) return 1; // No date goes to end
            if (!dateB) return -1;
            return dateA - dateB;
          }
          
          // For completed games, sort most recent first (descending)
          if (statusA === 'completed' && statusB === 'completed') {
            if (!dateA) return 1;
            if (!dateB) return -1;
            return dateB - dateA;
          }
          
          // For in-progress/halftime, sort by date descending
          return dateB - dateA;
        });
        setGames(sortedGames);
      },
    });

    return () => subscription.unsubscribe();
  }, [teamId]);

  const handleCreateGame = async () => {
    if (!opponent.trim()) {
      alert("Please enter an opponent name");
      return;
    }

    try {
      // Fetch the team to get coaches array
      const teamResponse = await client.models.Team.get({ id: teamId });
      if (!teamResponse.data) {
        alert('Team not found');
        return;
      }

      const gameData: any = {
        teamId,
        opponent,
        isHome,
        coaches: teamResponse.data.coaches, // Copy coaches array from team
      };

      // Convert datetime-local to ISO format if provided
      if (gameDate) {
        gameData.gameDate = new Date(gameDate).toISOString();
      }

      const result = await client.models.Game.create(gameData);
      console.log("Game created:", result);
      
      setOpponent("");
      setIsHome(true);
      setGameDate("");
      setIsCreating(false);
    } catch (error) {
      console.error("Error creating game:", error);
      console.error("Error details:", JSON.stringify(error, null, 2));
      alert(`Failed to create game: ${error}`);
    }
  };

  const getStatusBadge = (status?: string | null) => {
    const statusClass = status?.toLowerCase() || 'scheduled';
    const statusLabels: { [key: string]: string } = {
      'scheduled': 'Scheduled',
      'in-progress': 'In Progress',
      'halftime': 'Halftime',
      'completed': 'Completed',
    };
    return (
      <span className={`status-badge status-${statusClass}`}>
        {statusLabels[statusClass] || status || 'Scheduled'}
      </span>
    );
  };

  const formatDate = (dateString?: string | null) => {
    if (!dateString) return "No date set";
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  // Render a game card component
  const renderGameCard = (game: Game) => (
    <div
      key={game.id}
      className="game-card"
      onClick={() => onGameSelect(game)}
    >
      <div className="game-header">
        <div className="game-opponent">
          <span className="vs-label">vs</span>
          <h3>{game.opponent}</h3>
        </div>
        {getStatusBadge(game.status)}
      </div>
      <div className="game-details">
        <span className={`location-badge ${game.isHome ? 'home' : 'away'}`}>
          {game.isHome ? '🏠 Home' : '✈️ Away'}
        </span>
        <span className="game-date">{formatDate(game.gameDate)}</span>
      </div>
    </div>
  );

  // Group games by status
  const inProgressGames = games.filter(g => {
    const status = g.status || 'scheduled';
    return status === 'in-progress' || status === 'halftime';
  });
  const scheduledGames = games.filter(g => (g.status || 'scheduled') === 'scheduled');
  const completedGames = games.filter(g => g.status === 'completed');

  return (
    <div className="game-list-section">
      <h2>Games</h2>
      
      {!isCreating && (
        <button onClick={() => setIsCreating(true)} className="btn-primary">
          + Schedule New Game
        </button>
      )}

      {isCreating && (
        <div className="create-form">
          <input
            type="text"
            placeholder="Opponent Team Name *"
            value={opponent}
            onChange={(e) => setOpponent(e.target.value)}
          />
          <div className="radio-group">
            <label>
              <input
                type="radio"
                checked={isHome}
                onChange={() => setIsHome(true)}
              />
              Home Game
            </label>
            <label>
              <input
                type="radio"
                checked={!isHome}
                onChange={() => setIsHome(false)}
              />
              Away Game
            </label>
          </div>
          <input
            type="datetime-local"
            value={gameDate}
            onChange={(e) => setGameDate(e.target.value)}
          />
          <div className="form-actions">
            <button onClick={handleCreateGame} className="btn-primary">
              Create
            </button>
            <button onClick={() => setIsCreating(false)} className="btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}

      {games.length === 0 && !isCreating && (
        <p className="empty-state">No games scheduled. Create your first game!</p>
      )}

      {/* In Progress Games */}
      {inProgressGames.length > 0 && (
        <>
          <h3 className="game-category-heading">In Progress</h3>
          <div className="game-grid">
            {inProgressGames.map(renderGameCard)}
          </div>
        </>
      )}

      {/* Scheduled Games */}
      {scheduledGames.length > 0 && (
        <>
          <h3 className="game-category-heading">Scheduled</h3>
          <div className="game-grid">
            {scheduledGames.map(renderGameCard)}
          </div>
        </>
      )}

      {/* Completed Games */}
      {completedGames.length > 0 && (
        <>
          <h3 className="game-category-heading">Completed</h3>
          <div className="game-grid">
            {completedGames.map(renderGameCard)}
          </div>
        </>
      )}
    </div>
  );
}
