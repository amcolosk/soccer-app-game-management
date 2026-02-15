import { useEffect, useRef } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../../../amplify/data/resource";
import type { Game, GamePlan, PlannedRotation } from "../types";
import { handleApiError } from "../../../utils/errorHandler";

const client = generateClient<Schema>();

interface UseGameTimerParams {
  game: Game;
  gameState: Game;
  halfLengthSeconds: number;
  currentTime: number;
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
  isRunning: boolean;
  gamePlan: GamePlan | null;
  plannedRotations: PlannedRotation[];
  onHalftime: () => void;
  onEndGame: () => void;
}

export function useGameTimer({
  game,
  gameState,
  halfLengthSeconds,
  currentTime,
  setCurrentTime,
  isRunning,
  gamePlan,
  plannedRotations,
  onHalftime,
  onEndGame,
}: UseGameTimerParams) {
  // Guards to prevent duplicate auto-halftime / auto-end-game calls.
  // Without these, the timer can fire onHalftime() multiple times before
  // the React state update (setIsRunning(false)) takes effect, and also
  // re-fire onHalftime() at the start of the second half when
  // gameState.currentHalf hasn't yet propagated from the DB subscription.
  const halftimeTriggeredRef = useRef(false);
  const endGameTriggeredRef = useRef(false);

  // Reset the halftime guard when we enter the second half
  useEffect(() => {
    if (gameState.currentHalf === 2) {
      halftimeTriggeredRef.current = false;
    }
  }, [gameState.currentHalf]);

  // Use refs for callbacks so the interval always calls the latest version
  // without needing them in the useEffect dependency array
  const onHalftimeRef = useRef(onHalftime);
  onHalftimeRef.current = onHalftime;
  const onEndGameRef = useRef(onEndGame);
  onEndGameRef.current = onEndGame;

  useEffect(() => {
    let interval: NodeJS.Timeout;
    let saveInterval: NodeJS.Timeout;

    if (isRunning && gameState.status === 'in-progress') {
      interval = setInterval(() => {
        setCurrentTime(prev => {
          const newTime = prev + 1;

          // Check for upcoming rotations
          if (gamePlan && plannedRotations.length > 0) {
            const currentMinutes = Math.floor(newTime / 60);
            const nextRotation = plannedRotations.find(r => {
              const rotationMinute = r.gameMinute;
              return r.half === gameState.currentHalf &&
                     currentMinutes === rotationMinute - 1 && // 1 minute before
                     !r.viewedAt; // Not yet viewed
            });

            if (nextRotation) {
              // Mark as viewed and show modal
              client.models.PlannedRotation.update({
                id: nextRotation.id,
                viewedAt: new Date().toISOString(),
              });
            }
          }

          // Auto-pause at halftime (only in first half, only once)
          if (gameState.currentHalf === 1 && newTime >= halfLengthSeconds && !halftimeTriggeredRef.current) {
            halftimeTriggeredRef.current = true;
            // Schedule the callback outside the state updater to avoid
            // calling async operations from inside a React setState
            setTimeout(() => onHalftimeRef.current(), 0);
            return newTime;
          }

          // Auto-end game after 2 hours maximum (7200 seconds)
          if (newTime >= 7200 && !endGameTriggeredRef.current) {
            endGameTriggeredRef.current = true;
            setTimeout(() => onEndGameRef.current(), 0);
            return newTime;
          }

          return newTime;
        });
      }, 1000);

      // Save elapsed time to database every 5 seconds
      saveInterval = setInterval(() => {
        client.models.Game.update({
          id: game.id,
          elapsedSeconds: currentTime,
          lastStartTime: new Date().toISOString(),
        }).catch(err => handleApiError(err, 'Failed to save game time'));
      }, 5000);
    }

    return () => {
      if (interval) clearInterval(interval);
      if (saveInterval) clearInterval(saveInterval);
    };
  }, [isRunning, gameState.status, gameState.currentHalf, halfLengthSeconds, currentTime, game.id]);
}
