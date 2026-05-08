/**
 * PlannerLineupView — Visual lineup field for Plan tab timeline states.
 *
 * Renders the lineup from a positionId→playerId Map without routing through
 * live LineupAssignment mutations. All assignment changes are reported via
 * the `onPositionAssign` callback. Never calls DynamoDB directly.
 */

import { useMemo } from "react";
import { LineupShapeView } from "./shape/LineupShapeView";
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

  // List view: simple position → player-select grid.
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
      {positions.map((pos) => {
        const assignedPlayerId = displayLineup.get(pos.id) ?? "";
        const assignedPlayer = assignedPlayerId ? playerMap.get(assignedPlayerId) : null;
        const posLabel = pos.abbreviation || pos.positionName || "Position";
        const sortedPlayers = [...players].sort((a, b) => {
          const aPreferred = parsePreferredPositions(a.preferredPositions).has(pos.id);
          const bPreferred = parsePreferredPositions(b.preferredPositions).has(pos.id);

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

        return (
          <div key={pos.id} className="planner-lineup-view__row">
            <span className="planner-lineup-view__position-label">{posLabel}</span>
            {isReadOnly ? (
              <span className="planner-lineup-view__player-name">
                {assignedPlayer
                  ? getPlayerDisplayName(assignedPlayer) || "Unassigned"
                  : "Unassigned"}
              </span>
            ) : (
              <select
                className="planner-lineup-view__select"
                value={assignedPlayerId}
                aria-label={`Player for ${posLabel}`}
                onChange={(e) => {
                  onPositionAssign?.(pos.id, e.target.value);
                }}
              >
                <option value="">Unassigned</option>
                {sortedPlayers
                  .filter((p) => {
                    // Always show the currently assigned player; hide players assigned to other positions
                    if (p.id === assignedPlayerId) return true;
                    for (const [pid, vid] of displayLineup.entries()) {
                      if (pid !== pos.id && vid === p.id) return false;
                    }
                    return true;
                  })
                  .map((p) => {
                    const isPreferred = parsePreferredPositions(p.preferredPositions).has(pos.id);
                    const num = p.playerNumber != null ? `#${p.playerNumber} ` : '';
                    const displayName = `${num}${getPlayerDisplayName(p)}`;
                    const label = isPreferred ? `⭐ ${displayName}` : displayName;

                    return (
                    <option key={p.id} value={p.id}>
                      {label}
                    </option>
                    );
                  })}
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}
