import { useState } from 'react';
import { getStatusColor, getStatusLabel } from './PlayerAvailabilityGrid';
import { useAvailability } from '../contexts/AvailabilityContext';

interface Player {
  id: string;
  firstName: string;
  lastName: string;
  playerNumber?: number;
  preferredPositions?: string;
}

interface Position {
  id: string;
  positionName: string;
  abbreviation: string;
}

interface LineupBuilderProps {
  positions: Position[];
  availablePlayers: Player[];
  lineup: Map<string, string>; // positionId -> playerId
  onLineupChange: (positionId: string, playerId: string) => void;
  disabled?: boolean;
  showPreferredPositions?: boolean;
  /** When provided, the ✕ remove button is only shown for positions in this set */
  removablePositionIds?: Set<string>;
}

export function LineupBuilder({
  positions,
  availablePlayers,
  lineup,
  onLineupChange,
  disabled = false,
  showPreferredPositions = true,
  removablePositionIds,
}: LineupBuilderProps) {
  const { getPlayerAvailability } = useAvailability();
  const [draggedPlayer, setDraggedPlayer] = useState<Player | null>(null);

  const handleDragStart = (player: Player) => {
    setDraggedPlayer(player);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDropOnPosition = (positionId: string) => {
    if (draggedPlayer) {
      onLineupChange(positionId, draggedPlayer.id);
      setDraggedPlayer(null);
    }
  };

  const handleDropOnBench = () => {
    if (draggedPlayer) {
      // Remove player from lineup if they were assigned
      const positionId = Array.from(lineup.entries()).find(
        ([, playerId]) => playerId === draggedPlayer.id
      )?.[0];
      if (positionId) {
        onLineupChange(positionId, '');
      }
      setDraggedPlayer(null);
    }
  };

  const getPreferredPositionsText = (player: Player) => {
    if (!showPreferredPositions || !player.preferredPositions) return '';

    const preferredIds = player.preferredPositions.split(',').map(s => s.trim());
    const preferredPos = positions
      .filter((pos) => preferredIds.includes(pos.id))
      .map((pos) => pos.abbreviation)
      .join(', ');

    return preferredPos ? ` (${preferredPos})` : '';
  };

  return (
    <div className="starting-lineup-container">
      <div className="position-lineup-grid">
        {positions.map((position) => {
          const assignedPlayerId = lineup.get(position.id);
          const assignedPlayer = availablePlayers.find((p) => p.id === assignedPlayerId);

          return (
            <div
              key={position.id}
              className="position-slot"
              onDragOver={handleDragOver}
              onDrop={() => !disabled && handleDropOnPosition(position.id)}
            >
              <div className="position-label">{position.abbreviation}</div>
              {assignedPlayer ? (
                <>
                  <div
                    className={`assigned-player ${
                      (getPlayerAvailability(assignedPlayer.id) === 'absent' || getPlayerAvailability(assignedPlayer.id) === 'injured')
                        ? 'unavailable'
                        : ''
                    }`}
                    draggable={!disabled}
                    onDragStart={() => !disabled && handleDragStart(assignedPlayer)}
                  >
                    <span className="player-number">#{assignedPlayer.playerNumber || 0}</span>
                    <span className="player-name-short">
                      {assignedPlayer.firstName} {assignedPlayer.lastName}
                    </span>
                    {!disabled && (!removablePositionIds || removablePositionIds.has(position.id)) && (
                      <button
                        className="remove-player"
                        onClick={(e) => {
                          e.stopPropagation();
                          onLineupChange(position.id, '');
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {(() => {
                    const status = getPlayerAvailability(assignedPlayer.id);
                    if (status === 'absent' || status === 'injured') {
                      return (
                        <div className="lineup-availability-warning" style={{ borderLeftColor: getStatusColor(status) }}>
                          {getStatusLabel(status)} {status === 'absent' ? 'Absent' : 'Injured'}
                        </div>
                      );
                    }
                    return null;
                  })()}
                </>
              ) : (
                <select
                  className="player-select"
                  value=""
                  onChange={(e) => onLineupChange(position.id, e.target.value)}
                  disabled={disabled}
                >
                  <option value="">Select player...</option>
                  {availablePlayers
                    .filter((p) => !Array.from(lineup.values()).includes(p.id))
                    .slice()
                    .sort((a, b) => {
                      // Sort players with this position as preferred to the top
                      const aPreferred = a.preferredPositions?.split(',').map(s => s.trim()).includes(position.id) || false;
                      const bPreferred = b.preferredPositions?.split(',').map(s => s.trim()).includes(position.id) || false;
                      if (aPreferred && !bPreferred) return -1;
                      if (!aPreferred && bPreferred) return 1;
                      // Then sort by player number
                      return (a.playerNumber || 0) - (b.playerNumber || 0);
                    })
                    .map((player) => {
                      const preferredPos = getPreferredPositionsText(player);
                      const isPreferredForPosition = player.preferredPositions?.split(',').map(s => s.trim()).includes(position.id);
                      return (
                        <option key={player.id} value={player.id}>
                          {isPreferredForPosition ? '⭐ ' : ''}#{player.playerNumber || 0} {player.firstName} {player.lastName}
                          {preferredPos}
                        </option>
                      );
                    })}
                </select>
              )}
            </div>
          );
        })}
      </div>

      <div
        className="bench-area"
        onDragOver={handleDragOver}
        onDrop={() => !disabled && handleDropOnBench()}
      >
        <h4>Bench (Drag players here or to positions)</h4>
        <div className="bench-players">
          {availablePlayers
            .filter((p) => !Array.from(lineup.values()).includes(p.id))
            .map((player) => {
              const status = getPlayerAvailability(player.id);
              const isUnavailable = status === 'absent' || status === 'injured';
              return (
                <div
                  key={player.id}
                  className={`bench-player ${isUnavailable ? 'unavailable' : ''}`}
                  draggable={!disabled}
                  onDragStart={() => !disabled && handleDragStart(player)}
                  style={isUnavailable ? { borderColor: getStatusColor(status) } : undefined}
                >
                  {isUnavailable && (
                    <span className="bench-status" style={{ color: getStatusColor(status) }}>
                      {getStatusLabel(status)}
                    </span>
                  )}
                  <span className="player-number">#{player.playerNumber || 0}</span>
                  <span className="player-name">
                    {player.firstName} {player.lastName}
                  </span>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
