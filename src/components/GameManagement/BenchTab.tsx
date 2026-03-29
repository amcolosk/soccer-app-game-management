import { useState } from "react";
import {
  calculatePlayerPlayTime,
  formatPlayTime,
  isPlayerCurrentlyPlaying,
} from "../../utils/playTimeCalculations";
import { isPlayerInLineup } from "../../utils/lineupUtils";
import { useConfirm } from "../ConfirmModal";
import type { GameMutationInput } from "../../hooks/useOfflineMutations";
import { trackEvent, AnalyticsEvents } from "../../utils/analytics";
import { handleApiError } from "../../utils/errorHandler";
import { getPlayerAvailabilityStatus } from "../../utils/availabilityUtils";
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
  allowSubstitution?: boolean;
  onSelectPlayer: (playerId: string) => void;
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
  allowSubstitution = true,
  onSelectPlayer,
}: BenchTabProps) {
  const confirm = useConfirm();
  const [announcement, setAnnouncement] = useState("");

  const benchPlayers = players
    .filter((p) => !isPlayerInLineup(p.id, lineup))
    .map((p) => ({
      ...p,
      playTimeSeconds: calculatePlayerPlayTime(p.id, playTimeRecords, currentTime),
      availabilityStatus: getPlayerAvailabilityStatus(p.id, playerAvailabilities),
    }))
    .sort((a, b) => {
      if (a.playTimeSeconds !== b.playTimeSeconds) {
        return a.playTimeSeconds - b.playTimeSeconds;
      }
      return (a.playerNumber ?? 999) - (b.playerNumber ?? 999);
    });

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

    const confirmed = await confirm({
      title: `Mark ${player.firstName} ${player.lastName} as injured?`,
      message: "This removes the player from substitution options and rotation suggestions until recovered.",
      confirmText: "Mark Injured",
      cancelText: "Cancel",
      variant: "warning",
    });
    if (!confirmed) return;

    try {
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

      setAnnouncement(`${player.firstName} ${player.lastName} marked injured.`);
      trackEvent(AnalyticsEvents.PLAYER_MARKED_INJURED.category, AnalyticsEvents.PLAYER_MARKED_INJURED.action);
    } catch (error) {
      handleApiError(error, "Failed to update player injury status");
    }
  };

  const recoverPlayer = async (player: PlayerWithRoster) => {
    if (!mutations) return;

    const existing = playerAvailabilities.find((availability) => availability.playerId === player.id);
    if (!existing?.id) return;

    const confirmed = await confirm({
      title: `Mark ${player.firstName} ${player.lastName} available?`,
      message: "This adds the player back to substitution options and rotation suggestions.",
      confirmText: "Mark Available",
      cancelText: "Cancel",
      variant: "default",
    });
    if (!confirmed) return;

    try {
      await mutations.updatePlayerAvailability(existing.id, {
        status: "available",
        availableUntilMinute: null,
        markedAt: new Date().toISOString(),
      });
      setAnnouncement(`${player.firstName} ${player.lastName} marked available.`);
      trackEvent(
        AnalyticsEvents.PLAYER_RECOVERED_FROM_INJURY.category,
        AnalyticsEvents.PLAYER_RECOVERED_FROM_INJURY.action,
      );
    } catch (error) {
      handleApiError(error, "Failed to recover player");
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
                      {isInjured ? "Mark Available" : "Mark Injured"}
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
