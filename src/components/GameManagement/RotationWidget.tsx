import { useState } from "react";
import { updatePlayerAvailability } from "../../services/rotationPlannerService";
import { showSuccess } from "../../utils/toast";
import { handleApiError } from "../../utils/errorHandler";
import { useAvailability } from "../../contexts/AvailabilityContext";
import type { PlannedSubstitution } from "../../services/rotationPlannerService";
import { formatGameTimeDisplay } from "../../utils/gameTimeUtils";
import type {
  Game,
  Team,
  PlayerWithRoster,
  FormationPosition,
  GamePlan,
  PlannedRotation,
  LineupAssignment,
  PlayTimeRecord,
  SubQueue,
} from "./types";

interface RotationWidgetProps {
  gameState: Game;
  game: Game;
  team: Team;
  players: PlayerWithRoster[];
  positions: FormationPosition[];
  gamePlan: GamePlan | null;
  plannedRotations: PlannedRotation[];
  currentTime: number;
  lineup: LineupAssignment[];
  playTimeRecords: PlayTimeRecord[];
  substitutionQueue: SubQueue[];
  onQueueSubstitution: (playerId: string, positionId: string) => void;
}

export function RotationWidget({
  gameState,
  game,
  team,
  players,
  positions,
  gamePlan,
  plannedRotations,
  currentTime,
  substitutionQueue,
  onQueueSubstitution,
}: RotationWidgetProps) {
  const { getPlayerAvailability } = useAvailability();
  const [showRotationModal, setShowRotationModal] = useState(false);
  const [currentRotation, setCurrentRotation] = useState<PlannedRotation | null>(null);
  const [showLateArrivalModal, setShowLateArrivalModal] = useState(false);

  const getNextRotation = (): PlannedRotation | null => {
    if (!gamePlan || plannedRotations.length === 0) return null;

    const currentMinutes = Math.floor(currentTime / 60);
    return plannedRotations.find(r => {
      return r.half === gameState.currentHalf &&
             r.gameMinute >= currentMinutes - 2;
    }) || null;
  };

  const handleQueueAll = () => {
    if (!currentRotation) return;
    try {
      const subs: PlannedSubstitution[] = JSON.parse(currentRotation.plannedSubstitutions as string);
      subs.forEach(sub => {
        const inAvailability = getPlayerAvailability(sub.playerInId);
        const isQueued = substitutionQueue.some(
          q => q.playerId === sub.playerInId && q.positionId === sub.positionId
        );
        if (inAvailability === 'available' && !isQueued) {
          onQueueSubstitution(sub.playerInId, sub.positionId);
        }
      });
    } catch { /* ignore parse errors */ }
  };

  const canQueueAll = currentRotation ? (() => {
    try {
      const subs: PlannedSubstitution[] = JSON.parse(currentRotation.plannedSubstitutions as string);
      return subs.some(sub => {
        const inAvailability = getPlayerAvailability(sub.playerInId);
        const isQueued = substitutionQueue.some(
          q => q.playerId === sub.playerInId && q.positionId === sub.positionId
        );
        return inAvailability === 'available' && !isQueued;
      });
    } catch { return false; }
  })() : false;

  const handleLateArrival = async (playerId: string) => {
    try {
      await updatePlayerAvailability(
        game.id,
        playerId,
        'available',
        `Arrived late at ${formatGameTimeDisplay(currentTime, gameState.currentHalf || 1)}`,
        team.coaches || []
      );

      setShowLateArrivalModal(false);
      showSuccess('Player marked as available');
    } catch (error) {
      handleApiError(error, 'Failed to update player availability');
    }
  };

  if (gameState.status !== 'in-progress' || !gamePlan) {
    return null;
  }

  return (
    <>
      {/* Next Rotation Countdown */}
      {(() => {
        const nextRotation = getNextRotation();
        if (nextRotation) {
          const currentMinutes = Math.floor(currentTime / 60);
          const minutesUntil = nextRotation.gameMinute - currentMinutes;

          const rotationConflicts = (() => {
            try {
              const subs: PlannedSubstitution[] = JSON.parse(nextRotation.plannedSubstitutions as string);
              return subs.filter(sub => {
                const inStatus = getPlayerAvailability(sub.playerInId);
                const outStatus = getPlayerAvailability(sub.playerOutId);
                return inStatus === 'absent' || inStatus === 'injured' || outStatus === 'absent' || outStatus === 'injured';
              });
            } catch { return []; }
          })();

          return (
            <div className={`rotation-countdown-banner ${rotationConflicts.length > 0 ? 'has-conflicts' : ''}`}>
              <div className="countdown-info">
                <span className="countdown-label">Next Rotation:</span>
                <span className="countdown-time">{minutesUntil} min</span>
                <span className="countdown-detail">at {nextRotation.gameMinute}'</span>
                {rotationConflicts.length > 0 && (
                  <span className="rotation-conflict-badge" title="This rotation references unavailable players">
                    ⚠️ {rotationConflicts.length} conflict{rotationConflicts.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  setCurrentRotation(nextRotation);
                  setShowRotationModal(true);
                }}
                className="btn-view-rotation"
              >
                View Plan
              </button>
            </div>
          );
        }
        return null;
      })()}

      {players.some(p => {
        const status = getPlayerAvailability(p.id);
        return status === 'absent' || status === 'late-arrival';
      }) && (
        <div className="planner-actions">
          <button
            onClick={() => setShowLateArrivalModal(true)}
            className="btn-secondary"
          >
            + Add Late Arrival
          </button>
        </div>
      )}

      {/* Rotation Modal */}
      {showRotationModal && currentRotation && (
        <div className="modal-overlay" onClick={() => setShowRotationModal(false)}>
          <div className="modal-content rotation-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Planned Rotation - {currentRotation.gameMinute}'</h3>
            <p className="modal-subtitle">
              Suggested substitutions for this rotation. Plan remains as reference only.
            </p>

            <div className="planned-subs-list">
              {(() => {
                const subs: PlannedSubstitution[] = JSON.parse(currentRotation.plannedSubstitutions as string);
                return subs.map((sub, idx) => {
                  const playerOut = players.find(p => p.id === sub.playerOutId);
                  const playerIn = players.find(p => p.id === sub.playerInId);
                  const position = positions.find(p => p.id === sub.positionId);
                  const outAvailability = getPlayerAvailability(sub.playerOutId);
                  const inAvailability = getPlayerAvailability(sub.playerInId);

                  const isQueued = substitutionQueue.some(
                    q => q.playerId === sub.playerInId && q.positionId === sub.positionId
                  );

                  const canQueue = inAvailability === 'available' && !isQueued;

                  const getAvailabilityBadge = (status: string) => {
                    if (status === 'injured' || status === 'absent') {
                      return <span className="availability-badge unavailable">⚠️ {status}</span>;
                    }
                    if (status === 'late-arrival') {
                      return <span className="availability-badge late">⏰ late</span>;
                    }
                    return <span className="availability-badge available">✓</span>;
                  };

                  return (
                    <div key={idx} className="planned-sub-item">
                      <div className="sub-position-label">{position?.abbreviation}</div>
                      <div className="sub-players">
                        <div className="sub-player sub-out">
                          <span className="player-number">#{playerOut?.playerNumber}</span>
                          <span className="player-name">
                            {playerOut?.firstName} {playerOut?.lastName}
                          </span>
                          {getAvailabilityBadge(outAvailability)}
                        </div>
                        <div className="sub-arrow">→</div>
                        <div className="sub-player sub-in">
                          <span className="player-number">#{playerIn?.playerNumber}</span>
                          <span className="player-name">
                            {playerIn?.firstName} {playerIn?.lastName}
                          </span>
                          {getAvailabilityBadge(inAvailability)}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          if (canQueue) {
                            onQueueSubstitution(sub.playerInId, sub.positionId);
                          }
                        }}
                        className={`btn-queue-sub ${isQueued ? 'queued' : ''}`}
                        disabled={!canQueue}
                        title={isQueued ? 'Already queued' : (canQueue ? 'Add to substitution queue' : 'Player not available')}
                      >
                        {isQueued ? '✓ Queued' : '+ Queue'}
                      </button>
                    </div>
                  );
                });
              })()}
            </div>

            <div className="form-actions">
              <button
                onClick={handleQueueAll}
                className="btn-secondary"
                disabled={!canQueueAll}
                title={canQueueAll ? 'Queue all available substitutions' : 'No available substitutions to queue'}
              >
                Queue All
              </button>
              <button
                onClick={() => setShowRotationModal(false)}
                className="btn-primary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Late Arrival Modal */}
      {showLateArrivalModal && (
        <div className="modal-overlay" onClick={() => setShowLateArrivalModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Add Late Arrival</h3>
            <p className="modal-subtitle">Select a player who has arrived</p>

            <div className="late-arrival-list">
              {players
                .filter(p => {
                  const status = getPlayerAvailability(p.id);
                  return status === 'absent' || status === 'late-arrival';
                })
                .map((player) => (
                  <button
                    key={player.id}
                    className="late-arrival-option"
                    onClick={() => handleLateArrival(player.id)}
                  >
                    <span className="player-number">#{player.playerNumber}</span>
                    <span className="player-name">
                      {player.firstName} {player.lastName}
                    </span>
                    <span className="status-badge">
                      {getPlayerAvailability(player.id)}
                    </span>
                  </button>
                ))}
            </div>

            {players.filter(p => {
              const status = getPlayerAvailability(p.id);
              return status === 'absent' || status === 'late-arrival';
            }).length === 0 && (
              <p className="empty-state">No players marked as absent or late</p>
            )}

            <div className="form-actions">
              <button
                onClick={() => setShowLateArrivalModal(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
