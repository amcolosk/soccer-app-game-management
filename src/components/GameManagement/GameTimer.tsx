import { useState } from "react";
import {
  formatPlayTime,
} from "../../utils/playTimeCalculations";
import { PlayerAvailabilityGrid } from "../PlayerAvailabilityGrid";
import type { PlannedSubstitution } from "../../services/rotationPlannerService";
import { useAvailability } from "../../contexts/AvailabilityContext";
import type {
  Game,
  Team,
  PlayerWithRoster,
  FormationPosition,
  GamePlan,
  PlannedRotation,
  LineupAssignment,
} from "./types";

interface GameTimerProps {
  gameState: Game;
  game: Game;
  team: Team;
  players: PlayerWithRoster[];
  positions: FormationPosition[];
  currentTime: number;
  isRunning: boolean;
  halfLengthSeconds: number;
  gamePlan: GamePlan | null;
  plannedRotations: PlannedRotation[];
  lineup: LineupAssignment[];
  isRecalculating: boolean;
  onStartGame: () => void;
  onPauseTimer: () => void;
  onResumeTimer: () => void;
  onHalftime: () => void;
  onStartSecondHalf: () => void;
  onEndGame: () => void;
  onAddTestTime: (minutes: number) => void;
  onRecalculateRotations: () => void;
  onApplyHalftimeSub: (sub: PlannedSubstitution) => Promise<void>;
  getPlanConflicts: () => Array<{
    type: 'starter' | 'rotation';
    playerId: string;
    playerName: string;
    status: string;
    rotationNumbers: number[];
  }>;
}

export function GameTimer({
  gameState,
  game,
  team,
  players,
  positions,
  currentTime,
  isRunning,
  halfLengthSeconds,
  gamePlan,
  plannedRotations,
  lineup,
  isRecalculating,
  onStartGame,
  onPauseTimer,
  onResumeTimer,
  onHalftime,
  onStartSecondHalf,
  onEndGame,
  onAddTestTime,
  onRecalculateRotations,
  onApplyHalftimeSub,
  getPlanConflicts,
}: GameTimerProps) {
  const { getPlayerAvailability } = useAvailability();
  const [isApplyingAll, setIsApplyingAll] = useState(false);

  // Planned subs for the start of the second half
  const halftimeSubs = (() => {
    const rotation = plannedRotations.find(r => r.half === 2);
    if (!rotation) return [];
    try {
      return JSON.parse(rotation.plannedSubstitutions as string) as PlannedSubstitution[];
    } catch { return []; }
  })();

  const getHalftimeSubState = (sub: PlannedSubstitution) => {
    const inAvailability = getPlayerAvailability(sub.playerInId);
    const isApplied = lineup.find(l => l.positionId === sub.positionId && l.isStarter)?.playerId === sub.playerInId;
    const canApply = !isApplied && inAvailability !== 'absent' && inAvailability !== 'injured';
    return { isApplied, canApply, inAvailability };
  };

  const canApplyAll = halftimeSubs.some(sub => getHalftimeSubState(sub).canApply);

  const handleApplyAll = async () => {
    setIsApplyingAll(true);
    try {
      const pending = halftimeSubs.filter(sub => getHalftimeSubState(sub).canApply);
      await Promise.all(pending.map(sub => onApplyHalftimeSub(sub)));
    } finally {
      setIsApplyingAll(false);
    }
  };

  return (
    <div className="game-timer-card">
      <div className="timer-display">
        <div className="half-indicator">
          {gameState.currentHalf === 1 ? 'First Half' : 'Second Half'}
        </div>
        <div className="time-display">
          {formatPlayTime(currentTime, 'short')}
        </div>
        <div className="time-limit">
          / {formatPlayTime(halfLengthSeconds, 'short')}
        </div>
      </div>

      {/* Testing Controls */}
      {gameState.status === 'in-progress' && (
        <div className="testing-controls">
          <span className="testing-label">Testing:</span>
          <button
            onClick={() => onAddTestTime(1)}
            className="btn-test-time"
            title="Add 1 minute for testing"
          >
            +1 min
          </button>
          <button
            onClick={() => onAddTestTime(5)}
            className="btn-test-time"
            title="Add 5 minutes for testing"
          >
            +5 min
          </button>
        </div>
      )}

      {gameState.status === 'scheduled' && gamePlan && (() => {
        const conflicts = getPlanConflicts();
        if (conflicts.length === 0) return null;
        return (
          <div className="plan-conflict-banner">
            <h4>⚠️ Plan Conflicts</h4>
            <p>The following players are in the game plan but currently unavailable:</p>
            <ul>
              {conflicts.map(c => (
                <li key={c.playerId}>
                  <strong>{c.playerName}</strong> — {c.status}
                  {c.type === 'starter' && ' (starting lineup)'}
                  {c.rotationNumbers.length > 0 && ` · Rotation${c.rotationNumbers.length > 1 ? 's' : ''} ${c.rotationNumbers.join(', ')}`}
                </li>
              ))}
            </ul>
            <p className="conflict-hint">Update availability or adjust the game plan before starting.</p>
            <button
              onClick={onRecalculateRotations}
              disabled={isRecalculating}
              className="btn-secondary"
              style={{ marginTop: '8px' }}
            >
              {isRecalculating ? '⏳ Recalculating...' : '🔄 Recalculate Rotations'}
            </button>
          </div>
        );
      })()}

      {gameState.status === 'scheduled' && gamePlan && players.length > 0 && (
        <PlayerAvailabilityGrid
          players={players}
          gameId={game.id}
          coaches={team.coaches || []}
        />
      )}

      <div className="timer-controls">
        {gameState.status === 'scheduled' && (
          <button onClick={onStartGame} className="btn-primary btn-large">
            Start Game
          </button>
        )}

        {gameState.status === 'in-progress' && (
          <>
            {isRunning ? (
              <button onClick={onPauseTimer} className="btn-secondary">
                ⏸ Pause
              </button>
            ) : (
              <button onClick={onResumeTimer} className="btn-primary">
                ▶ Resume
              </button>
            )}
            {gameState.currentHalf === 1 && (
              <button onClick={onHalftime} className="btn-secondary">
                End First Half
              </button>
            )}
            {gameState.currentHalf === 2 && (
              <button onClick={onEndGame} className="btn-secondary">
                End Game
              </button>
            )}
          </>
        )}

        {gameState.status === 'halftime' && (
          <div className="halftime-controls">
            <div className="halftime-message">
              <h3>⏸️ Halftime</h3>
              <p>Apply 2nd half lineup changes, then start the second half</p>
            </div>

            {halftimeSubs.length > 0 && (
              <div className="halftime-planned-subs">
                <div className="halftime-subs-header">
                  <h4>🔄 2nd Half Lineup Changes</h4>
                  <button
                    onClick={handleApplyAll}
                    disabled={!canApplyAll || isApplyingAll}
                    className="btn-secondary"
                  >
                    {isApplyingAll ? 'Applying...' : 'Apply All'}
                  </button>
                </div>
                <div className="planned-subs-list">
                  {halftimeSubs.map((sub, idx) => {
                    const playerOut = players.find(p => p.id === sub.playerOutId);
                    const playerIn = players.find(p => p.id === sub.playerInId);
                    const position = positions.find(p => p.id === sub.positionId);
                    const { isApplied, canApply, inAvailability } = getHalftimeSubState(sub);

                    return (
                      <div key={idx} className="planned-sub-item">
                        <div className="sub-position-label">{position?.abbreviation}</div>
                        <div className="sub-players">
                          <div className="sub-player sub-out">
                            <span className="player-number">#{playerOut?.playerNumber}</span>
                            <span className="player-name">
                              {playerOut?.firstName} {playerOut?.lastName}
                            </span>
                          </div>
                          <div className="sub-arrow">→</div>
                          <div className="sub-player sub-in">
                            <span className="player-number">#{playerIn?.playerNumber}</span>
                            <span className="player-name">
                              {playerIn?.firstName} {playerIn?.lastName}
                            </span>
                            {(inAvailability === 'absent' || inAvailability === 'injured') && (
                              <span className="availability-badge unavailable">⚠️ {inAvailability}</span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => onApplyHalftimeSub(sub)}
                          className={`btn-queue-sub ${isApplied ? 'queued' : ''}`}
                          disabled={!canApply}
                          title={
                            isApplied ? 'Already applied' :
                            canApply ? 'Apply this substitution to the lineup' :
                            `${playerIn?.firstName} is ${inAvailability}`
                          }
                        >
                          {isApplied ? '✓ Applied' : 'Apply'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <button onClick={onStartSecondHalf} className="btn-primary btn-large">
              Start Second Half
            </button>
          </div>
        )}

        {gameState.status === 'completed' && (
          <div className="game-completed">
            ✓ Game Completed
          </div>
        )}
      </div>
    </div>
  );
}
