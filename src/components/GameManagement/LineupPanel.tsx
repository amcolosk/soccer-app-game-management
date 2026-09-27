import { useState } from "react";
import { showWarning } from "../../utils/toast";
import { handleApiError } from "../../utils/errorHandler";
import { useConfirm } from "../ConfirmModal";
import {
  calculatePlayerPlayTime,
  formatPlayTime,
  isPlayerCurrentlyPlaying,
} from "../../utils/playTimeCalculations";
import {
  isPlayerInLineup,
} from "../../utils/lineupUtils";
import { LineupBuilder } from "../LineupBuilder";
import { LineupShapeView } from "./shape/LineupShapeView";
import { createLineupInteractionAdapter } from "./shape/lineupInteractionAdapter";
import { cleanupDuplicateAssignmentsForPosition } from "../../services/lineupCleanupService";
import type { GameMutationInput } from "../../hooks/useOfflineMutations";
import { buildDeterministicStartPlayTimeRecordId } from "../../utils/playTimeRecordId";
import type {
  Game,
  Team,
  Player,
  PlayerWithRoster,
  FormationPosition,
  LineupAssignment,
  PlayTimeRecord,
} from "./types";

interface LineupPanelProps {
  gameState: Game;
  game: Game;
  team: Team;
  players: PlayerWithRoster[];
  positions: FormationPosition[];
  lineup: LineupAssignment[];
  playTimeRecords: PlayTimeRecord[];
  currentTime: number;
  hideAvailablePlayers?: boolean;
  isReadOnly?: boolean;
  onSubstitute: (position: FormationPosition) => void;
  mutations: GameMutationInput;
  currentUserId?: string;
  viewMode?: "list" | "shape";
  onViewModeChange?: (mode: "list" | "shape") => void;
  onResetViewPreference?: () => void;
}

type ShapeActionResult = "success" | "conflict" | "error";
type ShapeClearActionResult = ShapeActionResult | "cancelled";

export function LineupPanel({
  gameState,
  game,
  team,
  players,
  positions,
  lineup,
  playTimeRecords,
  currentTime,
  hideAvailablePlayers = false,
  isReadOnly = false,
  onSubstitute,
  mutations,
  viewMode = "list",
  onViewModeChange,
  onResetViewPreference,
}: LineupPanelProps) {
  const confirm = useConfirm();
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [showPositionPicker, setShowPositionPicker] = useState(false);

  // Assignment ids whose delete has been fired but hasn't round-tripped back through
  // the observeQuery subscription yet. Slots referencing these ids are treated as
  // already-empty so the UI updates the instant a coach clicks remove, instead of
  // waiting on network latency and inviting repeat clicks (#172).
  const [pendingRemovalIds, setPendingRemovalIds] = useState<Set<string>>(new Set());
  const isPendingRemoval = (id?: string | null) => !!id && pendingRemovalIds.has(id);
  const visibleLineup = lineup.filter(l => !isPendingRemoval(l.id));

  const startersCount = positions.filter(pos =>
    visibleLineup.some(l => l.positionId === pos.id && l.isStarter)
  ).length;

  const shapeEnabled = gameState.status === "scheduled" || gameState.status === "in-progress" || gameState.status === "halftime";
  const resolvedViewMode = shapeEnabled ? viewMode : "list";
  const isInteractive = !isReadOnly;

  const interactionAdapter = createLineupInteractionAdapter({
    gameStatus: gameState.status ?? "",
    startersCount,
    maxStarters: team.maxPlayersOnField,
    onSubstitute,
    onQuickReplace: () => undefined,
    onStarterLimitReached: showWarning,
  });

  const isInLineup = (playerId: string) => isPlayerInLineup(playerId, visibleLineup);

  const getPositionPlayer = (positionId: string) => {
    const assignment = visibleLineup.find(l => l.positionId === positionId && l.isStarter);
    if (!assignment) return null;
    return players.find(p => p.id === assignment.playerId);
  };

  const getPlayerPosition = (playerId: string) => {
    const assignment = visibleLineup.find(l => l.playerId === playerId);
    if (!assignment?.positionId) return null;
    return positions.find(p => p.id === assignment.positionId);
  };

  const getPlayerPlayTime = (playerId: string): string => {
    const totalSeconds = calculatePlayerPlayTime(playerId, playTimeRecords, currentTime);
    return formatPlayTime(totalSeconds, 'short');
  };

  const isCurrentlyPlaying = (playerId: string) => isPlayerCurrentlyPlaying(playerId, playTimeRecords);

  const isConflictError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error);
    return /conflict|already assigned|conditionalcheckfailed/i.test(message);
  };

  const isMissingRecordError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error);
    return /not found|does not exist|cannot find/i.test(message);
  };

  const handleRemoveFromLineup = async (lineupId: string) => {
    if (!isInteractive) return;
    if (!lineupId) return;
    if (isPendingRemoval(lineupId)) return; // already in flight — avoid a duplicate delete call
    // Looked up before the delete — once it succeeds this id may no longer be in `lineup`.
    const positionId = lineup.find(l => l.id === lineupId)?.positionId;
    // Optimistically hide the slot immediately so the click has visible effect
    // even before the delete round-trips back through the subscription.
    setPendingRemovalIds(prev => new Set(prev).add(lineupId));
    try {
      await mutations.deleteLineupAssignment(lineupId);
    } catch (error) {
      if (isConflictError(error) || isMissingRecordError(error)) {
        // Treat stale delete targets as already-cleared to avoid noisy halftime errors.
        // Only clean up on "already gone" — a genuine conflict may mean another
        // coach just seated a new, legitimate assignment on this position.
        if (positionId && isMissingRecordError(error)) {
          void cleanupDuplicateAssignmentsForPosition(game.id, positionId, lineupId);
        }
        return;
      }
      // Unexpected failure — restore the slot so the coach can see it's still there and retry.
      setPendingRemovalIds(prev => {
        const next = new Set(prev);
        next.delete(lineupId);
        return next;
      });
      handleApiError(error, 'Failed to remove player from lineup');
      return;
    }
    // Issue #215: a same-position orphan (left behind by, e.g., a failed delete
    // during a substitution) is hidden by useGameSubscriptions.ts's dedup — but
    // deleting only the visible assignment above would unmask it, making the
    // clear look like it silently did nothing. Delete it too.
    if (positionId) void cleanupDuplicateAssignmentsForPosition(game.id, positionId, lineupId);
  };

  const handleClearAllPositions = async () => {
    if (!isInteractive) return;
    // Base the batch on visibleLineup so an id already hidden by an in-flight
    // individual remove isn't re-submitted for deletion here.
    const starterAssignments = visibleLineup.filter(
      (assignment): assignment is typeof assignment & { id: string } =>
        assignment.isStarter && typeof assignment.id === 'string' && assignment.id.length > 0,
    );
    if (starterAssignments.length === 0) return;

    const confirmed = await confirm({
      title: 'Clear Lineup',
      message: `Remove all ${startersCount} players from the lineup?`,
      confirmText: 'Clear All',
      variant: 'warning',
    });
    if (!confirmed) return;

    const idsToRemove = starterAssignments.map((assignment) => assignment.id);
    setPendingRemovalIds(prev => new Set([...prev, ...idsToRemove]));

    try {
      const results = await Promise.allSettled(
        starterAssignments.map((assignment) => mutations.deleteLineupAssignment(assignment.id)),
      );
      const unexpectedFailureIds = starterAssignments
        .filter((_, index) => {
          const result = results[index];
          return result.status === 'rejected'
            && !isConflictError(result.reason)
            && !isMissingRecordError(result.reason);
        })
        .map((assignment) => assignment.id);

      if (unexpectedFailureIds.length > 0) {
        // Restore only the slots that actually failed — ones that succeeded (or hit a
        // benign conflict/missing-record error) stay hidden instead of flashing back in.
        setPendingRemovalIds(prev => {
          const next = new Set(prev);
          unexpectedFailureIds.forEach(id => next.delete(id));
          return next;
        });
        const firstUnexpectedFailure = results.find(
          (result) =>
            result.status === 'rejected'
            && !isConflictError(result.reason)
            && !isMissingRecordError(result.reason),
        ) as PromiseRejectedResult;
        throw firstUnexpectedFailure.reason;
      }

      // Issue #215: clean up any same-position orphan left hidden by
      // useGameSubscriptions.ts's dedup, for every position that actually
      // cleared (succeeded, or was already gone) above — see
      // handleRemoveFromLineup's own comment for why deleting only the
      // visible assignment isn't enough. Skipped for a genuine conflict (as
      // opposed to "already gone"): another coach may have just seated a new,
      // legitimate assignment on that position.
      starterAssignments
        .filter((assignment, index) => {
          if (!assignment.positionId) return false;
          const result = results[index];
          return result.status === 'fulfilled'
            || (result.status === 'rejected' && isMissingRecordError(result.reason));
        })
        .forEach((assignment) => {
          void cleanupDuplicateAssignmentsForPosition(game.id, assignment.positionId as string, assignment.id);
        });
    } catch (error) {
      handleApiError(error, 'Failed to clear lineup');
    }
  };

  const handleShapeQuickReplace = async (params: {
    assignmentId: string;
    playerId: string;
    positionId: string;
  }): Promise<ShapeActionResult> => {
    if (!isInteractive) {
      return "error";
    }

    const targetStarter = lineup.find(
      (entry) => entry.isStarter && entry.positionId === params.positionId,
    );

    const selectedPlayerStarter = lineup.find(
      (entry) => entry.isStarter && entry.playerId === params.playerId,
    );

    try {
      try {
        await mutations.updateLineupAssignment(params.assignmentId, {
          playerId: params.playerId,
        });
      } catch (error) {
        if (!isMissingRecordError(error)) {
          if (isConflictError(error)) {
            return "conflict";
          }

          handleApiError(error, 'Failed to update lineup slot');
          return "error";
        }

        try {
          await mutations.createLineupAssignment({
            gameId: game.id,
            playerId: params.playerId,
            positionId: params.positionId,
            isStarter: true,
            coaches: team.coaches,
          });
        } catch (fallbackError) {
          if (isConflictError(fallbackError)) {
            return "conflict";
          }

          handleApiError(fallbackError, 'Failed to update lineup slot');
          return "error";
        }
      }

      if (!selectedPlayerStarter || selectedPlayerStarter.id === params.assignmentId) {
        return "success";
      }

      try {
        await mutations.deleteLineupAssignment(selectedPlayerStarter.id);
        return "success";
      } catch (cleanupError) {
        const rollbackTargetPlayerId = targetStarter?.playerId ?? null;

        if (rollbackTargetPlayerId && rollbackTargetPlayerId !== params.playerId) {
          try {
            await mutations.updateLineupAssignment(params.assignmentId, {
              playerId: rollbackTargetPlayerId,
            });
          } catch (rollbackError) {
            if (isConflictError(rollbackError) || isMissingRecordError(rollbackError)) {
              return "conflict";
            }

            handleApiError(rollbackError, 'Failed to rollback lineup slot after cleanup failure');
            return "error";
          }
        }

        if (isConflictError(cleanupError) || isMissingRecordError(cleanupError)) {
          return "conflict";
        }

        handleApiError(cleanupError, 'Failed to clean up previous starter assignment');
        return "error";
      }
    } catch (error) {
      if (isConflictError(error)) {
        return "conflict";
      }

      handleApiError(error, 'Failed to update lineup slot');
      return "error";
    }
  };

  const handleShapeClearSlot = async (params: {
    assignmentId: string;
    positionName: string;
    playerName: string;
  }): Promise<ShapeClearActionResult> => {
    if (!isInteractive) {
      return "error";
    }

    const confirmed = await confirm({
      title: 'Clear Position',
      message: `Remove ${params.playerName} from ${params.positionName}?`,
      confirmText: 'Clear Slot',
      variant: 'warning',
    });

    if (!confirmed) {
      return "cancelled";
    }

    const positionId = lineup.find(l => l.id === params.assignmentId)?.positionId;

    try {
      await mutations.deleteLineupAssignment(params.assignmentId);
      // Issue #215: see handleRemoveFromLineup's own comment on why a
      // same-position orphan must be deleted too, not just the visible one.
      if (positionId) void cleanupDuplicateAssignmentsForPosition(game.id, positionId, params.assignmentId);
      return "success";
    } catch (error) {
      if (isConflictError(error) || isMissingRecordError(error)) {
        // Only clean up when the assignment was simply already gone — a genuine
        // optimistic-concurrency conflict may mean another coach just seated a
        // new, legitimate assignment on this position, which must not be swept
        // up as an "orphan" here.
        if (positionId && isMissingRecordError(error)) {
          void cleanupDuplicateAssignmentsForPosition(game.id, positionId, params.assignmentId);
        }
        return "conflict";
      }

      handleApiError(error, 'Failed to remove player from lineup');
      return "error";
    }
  };

  const handlePlayerClick = (player: Player) => {
    if (!isInteractive) return;
    const existing = visibleLineup.find(l => l.playerId === player.id);

    if (existing) {
      void handleRemoveFromLineup(existing.id);
    } else {
      if (startersCount >= team.maxPlayersOnField) {
        showWarning(`Maximum ${team.maxPlayersOnField} starters allowed`);
        return;
      }
      setSelectedPlayer(player);
      setShowPositionPicker(true);
    }
  };

  const handleEmptyPositionClick = (position: FormationPosition) => {
    if (!isInteractive) return;
    interactionAdapter.getEmptyNodeInteraction(position).onTap();
  };

  const handleAssignPosition = async (positionId: string) => {
    if (!isInteractive) return;
    if (!selectedPlayer) return;

    try {
      await mutations.createLineupAssignment({
        gameId: game.id,
        playerId: selectedPlayer.id,
        positionId: positionId,
        isStarter: true,
        coaches: team.coaches,
      });

      if (gameState.status === 'in-progress') {
        await mutations.createPlayTimeRecord({
          id: buildDeterministicStartPlayTimeRecordId({
            gameId: game.id,
            playerId: selectedPlayer.id,
            half: gameState.currentHalf === 2 ? 2 : 1,
            startGameSeconds: currentTime,
          }),
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
      handleApiError(error, 'Failed to add player to lineup');
    }
  };

  return (
    <>
      {/* Position-based Lineup */}
      <div className="lineup-section">
        <div className="lineup-header">
          <h2>
            {gameState.status === 'halftime' ? 'Second Half Lineup' : gameState.status === 'in-progress' ? 'Current Lineup' : 'Starting Lineup'} ({startersCount}/{team.maxPlayersOnField})
          </h2>
          <div className="lineup-header__actions">
            {shapeEnabled && (
              <div className="lineup-view-toggle" role="group" aria-label="Lineup view mode">
                <button
                  type="button"
                  className={`btn-secondary ${resolvedViewMode === "list" ? "is-active" : ""}`}
                  onClick={() => onViewModeChange?.("list")}
                  disabled={!isInteractive}
                >
                  List
                </button>
                <button
                  type="button"
                  className={`btn-secondary ${resolvedViewMode === "shape" ? "is-active" : ""}`}
                  onClick={() => onViewModeChange?.("shape")}
                  disabled={!isInteractive}
                >
                  Shape
                </button>
                {onResetViewPreference && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={onResetViewPreference}
                    disabled={!isInteractive}
                  >
                    Reset View
                  </button>
                )}
              </div>
            )}
            {gameState.status === 'halftime' && (
              <button
                onClick={handleClearAllPositions}
                className="btn-clear-lineup"
                disabled={!isInteractive || startersCount === 0}
              >
                Clear All Positions
              </button>
            )}
          </div>
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
        ) : resolvedViewMode === "shape" ? (
          <LineupShapeView
            gameState={gameState}
            game={game}
            positions={positions}
            lineup={lineup}
            players={players}
            playTimeRecords={playTimeRecords}
            currentTime={currentTime}
            teamMaxPlayersOnField={team.maxPlayersOnField}
            onSubstitute={onSubstitute}
            onQuickReplace={handleShapeQuickReplace}
            onClearSlot={handleShapeClearSlot}
            isReadOnly={isReadOnly}
          />
        ) : gameState.status === 'scheduled' ? (
          isInteractive ? (
            <LineupBuilder
              positions={positions}
              availablePlayers={players.filter(p => p.isActive)}
              lineup={new Map(lineup.filter(l => l.positionId && l.playerId).map(l => [l.positionId as string, l.playerId]))}
              onLineupChange={async (positionId, playerId) => {
                const existing = lineup.find(l => l.positionId === positionId);

                if (playerId === '') {
                  if (existing) {
                    await mutations.deleteLineupAssignment(existing.id);
                  }
                } else {
                  const playerExisting = lineup.find(l => l.playerId === playerId);
                  if (playerExisting) {
                    await mutations.deleteLineupAssignment(playerExisting.id);
                  }

                  if (existing) {
                    await mutations.updateLineupAssignment(existing.id, { playerId });
                  } else {
                    await mutations.createLineupAssignment({
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
            />
          ) : (
            <div className="lineup-readonly-message" role="note">
              Lineup editing is disabled in this view.
            </div>
          )
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
                            isInteractive ? (
                              <button
                                onClick={() => {
                                  // Match getPositionPlayer's lookup (visibleLineup + isStarter) exactly so
                                  // this always targets the assignment actually rendered in the slot, not a
                                  // stale one still round-tripping through the subscription (#172).
                                  const assignment = visibleLineup.find(l => l.positionId === position.id && l.isStarter);
                                  if (assignment) void handleRemoveFromLineup(assignment.id);
                                }}
                                className="btn-remove-small"
                              >
                                ✕
                              </button>
                            ) : null
                          ) : (
                            isInteractive ? (
                              <div className="player-actions">
                                <button
                                  onClick={() => onSubstitute(position)}
                                  className="btn-substitute"
                                  title="Make substitution"
                                >
                                  ⇄
                                </button>
                              </div>
                            ) : null
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
                        className={`empty-slot ${isInteractive && (gameState.status === 'halftime' || gameState.status === 'scheduled') ? 'clickable' : ''}`}
                        onClick={isInteractive ? () => handleEmptyPositionClick(position) : undefined}
                        title={isInteractive && (gameState.status === 'halftime' || gameState.status === 'scheduled') ? 'Click to assign player' : ''}
                      >
                        Empty
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {gameState.status !== 'scheduled' && !hideAvailablePlayers && (
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
                        className={`player-card ${isInteractive ? 'clickable' : ''} ${inLineup ? 'in-lineup' : ''} ${playing ? 'currently-playing' : ''}`}
                        onClick={isInteractive ? () => handlePlayerClick(player) : undefined}
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
      {isInteractive && showPositionPicker && selectedPlayer && (
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
