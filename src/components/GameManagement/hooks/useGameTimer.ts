import { useEffect } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../../../amplify/data/resource";
import type { Game, GamePlan, PlannedRotation } from "../types";

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

          // Auto-pause at halftime
          if (gameState.currentHalf === 1 && newTime >= halfLengthSeconds) {
            onHalftime();
            return newTime;
          }

          // Auto-end game after 2 hours maximum (7200 seconds)
          if (newTime >= 7200) {
            onEndGame();
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
        }).catch(err => console.error('Error saving elapsed time:', err));
      }, 5000);
    }

    return () => {
      if (interval) clearInterval(interval);
      if (saveInterval) clearInterval(saveInterval);
    };
  }, [isRunning, gameState.status, gameState.currentHalf, halfLengthSeconds, currentTime, game.id]);
}
