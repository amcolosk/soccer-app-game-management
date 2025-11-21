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
          if (!a.gameDate) return 1;
          if (!b.gameDate) return -1;
          return new Date(b.gameDate).getTime() - new Date(a.gameDate).getTime();
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
      const gameData: any = {
        teamId,
        opponent,
        isHome,
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

  const handleDeleteGame = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this game?")) {
      try {
        await client.models.Game.delete({ id });
      } catch (error) {
        console.error("Error deleting game:", error);
        alert("Failed to delete game");
      }
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

      <div className="game-grid">
        {games.length === 0 && !isCreating && (
          <p className="empty-state">No games scheduled. Create your first game!</p>
        )}
        
        {games.map((game) => (
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
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteGame(game.id);
              }}
              className="btn-delete"
              aria-label="Delete game"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
