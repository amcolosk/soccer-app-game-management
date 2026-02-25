import { formatPlayTime } from "../../utils/playTimeCalculations";
import type { Game, GamePlan, PlannedRotation } from "./types";

interface CommandBandProps {
  gameState: Game;
  onBack: () => void;
  currentTime: number;
  isRunning: boolean;
  halfLengthSeconds: number;
  gamePlan: GamePlan | null;
  plannedRotations: PlannedRotation[];
  onPauseTimer: () => void;
  onResumeTimer: () => void;
  onShowRotationModal: () => void;
}

export function CommandBand({
  gameState,
  onBack,
  currentTime,
  isRunning,
  halfLengthSeconds,
  gamePlan,
  plannedRotations,
  onPauseTimer,
  onResumeTimer,
  onShowRotationModal,
}: CommandBandProps) {
  const getNextRotation = (): PlannedRotation | null => {
    if (!gamePlan || plannedRotations.length === 0) return null;
    const currentMinutes = Math.floor(currentTime / 60);
    return (
      plannedRotations.find(
        (r) =>
          r.half === gameState.currentHalf && r.gameMinute >= currentMinutes - 2
      ) ?? null
    );
  };

  const nextRotation = getNextRotation();
  const minutesUntilRotation = nextRotation
    ? nextRotation.gameMinute - Math.floor(currentTime / 60)
    : null;

  const renderRightCell = () => {
    if (gameState.status === "in-progress") {
      if (gamePlan && nextRotation) {
        return (
          <button
            className="command-band__rotation-badge"
            onClick={onShowRotationModal}
            title="View rotation plan"
          >
            <div className="command-band__rotation-countdown">
              {minutesUntilRotation !== null && minutesUntilRotation <= 0
                ? "Sub now!"
                : `${minutesUntilRotation}' to sub`}
            </div>
            <div className="command-band__rotation-at">
              Rot @ {nextRotation.gameMinute}'
            </div>
          </button>
        );
      }
      return (
        <span className="command-band__status-badge command-band__status-live">
          ● Live
        </span>
      );
    }
    if (gameState.status === "halftime") {
      return (
        <span className="command-band__status-badge command-band__status-halftime">
          Halftime
        </span>
      );
    }
    if (gameState.status === "completed") {
      return (
        <span className="command-band__status-badge command-band__status-final">
          Final
        </span>
      );
    }
    return (
      <span className="command-band__status-badge command-band__status-pregame">
        Pre-Game
      </span>
    );
  };

  const halfLabel =
    gameState.currentHalf === 2 ? "2nd Half" : "1st Half";

  return (
    <div className="command-band">
      {/* Left: back + score */}
      <div className="command-band__left">
        <button
          onClick={onBack}
          className="command-band__btn-back"
          title="Back to games"
        >
          ←
        </button>
        <div className="command-band__score-block">
          <div className="command-band__score">
            {gameState.ourScore ?? 0}{" "}
            <span className="command-band__score-dash">–</span>{" "}
            {gameState.opponentScore ?? 0}
          </div>
          <div className="command-band__score-label">
            vs {gameState.opponent}
          </div>
        </div>
      </div>

      {/* Center: timer */}
      <div className="command-band__center">
        <div className="command-band__timer">
          {formatPlayTime(currentTime, "short")}
        </div>
        <div className="command-band__timer-meta">
          <span className="command-band__half">{halfLabel}</span>
          {gameState.status === "in-progress" && (
            <button
              onClick={isRunning ? onPauseTimer : onResumeTimer}
              className="command-band__btn-pause"
              title={isRunning ? "Pause timer" : "Resume timer"}
            >
              {isRunning ? "⏸" : "▶"}
            </button>
          )}
        </div>
        <div className="command-band__time-limit">
          / {formatPlayTime(halfLengthSeconds, "short")}
        </div>
      </div>

      {/* Right: status / rotation info */}
      <div className="command-band__right">{renderRightCell()}</div>
    </div>
  );
}
