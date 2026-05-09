/**
 * PlannerLineupView — Visual lineup field for Plan tab timeline states.
 *
 * Renders the lineup from a positionId→playerId Map without routing through
 * live LineupAssignment mutations. All assignment changes are reported via
 * the `onPositionAssign` callback. Never calls DynamoDB directly.
 */

import { useMemo, useState } from "react";
import { LineupShapeView } from "./shape/LineupShapeView";
import { useAvailability } from "../../contexts/AvailabilityContext";
import type {
  FormationPosition,
  Game,
  PlayerWithRoster,
  LineupAssignment,
  Team,
} from "./types";

export interface PlannerLineupViewProps {
  /** Planner lineup: positionId → playerId (empty string or missing = unassigned) */
  displayLineup: Map<string, string>;
  positions: FormationPosition[];
  players: PlayerWithRoster[];
  /** Called when a position assignment changes. playerId === '' means cleared. */
  onPositionAssign?: (positionId: string, playerId: string) => void;
  /** True = no interaction, visual only. */
  isReadOnly: boolean;
  /** Human-readable label for ARIA (e.g. "Starting lineup", "Halftime lineup"). */
  label?: string;
  viewMode?: "list" | "shape";
  onViewModeChange?: (mode: "list" | "shape") => void;
  /** Game context for shape view (SoccerPitchSurface). */
  game?: Game;
  /** Team context for shape view. */
  team?: Team;
}

/**
 * Convert a positionId→playerId Map to synthetic LineupAssignment records.
 * Synthetic ids use the prefix "plan-<positionId>" so that onClearSlot can
 * extract the positionId by slicing the prefix.
 */
function displayLineupToAssignments(
  displayLineup: Map<string, string>,
): LineupAssignment[] {
  const assignments: LineupAssignment[] = [];
  for (const [positionId, playerId] of displayLineup.entries()) {
    if (playerId) {
      assignments.push({
        id: `plan-${positionId}`,
        positionId,
        playerId,
        isStarter: true,
        gameId: "",
        coaches: [],
      } as unknown as LineupAssignment);
    }
  }
  return assignments;
}

export function PlannerLineupView({
  displayLineup,
  positions,
  players,
  onPositionAssign,
  isReadOnly,
  label,
  viewMode = "list",
  onViewModeChange,
  game,
  team,
}: PlannerLineupViewProps) {
  const { getPlayerAvailability } = useAvailability();
  const [dragSource, setDragSource] = useState<{
    playerId: string;
    sourcePositionId: string | null;
  } | null>(null);

  const parsePreferredPositions = (preferredPositions?: string): Set<string> => {
    if (!preferredPositions) return new Set<string>();
    return new Set(
      preferredPositions
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
  };

  const getPlayerDisplayName = (player: PlayerWithRoster): string => {
    return `${player.firstName ?? ""} ${player.lastName ?? ""}`.trim() || player.id;
  };

  const syntheticAssignments = useMemo(
    () => displayLineupToAssignments(displayLineup),
    [displayLineup],
  );

  const playerMap = useMemo(
    () => new Map(players.map((p) => [p.id, p])),
    [players],
  );

  const assignedPlayerIds = useMemo(
    () => new Set(Array.from(displayLineup.values()).filter(Boolean)),
    [displayLineup],
  );

  const benchPlayers = useMemo(
    () => players.filter((player) => !assignedPlayerIds.has(player.id)),
    [assignedPlayerIds, players],
  );

  const supportsShapeToggle = Boolean(onViewModeChange && game && team);
  const viewModeToggle = supportsShapeToggle ? (
    <div className="lineup-view-toggle" role="group" aria-label="Planner lineup view mode">
      <button
        type="button"
        className={`btn-secondary ${viewMode === "list" ? "is-active" : ""}`}
        onClick={() => onViewModeChange?.("list")}
        aria-pressed={viewMode === "list"}
        aria-label="List view"
      >
        List
      </button>
      <button
        type="button"
        className={`btn-secondary ${viewMode === "shape" ? "is-active" : ""}`}
        onClick={() => onViewModeChange?.("shape")}
        aria-pressed={viewMode === "shape"}
        aria-label="Shape view"
      >
        Shape
      </button>
    </div>
  ) : null;

  if (viewMode === "shape" && game && team) {
    // Shape view: delegate to LineupShapeView with planner-safe routing.
    // onQuickReplace fires when a bench player is selected in the quick-replace dialog.
    // onClearSlot fires when the "clear slot" action is chosen.
    // Neither handler calls live mutations — both route through onPositionAssign.
    const shapeGame: Game = game;

    return (
      <div
        className="planner-lineup-view planner-lineup-view--shape"
        aria-label={label}
      >
        {viewModeToggle}
        <LineupShapeView
          gameState={shapeGame}
          game={shapeGame}
          positions={positions}
          lineup={syntheticAssignments}
          players={players}
          playTimeRecords={[]}
          currentTime={0}
          teamMaxPlayersOnField={team.maxPlayersOnField}
          onSubstitute={() => undefined}
          onQuickReplace={async ({ positionId, playerId }) => {
            if (!isReadOnly) {
              onPositionAssign?.(positionId, playerId);
            }
            return "success";
          }}
          onClearSlot={async ({ assignmentId }) => {
            if (!isReadOnly) {
              // assignmentId is "plan-<positionId>"
              const positionId = assignmentId.startsWith("plan-")
                ? assignmentId.slice(5)
                : assignmentId;
              onPositionAssign?.(positionId, "");
            }
            return "success";
          }}
          isReadOnly={isReadOnly}
        />
      </div>
    );
  }

  const isUnavailableStatus = (status: string): boolean =>
    status === "absent" || status === "injured";

  const getPreferredPositionLabels = (player: PlayerWithRoster): string => {
    const preferredIds = Array.from(parsePreferredPositions(player.preferredPositions));
    if (preferredIds.length === 0) return "";

    const labels = positions
      .filter((position) => preferredIds.includes(position.id))
      .map((position) => position.abbreviation || position.positionName)
      .filter(Boolean);

    return labels.length > 0 ? `(${labels.join(", ")})` : "";
  };

  const getSortedPlayersForPosition = (
    position: FormationPosition,
  ): PlayerWithRoster[] => {
    return [...players]
      .sort((a, b) => {
        const aPreferred = parsePreferredPositions(a.preferredPositions).has(position.id);
        const bPreferred = parsePreferredPositions(b.preferredPositions).has(position.id);

        if (aPreferred !== bPreferred) {
          return aPreferred ? -1 : 1;
        }

        const aNum = a.playerNumber ?? Number.MAX_SAFE_INTEGER;
        const bNum = b.playerNumber ?? Number.MAX_SAFE_INTEGER;
        if (aNum !== bNum) {
          return aNum - bNum;
        }

        return getPlayerDisplayName(a).localeCompare(getPlayerDisplayName(b));
      });
  };

  const handleDragStart = (playerId: string, sourcePositionId: string | null) => {
    const player = playerMap.get(playerId);
    if (!player) return;

    const status = getPlayerAvailability(playerId);
    if (isUnavailableStatus(status)) return;

    setDragSource({ playerId, sourcePositionId });
  };

  const clearDragSource = () => {
    setDragSource(null);
  };

  const handleDropOnPosition = (targetPosition: FormationPosition) => {
    if (!dragSource || isReadOnly) return;

    const draggedPlayer = playerMap.get(dragSource.playerId);
    if (!draggedPlayer) {
      clearDragSource();
      return;
    }

    const targetPlayerId = displayLineup.get(targetPosition.id) ?? "";

    if (dragSource.sourcePositionId === targetPosition.id) {
      clearDragSource();
      return;
    }

    if (dragSource.sourcePositionId === null) {
      onPositionAssign?.(targetPosition.id, dragSource.playerId);
      clearDragSource();
      return;
    }

    onPositionAssign?.(targetPosition.id, dragSource.playerId);
    if (targetPlayerId) {
      onPositionAssign?.(dragSource.sourcePositionId, targetPlayerId);
    } else {
      onPositionAssign?.(dragSource.sourcePositionId, "");
    }
    clearDragSource();
  };

  const handleDropOnBench = () => {
    if (!dragSource || isReadOnly) return;
    if (!dragSource.sourcePositionId) {
      clearDragSource();
      return;
    }

    onPositionAssign?.(dragSource.sourcePositionId, "");
    clearDragSource();
  };

  return (
    <div
      className="planner-lineup-view planner-lineup-view--list"
      aria-label={label}
    >
      {viewModeToggle}
      {positions.length === 0 && (
        <p className="planner-lineup-view__empty" role="status">
          No positions defined for this formation yet.
        </p>
      )}
      {positions.length > 0 && (
        <>
          <div className="position-lineup-grid">
            {positions.map((pos) => {
              const assignedPlayerId = displayLineup.get(pos.id) ?? "";
              const assignedPlayer = assignedPlayerId ? playerMap.get(assignedPlayerId) : null;
              const posLabel = pos.abbreviation || pos.positionName || "Position";
              const playerStatus = assignedPlayer ? getPlayerAvailability(assignedPlayer.id) : "available";
              const isUnavailable = isUnavailableStatus(playerStatus);
              const sortedPlayers = getSortedPlayersForPosition(pos);

              return (
                <div
                  key={pos.id}
                  className="position-slot"
                  onDragOver={(event) => {
                    if (!isReadOnly) {
                      event.preventDefault();
                    }
                  }}
                  onDrop={() => {
                    handleDropOnPosition(pos);
                  }}
                >
                  <div className="position-label">{posLabel}</div>
                  {assignedPlayer ? (
                    <div
                      className={`assigned-player ${isUnavailable ? "unavailable" : ""}`.trim()}
                      draggable={!isReadOnly && !isUnavailable}
                      onDragStart={() => handleDragStart(assignedPlayer.id, pos.id)}
                      onDragEnd={clearDragSource}
                    >
                      <span className="player-number">#{assignedPlayer.playerNumber || 0}</span>
                      <span className="player-name-short">{getPlayerDisplayName(assignedPlayer)}</span>
                      {!isReadOnly && (
                        <button
                          type="button"
                          className="remove-player"
                          aria-label={`Remove ${getPlayerDisplayName(assignedPlayer)} from ${posLabel}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onPositionAssign?.(pos.id, "");
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ) : isReadOnly ? (
                    <div className="planner-lineup-view__empty-slot">Unassigned</div>
                  ) : (
                    <select
                      className="player-select"
                      value={assignedPlayerId}
                      aria-label={`Player for ${posLabel}`}
                      onChange={(e) => {
                        onPositionAssign?.(pos.id, e.target.value);
                      }}
                    >
                      <option value="">Unassigned</option>
                      {sortedPlayers.map((player) => {
                        const isPreferred = parsePreferredPositions(player.preferredPositions).has(pos.id);
                        const isAssignedElsewhere = player.id !== assignedPlayerId && assignedPlayerIds.has(player.id);
                        const num = player.playerNumber != null ? `#${player.playerNumber} ` : "";
                        const displayName = `${num}${getPlayerDisplayName(player)}`;
                        const baseLabel = isPreferred ? `⭐ ${displayName}` : displayName;
                        const optionLabel = isAssignedElsewhere
                          ? `${baseLabel} (Assigned)`
                          : baseLabel;

                        return (
                          <option key={player.id} value={player.id}>
                            {optionLabel}
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
            onDragOver={(event) => {
              if (!isReadOnly) {
                event.preventDefault();
              }
            }}
            onDrop={handleDropOnBench}
          >
            <h4>Bench</h4>
            {benchPlayers.length === 0 ? (
              <p className="planner-lineup-view__bench-empty">All available players assigned.</p>
            ) : (
              <div className="bench-players">
                {benchPlayers.map((player) => {
                  const status = getPlayerAvailability(player.id);
                  const isUnavailable = isUnavailableStatus(status);
                  const preferredPositions = getPreferredPositionLabels(player);

                  return (
                    <div
                      key={player.id}
                      className={`bench-player ${isUnavailable ? "unavailable" : ""}`.trim()}
                      draggable={!isReadOnly && !isUnavailable}
                      onDragStart={() => handleDragStart(player.id, null)}
                      onDragEnd={clearDragSource}
                    >
                      <span className="player-number">#{player.playerNumber || 0}</span>
                      <span className="player-name">
                        {getPlayerDisplayName(player)}
                        {preferredPositions ? (
                          <span className="planner-lineup-view__preferred-positions"> {preferredPositions}</span>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
