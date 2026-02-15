import { useEffect, useRef, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../../../amplify/data/resource";
import type {
  Game,
  Team,
  GamePlan,
  PlannedRotation,
} from "../types";
import { useAmplifyQuery } from "../../../hooks/useAmplifyQuery";
import { handleApiError } from "../../../utils/errorHandler";

const client = generateClient<Schema>();

interface UseGameSubscriptionsParams {
  game: Game;
  team: Team;
  isRunning: boolean;
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
  setIsRunning: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useGameSubscriptions({
  game,
  team,
  isRunning,
  setCurrentTime,
  setIsRunning,
}: UseGameSubscriptionsParams) {
  const [gameState, setGameState] = useState(game);
  const [gamePlan, setGamePlan] = useState<GamePlan | null>(null);
  const [plannedRotations, setPlannedRotations] = useState<PlannedRotation[]>([]);

  // Simple data subscriptions via reusable hook
  const { data: lineup } = useAmplifyQuery('LineupAssignment', {
    filter: { gameId: { eq: game.id } },
  }, [game.id]);

  const { data: playTimeRecords } = useAmplifyQuery('PlayTimeRecord', {
    filter: { gameId: { eq: game.id } },
  }, [game.id]);

  const halfThenSeconds = (a: { half: number; gameSeconds: number }, b: { half: number; gameSeconds: number }) => {
    if (a.half !== b.half) return a.half - b.half;
    return a.gameSeconds - b.gameSeconds;
  };

  const { data: goals } = useAmplifyQuery('Goal', {
    filter: { gameId: { eq: game.id } },
    sort: halfThenSeconds,
  }, [game.id]);

  const { data: gameNotes } = useAmplifyQuery('GameNote', {
    filter: { gameId: { eq: game.id } },
    sort: halfThenSeconds,
  }, [game.id]);

  const { data: playerAvailabilities } = useAmplifyQuery('PlayerAvailability', {
    filter: { gameId: { eq: game.id } },
  }, [game.id]);

  // Ref to track manual pause - prevents race condition with observeQuery auto-resume
  const manuallyPausedRef = useRef(false);

  // Ref to track if lineup sync is in progress - prevents duplicate creation
  const lineupSyncInProgressRef = useRef(false);

  // Observe game changes and restore state (complex timer resume logic — stays manual)
  useEffect(() => {
    const gameSub = client.models.Game.observeQuery({
      filter: { id: { eq: game.id } },
    }).subscribe({
      next: (data) => {
        if (data.items.length > 0) {
          const updatedGame = data.items[0];
          setGameState(updatedGame);

          // Don't update time if timer is currently running in this component
          // This prevents score updates from resetting the clock
          if (isRunning) {
            return;
          }

          // Don't update time if game was just completed - the handleEndGame already set the final time
          if (updatedGame.status === 'completed' && gameState.status !== 'completed') {
            // Game just completed, use the final elapsedSeconds from database
            if (updatedGame.elapsedSeconds !== null && updatedGame.elapsedSeconds !== undefined) {
              setCurrentTime(updatedGame.elapsedSeconds);
            }
            return;
          }

          // Auto-resume timer if game was in progress (but not if user manually paused)
          if (updatedGame.status === 'in-progress' && updatedGame.lastStartTime && !manuallyPausedRef.current) {
            const lastStart = new Date(updatedGame.lastStartTime).getTime();
            const now = Date.now();
            const additionalSeconds = Math.floor((now - lastStart) / 1000);
            setCurrentTime((updatedGame.elapsedSeconds || 0) + additionalSeconds);
            setIsRunning(true);
          } else if (updatedGame.status !== 'completed') {
            // Only restore elapsed time if game is not actively running and not completed
            if (updatedGame.elapsedSeconds !== null && updatedGame.elapsedSeconds !== undefined) {
              setCurrentTime(updatedGame.elapsedSeconds);
            }
          }
        }
      },
    });

    return () => {
      gameSub.unsubscribe();
    };
  }, [game.id, isRunning]);

  // GamePlan + PlannedRotation subscriptions (co-dependent — stays manual)
  useEffect(() => {
    let currentGamePlanId: string | null = null;

    const gamePlanSub = client.models.GamePlan.observeQuery({
      filter: { gameId: { eq: game.id } },
    }).subscribe({
      next: (data) => {
        if (data.items.length > 0) {
          const plan = data.items[0];
          setGamePlan(plan);
          currentGamePlanId = plan.id;

          // Load rotations for this game plan
          client.models.PlannedRotation.list({
            filter: { gamePlanId: { eq: plan.id } },
          }).then(({ data: rotations }) => {
            if (rotations) {
              setPlannedRotations(rotations.sort((a, b) => a.rotationNumber - b.rotationNumber));
            }
          });
        }
      },
    });

    const rotationSub = client.models.PlannedRotation.observeQuery().subscribe({
      next: (data) => {
        if (currentGamePlanId) {
          const gameRotations = data.items.filter(r => r.gamePlanId === currentGamePlanId);
          setPlannedRotations(gameRotations.sort((a, b) => a.rotationNumber - b.rotationNumber));
        }
      },
    });

    return () => {
      gamePlanSub.unsubscribe();
      rotationSub.unsubscribe();
    };
  }, [game.id, gamePlan?.id]);

  // Sync lineup from game plan when available
  useEffect(() => {
    const syncLineupFromGamePlan = async () => {
      if (!gamePlan || gameState.status !== 'scheduled') {
        return; // Only sync if game is scheduled
      }

      if (!gamePlan.startingLineup) {
        console.log('Game plan has no starting lineup data');
        return;
      }

      // Prevent concurrent execution using ref
      if (lineupSyncInProgressRef.current) {
        console.log('Lineup sync already in progress, skipping');
        return;
      }
      lineupSyncInProgressRef.current = true;

      try {
        // Check local state first (fast path - avoids DB query if data already loaded)
        if (lineup.length > 0) {
          console.log(`Lineup already exists locally with ${lineup.length} assignments, skipping sync`);
          return;
        }

        // Query the database to double-check for existing assignments
        // This handles the race condition where subscription hasn't loaded yet
        const existingAssignments = await client.models.LineupAssignment.list({
          filter: { gameId: { eq: game.id } },
        });

        if (existingAssignments.data.length > 0) {
          console.log(`Lineup already exists in DB with ${existingAssignments.data.length} assignments, skipping sync`);
          return;
        }

        // Parse the starting lineup from the game plan
        const startingLineup = JSON.parse(gamePlan.startingLineup as string) as Array<{
          playerId: string;
          positionId: string;
        }>;

        // Create LineupAssignment records for starters
        const lineupPromises = startingLineup.map(({ playerId, positionId }) =>
          client.models.LineupAssignment.create({
            gameId: game.id,
            playerId,
            positionId,
            isStarter: true,
            coaches: team.coaches,
          })
        );

        await Promise.all(lineupPromises);
        console.log(`Synced ${startingLineup.length} starters from game plan`);
      } catch (error) {
        handleApiError(error, 'Failed to sync lineup from game plan');
      } finally {
        lineupSyncInProgressRef.current = false;
      }
    };

    syncLineupFromGamePlan();
  }, [gamePlan, gameState.status, game.id, team.coaches, lineup.length]);

  return {
    gameState,
    setGameState,
    lineup,
    playTimeRecords,
    goals,
    gameNotes,
    gamePlan,
    plannedRotations,
    playerAvailabilities,
    manuallyPausedRef,
  };
}
