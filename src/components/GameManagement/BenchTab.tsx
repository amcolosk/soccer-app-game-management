import {
  calculatePlayerPlayTime,
  formatPlayTime,
  isPlayerCurrentlyPlaying,
} from "../../utils/playTimeCalculations";
import { isPlayerInLineup } from "../../utils/lineupUtils";
import type {
  PlayerWithRoster,
  LineupAssignment,
  PlayTimeRecord,
} from "./types";

interface BenchTabProps {
  players: PlayerWithRoster[];
  lineup: LineupAssignment[];
  playTimeRecords: PlayTimeRecord[];
  currentTime: number;
  halfLengthSeconds: number;
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
  onSelectPlayer,
}: BenchTabProps) {
  const benchPlayers = players
    .filter((p) => !isPlayerInLineup(p.id, lineup))
    .map((p) => ({
      ...p,
      playTimeSeconds: calculatePlayerPlayTime(p.id, playTimeRecords, currentTime),
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

  return (
    <div className="bench-tab">
      {benchPlayers.length === 0 && (
        <p className="empty-state" style={{ padding: "1rem" }}>
          No players on the bench.
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

              return (
                <button
                  key={player.id}
                  className="bench-tab__player-row"
                  onClick={() => onSelectPlayer(player.id)}
                  title={`Tap to substitute ${player.firstName} in`}
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
                </button>
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
