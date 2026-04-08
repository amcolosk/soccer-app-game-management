import { useState, useEffect } from "react";
import { updatePlayerAvailability } from "../../services/rotationPlannerService";
import { showSuccess } from "../../utils/toast";
import { handleApiError } from "../../utils/errorHandler";
import { useAvailability } from "../../contexts/AvailabilityContext";
import type { PlannedSubstitution } from "../../services/rotationPlannerService";
import { isRotationFullyExecuted, isSubEffectivelyExecuted } from "../../utils/rotationConflictUtils";
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
  isRotationModalOpen?: boolean;
  onOpenRotationModal?: () => void;
  onCloseRotationModal?: () => void;
  onRecalculateRotations?: () => void;
  isRecalculating?: boolean;
  getPlanConflicts?: () => Array<{
    type: 'starter' | 'rotation' | 'on-field';
    playerId: string;
    playerName: string;
    status: string;
    rotationNumbers: number[];
  }>;
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
  lineup,
  substitutionQueue,
  onQueueSubstitution,
  isRotationModalOpen,
  onOpenRotationModal,
  onCloseRotationModal,
  onRecalculateRotations,
  isRecalculating,
  getPlanConflicts,
}: RotationWidgetProps) {
  const { getPlayerAvailability } = useAvailability();
  const [internalShowRotationModal, setInternalShowRotationModal] = useState(false);
  const [currentRotation, setCurrentRotation] = useState<PlannedRotation | null>(null);

  // Support both controlled (isRotationModalOpen prop) and uncontrolled modal state.
  const showRotationModal =
    isRotationModalOpen !== undefined ? isRotationModalOpen : internalShowRotationModal;

  const setShowRotationModal = (value: boolean) => {
    setInternalShowRotationModal(value);
    if (!value && onCloseRotationModal) {
      onCloseRotationModal();
    }
  };
  const [showLateArrivalModal, setShowLateArrivalModal] = useState(false);

  const getNextRotation = (): PlannedRotation | null => {
    if (!gamePlan || plannedRotations.length === 0) return null;

    const currentMinutes = Math.floor(currentTime / 60);
    return plannedRotations.find(r => {
      if (r.half !== gameState.currentHalf) return false;
      if (r.gameMinute < currentMinutes - 2) return false;
      if (isRotationFullyExecuted(r.plannedSubstitutions as string, lineup ?? [])) return false;
      return true;
    }) || null;
  };

  // When the modal is opened externally (via CommandBand tap), auto-select the next rotation.
  useEffect(() => {
    if (isRotationModalOpen) {
      const next = getNextRotation();
      setCurrentRotation(next ?? null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRotationModalOpen, plannedRotations]);

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
      setShowRotationModal(false);
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
        team.coaches || [],
        null,  // clear stale availableFromMinute — player has now arrived
        null   // clear availableUntilMinute — player is fully available
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
                // Rotation already physically executed — playerIn on field, playerOut off field
                if (isSubEffectivelyExecuted(sub, lineup ?? [])) return false;
                const inStatus = getPlayerAvailability(sub.playerInId);
                const outStatus = getPlayerAvailability(sub.playerOutId);
                const playerInOnField = lineup?.some(l => l.isStarter && l.playerId === sub.playerInId) ?? false;
                const playerOutOnField = lineup?.some(l => l.isStarter && l.playerId === sub.playerOutId) ?? false;
                // True on-field conflict: both players are simultaneously on the field
                const isTrueOnFieldConflict = playerInOnField && playerOutOnField;
                return (
                  isTrueOnFieldConflict ||
                  inStatus === 'absent' || inStatus === 'injured' ||
                  outStatus === 'absent' || outStatus === 'injured'
                );
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
                  if (onOpenRotationModal) {
                    onOpenRotationModal();
                  } else {
                    setShowRotationModal(true);
                  }
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
                let subs: PlannedSubstitution[] = [];
                try {
                  subs = JSON.parse(currentRotation.plannedSubstitutions as string);
                } catch {
                  return <p className="empty-state">Unable to load rotation data.</p>;
                }

                const queueEligibleSubs = subs.filter((sub) => {
                  const inAvailability = getPlayerAvailability(sub.playerInId);
                  return inAvailability !== 'injured';
                });

                if (queueEligibleSubs.length === 0) {
                  return (
                    <p className="empty-state">
                      No rotation changes available. All planned players are either unavailable or already on the field.
                    </p>
                  );
                }

                return queueEligibleSubs.map((sub, idx) => {
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
                          {lineup?.some(l => l.isStarter && l.playerId === sub.playerInId) && (
                            <span className="availability-badge unavailable">⚠️ on field</span>
                          )}
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

            {(getPlanConflicts?.() ?? []).length > 0 && onRecalculateRotations && (
              <div style={{ marginBottom: '0.5rem' }}>
                <button
                  onClick={onRecalculateRotations}
                  disabled={isRecalculating}
                  aria-busy={isRecalculating}
                  className="btn-secondary"
                  style={{ width: '100%' }}
                >
                  {isRecalculating ? '⏳ Recalculating...' : '🔄 Recalculate Rotations'}
                </button>
              </div>
            )}
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
