import { calculateTeamShotStats } from "../../utils/gameCalculations";
import type { SendOffSummary } from "../../utils/sendOffCalculations";
import type { Shot } from "./types";

interface CompletedGameStatsProps {
  shots: Shot[];
  opponentName: string;
  /** Active red-card send-offs, with the time the team played a player down. */
  sendOffs?: Array<SendOffSummary & { playerLabel: string }>;
}

function formatMinutes(seconds: number): string {
  return `${Math.floor(seconds / 60)}'`;
}

// Post-game team-level stats, alongside the per-player CompletedPlayTimeSummary
// and the play-by-play CompletedGameTimeline. Shots on Goal = outcome GOAL or
// SAVED (calculateTeamShotStats), same on-target definition used for the
// per-player breakdown in SeasonReport.tsx.
export function CompletedGameStats({ shots, opponentName, sendOffs = [] }: CompletedGameStatsProps) {
  // Games completed before unified shot tracking shipped (or where the coach
  // never used it) have zero Shot rows despite a non-zero final score --
  // showing "0 - 0" next to that score would misrepresent the game, so the
  // shots card renders nothing rather than a misleading zero.
  const showShots = shots.length > 0;
  if (!showShots && sendOffs.length === 0) return null;

  const ourStats = calculateTeamShotStats(true, shots);
  const opponentStats = calculateTeamShotStats(false, shots);

  return (
    <>
      {showShots && (
        <section
          className="completed-game-stats"
          aria-labelledby="completed-game-stats-heading"
        >
          <h3
            id="completed-game-stats-heading"
            className="completed-game-stats__heading"
          >
            🎯 Shots on Goal
          </h3>
          <div className="completed-game-stats__row">
            <span className="completed-game-stats__label">Us</span>
            <span className="completed-game-stats__value">{ourStats.onTarget}</span>
          </div>
          <div className="completed-game-stats__row">
            <span className="completed-game-stats__label">{opponentName}</span>
            <span className="completed-game-stats__value">{opponentStats.onTarget}</span>
          </div>
        </section>
      )}
      {sendOffs.length > 0 && (
        <section
          className="completed-game-stats"
          aria-labelledby="completed-game-sendoffs-heading"
        >
          <h3
            id="completed-game-sendoffs-heading"
            className="completed-game-stats__heading"
          >
            🟥 Played a player down
          </h3>
          {sendOffs.map((sendOff) => (
            <div className="completed-game-stats__row" key={`${sendOff.playerId}-${sendOff.sentOffSeconds}`}>
              <span className="completed-game-stats__label">
                {sendOff.playerLabel} sent off at {formatMinutes(sendOff.sentOffSeconds)}
              </span>
              <span className="completed-game-stats__value">{formatMinutes(sendOff.playedDownSeconds)}</span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
