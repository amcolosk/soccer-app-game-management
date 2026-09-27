import { calculateTeamShotStats } from "../../utils/gameCalculations";
import type { Shot } from "./types";

interface CompletedGameStatsProps {
  shots: Shot[];
  opponentName: string;
}

// Post-game team-level stats, alongside the per-player CompletedPlayTimeSummary
// and the play-by-play CompletedGameTimeline. Shots on Goal = outcome GOAL or
// SAVED (calculateTeamShotStats), same on-target definition used for the
// per-player breakdown in SeasonReport.tsx.
export function CompletedGameStats({ shots, opponentName }: CompletedGameStatsProps) {
  // Games completed before unified shot tracking shipped (or where the coach
  // never used it) have zero Shot rows despite a non-zero final score --
  // showing "0 - 0" next to that score would misrepresent the game, so the
  // card renders nothing rather than a misleading zero.
  if (shots.length === 0) return null;

  const ourStats = calculateTeamShotStats(true, shots);
  const opponentStats = calculateTeamShotStats(false, shots);

  return (
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
  );
}
