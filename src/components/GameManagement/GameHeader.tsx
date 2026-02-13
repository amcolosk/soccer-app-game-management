import type { Game } from "./types";

interface GameHeaderProps {
  gameState: Game;
  onBack: () => void;
}

export function GameHeader({ gameState, onBack }: GameHeaderProps) {
  return (
    <>
      <div className="game-header">
        <button onClick={onBack} className="btn-back">
          ← Back to Games
        </button>
        <div className="game-title">
          <h1>vs {gameState.opponent}</h1>
          <span className={`location-badge ${gameState.isHome ? 'home' : 'away'}`}>
            {gameState.isHome ? '🏠 Home' : '✈️ Away'}
          </span>
        </div>
      </div>

      {/* Score Display */}
      <div className="score-display">
        <div className="score-team">
          <div className="team-name">Us</div>
          <div className="score">{gameState.ourScore || 0}</div>
        </div>
        <div className="score-divider">-</div>
        <div className="score-team">
          <div className="team-name">{gameState.opponent}</div>
          <div className="score">{gameState.opponentScore || 0}</div>
        </div>
      </div>
    </>
  );
}
