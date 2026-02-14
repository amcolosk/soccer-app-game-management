import { useState, useEffect } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../../amplify/data/resource";
import { showError, showWarning } from "../../utils/toast";
import { useConfirm } from "../ConfirmModal";
import {
  calculatePlayerPlayTime,
  isPlayerCurrentlyPlaying,
} from "../../utils/playTimeCalculations";
import {
  isPlayerInLineup,
} from "../../utils/lineupUtils";
import { formatMinutesSeconds } from "../../utils/gameTimeUtils";
import { executeSubstitution } from "../../services/substitutionService";
import { useAvailability } from "../../contexts/AvailabilityContext";
import type {
  Game,
  Team,
  PlayerWithRoster,
  FormationPosition,
  LineupAssignment,
  PlayTimeRecord,
  SubQueue,
} from "./types";

const client = generateClient<Schema>();

interface SubstitutionPanelProps {
  gameState: Game;
  game: Game;
  team: Team;
  players: PlayerWithRoster[];
  positions: FormationPosition[];
  lineup: LineupAssignment[];
  playTimeRecords: PlayTimeRecord[];
  currentTime: number;
  substitutionQueue: SubQueue[];
  onQueueChange: (queue: SubQueue[]) => void;
  substitutionRequest: FormationPosition | null;
  onSubstitutionRequestHandled: () => void;
}

export function SubstitutionPanel({
  gameState,
  game,
  team,
  players,
  positions,
  lineup,
  playTimeRecords,
  currentTime,
  substitutionQueue,
  onQueueChange,
  substitutionRequest,
  onSubstitutionRequestHandled,
}: SubstitutionPanelProps) {
  const confirm = useConfirm();
  const { getPlayerAvailability } = useAvailability();
  const [showSubstitution, setShowSubstitution] = useState(false);
  const [substitutionPosition, setSubstitutionPosition] = useState<FormationPosition | null>(null);

  // Pick up substitution requests from the orchestrator (triggered by LineupPanel)
  useEffect(() => {
    if (substitutionRequest) {
      setSubstitutionPosition(substitutionRequest);
      setShowSubstitution(true);
      onSubstitutionRequestHandled();
    }
  }, [substitutionRequest, onSubstitutionRequestHandled]);

  const isInLineup = (playerId: string) => isPlayerInLineup(playerId, lineup);
  const isCurrentlyPlaying = (playerId: string) => isPlayerCurrentlyPlaying(playerId, playTimeRecords);
  const getPlayerPlayTimeSeconds = (playerId: string) => calculatePlayerPlayTime(playerId, playTimeRecords, currentTime);

  const handleQueueSubstitution = (playerId: string, positionId: string) => {
    const alreadyQueued = substitutionQueue.some(
      q => q.playerId === playerId && q.positionId === positionId
    );
    if (alreadyQueued) {
      showWarning("This player is already queued for this position");
      return;
    }

    const queuedElsewhere = substitutionQueue.find(q => q.playerId === playerId);
    if (queuedElsewhere) {
      showWarning("This player is already queued for another position");
      return;
    }

    onQueueChange([...substitutionQueue, { playerId, positionId }]);
    setShowSubstitution(false);
    setSubstitutionPosition(null);
  };

  const handleRemoveFromQueue = (playerId: string, positionId: string) => {
    onQueueChange(substitutionQueue.filter(
      q => !(q.playerId === playerId && q.positionId === positionId)
    ));
  };

  const handleExecuteAllSubstitutions = async () => {
    if (substitutionQueue.length === 0) return;

    const confirmMessage = `Execute all ${substitutionQueue.length} queued substitutions?`;
    const confirmed = await confirm({
      title: 'Execute Substitutions',
      message: confirmMessage,
      confirmText: 'Execute All',
      variant: 'warning',
    });
    if (!confirmed) return;

    try {
      for (const queueItem of substitutionQueue) {
        const { playerId: newPlayerId, positionId } = queueItem;

        const currentAssignment = lineup.find(
          l => l.positionId === positionId && l.isStarter
        );
        if (!currentAssignment) continue;

        const oldPlayerId = currentAssignment.playerId;

        await executeSubstitution(
          game.id,
          oldPlayerId,
          newPlayerId,
          positionId,
          currentTime,
          gameState.currentHalf || 1,
          playTimeRecords,
          currentAssignment.id,
          team.coaches || []
        );
      }

      onQueueChange([]);
    } catch (error) {
      console.error("Error executing all substitutions:", error);
      showError("Failed to execute all substitutions. Some may have been completed.");
    }
  };

  const handleExecuteSubstitution = async (queueItem: SubQueue) => {
    const { playerId: newPlayerId, positionId } = queueItem;

    const currentAssignment = lineup.find(
      l => l.positionId === positionId && l.isStarter
    );
    if (!currentAssignment) {
      showError("No player currently in this position");
      return;
    }

    const oldPlayerId = currentAssignment.playerId;

    try {
      await executeSubstitution(
        game.id,
        oldPlayerId,
        newPlayerId,
        positionId,
        currentTime,
        gameState.currentHalf || 1,
        playTimeRecords,
        currentAssignment.id,
        team.coaches || []
      );

      handleRemoveFromQueue(newPlayerId, positionId);
    } catch (error) {
      console.error("Error making substitution:", error);
      showError("Failed to make substitution");
    }
  };

  const handleMakeSubstitution = async (newPlayerId: string) => {
    if (!substitutionPosition) return;

    const currentAssignment = lineup.find(
      l => l.positionId === substitutionPosition.id && l.isStarter
    );
    if (!currentAssignment) return;

    const oldPlayerId = currentAssignment.playerId;

    try {
      await executeSubstitution(
        game.id,
        oldPlayerId,
        newPlayerId,
        substitutionPosition.id,
        currentTime,
        gameState.currentHalf || 1,
        playTimeRecords,
        currentAssignment.id,
        team.coaches || []
      );

      setShowSubstitution(false);
      setSubstitutionPosition(null);
    } catch (error) {
      console.error("Error making substitution:", error);
      showError("Failed to make substitution");
    }
  };

  const handleAssignPosition = async (positionId: string, playerId: string) => {
    try {
      await client.models.LineupAssignment.create({
        gameId: game.id,
        playerId,
        positionId,
        isStarter: true,
        coaches: team.coaches,
      });

      if (gameState.status === 'in-progress') {
        await client.models.PlayTimeRecord.create({
          gameId: game.id,
          playerId,
          positionId,
          startGameSeconds: currentTime,
          coaches: team.coaches,
        });
      }

      setShowSubstitution(false);
      setSubstitutionPosition(null);
    } catch (error) {
      console.error("Error adding to lineup:", error);
      showError("Failed to add player to lineup");
    }
  };

  return (
    <>
      {/* Substitution Queue */}
      {substitutionQueue.length > 0 && gameState.status === 'in-progress' && (
        <div className="sub-queue-section">
          <div className="sub-queue-header">
            <h3>Substitution Queue ({substitutionQueue.length})</h3>
            <button
              onClick={handleExecuteAllSubstitutions}
              className="btn-sub-all"
              title="Execute all queued substitutions at once"
            >
              ⚽ Sub All Now
            </button>
          </div>
          <p className="sub-queue-hint">Players ready to substitute in when referee allows</p>
          <div className="sub-queue-list">
            {substitutionQueue.map((queueItem) => {
              const player = players.find(p => p.id === queueItem.playerId);
              const position = positions.find(p => p.id === queueItem.positionId);
              const currentAssignment = lineup.find(l => l.positionId === queueItem.positionId && l.isStarter);
              const currentPlayer = currentAssignment ? players.find(p => p.id === currentAssignment.playerId) : null;

              if (!player || !position) return null;

              return (
                <div key={`${queueItem.playerId}-${queueItem.positionId}`} className="sub-queue-item">
                  <div className="sub-queue-info">
                    <div className="sub-queue-position">
                      {position.abbreviation} - {position.positionName}
                    </div>
                    <div className="sub-queue-players">
                      <span className="player-out">
                        {currentPlayer ? `#${currentPlayer.playerNumber} ${currentPlayer.firstName}` : 'N/A'}
                      </span>
                      <span className="sub-arrow">→</span>
                      <span className="player-in">
                        #{player.playerNumber} {player.firstName} {player.lastName}
                      </span>
                    </div>
                  </div>
                  <div className="sub-queue-actions">
                    <button
                      onClick={() => handleExecuteSubstitution(queueItem)}
                      className="btn-execute-sub"
                      title="Execute substitution now"
                    >
                      ✓ Sub Now
                    </button>
                    <button
                      onClick={() => handleRemoveFromQueue(queueItem.playerId, queueItem.positionId)}
                      className="btn-remove-queue"
                      title="Remove from queue"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Substitution Modal */}
      {showSubstitution && substitutionPosition && (
        <div className="modal-overlay" onClick={() => setShowSubstitution(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            {(() => {
              const currentAssignment = lineup.find((a: LineupAssignment) => a.positionId === substitutionPosition.id);
              const isEmptyPosition = !currentAssignment;
              const currentPlayer = currentAssignment ? players.find(p => p.id === currentAssignment.playerId) : null;

              return (
                <>
                  <h2>{isEmptyPosition ? 'Assign Player to Position' : 'Substitution'}</h2>
                  <p className="modal-subtitle">
                    Position: {positions.find(p => p.id === substitutionPosition.id)?.positionName || 'Unknown'}
                  </p>
                  {currentPlayer && (
                    <p className="modal-subtitle">
                      Coming Off: #{currentPlayer.playerNumber} {currentPlayer.firstName}
                    </p>
                  )}
                  {!isEmptyPosition && (
                    <p style={{ fontSize: '0.9em', color: '#666', marginBottom: '1rem' }}>
                      Queue players when ready, execute when referee allows
                    </p>
                  )}
                  {isEmptyPosition && (
                    <p style={{ fontSize: '0.9em', color: '#666', marginBottom: '1rem' }}>
                      Select a player to assign to this position
                    </p>
                  )}
                  <div className="position-picker-list">
                    {(() => {
                      const currentPosition = positions.find(p => p.id === substitutionPosition.id);
                      const positionName = currentPosition?.positionName || '';
                      const positionAbbr = currentPosition?.abbreviation || '';

                      const availablePlayers = players
                        .filter(p => isEmptyPosition ? !isInLineup(p.id) : !isCurrentlyPlaying(p.id))
                        .filter(p => !substitutionQueue.some(q => q.playerId === p.id))
                        .filter(p => {
                          const status = getPlayerAvailability(p.id);
                          return status !== 'absent' && status !== 'injured';
                        });

                      const recommendedPlayers = availablePlayers.filter(p => {
                        if (!p.preferredPositions) return false;
                        const preferredPositions = p.preferredPositions.split(', ');
                        return preferredPositions.some((pref: string) =>
                          pref === substitutionPosition.id ||
                          pref === positionName ||
                          pref === positionAbbr
                        );
                      });
                      const sortedRecommendedPlayers = [...recommendedPlayers].sort((a, b) =>
                        (a.playerNumber || 999) - (b.playerNumber || 999)
                      );

                      const otherPlayers = availablePlayers
                        .filter(p => !recommendedPlayers.includes(p))
                        .sort((a, b) => (a.playerNumber || 999) - (b.playerNumber || 999));

                      return (
                        <>
                          {sortedRecommendedPlayers.length > 0 && (
                            <>
                              <div className="player-section-header">
                                <span className="section-label">⭐ Recommended Players</span>
                                <span className="section-hint">Prefer this position</span>
                              </div>
                              {sortedRecommendedPlayers.map((player: PlayerWithRoster) => {
                                const playTimeSeconds = getPlayerPlayTimeSeconds(player.id);
                                return (
                                  <div key={player.id} className="sub-player-item recommended">
                                    <div className="sub-player-info">
                                      <span>#{player.playerNumber} {player.firstName} {player.lastName}</span>
                                      <span className="player-play-time">
                                        {formatMinutesSeconds(playTimeSeconds)}
                                      </span>
                                    </div>
                                    <div className="sub-player-actions">
                                      {isEmptyPosition ? (
                                        <button
                                          onClick={() => handleAssignPosition(substitutionPosition.id, player.id)}
                                          className="btn-primary"
                                          title="Assign to position"
                                        >
                                          Assign
                                        </button>
                                      ) : (
                                        <>
                                          <button
                                            onClick={() => handleQueueSubstitution(player.id, substitutionPosition.id)}
                                            className="btn-queue"
                                            title="Add to substitution queue"
                                          >
                                            Queue
                                          </button>
                                          <button
                                            onClick={() => handleMakeSubstitution(player.id)}
                                            className="btn-sub-now"
                                            title="Substitute immediately"
                                          >
                                            Sub Now
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </>
                          )}

                          {otherPlayers.length > 0 && (
                            <>
                              {recommendedPlayers.length > 0 && (
                                <div className="player-section-header">
                                  <span className="section-label">Other Players</span>
                                </div>
                              )}
                              {otherPlayers.map((player: PlayerWithRoster) => {
                                const playTimeSeconds = getPlayerPlayTimeSeconds(player.id);
                                return (
                                  <div key={player.id} className="sub-player-item">
                                    <div className="sub-player-info">
                                      <span>#{player.playerNumber} {player.firstName} {player.lastName}</span>
                                      <span className="player-play-time">
                                        {formatMinutesSeconds(playTimeSeconds)}
                                      </span>
                                    </div>
                                    <div className="sub-player-actions">
                                      {isEmptyPosition ? (
                                        <button
                                          onClick={() => handleAssignPosition(substitutionPosition.id, player.id)}
                                          className="btn-primary"
                                          title="Assign to position"
                                        >
                                          Assign
                                        </button>
                                      ) : (
                                        <>
                                          <button
                                            onClick={() => handleQueueSubstitution(player.id, substitutionPosition.id)}
                                            className="btn-queue"
                                            title="Add to substitution queue"
                                          >
                                            Queue
                                          </button>
                                          <button
                                            onClick={() => handleMakeSubstitution(player.id)}
                                            className="btn-sub-now"
                                            title="Substitute immediately"
                                          >
                                            Sub Now
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </>
              );
            })()}

            <button
              onClick={() => setShowSubstitution(false)}
              className="btn-secondary"
              style={{ marginTop: '1rem', width: '100%' }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
