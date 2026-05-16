import { useEffect, useRef, useState } from "react";
import {
  calculatePlayerPlayTime,
  formatPlayTime,
  isPlayerCurrentlyPlaying,
} from "../../utils/playTimeCalculations";
import { isPlayerInLineup } from "../../utils/lineupUtils";
import { useConfirm } from "../ConfirmModal";
import type { GameMutationInput } from "../../hooks/useOfflineMutations";
import { trackEvent, AnalyticsEvents } from "../../utils/analytics";
import { showError, showInfo, showSuccess, showWarning } from "../../utils/toast";
import { getPlayerAvailabilityStatus } from "../../utils/availabilityUtils";
import { sortBenchPlayersByPriority } from "./shape/lineupInteractionAdapter";
import type {
  PlayerWithRoster,
  LineupAssignment,
  PlayTimeRecord,
  PlayerAvailability,
} from "./types";

interface BenchTabProps {
  players: PlayerWithRoster[];
  lineup: LineupAssignment[];
  playTimeRecords: PlayTimeRecord[];
  currentTime: number;
  halfLengthSeconds: number;
  gameId?: string;
  coaches?: string[];
  playerAvailabilities?: PlayerAvailability[];
  mutations?: GameMutationInput;
  isOnline?: boolean;
  allowSubstitution?: boolean;
  onInjuryMutationPendingChange?: (isPending: boolean) => void;
  onSelectPlayer: (playerId: string) => void;
  sortPositionId?: string;
}

type InjuryMutationState =
  | "idle"
  | "confirming"
  | "submitting"
  | "queued-offline"
  | "sync-success"
  | "sync-failure"
  | "retryable-failure";

type InjuryMutationIntent = "injured" | "available";

interface RowMutationFeedback {
  state: InjuryMutationState;
  intent: InjuryMutationIntent;
}

function getSafeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

function getUrgencyClass(playTimeSeconds: number, halfLengthSeconds: number): string {
  const ratio = halfLengthSeconds > 0 ? playTimeSeconds / halfLengthSeconds : 0;
  if (ratio < 0.2) return "bench-tab__progress-fill--red";
  if (ratio < 0.6) return "bench-tab__progress-fill--orange";
  return "bench-tab__progress-fill--green";
}

export function BenchTab({
  players,
  lineup,
  playTimeRecords,
  currentTime,
  halfLengthSeconds,
  gameId,
  coaches,
  playerAvailabilities = [],
  mutations,
  isOnline = navigator.onLine,
  allowSubstitution = true,
  onInjuryMutationPendingChange,
  onSelectPlayer,
  sortPositionId,
}: BenchTabProps) {
  const confirm = useConfirm();
  const [announcement, setAnnouncement] = useState("");
  const [rowFeedbackByPlayer, setRowFeedbackByPlayer] = useState<Record<string, RowMutationFeedback>>({});
  const [activeMutationByPlayer, setActiveMutationByPlayer] = useState<Record<string, boolean>>({});
  const pendingMutationsRef = useRef(0);
  const debounceByPlayerRef = useRef<Record<string, number>>({});
  const clearTimerByPlayerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const clearTimerByPlayer = clearTimerByPlayerRef.current;
    return () => {
      const timers = Object.values(clearTimerByPlayer);
      for (const timer of timers) {
        clearTimeout(timer);
      }
      onInjuryMutationPendingChange?.(false);
    };
  }, [onInjuryMutationPendingChange]);

  const setRowFeedback = (
    playerId: string,
    feedback: RowMutationFeedback,
    clearAfterMs?: number,
  ) => {
    const existingTimer = clearTimerByPlayerRef.current[playerId];
    if (existingTimer) {
      clearTimeout(existingTimer);
      delete clearTimerByPlayerRef.current[playerId];
    }

    setRowFeedbackByPlayer((prev) => ({ ...prev, [playerId]: feedback }));

    if (clearAfterMs && clearAfterMs > 0) {
      clearTimerByPlayerRef.current[playerId] = setTimeout(() => {
        setRowFeedbackByPlayer((prev) => {
          const next = { ...prev };
          delete next[playerId];
          return next;
        });
        delete clearTimerByPlayerRef.current[playerId];
      }, clearAfterMs);
    }
  };

  const beginMutation = (playerId: string, playerName: string, intent: InjuryMutationIntent) => {
    pendingMutationsRef.current += 1;
    onInjuryMutationPendingChange?.(pendingMutationsRef.current > 0);
    setActiveMutationByPlayer((prev) => ({ ...prev, [playerId]: true }));
    setRowFeedback(playerId, { state: "submitting", intent });
    setAnnouncement(`Submitting injury update for ${playerName}.`);
    showInfo("Saving change...");
  };

  const endMutation = (playerId: string) => {
    pendingMutationsRef.current = Math.max(0, pendingMutationsRef.current - 1);
    onInjuryMutationPendingChange?.(pendingMutationsRef.current > 0);
    setActiveMutationByPlayer((prev) => ({ ...prev, [playerId]: false }));
  };

  const getRowStatusMessage = (feedback?: RowMutationFeedback): string | null => {
    if (!feedback) return null;
    switch (feedback.state) {
      case "confirming":
        return "Awaiting confirmation";
      case "submitting":
        return feedback.intent === "injured" ? "Saving injury status..." : "Saving recovery status...";
      case "queued-offline":
        return "Queued offline. Will sync when online.";
      case "sync-success":
        return "Synced";
      case "sync-failure":
        return "Sync failed. Change not applied.";
      case "retryable-failure":
        return "Retry available.";
      default:
        return null;
    }
  };

  const unsortedBenchPlayers = players
    .filter((p) => !isPlayerInLineup(p.id, lineup))
    .filter((p) => getPlayerAvailabilityStatus(p.id, playerAvailabilities) !== 'absent')
    .map((p) => ({
      ...p,
      playTimeSeconds: calculatePlayerPlayTime(p.id, playTimeRecords, currentTime),
      availabilityStatus: getPlayerAvailabilityStatus(p.id, playerAvailabilities),
    }));

  const benchPlayers = sortBenchPlayersByPriority({
    benchPlayers: unsortedBenchPlayers,
    currentPositionId: sortPositionId,
    getPlayTimeSeconds: (playerId: string) => calculatePlayerPlayTime(playerId, playTimeRecords, currentTime),
  }).map((player) => ({
    ...player,
    playTimeSeconds: calculatePlayerPlayTime(player.id, playTimeRecords, currentTime),
    availabilityStatus: getPlayerAvailabilityStatus(player.id, playerAvailabilities),
  }));

  const onFieldPlayers = players
    .filter((p) => isPlayerCurrentlyPlaying(p.id, playTimeRecords))
    .map((p) => ({
      ...p,
      playTimeSeconds: calculatePlayerPlayTime(p.id, playTimeRecords, currentTime),
    }))
    .sort((a, b) => (a.playerNumber ?? 999) - (b.playerNumber ?? 999));

  const progressBarWidth = (seconds: number) =>
    Math.min(100, halfLengthSeconds > 0 ? (seconds / halfLengthSeconds) * 100 : 0);

  const markPlayerInjured = async (player: PlayerWithRoster) => {
    if (!mutations || !gameId) return;
    if (activeMutationByPlayer[player.id]) return;

    const now = Date.now();
    const lastAttemptAt = debounceByPlayerRef.current[player.id] ?? 0;
    if (now - lastAttemptAt < 350) return;
    debounceByPlayerRef.current[player.id] = now;

    setRowFeedback(player.id, { state: "confirming", intent: "injured" });

    const confirmed = await confirm({
      title: `Mark ${player.firstName} ${player.lastName} as injured?`,
      message: "This removes the player from substitution options and rotation suggestions until recovered.",
      confirmText: "Mark Injured",
      cancelText: "Cancel",
      variant: "warning",
    });
    if (!confirmed) {
      setRowFeedbackByPlayer((prev) => {
        const next = { ...prev };
        delete next[player.id];
        return next;
      });
      return;
    }

    try {
      beginMutation(player.id, `${player.firstName} ${player.lastName}`, "injured");
      const existing = playerAvailabilities.find((availability) => availability.playerId === player.id);
      const markedAt = new Date().toISOString();
      const availableUntilMinute = Math.floor(currentTime / 60);

      if (existing?.id) {
        await mutations.updatePlayerAvailability(existing.id, {
          status: "injured",
          markedAt,
          availableUntilMinute,
        });
      } else {
        await mutations.createPlayerAvailability({
          gameId,
          playerId: player.id,
          status: "injured",
          markedAt,
          availableUntilMinute,
          coaches,
        });
      }

      if (isOnline) {
        setRowFeedback(player.id, { state: "sync-success", intent: "injured" }, 2200);
        setAnnouncement(`Injury status updated for ${player.firstName} ${player.lastName}.`);
        showSuccess("Player status updated.");
      } else {
        setRowFeedback(player.id, { state: "queued-offline", intent: "injured" });
        setAnnouncement(`Injury update queued offline for ${player.firstName} ${player.lastName}.`);
        showWarning("Saved offline. Will sync automatically.");
      }
      trackEvent(AnalyticsEvents.PLAYER_MARKED_INJURED.category, AnalyticsEvents.PLAYER_MARKED_INJURED.action);
    } catch (error) {
      console.error(`[BenchTab] markPlayerInjured failed: ${getSafeErrorMessage(error)}`);
      setRowFeedback(player.id, { state: "retryable-failure", intent: "injured" });
      setAnnouncement(`Injury update failed for ${player.firstName} ${player.lastName}.`);
      showError("Could not update player status.");
    } finally {
      endMutation(player.id);
    }
  };

  const recoverPlayer = async (player: PlayerWithRoster) => {
    if (!mutations) return;
    if (activeMutationByPlayer[player.id]) return;

    const now = Date.now();
    const lastAttemptAt = debounceByPlayerRef.current[player.id] ?? 0;
    if (now - lastAttemptAt < 350) return;
    debounceByPlayerRef.current[player.id] = now;

    const existing = playerAvailabilities.find((availability) => availability.playerId === player.id);
    if (!existing?.id) return;

    setRowFeedback(player.id, { state: "confirming", intent: "available" });

    const confirmed = await confirm({
      title: `Mark ${player.firstName} ${player.lastName} available?`,
      message: "This adds the player back to substitution options and rotation suggestions.",
      confirmText: "Mark Available",
      cancelText: "Cancel",
      variant: "default",
    });
    if (!confirmed) {
      setRowFeedbackByPlayer((prev) => {
        const next = { ...prev };
        delete next[player.id];
        return next;
      });
      return;
    }

    try {
      beginMutation(player.id, `${player.firstName} ${player.lastName}`, "available");
      await mutations.updatePlayerAvailability(existing.id, {
        status: "available",
        availableUntilMinute: null,
        markedAt: new Date().toISOString(),
      });

      if (isOnline) {
        setRowFeedback(player.id, { state: "sync-success", intent: "available" }, 2200);
        setAnnouncement(`Injury status updated for ${player.firstName} ${player.lastName}.`);
        showSuccess("Player status updated.");
      } else {
        setRowFeedback(player.id, { state: "queued-offline", intent: "available" });
        setAnnouncement(`Injury update queued offline for ${player.firstName} ${player.lastName}.`);
        showWarning("Saved offline. Will sync automatically.");
      }

      trackEvent(
        AnalyticsEvents.PLAYER_RECOVERED_FROM_INJURY.category,
        AnalyticsEvents.PLAYER_RECOVERED_FROM_INJURY.action,
      );
    } catch (error) {
      console.error(`[BenchTab] recoverPlayer failed: ${getSafeErrorMessage(error)}`);
      setRowFeedback(player.id, { state: "retryable-failure", intent: "available" });
      setAnnouncement(`Injury update failed for ${player.firstName} ${player.lastName}.`);
      showError("Could not update player status.");
    } finally {
      endMutation(player.id);
    }
  };

  return (
    <div className="bench-tab">
      <div className="sr-only" aria-live="polite">{announcement}</div>
      {benchPlayers.length === 0 && (
        <p className="empty-state" style={{ padding: "1rem" }}>
          No bench players available.
        </p>
      )}

      {benchPlayers.length > 0 && (
        <div className="bench-tab__section">
          <div className="bench-tab__section-header">
            Bench — tap to substitute
          </div>
          <div className="bench-tab__player-list">
            {benchPlayers.map((player) => {
              const urgencyClass = getUrgencyClass(
                player.playTimeSeconds,
                halfLengthSeconds
              );
              const widthPct = progressBarWidth(player.playTimeSeconds);
              const isInjured = player.availabilityStatus === "injured";
              const rowFeedback = rowFeedbackByPlayer[player.id];
              const rowStatusMessage = getRowStatusMessage(rowFeedback);
              const isActionPending = Boolean(activeMutationByPlayer[player.id]);

              return (
                <div
                  key={player.id}
                  className={`bench-tab__player-row-container ${isInjured ? "bench-tab__player-row-container--injured" : ""}`}
                >
                  {allowSubstitution ? (
                    <button
                      className={`bench-tab__player-row ${isInjured ? "bench-tab__player-row--injured" : ""}`}
                      onClick={() => onSelectPlayer(player.id)}
                      disabled={isInjured}
                      title={isInjured
                        ? `${player.firstName} is marked injured`
                        : `Tap to substitute ${player.firstName} in`}
                    >
                      <div className="bench-tab__player-header">
                        <span className="bench-tab__player-label">
                          #{player.playerNumber} {player.firstName} {player.lastName}
                        </span>
                        <span className="bench-tab__player-time">
                          {formatPlayTime(player.playTimeSeconds, "short")}
                        </span>
                      </div>
                      <div className="bench-tab__player-meta">
                        {isInjured && <span className="status-badge unavailable">Injured</span>}
                        {rowStatusMessage && (
                          <span className="status-badge">{rowStatusMessage}</span>
                        )}
                      </div>
                      <div className="bench-tab__progress-bar">
                        <div
                          className={`bench-tab__progress-fill ${urgencyClass}`}
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </button>
                  ) : (
                    <div className={`bench-tab__player-row bench-tab__player-row--readonly ${isInjured ? "bench-tab__player-row--injured" : ""}`}>
                      <div className="bench-tab__player-header">
                        <span className="bench-tab__player-label">
                          #{player.playerNumber} {player.firstName} {player.lastName}
                        </span>
                        <span className="bench-tab__player-time">
                          {formatPlayTime(player.playTimeSeconds, "short")}
                        </span>
                      </div>
                      <div className="bench-tab__player-meta">
                        {isInjured && <span className="status-badge unavailable">Injured</span>}
                        {rowStatusMessage && (
                          <span className="status-badge">{rowStatusMessage}</span>
                        )}
                      </div>
                      <div className="bench-tab__progress-bar">
                        <div
                          className={`bench-tab__progress-fill ${urgencyClass}`}
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {mutations && (
                    <button
                      type="button"
                      className="bench-tab__injury-action btn-secondary"
                      disabled={isActionPending}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (isInjured) {
                          void recoverPlayer(player);
                          return;
                        }
                        void markPlayerInjured(player);
                      }}
                      aria-label={isInjured
                        ? `Mark ${player.firstName} ${player.lastName} available`
                        : `Mark ${player.firstName} ${player.lastName} injured`}
                    >
                      {isActionPending
                        ? (isInjured ? "Marking Available..." : "Marking Injured...")
                        : (isInjured ? "Mark Available" : "Mark Injured")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {onFieldPlayers.length > 0 && (
        <div className="bench-tab__section">
          <div className="bench-tab__section-header bench-tab__section-header--muted">
            On Field
          </div>
          <div className="bench-tab__player-list">
            {onFieldPlayers.map((player) => {
              const urgencyClass = getUrgencyClass(
                player.playTimeSeconds,
                halfLengthSeconds
              );
              const widthPct = progressBarWidth(player.playTimeSeconds);

              return (
                <div
                  key={player.id}
                  className="bench-tab__player-row bench-tab__player-row--on-field"
                >
                  <div className="bench-tab__player-header">
                    <span className="bench-tab__player-label">
                      #{player.playerNumber} {player.firstName} {player.lastName}
                    </span>
                    <span className="bench-tab__player-time">
                      {formatPlayTime(player.playTimeSeconds, "short")}
                    </span>
                  </div>
                  <div className="bench-tab__progress-bar">
                    <div
                      className={`bench-tab__progress-fill ${urgencyClass}`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
