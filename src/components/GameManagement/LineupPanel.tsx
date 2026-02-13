import { useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../../amplify/data/resource";
import {
  calculatePlayerPlayTime,
  formatPlayTime,
  isPlayerCurrentlyPlaying,
} from "../../utils/playTimeCalculations";
import {
  isPlayerInLineup,
} from "../../utils/lineupUtils";
import { LineupBuilder } from "../LineupBuilder";
import type {
  Game,
  Team,
  Player,
  PlayerWithRoster,
  FormationPosition,
  LineupAssignment,
  PlayTimeRecord,
  GamePlan,
} from "./types";

const client = generateClient<Schema>();

interface LineupPanelProps {
  gameState: Game;
  game: Game;
  team: Team;
  players: PlayerWithRoster[];
  positions: FormationPosition[];
  lineup: LineupAssignment[];
  playTimeRecords: PlayTimeRecord[];
  currentTime: number;
  gamePlan: GamePlan | null;
  onSubstitute: (position: FormationPosition) => void;
  onMarkInjured: (playerId: string) => void;
  getPlayerAvailability: (playerId: string) => string;
}

export function LineupPanel({
  gameState,
  game,
  team,
  players,
  positions,
  lineup,
  playTimeRecords,
  currentTime,
  gamePlan,
  onSubstitute,
  onMarkInjured,
  getPlayerAvailability,
}: LineupPanelProps) {
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [showPositionPicker, setShowPositionPicker] = useState(false);

  const startersCount = positions.filter(pos =>
    lineup.some(l => l.positionId === pos.id && l.isStarter)
  ).length;

  const isInLineup = (playerId: string) => isPlayerInLineup(playerId, lineup);

  const getPositionPlayer = (positionId: string) => {
    const assignment = lineup.find(l => l.positionId === positionId && l.isStarter);
    if (!assignment) return null;
    return players.find(p => p.id === assignment.playerId);
  };

  const getPlayerPosition = (playerId: string) => {
    const assignment = lineup.find(l => l.playerId === playerId);
    if (!assignment?.positionId) return null;
    return positions.find(p => p.id === assignment.positionId);
  };

  const getPlayerPlayTime = (playerId: string): string => {
    const totalSeconds = calculatePlayerPlayTime(playerId, playTimeRecords, currentTime);
    return formatPlayTime(totalSeconds, 'short');
  };

  const isCurrentlyPlaying = (playerId: string) => isPlayerCurrentlyPlaying(playerId, playTimeRecords);

  const handleRemoveFromLineup = async (lineupId: string) => {
    try {
      await client.models.LineupAssignment.delete({ id: lineupId });
    } catch (error) {
      console.error("Error removing from lineup:", error);
      alert("Failed to remove player from lineup");
    }
  };

  const handleClearAllPositions = async () => {
    if (!confirm(`Remove all ${startersCount} players from the lineup?`)) {
      return;
    }

    try {
      const deletePromises = lineup.map(assignment =>
        client.models.LineupAssignment.delete({ id: assignment.id })
      );
      await Promise.all(deletePromises);
    } catch (error) {
      console.error("Error clearing lineup:", error);
      alert("Failed to clear lineup");
    }
  };

  const handlePlayerClick = (player: Player) => {
    const existing = lineup.find(l => l.playerId === player.id);

    if (existing) {
      handleRemoveFromLineup(existing.id);
    } else {
      if (startersCount >= team.maxPlayersOnField) {
        alert(`Maximum ${team.maxPlayersOnField} starters allowed`);
        return;
      }
      setSelectedPlayer(player);
      setShowPositionPicker(true);
    }
  };

  const handleEmptyPositionClick = (position: FormationPosition) => {
    if (startersCount >= team.maxPlayersOnField) {
      alert(`Maximum ${team.maxPlayersOnField} starters allowed`);
      return;
    }
    onSubstitute(position);
  };

  const handleAssignPosition = async (positionId: string) => {
    if (!selectedPlayer) return;

    try {
      await client.models.LineupAssignment.create({
        gameId: game.id,
        playerId: selectedPlayer.id,
        positionId: positionId,
        isStarter: true,
        coaches: team.coaches,
      });

      if (gameState.status === 'in-progress') {
        await client.models.PlayTimeRecord.create({
          gameId: game.id,
          playerId: selectedPlayer.id,
          positionId: positionId,
          startGameSeconds: currentTime,
          coaches: team.coaches,
        });
      }

      setSelectedPlayer(null);
      setShowPositionPicker(false);
    } catch (error) {
      console.error("Error adding to lineup:", error);
      alert("Failed to add player to lineup");
    }
  };

  return (
    <>
      {/* Position-based Lineup */}
      <div className="lineup-section">
        <div className="lineup-header">
          <h2>
            {gameState.status === 'halftime' ? 'Second Half Lineup' : 'Starting Lineup'} ({startersCount}/{team.maxPlayersOnField})
          </h2>
          {gameState.status === 'halftime' && startersCount > 0 && (
            <button onClick={handleClearAllPositions} className="btn-clear-lineup">
              Clear All Positions
            </button>
          )}
        </div>
        {gameState.status === 'halftime' && (
          <p className="halftime-lineup-hint">
            Make substitutions now for the start of the second half. Players will start with fresh play time tracking.
          </p>
        )}

        {positions.length === 0 ? (
          <p className="empty-state">
            No positions defined. Go to the Positions tab to add field positions first.
          </p>
        ) : gameState.status === 'scheduled' ? (
          <LineupBuilder
            positions={positions}
            availablePlayers={players.filter(p => p.isActive)}
            lineup={new Map(lineup.filter(l => l.positionId && l.playerId).map(l => [l.positionId as string, l.playerId]))}
            onLineupChange={async (positionId, playerId) => {
              const existing = lineup.find(l => l.positionId === positionId);

              if (playerId === '') {
                if (existing) {
                  await client.models.LineupAssignment.delete({ id: existing.id });
                }
              } else {
                const playerExisting = lineup.find(l => l.playerId === playerId);
                if (playerExisting) {
                  await client.models.LineupAssignment.delete({ id: playerExisting.id });
                }

                if (existing) {
                  await client.models.LineupAssignment.update({
                    id: existing.id,
                    playerId,
                  });
                } else {
                  await client.models.LineupAssignment.create({
                    gameId: game.id,
                    playerId,
                    positionId,
                    isStarter: true,
                    coaches: team.coaches,
                  });
                }
              }
            }}
            showPreferredPositions={true}
            getPlayerAvailability={getPlayerAvailability}
          />
        ) : (
          <>
            <div className="position-lineup-grid">
              {positions.map((position) => {
                const assignedPlayer = getPositionPlayer(position.id);
                return (
                  <div key={position.id} className="position-slot">
                    <div className="position-header">
                      {position.abbreviation && (
                        <span className="position-abbr-small">{position.abbreviation}</span>
                      )}
                      <span className="position-name-small">{position.positionName}</span>
                    </div>
                    {assignedPlayer ? (
                      <div className="assigned-player-slot">
                        <div className="assigned-player">
                          <span className="player-number-small">#{assignedPlayer.playerNumber}</span>
                          <span className="player-name-small">
                            {assignedPlayer.firstName} {assignedPlayer.lastName}
                          </span>
                          {gameState.status !== 'in-progress' ? (
                            <button
                              onClick={() => {
                                const assignment = lineup.find(l => l.positionId === position.id);
                                if (assignment) handleRemoveFromLineup(assignment.id);
                              }}
                              className="btn-remove-small"
                            >
                              ✕
                            </button>
                          ) : (
                            <div className="player-actions">
                              <button
                                onClick={() => onSubstitute(position)}
                                className="btn-substitute"
                                title="Make substitution"
                              >
                                ⇄
                              </button>
                              {gamePlan && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm(`Mark ${assignedPlayer.firstName} as injured?`)) {
                                      onMarkInjured(assignedPlayer.id);
                                    }
                                  }}
                                  className="btn-mark-injured"
                                  title="Mark player as injured"
                                >
                                  🩹
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        {isCurrentlyPlaying(assignedPlayer.id) && (
                          <div className="play-time-indicator">
                            ⚽ Playing: {getPlayerPlayTime(assignedPlayer.id)}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div
                        className={`empty-slot ${(gameState.status === 'halftime' || gameState.status === 'scheduled') ? 'clickable' : ''}`}
                        onClick={() => handleEmptyPositionClick(position)}
                        title={(gameState.status === 'halftime' || gameState.status === 'scheduled') ? 'Click to assign player' : ''}
                      >
                        Empty
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {gameState.status !== 'scheduled' && (
              <>
                <h3 style={{ marginTop: '2rem' }}>Available Players</h3>
                <p className="lineup-hint">Click a player to assign them to a position</p>

                <div className="player-list">
                  {players.map((player) => {
                    const inLineup = isInLineup(player.id);
                    const assignedPosition = getPlayerPosition(player.id);
                    const playTime = getPlayerPlayTime(player.id);
                    const playing = isCurrentlyPlaying(player.id);
                    return (
                      <div
                        key={player.id}
                        className={`player-card clickable ${inLineup ? 'in-lineup' : ''} ${playing ? 'currently-playing' : ''}`}
                        onClick={() => handlePlayerClick(player)}
                      >
                        <div className="player-number">#{player.playerNumber}</div>
                        <div className="player-info">
                          <h3>{player.firstName} {player.lastName}</h3>
                          {assignedPosition && (
                            <p className="player-position">
                              Playing: {assignedPosition.positionName}
                            </p>
                          )}
                          {playTime !== '0:00' && (
                            <p className="player-play-time">
                              ⏱️ Time played: {playTime}
                            </p>
                          )}
                        </div>
                        {inLineup && <span className="checkmark">✓</span>}
                        {playing && <span className="playing-badge">On Field</span>}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Position Picker Modal */}
      {showPositionPicker && selectedPlayer && (
        <div className="modal-overlay" onClick={() => setShowPositionPicker(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Assign {selectedPlayer.firstName} {selectedPlayer.lastName} to Position</h2>
            <div className="position-picker-grid">
              {positions.map((position) => {
                const occupied = getPositionPlayer(position.id);
                return (
                  <button
                    key={position.id}
                    className={`position-picker-btn ${occupied ? 'occupied' : ''}`}
                    onClick={() => handleAssignPosition(position.id)}
                    disabled={!!occupied}
                  >
                    <div className="position-picker-label">
                      {position.abbreviation && (
                        <span className="abbr">{position.abbreviation}</span>
                      )}
                      <span className="name">{position.positionName}</span>
                    </div>
                    {occupied && (
                      <div className="occupied-by">
                        #{occupied.playerNumber} {occupied.firstName}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setShowPositionPicker(false)}
              className="btn-secondary"
              style={{ marginTop: '1rem', width: '100%' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
