import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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
  onQuickReplace: (params: { assignmentId: string; playerId: string; positionId: string }) => Promise<"success" | "conflict" | "error">;
  onClearSlot: (params: { assignmentId: string; positionName: string; playerName: string }) => Promise<"success" | "conflict" | "error" | "cancelled">;
}

type QuickReplaceStatus = "idle" | "loading" | "success" | "error" | "conflict";

const QUICK_REPLACE_COPY = {
  scheduled: {
    title: "Quick Replace",
    helper: "Select a bench player to update this starting slot before kickoff.",
  },
  halftime: {
    title: "Quick Replace",
    helper: "Select a bench player to update this second-half slot before restart.",
  },
  states: {
    idle: "Ready: choose a bench player or clear this slot.",
    loading: "Saving lineup update...",
    success: "Lineup slot updated successfully.",
    error: "Unable to update this slot right now. Please try again.",
    conflict: "Lineup changed from another update. Refresh and try again.",
  },
} as const;

interface QuickReplaceTarget {
  assignmentId: string;
  positionId: string;
  positionName: string;
  currentPlayerName: string;
  opener: HTMLElement | null;
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
  onQuickReplace,
  onClearSlot,
}: LineupShapeViewProps) {
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);
  const [quickReplaceTarget, setQuickReplaceTarget] = useState<QuickReplaceTarget | null>(null);
  const [quickReplaceStatus, setQuickReplaceStatus] = useState<QuickReplaceStatus>("idle");

  const quickReplaceTitleId = useId();
  const exportButtonRef = useRef<HTMLButtonElement>(null);
  const quickReplaceDialogRef = useRef<HTMLDivElement>(null);
  const quickReplaceCloseRef = useRef<HTMLButtonElement>(null);

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
      onQuickReplace: (position) => {
        const assignment = lineupByPosition.get(position.id);
        if (!assignment) {
          return;
        }

        const player = assignment.playerId ? playersById.get(assignment.playerId) : undefined;
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

        setQuickReplaceTarget({
          assignmentId: assignment.id,
          positionId: position.id,
          positionName: position.positionName,
          currentPlayerName: getPlayerName(player),
          opener,
        });
        setQuickReplaceStatus("idle");
      },
      onStarterLimitReached: (message) => showError(message),
    });
  }, [gameState.status, lineupByPosition, onSubstitute, playersById, startersCount, teamMaxPlayersOnField]);

  const benchPlayers = useMemo(() => {
    const bench = players.filter((player) => !lineup.some((entry) => entry.playerId === player.id && entry.isStarter));
    return sortBenchPlayersByPriority({
      benchPlayers: bench,
      currentPositionId: selectedPositionId ?? undefined,
      getPlayTimeSeconds: (playerId: string) => calculatePlayerPlayTime(playerId, playTimeRecords, currentTime),
    });
  }, [currentTime, lineup, playTimeRecords, players, selectedPositionId]);

  const quickReplaceBenchPlayers = useMemo(() => {
    if (!quickReplaceTarget) {
      return [];
    }

    return sortBenchPlayersByPriority({
      benchPlayers,
      currentPositionId: quickReplaceTarget.positionId,
      getPlayTimeSeconds: (playerId: string) => calculatePlayerPlayTime(playerId, playTimeRecords, currentTime),
    });
  }, [benchPlayers, currentTime, playTimeRecords, quickReplaceTarget]);

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

  const focusFallbackElement = useCallback(() => {
    const fallbackNode = document.querySelector<HTMLButtonElement>(".lineup-shape-node__tap-target:not(:disabled)");
    if (fallbackNode) {
      fallbackNode.focus();
      return;
    }

    if (exportButtonRef.current) {
      exportButtonRef.current.focus();
      return;
    }

    const fallbackButton = document.querySelector<HTMLButtonElement>("button:not(:disabled)");
    fallbackButton?.focus();
  }, []);

  const closeQuickReplace = useCallback(() => {
    const opener = quickReplaceTarget?.opener;
    setQuickReplaceTarget(null);
    setQuickReplaceStatus("idle");

    if (opener && opener.isConnected) {
      opener.focus();
      return;
    }

    focusFallbackElement();
  }, [focusFallbackElement, quickReplaceTarget]);

  useEffect(() => {
    if (!quickReplaceTarget) {
      return;
    }

    quickReplaceCloseRef.current?.focus();
  }, [quickReplaceTarget]);

  useEffect(() => {
    if (!quickReplaceTarget) {
      return;
    }

    const modal = quickReplaceDialogRef.current;
    if (!modal) {
      return;
    }

    const focusableSelectors = [
      'button:not(:disabled)',
      '[href]',
      'input:not(:disabled)',
      'select:not(:disabled)',
      'textarea:not(:disabled)',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeQuickReplace();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = Array.from(modal.querySelectorAll<HTMLElement>(focusableSelectors));
      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    modal.addEventListener("keydown", onKeyDown);
    return () => modal.removeEventListener("keydown", onKeyDown);
  }, [closeQuickReplace, quickReplaceTarget]);

  const isConflictError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error);
    return /conflict|already assigned|conditionalcheckfailed/i.test(message);
  };

  const handleQuickReplacePlayer = async (playerId: string) => {
    if (!quickReplaceTarget) {
      return;
    }

    const playerAlreadyStarter = lineup.some((entry) => entry.playerId === playerId && entry.isStarter);
    if (playerAlreadyStarter) {
      setQuickReplaceStatus("conflict");
      return;
    }

    setQuickReplaceStatus("loading");
    try {
      const result = await onQuickReplace({
        assignmentId: quickReplaceTarget.assignmentId,
        playerId,
        positionId: quickReplaceTarget.positionId,
      });

      if (result === "success") {
        setQuickReplaceStatus("success");
        showSuccess("Lineup slot updated.");
        return;
      }

      if (result === "conflict") {
        setQuickReplaceStatus("conflict");
        return;
      }

      setQuickReplaceStatus("error");
      showError("Unable to update this lineup slot.");
    } catch (error) {
      if (isConflictError(error)) {
        setQuickReplaceStatus("conflict");
        return;
      }

      setQuickReplaceStatus("error");
      showError("Unable to update this lineup slot.");
    }
  };

  const handleClearSlot = async () => {
    if (!quickReplaceTarget) {
      return;
    }

    setQuickReplaceStatus("loading");
    try {
      const result = await onClearSlot({
        assignmentId: quickReplaceTarget.assignmentId,
        positionName: quickReplaceTarget.positionName,
        playerName: quickReplaceTarget.currentPlayerName,
      });

      if (result === "cancelled") {
        setQuickReplaceStatus("idle");
        return;
      }

      if (result === "conflict") {
        setQuickReplaceStatus("conflict");
        return;
      }

      if (result === "error") {
        setQuickReplaceStatus("error");
        showError("Unable to clear this lineup slot.");
        return;
      }

      setQuickReplaceStatus("success");
      showSuccess("Lineup slot cleared.");
      closeQuickReplace();
    } catch (error) {
      if (isConflictError(error)) {
        setQuickReplaceStatus("conflict");
        return;
      }

      setQuickReplaceStatus("error");
      showError("Unable to clear this lineup slot.");
    }
  };

  const quickReplaceStateMessage = QUICK_REPLACE_COPY.states[quickReplaceStatus];
  const quickReplaceHelper = gameState.status === "halftime"
    ? QUICK_REPLACE_COPY.halftime.helper
    : QUICK_REPLACE_COPY.scheduled.helper;
  const politeAnnouncement = quickReplaceStatus === "error" || quickReplaceStatus === "conflict" ? "" : quickReplaceStateMessage;
  const assertiveAnnouncement = quickReplaceStatus === "error" || quickReplaceStatus === "conflict" ? quickReplaceStateMessage : "";

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
          ref={exportButtonRef}
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
              className={`lineup-shape-node ${assignment ? "lineup-shape-node--assigned" : "lineup-shape-node--empty"} ${selectedPositionId === node.positionId ? "lineup-shape-node--selected" : ""}`}
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
            </div>
          );
        })}
        <div className="lineup-shape-view__pitch-center-line" aria-hidden="true" />
        <div className="lineup-shape-view__pitch-center-circle" aria-hidden="true" />
        <div className="lineup-shape-view__pitch-penalty-box lineup-shape-view__pitch-penalty-box--top" aria-hidden="true" />
        <div className="lineup-shape-view__pitch-penalty-box lineup-shape-view__pitch-penalty-box--bottom" aria-hidden="true" />
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

      {quickReplaceTarget && (
        <div className="modal-overlay" onClick={closeQuickReplace}>
          <div
            ref={quickReplaceDialogRef}
            className="modal-content lineup-shape-view__quick-replace-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={quickReplaceTitleId}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id={quickReplaceTitleId} className="lineup-shape-view__quick-replace-title">
              {QUICK_REPLACE_COPY[gameState.status === "halftime" ? "halftime" : "scheduled"].title}: {quickReplaceTarget.positionName}
            </h2>
            <p className="lineup-shape-view__quick-replace-helper">{quickReplaceHelper}</p>
            <p className={`lineup-shape-view__quick-replace-status lineup-shape-view__quick-replace-status--${quickReplaceStatus}`}>
              {quickReplaceStateMessage}
            </p>

            <div className="sr-only" aria-live="polite">{politeAnnouncement}</div>
            <div className="sr-only" aria-live="assertive">{assertiveAnnouncement}</div>

            <ul className="lineup-shape-view__quick-replace-list" aria-label="Bench players sorted by replacement priority">
              {quickReplaceBenchPlayers.map((player) => {
                const playTimeSeconds = calculatePlayerPlayTime(player.id, playTimeRecords, currentTime);
                const preferred = playerPreferredForPosition(player, quickReplaceTarget.positionId);
                return (
                  <li key={player.id}>
                    <button
                      type="button"
                      className="lineup-shape-view__quick-replace-option"
                      onClick={() => void handleQuickReplacePlayer(player.id)}
                      disabled={quickReplaceStatus === "loading"}
                    >
                      <span className="lineup-shape-view__quick-replace-player">#{player.playerNumber ?? "?"} {player.firstName} {player.lastName}</span>
                      <span className="lineup-shape-view__quick-replace-meta">{formatPlayTime(playTimeSeconds, "short")}</span>
                      {preferred && <span className="lineup-shape-view__bench-fit">Fit</span>}
                    </button>
                  </li>
                );
              })}
              {quickReplaceBenchPlayers.length === 0 && (
                <li className="lineup-shape-view__quick-replace-empty">No bench players available for quick replace.</li>
              )}
            </ul>

            <div className="lineup-shape-view__quick-replace-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void handleClearSlot()}
                disabled={quickReplaceStatus === "loading"}
              >
                Clear Slot
              </button>
              <button
                type="button"
                className="btn-secondary"
                ref={quickReplaceCloseRef}
                onClick={closeQuickReplace}
                disabled={quickReplaceStatus === "loading"}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
