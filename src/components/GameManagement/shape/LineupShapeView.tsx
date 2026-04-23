import { useMemo, useState } from "react";
import { calculatePlayerPlayTime, formatPlayTime } from "../../../utils/playTimeCalculations";
import { showError, showSuccess } from "../../../utils/toast";
import type {
  FormationPosition,
  Game,
  LineupAssignment,
  PlayTimeRecord,
  PlayerWithRoster,
} from "../types";
import {
  buildLineupShapeNodes,
  LINEUP_SHAPE_LAYOUT_VERSION,
  type LineupShapeNode,
} from "./lineupShapeDeterminism";
import {
  createLineupInteractionAdapter,
  playerHasPreferredPositions,
  playerPreferredForPosition,
  sortBenchPlayersByPriority,
} from "./lineupInteractionAdapter";
import { exportLineupShapeLocally, type ExportBenchPlayer } from "./exportLineupShape";

interface LineupShapeViewProps {
  gameState: Game;
  game: Game;
  positions: FormationPosition[];
  lineup: LineupAssignment[];
  players: PlayerWithRoster[];
  playTimeRecords: PlayTimeRecord[];
  currentTime: number;
  teamMaxPlayersOnField: number;
  onSubstitute: (position: FormationPosition) => void;
  onRemoveFromLineup: (lineupId: string) => Promise<void>;
}

function getPlayerName(player: PlayerWithRoster | undefined): string {
  if (!player) return "Unknown player";
  return `${player.firstName} ${player.lastName}`.trim();
}

export function LineupShapeView({
  gameState,
  game,
  positions,
  lineup,
  players,
  playTimeRecords,
  currentTime,
  teamMaxPlayersOnField,
  onSubstitute,
  onRemoveFromLineup,
}: LineupShapeViewProps) {
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);

  const nodes = useMemo(() => buildLineupShapeNodes(positions), [positions]);
  const lineupByPosition = useMemo(() => {
    const map = new Map<string, LineupAssignment>();
    for (const assignment of lineup) {
      if (assignment.isStarter && assignment.positionId) {
        map.set(assignment.positionId, assignment);
      }
    }
    return map;
  }, [lineup]);

  const positionsById = useMemo(() => {
    return new Map(positions.map((position) => [position.id, position]));
  }, [positions]);

  const playersById = useMemo(() => {
    return new Map(players.map((player) => [player.id, player]));
  }, [players]);

  const startersCount = lineup.filter((assignment) => assignment.isStarter).length;

  const interactionAdapter = useMemo(() => {
    return createLineupInteractionAdapter({
      gameStatus: gameState.status ?? "",
      startersCount,
      maxStarters: teamMaxPlayersOnField,
      onSubstitute,
      onStarterLimitReached: (message) => showError(message),
    });
  }, [gameState.status, onSubstitute, startersCount, teamMaxPlayersOnField]);

  const benchPlayers = useMemo(() => {
    const bench = players.filter((player) => !lineup.some((entry) => entry.playerId === player.id && entry.isStarter));
    return sortBenchPlayersByPriority({
      benchPlayers: bench,
      currentPositionId: selectedPositionId ?? undefined,
      getPlayTimeSeconds: (playerId: string) => calculatePlayerPlayTime(playerId, playTimeRecords, currentTime),
    });
  }, [currentTime, lineup, playTimeRecords, players, selectedPositionId]);

  const benchStrip = useMemo<ExportBenchPlayer[]>(() => {
    return benchPlayers.map((player) => ({
      playerId: player.id,
      playerNumber: player.playerNumber ?? null,
      name: getPlayerName(player),
      playTimeSeconds: calculatePlayerPlayTime(player.id, playTimeRecords, currentTime),
    }));
  }, [benchPlayers, currentTime, playTimeRecords]);

  const handleNodeTap = (node: LineupShapeNode, assignment: LineupAssignment | undefined) => {
    const position = positionsById.get(node.positionId);
    if (!position) return;

    setSelectedPositionId(position.id);

    if (!assignment) {
      const interaction = interactionAdapter.getEmptyNodeInteraction(position);
      interaction.onTap();
      return;
    }

    const interaction = interactionAdapter.getAssignedNodeInteraction(position);
    interaction.onTap();
  };

  const handleExport = () => {
    try {
      const { filename } = exportLineupShapeLocally({
        fileStem: `game-${game.id}`,
        layoutVersion: LINEUP_SHAPE_LAYOUT_VERSION,
        nodes,
        lineup,
        playersById,
        benchStrip,
      });
      showSuccess(`Exported lineup shape (${filename})`);
    } catch (error) {
      console.error("[LineupShapeView] export failed", error);
      showError("Unable to export lineup shape locally.");
    }
  };

  return (
    <section className="lineup-shape-view" aria-label="Lineup shape view">
      <div className="lineup-shape-view__toolbar">
        <span className="lineup-shape-view__layout-version">Layout {LINEUP_SHAPE_LAYOUT_VERSION}</span>
        <button
          type="button"
          className="btn-secondary"
          onClick={handleExport}
          aria-label="Export lineup shape and bench strip to local file"
        >
          Export Shape
        </button>
      </div>

      {gameState.status === "halftime" && (
        <p className="lineup-shape-view__halftime-preview" aria-live="polite">
          Halftime preview: update the second-half lineup before restarting play.
        </p>
      )}

      <div className="lineup-shape-view__pitch" role="img" aria-label="Soccer lineup shape">
        <div className="lineup-shape-view__pitch-grid" />
        {nodes.map((node) => {
          const assignment = lineupByPosition.get(node.positionId);
          const player = assignment?.playerId ? playersById.get(assignment.playerId) : undefined;
          const playerName = getPlayerName(player);
          const showRemove = Boolean(assignment && gameState.status !== "in-progress");
          const nodePlayerLabel = assignment && player
            ? `#${player.playerNumber ?? "?"} ${player.firstName}`
            : "Empty";
          const outOfPosition = Boolean(
            player
              && assignment?.positionId
              && playerHasPreferredPositions(player)
              && !playerPreferredForPosition(player, assignment.positionId),
          );
          const position = positionsById.get(node.positionId);
          const interaction = assignment && position
            ? interactionAdapter.getAssignedNodeInteraction(position)
            : position
              ? interactionAdapter.getEmptyNodeInteraction(position)
              : null;

          return (
            <div
              key={node.positionId}
              className={`lineup-shape-node ${assignment ? "lineup-shape-node--assigned" : "lineup-shape-node--empty"} ${showRemove ? "lineup-shape-node--removable" : ""} ${selectedPositionId === node.positionId ? "lineup-shape-node--selected" : ""}`}
              style={{ left: `${node.xPct}%`, top: `${node.yPct}%` }}
            >
              <button
                type="button"
                className="lineup-shape-node__tap-target"
                onClick={() => handleNodeTap(node, assignment)}
                aria-label={`${node.positionName}: ${assignment ? playerName : "empty"}`}
                title={interaction?.title ?? "Unavailable"}
                disabled={!interaction?.canTap}
              >
                <span className="lineup-shape-node__position">{node.abbreviation || node.positionName}</span>
                <span className="lineup-shape-node__player" title={nodePlayerLabel}>{nodePlayerLabel}</span>
                {outOfPosition && <span className="lineup-shape-node__detail">Out of position</span>}
              </button>

              {showRemove && assignment && (
                <button
                  type="button"
                  className="lineup-shape-node__remove"
                  onClick={() => void onRemoveFromLineup(assignment.id)}
                  aria-label={`Remove ${playerName} from ${node.positionName}`}
                >
                  <span className="lineup-shape-node__remove-icon" aria-hidden="true">×</span>
                  <span className="sr-only">Remove player</span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div
        className="lineup-shape-view__bench-strip"
        role="region"
        aria-label="Locked bench strip"
      >
        <div className="lineup-shape-view__bench-header">
          <strong>Locked bench strip</strong>
          <span>
            Ordered by lowest play time{selectedPositionId ? ", then preferred-position fit" : ""}.
          </span>
        </div>
        <ul className="lineup-shape-view__bench-list">
          {benchPlayers.map((player) => {
            const playTimeSeconds = calculatePlayerPlayTime(player.id, playTimeRecords, currentTime);
            const preferred = selectedPositionId
              ? playerPreferredForPosition(player, selectedPositionId)
              : false;
            return (
              <li key={player.id} className="lineup-shape-view__bench-item">
                <span>#{player.playerNumber ?? "?"} {player.firstName} {player.lastName}</span>
                <span>{formatPlayTime(playTimeSeconds, "short")}</span>
                {preferred && <span className="lineup-shape-view__bench-fit">Fit</span>}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
