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
  onHalftime: () => void | Promise<void>;
  onEndGame: () => void | Promise<void>;
}

interface UseGameTimerResult {
  /** Update the wall-clock anchor after programmatic time changes (e.g. test controls). */
  resetAnchor: (atSeconds: number) => void;
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
}: UseGameTimerParams): UseGameTimerResult {
  // Guards to prevent duplicate auto-halftime / auto-end-game calls.
  const halftimeTriggeredRef = useRef(false);
  const endGameTriggeredRef = useRef(false);

  // Wall-clock anchor refs — allow deriving game time from Date.now() so the
  // timer recovers correctly after iOS PWA backgrounding (fixes #31).
  const startMsRef = useRef<number | null>(null);   // null = paused
  const startElapsedRef = useRef<number>(0);        // game seconds at last anchor

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

  // Track the current game status via a ref so the saveInterval callback
  // can guard against writing lastStartTime after the game is no longer in-progress.
  const gameStatusRef = useRef(gameState.status);
  gameStatusRef.current = gameState.status;

  // Capture anchor whenever isRunning transitions.
  // currentTime is intentionally excluded from deps so we only read it at the
  // exact moment of the transition, not on every tick.
  useEffect(() => {
    if (isRunning) {
      startMsRef.current = Date.now();
      startElapsedRef.current = currentTime;
    } else {
      startMsRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    let saveInterval: NodeJS.Timeout;

    if (isRunning && gameState.status === 'in-progress') {
      // 500 ms tick — derives game time from wall clock so iOS backgrounding
      // no longer causes the counter to fall behind.
      interval = setInterval(() => {
        if (startMsRef.current === null) return;
        const derived = startElapsedRef.current + Math.floor((Date.now() - startMsRef.current) / 1000);

        // Check for upcoming rotations
        if (gamePlan && plannedRotations.length > 0) {
          const currentMinutes = Math.floor(derived / 60);
          const nextRotation = plannedRotations.find(r => {
            return r.half === gameState.currentHalf &&
                   currentMinutes === r.gameMinute - 1 &&
                   !r.viewedAt;
          });
          if (nextRotation) {
            void client.models.PlannedRotation.update({
              id: nextRotation.id,
              viewedAt: new Date().toISOString(),
            });
          }
        }

        // Auto-pause at halftime (only in first half, only once)
        if (gameState.currentHalf === 1 && derived >= halfLengthSeconds && !halftimeTriggeredRef.current) {
          halftimeTriggeredRef.current = true;
          void onHalftimeRef.current();
        }

        // Auto-end game after 2 hours maximum (7200 seconds)
        if (derived >= 7200 && !endGameTriggeredRef.current) {
          endGameTriggeredRef.current = true;
          void onEndGameRef.current();
        }

        setCurrentTime(derived);
      }, 500);

      // Save elapsed time to database every 5 seconds
      saveInterval = setInterval(() => {
        // Guard: skip if the game is no longer in-progress (e.g., handleEndGame was called
        // but the effect cleanup hasn't run yet due to the React re-render cycle).
        if (gameStatusRef.current !== 'in-progress') return;
        const derivedNow = startMsRef.current !== null
          ? startElapsedRef.current + Math.floor((Date.now() - startMsRef.current) / 1000)
          : startElapsedRef.current;
        client.models.Game.update({
          id: game.id,
          elapsedSeconds: derivedNow,
          lastStartTime: new Date().toISOString(),
        }).catch(err => handleApiError(err, 'Failed to save game time'));
      }, 5000);
    }

    return () => {
      if (interval) clearInterval(interval);
      if (saveInterval) clearInterval(saveInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, gameState.status, gameState.currentHalf, halfLengthSeconds, game.id]);
  // NOTE: currentTime removed from deps — timer derives from wall clock refs, not accumulated state

  /** Sync anchor refs after a programmatic jump in currentTime (e.g. test controls). */
  const resetAnchor = (atSeconds: number): void => {
    startElapsedRef.current = atSeconds;
    if (startMsRef.current !== null) {
      startMsRef.current = Date.now();
    }
  };

  return { resetAnchor };
}
