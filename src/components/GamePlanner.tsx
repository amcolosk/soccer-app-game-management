import { useEffect, useState, useRef, useMemo } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import type {
  Game, Team, FormationPosition, GamePlan, PlannedRotation,
  PlayerAvailability, PlayerWithRoster as PlayerWithRosterBase,
} from "../types/schema";
import {
  calculatePlayTime,
  calculateFairRotations,
  copyGamePlan,
  type PlannedSubstitution,
} from "../services/rotationPlannerService";
import { LineupBuilder } from "./LineupBuilder";
import { PlayerAvailabilityGrid } from "./PlayerAvailabilityGrid";
import { useTeamData } from "../hooks/useTeamData";
import { AvailabilityProvider } from "../contexts/AvailabilityContext";
import { showSuccess, showWarning } from "../utils/toast";
import { handleApiError, logError } from "../utils/errorHandler";
import { useConfirm } from "./ConfirmModal";
import { UI_CONSTANTS } from "../constants/ui";
import { useAmplifyQuery } from "../hooks/useAmplifyQuery";
import { computeLineupAtRotation, computeLineupDiff } from "../utils/gamePlannerUtils";

const client = generateClient<Schema>();

// Extend the base PlayerWithRoster with availability
interface PlayerWithRoster extends PlayerWithRosterBase {
  availability?: PlayerAvailability;
}

interface GamePlannerProps {
  game: Game;
  team: Team;
  onBack: () => void;
}

export function GamePlanner({ game, team, onBack }: GamePlannerProps) {
  const confirm = useConfirm();
  // Load team roster and formation positions with real-time updates
  const { players: basePlayersData, positions } = useTeamData(team.id, team.formationId);

  // Use a ref to store the current gamePlanId for use in subscriptions
  const gamePlanIdRef = useRef<string | null>(null);

  // Track in-flight saves to prevent observeQuery from clobbering local state
  // with stale DynamoDB data while saves are pending.
  // When saves complete, we apply the latest buffered subscription data.
  const pendingLineupSaves = useRef(0);
  const pendingRotationSaves = useRef(0);
  const bufferedLineupData = useRef<string | null>(null);
  const bufferedRotationData = useRef<PlannedRotation[] | null>(null);

  // Halftime lineup save tracking (mirrors the startingLineup pattern)
  const pendingHalftimeSaves = useRef(0);
  const bufferedHalftimeData = useRef<string | null>(null);

  // Apply any buffered subscription data when pending saves finish
  const flushBufferedLineup = () => {
    if (pendingLineupSaves.current === 0 && bufferedLineupData.current) {
      try {
        const lineupArray = JSON.parse(bufferedLineupData.current) as Array<{ positionId: string; playerId: string }>;
        const lineup = new Map<string, string>();
        lineupArray.forEach(({ positionId, playerId }) => {
          lineup.set(positionId, playerId);
        });
        setStartingLineup(lineup);
      } catch (error) {
        logError('Parse buffered starting lineup', error);
      }
      bufferedLineupData.current = null;
    }
  };

  const flushBufferedRotations = () => {
    if (pendingRotationSaves.current === 0 && bufferedRotationData.current) {
      setRotations(bufferedRotationData.current);
      bufferedRotationData.current = null;
    }
  };

  const flushBufferedHalftimeLineup = () => {
    if (pendingHalftimeSaves.current === 0 && bufferedHalftimeData.current) {
      try {
        const lineupArray = JSON.parse(bufferedHalftimeData.current) as Array<{ positionId: string; playerId: string }>;
        const lineup = new Map<string, string>();
        lineupArray.forEach(({ positionId, playerId }) => {
          lineup.set(positionId, playerId);
        });
        setHalftimeLineup(lineup);
      } catch (error) {
        logError('Parse buffered halftime lineup', error);
      }
      bufferedHalftimeData.current = null;
    }
  };

  // Extend players with availability data
  const [players, setPlayers] = useState<PlayerWithRoster[]>([]);
  const [gamePlan, setGamePlan] = useState<GamePlan | null>(null);
  const [rotations, setRotations] = useState<PlannedRotation[]>([]);
  const { data: availabilities } = useAmplifyQuery('PlayerAvailability', {
    filter: { gameId: { eq: game.id } },
  }, [game.id]);
  const [startingLineup, setStartingLineup] = useState<Map<string, string>>(new Map()); // positionId -> playerId
  const [halftimeLineup, setHalftimeLineup] = useState<Map<string, string> | null>(null); // positionId -> playerId for H2; null = not explicitly set (use fallback)
  const [rotationIntervalMinutes, setRotationIntervalMinutes] = useState(10);
  const [selectedRotation, setSelectedRotation] = useState<number | 'starting' | 'halftime' | null>(null);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [previousGames, setPreviousGames] = useState<Game[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [planWarnings, setPlanWarnings] = useState<string[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [swapModalData, setSwapModalData] = useState<{
    rotationNumber: number;
    positionId: string;
    currentPlayerId: string;
  } | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // New tab state for mobile redesign
  const [plannerTab, setPlannerTab] = useState<'availability' | 'lineup' | 'rotations'>('lineup');
  const tabInitialized = useRef(false);
  const prevGamePlanId = useRef<string | null>(null);

  const halfLengthMinutes = team.halfLengthMinutes || 30;
  const maxPlayersOnField = team.maxPlayersOnField || 11;

  // Merge base player data with availability when either changes
  useEffect(() => {
    const playersWithAvailability = basePlayersData.map(player => {
      const availability = availabilities.find(a => a.playerId === player.id);
      return { ...player, availability };
    });
    setPlayers(playersWithAvailability);
  }, [basePlayersData, availabilities]);

  useEffect(() => {
    // Set up reactive subscriptions for game plan data (handles eventual consistency)
    const gamePlanSub = client.models.GamePlan.observeQuery({
      filter: { gameId: { eq: game.id } },
    }).subscribe({
      next: (data) => {
        if (data.items.length > 0) {
          const plan = data.items[0];
          setGamePlan(plan);
          gamePlanIdRef.current = plan.id; // Update ref for use in other subscriptions
          setRotationIntervalMinutes(plan.rotationIntervalMinutes);

          // Load starting lineup from GamePlan
          // Skip if we have pending local saves to avoid clobbering optimistic state
          if (plan.startingLineup) {
            if (pendingLineupSaves.current > 0) {
              // Buffer the latest data so we can apply it when saves finish
              bufferedLineupData.current = plan.startingLineup as string;
            } else {
              try {
                const lineupArray = JSON.parse(plan.startingLineup as string) as Array<{ positionId: string; playerId: string }>;
                const lineup = new Map<string, string>();
                lineupArray.forEach(({ positionId, playerId }) => {
                  lineup.set(positionId, playerId);
                });
                setStartingLineup(lineup);
              } catch (error) {
                logError('Parse starting lineup', error);
              }
            }
          }

          // Load halftime lineup from GamePlan
          if (plan.halftimeLineup) {
            if (pendingHalftimeSaves.current > 0) {
              bufferedHalftimeData.current = plan.halftimeLineup as string;
            } else {
              try {
                const htLineupArray = JSON.parse(plan.halftimeLineup as string) as Array<{ positionId: string; playerId: string }>;
                const htLineup = new Map<string, string>();
                htLineupArray.forEach(({ positionId, playerId }) => {
                  htLineup.set(positionId, playerId);
                });
                setHalftimeLineup(htLineup);
              } catch (error) {
                logError('Parse halftime lineup', error);
              }
            }
          }
        } else {
          setGamePlan(null);
          gamePlanIdRef.current = null;
          setStartingLineup(new Map());
          setHalftimeLineup(null);
        }
      },
    });

    // Set up reactive subscription for planned rotations
    // We use observeQuery without filter to get all rotations the user has access to
    // NOTE: We can't use gamePlan state directly here due to closure issues - it would be stale
    const rotationSub = client.models.PlannedRotation.observeQuery().subscribe({
      next: (data) => {
        // Filter to only rotations for the current game plan using the ref
        const currentPlanId = gamePlanIdRef.current;
        const currentPlanRotations = currentPlanId
          ? data.items.filter(r => r.gamePlanId === currentPlanId)
          : [];
        const sorted = [...currentPlanRotations].sort((a, b) => a.rotationNumber - b.rotationNumber);
        // Skip if we have pending local rotation saves to avoid clobbering optimistic state
        if (pendingRotationSaves.current > 0) {
          bufferedRotationData.current = sorted;
          return;
        }
        setRotations(sorted);
      },
    });

    // Load previous games once (doesn't need real-time updates)
    loadPreviousGames();

    return () => {
      gamePlanSub.unsubscribe();
      rotationSub.unsubscribe();
    };
  }, [game.id, team.id, gamePlan?.id]);

  const loadPreviousGames = async () => {
    try {
      // Load previous games for copy feature
      const previousGamesResult = await client.models.Game.list({
        filter: {
          and: [
            { teamId: { eq: team.id } },
            { id: { ne: game.id } },
          ],
        },
      });

      // Query all GamePlans for the team in a single call (instead of N queries)
      const gamePlansResult = await client.models.GamePlan.list();

      // Create a Set of gameIds that have plans for O(1) lookup
      const gameIdsWithPlans = new Set(
        gamePlansResult.data.map(plan => plan.gameId).filter(Boolean)
      );

      // Filter games that have plans using the Set
      const validGames = previousGamesResult.data.filter(g =>
        gameIdsWithPlans.has(g.id)
      );

      setPreviousGames(
        validGames.sort((a, b) => {
          const dateA = a.gameDate ? new Date(a.gameDate).getTime() : 0;
          const dateB = b.gameDate ? new Date(b.gameDate).getTime() : 0;
          return dateB - dateA;
        })
      );
    } catch (error) {
      logError('Load previous games', error);
    }
  };


  // Initial tab selection (runs once when data first loads)
  useEffect(() => {
    if (tabInitialized.current) return;
    if (gamePlan !== null || players.length > 0) {
      setPlannerTab(gamePlan ? 'rotations' : 'lineup');
      tabInitialized.current = true;
    }
  }, [gamePlan, players]);

  // Auto-jump to rotations when plan is first created
  useEffect(() => {
    if (gamePlan?.id && prevGamePlanId.current === null) {
      setPlannerTab('rotations');
    }
    prevGamePlanId.current = gamePlan?.id ?? null;
  }, [gamePlan?.id]);

  const getPlayerAvailability = (playerId: string): string => {
    const availability = availabilities.find((a) => a.playerId === playerId);
    return availability?.status || "available";
  };

  // Memoize filtered player lists to avoid recalculating on every render
  const startingLineupPlayers = useMemo(() => {
    return players.filter((p) => {
      const status = getPlayerAvailability(p.id);
      return status === "available";
    });
  }, [players, availabilities]);

  const rotationPlayers = useMemo(() => {
    return players.filter((p) => {
      const status = getPlayerAvailability(p.id);
      return status === "available" || status === "late-arrival";
    });
  }, [players, availabilities]);

  // Identify the halftime rotation number (first rotation of second half).
  // Always derived from the plan settings — never from the half field on individual
  // PlannedRotation records, which can be stale after a rotation-interval change.
  const halftimeRotationNumber = useMemo(() => {
    if (!gamePlan) return undefined;
    const rotationsPerHalf = Math.max(0, Math.floor(halfLengthMinutes / rotationIntervalMinutes) - 1);
    return rotationsPerHalf > 0 ? rotationsPerHalf + 1 : undefined;
  }, [gamePlan, halfLengthMinutes, rotationIntervalMinutes]);

  // Memoize play time calculation which is expensive
  const playTimeData = useMemo(() => {
    if (!gamePlan || rotations.length === 0) return new Map();

    return calculatePlayTime(
      rotations,
      Array.from(startingLineup.entries()).map(([positionId, playerId]) => ({
        playerId,
        positionId,
      })),
      rotationIntervalMinutes,
      halfLengthMinutes * 2
    );
  }, [gamePlan, rotations, startingLineup, rotationIntervalMinutes, halfLengthMinutes]);

  const halftimeLineupForDisplay = useMemo(() => {
    if (halftimeLineup !== null) return halftimeLineup;
    if (!halftimeRotationNumber || rotations.length === 0) return startingLineup;
    return computeLineupAtRotation(startingLineup, rotations as Array<{ rotationNumber: number; plannedSubstitutions: string }>, halftimeRotationNumber - 1);
  }, [halftimeLineup, halftimeRotationNumber, startingLineup, rotations]);

  const handleLineupChange = async (positionId: string, playerId: string) => {
    const newLineup = new Map(startingLineup);

    if (playerId === "") {
      newLineup.delete(positionId);
    } else {
      // Check if player is already in another position
      for (const [pos, pid] of newLineup.entries()) {
        if (pid === playerId) {
          newLineup.delete(pos);
        }
      }
      newLineup.set(positionId, playerId);
    }

    setStartingLineup(newLineup);

    // Auto-save starting lineup to GamePlan if it exists
    if (gamePlan) {
      pendingLineupSaves.current++;
      try {
        const lineupArray = Array.from(newLineup.entries()).map(([positionId, playerId]) => ({
          playerId,
          positionId,
        }));

        await client.models.GamePlan.update({
          id: gamePlan.id,
          startingLineup: JSON.stringify(lineupArray),
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        handleApiError(error, 'Failed to auto-save lineup');
      } finally {
        pendingLineupSaves.current--;
        flushBufferedLineup();
      }
    }
  };

  const handleUpdatePlan = async () => {
    // Validate starting lineup
    if (startingLineup.size > maxPlayersOnField) {
      showWarning(`Starting lineup cannot exceed ${maxPlayersOnField} players`);
      return;
    }

    setIsGenerating(true);
    setValidationErrors([]);
    pendingLineupSaves.current++;
    pendingRotationSaves.current++;

    try {
      const lineupArray = Array.from(startingLineup.entries()).map(([positionId, playerId]) => ({
        playerId,
        positionId,
      }));

      // Calculate total rotations
      const rotationsPerHalf = Math.max(0, Math.floor(halfLengthMinutes / rotationIntervalMinutes) - 1);
      // +1 for the halftime rotation itself (which sits at the half boundary)
      const totalRotations = rotationsPerHalf * 2 + 1;

      let currentPlan = gamePlan;

      // Serialize halftime lineup for persistence (null state → omit field; explicitly-set map → always persist, even if empty)
      const halftimeLineupJson = halftimeLineup !== null
        ? JSON.stringify(Array.from(halftimeLineup.entries()).map(([posId, pid]) => ({ positionId: posId, playerId: pid })))
        : undefined;

      // Create or update plan
      if (!currentPlan) {
        const gamePlanResult = await client.models.GamePlan.create({
          gameId: game.id,
          rotationIntervalMinutes,
          totalRotations,
          startingLineup: JSON.stringify(lineupArray),
          halftimeLineup: halftimeLineupJson,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          coaches: team.coaches || [],
        });
        currentPlan = gamePlanResult.data;
      } else {
         const gamePlanResult = await client.models.GamePlan.update({
          id: currentPlan.id,
          rotationIntervalMinutes,
          totalRotations,
          startingLineup: JSON.stringify(lineupArray),
          halftimeLineup: halftimeLineupJson,
          updatedAt: new Date().toISOString(),
        });
        currentPlan = gamePlanResult.data;
      }

      if (!currentPlan) {
        throw new Error('Failed to create/update game plan');
      }

      // Handle rotations (Smart Update)
      // Get existing rotations to determine what to keep/update/delete
      // Note: we use the state 'rotations' which should be current,
      // but to be safe against stale state during rapid updates, we could re-fetch,
      // but 'rotations' state is updated via loadData().

      const existingRotationsMap = new Map(rotations.map(r => [r.rotationNumber, r]));
      const operations = [];

      // 1. Delete rotations that are beyond the new total
      for (const rot of rotations) {
        if (rot.rotationNumber > totalRotations) {
          operations.push(client.models.PlannedRotation.delete({ id: rot.id }));
        }
      }

      // 2. Create or Update rotations
      for (let i = 1; i <= totalRotations; i++) {
        const half = i <= rotationsPerHalf ? 1 : 2;
        let gameMinute: number;
        if (half === 1) {
          gameMinute = i * rotationIntervalMinutes;
        } else {
          // Second-half rotations: the first one (i === rotationsPerHalf+1) is the
          // halftime rotation at the half boundary, then each subsequent one adds
          // another interval.
          const secondHalfIndex = i - rotationsPerHalf - 1; // 0-based: 0 = halftime
          gameMinute = halfLengthMinutes + secondHalfIndex * rotationIntervalMinutes;
        }

        const existingRotation = existingRotationsMap.get(i);

        if (existingRotation) {
          // Update gameMinute and half if either changed due to interval change.
          // We preserve plannedSubstitutions.
          if (existingRotation.gameMinute !== gameMinute || existingRotation.half !== half) {
            operations.push(client.models.PlannedRotation.update({
              id: existingRotation.id,
              gameMinute,
              half,
            }));
          }
        } else {
          // Create new rotation
          operations.push(client.models.PlannedRotation.create({
            gamePlanId: currentPlan.id,
            rotationNumber: i,
            gameMinute,
            half,
            plannedSubstitutions: JSON.stringify([]),
            coaches: team.coaches || [],
          }));
        }
      }

      const operationResults = await Promise.all(operations);

      // If we have an explicit H2 lineup, repopulate the halftime rotation's subs
      // from the diff of (end-of-H1 lineup) vs (halftimeLineup).
      // This is needed when creating a brand-new plan (rotations were just created above).
      if (halftimeLineup !== null && halftimeLineup.size > 0) {
        const htRotNum = rotationsPerHalf + 1; // 1-based rotation number for halftime
        // Collect newly-created rotations from operation results
        const newlyCreatedRotations: PlannedRotation[] = [];
        for (const result of operationResults) {
          if (result && 'data' in result && result.data && 'rotationNumber' in result.data) {
            newlyCreatedRotations.push(result.data as PlannedRotation);
          }
        }

        // Build the combined list of rotations (existing + newly created)
        const allRotations = [
          ...rotations.filter(r => r.rotationNumber <= totalRotations),
          ...newlyCreatedRotations,
        ].sort((a, b) => a.rotationNumber - b.rotationNumber);

        // De-duplicate (prefer newly created over existing for same rotationNumber)
        const rotationsByNum = new Map<number, PlannedRotation>();
        for (const rot of allRotations) {
          rotationsByNum.set(rot.rotationNumber, rot);
        }

        const htRotation = rotationsByNum.get(htRotNum);
        if (htRotation) {
          // Compute end-of-H1 lineup from startingLineup + first-half rotations
          const firstHalfRotationsList = Array.from(rotationsByNum.values())
            .filter(r => r.rotationNumber < htRotNum)
            .sort((a, b) => a.rotationNumber - b.rotationNumber)
            .map(r => ({ rotationNumber: r.rotationNumber, plannedSubstitutions: r.plannedSubstitutions as string }));

          const endOfH1 = computeLineupAtRotation(
            new Map(lineupArray.map(({ positionId, playerId }) => [positionId, playerId])),
            firstHalfRotationsList,
            htRotNum - 1
          );

          const htSubs = computeLineupDiff(endOfH1, halftimeLineup);

          await client.models.PlannedRotation.update({
            id: htRotation.id,
            plannedSubstitutions: JSON.stringify(htSubs),
          });
        }
      }

      // Data will update automatically via observeQuery subscriptions

      showSuccess(gamePlan ? "Plan updated!" : "Plan created! Now set up each rotation.");
    } catch (error) {
      handleApiError(error, 'Failed to update rotation plan');
    } finally {
      setIsGenerating(false);
      pendingLineupSaves.current--;
      pendingRotationSaves.current--;
      flushBufferedLineup();
      flushBufferedHalftimeLineup();
      flushBufferedRotations();
    }
  };

  const handleAutoGenerateRotations = async () => {
    if (!gamePlan || rotations.length === 0) {
      showWarning('Create a plan first before auto-generating rotations.');
      return;
    }

    if (startingLineup.size === 0) {
      showWarning('Set up a starting lineup first.');
      return;
    }

    const confirmed = await confirm({
      title: 'Overwrite Rotations',
      message: 'This will overwrite all current rotation substitutions with auto-generated fair rotations based on player availability.\n\nContinue?',
      confirmText: 'Overwrite',
      variant: 'warning',
    });
    if (!confirmed) return;

    try {
      setIsGenerating(true);
      pendingRotationSaves.current++;

      // Build available roster from players who are available or late-arrival
      const availableRoster = players
        .filter(p => {
          const status = getPlayerAvailability(p.id);
          return status === 'available' || status === 'late-arrival';
        })
        .map(p => ({
          id: p.id,
          playerId: p.id,
          playerNumber: p.playerNumber || 0,
          preferredPositions: p.preferredPositions,
          availableFromMinute: availabilities.find(a => a.playerId === p.id)?.availableFromMinute ?? undefined,
          availableUntilMinute: availabilities.find(a => a.playerId === p.id)?.availableUntilMinute ?? undefined,
        }));

      const lineupArray = Array.from(startingLineup.entries()).map(([positionId, playerId]) => ({
        playerId,
        positionId,
      }));

      const rotationsPerHalf = Math.max(0, Math.floor(halfLengthMinutes / rotationIntervalMinutes) - 1);

      // Identify the goalkeeper position (never auto-subbed in regular rotations)
      const goaliePos = positions.find(p => {
        const abbr = p.abbreviation?.toUpperCase();
        return abbr === 'GK' || abbr === 'G';
      });
      const goaliePositionId = goaliePos?.id;

      // If the coach has already set the halftime lineup explicitly, keep it and build
      // second-half rotations from that fixed starting point
      let halftimeLineupArray: Array<{ playerId: string; positionId: string }> | undefined;
      if (halftimeLineup !== null && halftimeLineup.size > 0) {
        halftimeLineupArray = Array.from(halftimeLineup.entries()).map(([positionId, playerId]) => ({ playerId, positionId }));
      }

      const { rotations: generatedRotations, warnings: newWarnings } = calculateFairRotations(
        availableRoster,
        lineupArray,
        rotations.length,
        rotationsPerHalf,
        team.maxPlayersOnField || positions.length,
        goaliePositionId,
        halftimeLineupArray,
        { rotationIntervalMinutes, halfLengthMinutes, positions },
      );

      setPlanWarnings(newWarnings);
      if (newWarnings.length > 0) {
        newWarnings.forEach(w => showWarning(w));
      }

      // Update each rotation with generated substitutions
      const updates = rotations.map((rotation, idx) => {
        const generated = generatedRotations[idx];
        return client.models.PlannedRotation.update({
          id: rotation.id,
          plannedSubstitutions: JSON.stringify(generated?.substitutions || []),
        });
      });

      await Promise.all(updates);

      showSuccess('Rotations auto-generated! Review each rotation to verify.');
    } catch (error) {
      handleApiError(error, 'Failed to auto-generate rotations');
    } finally {
      setIsGenerating(false);
      pendingRotationSaves.current--;
      flushBufferedRotations();
    }
  };

  const handleCopyFromGame = async (sourceGameId: string) => {
    try {
      setShowCopyModal(false);
      setIsGenerating(true);
      pendingLineupSaves.current++;
      pendingRotationSaves.current++;

      // Delete existing plan if any
      if (gamePlan) {
        const deleteRotationPromises = rotations.map((r) =>
          client.models.PlannedRotation.delete({ id: r.id })
        );
        await Promise.all(deleteRotationPromises);
        await client.models.GamePlan.delete({ id: gamePlan.id });
      }

      await copyGamePlan(sourceGameId, game.id, team.coaches || []);
      // Data will update automatically via observeQuery subscriptions

      showSuccess("Plan copied successfully!");
    } catch (error) {
      handleApiError(error, 'Failed to copy game plan');
    } finally {
      setIsGenerating(false);
      pendingLineupSaves.current--;
      pendingRotationSaves.current--;
      flushBufferedLineup();
      flushBufferedRotations();
    }
  };

  const handleHalftimeLineupChange = async (positionId: string, playerId: string) => {
    // Start from current displayed lineup (fallback already computed)
    const baseLineup = halftimeLineupForDisplay;
    const newLineup = new Map(baseLineup);

    if (playerId === '') {
      // Clearing a position reverts to H1 player — remove from explicit H2 lineup
      newLineup.delete(positionId);
    } else {
      // Swap semantics: remove player from their old H2 position if they're already assigned
      for (const [pos, pid] of newLineup.entries()) {
        if (pid === playerId && pos !== positionId) {
          newLineup.delete(pos);
          break;
        }
      }
      newLineup.set(positionId, playerId);
    }

    setHalftimeLineup(newLineup);

    if (!gamePlan || halftimeRotationNumber === undefined) return;
    const halftimeRotation = rotations.find(r => r.rotationNumber === halftimeRotationNumber);
    if (!halftimeRotation) return;

    pendingHalftimeSaves.current++;
    pendingRotationSaves.current++;
    try {
      // Serialize and save full H2 lineup to GamePlan
      const lineupArray = Array.from(newLineup.entries()).map(([posId, pid]) => ({ positionId: posId, playerId: pid }));
      await client.models.GamePlan.update({ id: gamePlan.id, halftimeLineup: JSON.stringify(lineupArray) });

      // Compute diff: end-of-H1 lineup vs new H2 lineup
      const endOfH1 = computeLineupAtRotation(startingLineup, rotations as Array<{ rotationNumber: number; plannedSubstitutions: string }>, halftimeRotationNumber - 1);
      const subs = computeLineupDiff(endOfH1, newLineup);

      const subsJson = JSON.stringify(subs);
      await client.models.PlannedRotation.update({ id: halftimeRotation.id, plannedSubstitutions: subsJson });
      await recalculateDownstreamRotations(halftimeRotationNumber, new Map([[halftimeRotationNumber, subsJson]]));
    } catch (error) {
      handleApiError(error, 'Failed to save halftime lineup');
    } finally {
      pendingHalftimeSaves.current--;
      pendingRotationSaves.current--;
      flushBufferedHalftimeLineup();
      flushBufferedRotations();
    }
  };

  const handleRotationClick = (rotationNumber: number | 'starting' | 'halftime') => {
    setSelectedRotation(selectedRotation === rotationNumber ? null : rotationNumber);

    // Scroll the selected rotation into view
    setTimeout(() => {
      if (timelineRef.current) {
        const index = rotationNumber === 'starting' ? 0 : (typeof rotationNumber === 'number' ? rotationNumber : 0);
        const selectedElement = timelineRef.current.querySelector(
          `.rotation-column:nth-child(${index + 1})`
        );
        if (selectedElement) {
          selectedElement.scrollIntoView({
            behavior: UI_CONSTANTS.SCROLL.BEHAVIOR,
            inline: UI_CONSTANTS.SCROLL.INLINE,
            block: UI_CONSTANTS.SCROLL.BLOCK,
          });
        }
      }
    }, UI_CONSTANTS.SCROLL.DELAY_MS);
  };

  /**
   * After modifying rotation N, recalculate substitutions for all rotations after N.
   * Each downstream rotation's *intended* absolute lineup is preserved by snapshotting
   * what it resolved to under the OLD subs, then re-diffing against the new predecessor.
   * @param changedRotationNumber - the rotation that was just modified
   * @param subsOverrides - map of rotationNumber -> new subs JSON for rotations that have already been updated (including the changed one)
   */
  const recalculateDownstreamRotations = async (
    changedRotationNumber: number,
    subsOverrides: Map<number, string>
  ) => {
    // Helper: compute lineup at a given rotation using current state + overrides
    const getLineupWith = (targetRotNum: number, overrides: Map<number, string>): Map<string, string> => {
      const lineup = new Map(startingLineup);
      for (let i = 0; i < rotations.length && rotations[i].rotationNumber <= targetRotNum; i++) {
        const rot = rotations[i];
        const subsJson = overrides.has(rot.rotationNumber)
          ? overrides.get(rot.rotationNumber)!
          : (rot.plannedSubstitutions as string);
        let subs: PlannedSubstitution[] = [];
        try { subs = JSON.parse(subsJson); } catch (e) { logError('Parse rotation subs in recalculate', e); }
        subs.forEach(sub => {
          const tempLineup = new Map<string, string>();
          for (const [posId, pId] of lineup.entries()) {
            if (pId === sub.playerInId && posId !== sub.positionId) continue;
            tempLineup.set(posId, pId);
          }
          tempLineup.set(sub.positionId, sub.playerInId);
          lineup.clear();
          tempLineup.forEach((pid, posId) => lineup.set(posId, pid));
        });
      }
      return lineup;
    };

    // Snapshot the intended absolute lineup at each downstream rotation using the OLD subs
    const downstreamRotations = rotations.filter(r => r.rotationNumber > changedRotationNumber);
    const intendedLineups = new Map<number, Map<string, string>>();
    for (const rot of downstreamRotations) {
      // Use original (un-overridden) subs to compute what the coach originally intended
      intendedLineups.set(rot.rotationNumber, getLineupWith(rot.rotationNumber, new Map()));
    }

    // Now walk downstream rotations, re-diff each against its new predecessor
    const updatedOverrides = new Map(subsOverrides);
    const updateOps = [];

    for (const rot of downstreamRotations) {
      const newPrevLineup = getLineupWith(rot.rotationNumber - 1, updatedOverrides);
      const intendedLineup = intendedLineups.get(rot.rotationNumber)!;

      // Diff: for each position where the intended lineup differs from the new previous lineup
      const newSubs: PlannedSubstitution[] = [];
      for (const [positionId, intendedPlayerId] of intendedLineup.entries()) {
        const prevPlayerId = newPrevLineup.get(positionId);
        if (prevPlayerId && intendedPlayerId && prevPlayerId !== intendedPlayerId) {
          newSubs.push({
            playerOutId: prevPlayerId,
            playerInId: intendedPlayerId,
            positionId,
          });
        }
      }

      const newSubsJson = JSON.stringify(newSubs);
      updatedOverrides.set(rot.rotationNumber, newSubsJson);

      // Only update if subs actually changed
      const oldSubsJson = rot.plannedSubstitutions as string;
      if (newSubsJson !== oldSubsJson) {
        updateOps.push(
          client.models.PlannedRotation.update({
            id: rot.id,
            plannedSubstitutions: newSubsJson,
          })
        );
      }
    }

    if (updateOps.length > 0) {
      await Promise.all(updateOps);
    }
  };

  const handleRotationLineupChange = async (
    rotationNumber: number,
    newLineup: Map<string, string>
  ) => {
    const rotation = rotations.find((r) => r.rotationNumber === rotationNumber);
    if (!rotation) return;

    // Get previous lineup
    const previousLineup = rotationNumber === 1
      ? startingLineup
      : getLineupAtRotation(rotationNumber - 1);

    // Ensure all positions from previous lineup are accounted for in new lineup
    // If a position is missing, keep the previous player
    const completeNewLineup = new Map(previousLineup);
    for (const [positionId, playerId] of newLineup.entries()) {
      if (playerId) {
        completeNewLineup.set(positionId, playerId);
      }
    }

    // Calculate substitutions by comparing lineups
    const subs: PlannedSubstitution[] = [];
    for (const [positionId, newPlayerId] of completeNewLineup.entries()) {
      const oldPlayerId = previousLineup.get(positionId);
      if (oldPlayerId && newPlayerId && oldPlayerId !== newPlayerId) {
        subs.push({
          playerOutId: oldPlayerId,
          playerInId: newPlayerId,
          positionId,
        });
      }
    }

    pendingRotationSaves.current++;
    try {
      const subsJson = JSON.stringify(subs);
      await client.models.PlannedRotation.update({
        id: rotation.id,
        plannedSubstitutions: subsJson,
      });

      // Recalculate downstream rotations so their subs stay consistent
      await recalculateDownstreamRotations(
        rotationNumber,
        new Map([[rotationNumber, subsJson]])
      );
      // Data will update automatically via observeQuery subscriptions
    } catch (error) {
      handleApiError(error, 'Failed to update rotation');
    } finally {
      pendingRotationSaves.current--;
      flushBufferedRotations();
    }
  };

  const handleCopyFromPreviousRotation = async (rotationNumber: number) => {
    const rotation = rotations.find((r) => r.rotationNumber === rotationNumber);
    if (!rotation) return;

    // Copy the lineup (no substitutions)
    pendingRotationSaves.current++;
    try {
      const emptySubsJson = JSON.stringify([]);
      await client.models.PlannedRotation.update({
        id: rotation.id,
        plannedSubstitutions: emptySubsJson,
      });

      // If clearing the halftime rotation, also clear the GamePlan halftimeLineup field
      if (rotationNumber === halftimeRotationNumber && gamePlan) {
        await client.models.GamePlan.update({ id: gamePlan.id, halftimeLineup: null });
        setHalftimeLineup(null);
      }

      // Recalculate downstream rotations so their subs stay consistent
      await recalculateDownstreamRotations(
        rotationNumber,
        new Map([[rotationNumber, emptySubsJson]])
      );
      // Data will update automatically via observeQuery subscriptions

      // Select this rotation to edit it
      setSelectedRotation(rotationNumber);
    } catch (error) {
      handleApiError(error, 'Failed to copy from previous rotation');
    } finally {
      pendingRotationSaves.current--;
      flushBufferedRotations();
    }
  };

  const handleSwapPlayer = async (newPlayerId: string) => {
    if (!swapModalData) return;

    const { rotationNumber, positionId, currentPlayerId } = swapModalData;
    const currentLineup = getLineupAtRotation(rotationNumber);
    const newLineup = new Map(currentLineup);

    // Find if the new player is already in the lineup (on field)
    let oldPositionOfNewPlayer: string | undefined;
    for (const [pos, pid] of currentLineup.entries()) {
      if (pid === newPlayerId) {
        oldPositionOfNewPlayer = pos;
        break;
      }
    }

    if (oldPositionOfNewPlayer) {
      // Swap: put new player at target position, and put current player at new player's old position
      newLineup.set(positionId, newPlayerId);
      newLineup.set(oldPositionOfNewPlayer, currentPlayerId);
    } else {
      // Simple substitution: new player from bench replaces current player
      newLineup.set(positionId, newPlayerId);
    }

    // Close modal first to prevent UI issues
    setSwapModalData(null);

    // Then save the changes
    await handleRotationLineupChange(rotationNumber, newLineup);
  };

  // Memoize lineup calculations at each rotation to avoid recalculating
  const lineupCache = useMemo(() => {
    const cache = new Map<number, Map<string, string>>();
    return cache;
  }, [startingLineup, rotations]);

  // Calculate lineup state at each rotation (with caching)
  const getLineupAtRotation = (rotationNumber: number): Map<string, string> => {
    // Check cache first
    if (lineupCache.has(rotationNumber)) {
      return lineupCache.get(rotationNumber)!;
    }

    const lineup = new Map(startingLineup);

    // Apply all substitutions up to this rotation
    for (let i = 0; i < rotations.length && rotations[i].rotationNumber <= rotationNumber; i++) {
      const rotation = rotations[i];
      let subs: PlannedSubstitution[] = [];
      try { subs = JSON.parse(rotation.plannedSubstitutions as string); } catch (e) { logError('Parse rotation subs in getLineupAtRotation', e); }

      subs.forEach(sub => {
        // Simply swap the player at the position with the new player
        // Remove the new player from wherever they might be
        const tempLineup = new Map<string, string>();
        for (const [posId, pId] of lineup.entries()) {
          if (pId === sub.playerInId && posId !== sub.positionId) {
            // Skip this player - they're moving to sub.positionId
            continue;
          }
          tempLineup.set(posId, pId);
        }

        // Set the new player at the target position (replaces whoever was there)
        tempLineup.set(sub.positionId, sub.playerInId);

        // Update lineup
        lineup.clear();
        tempLineup.forEach((playerId, positionId) => {
          lineup.set(positionId, playerId);
        });
      });
    }

    // Cache the result
    lineupCache.set(rotationNumber, lineup);
    return lineup;
  };

  // Render selected rotation details — defined at component level so it can be
  // called from both renderRotationTimeline() and the bottom sheet.
  const renderSelectedDetails = () => {
    if (selectedRotation === null) return null;

    if (selectedRotation === 'halftime') {
      const secondHalfStartRotation = halftimeRotationNumber
        ? rotations.find(r => r.rotationNumber === halftimeRotationNumber)
        : undefined;

      let halftimeSubs: PlannedSubstitution[] = [];
      if (secondHalfStartRotation) {
        try { halftimeSubs = JSON.parse(secondHalfStartRotation.plannedSubstitutions as string); } catch (e) { logError('Parse halftime subs in renderSelectedDetails', e); }
      }
      // Positions with an explicit halftime change (playerInId keyed by positionId).
      const halftimeSubsLineup = new Map<string, string>(
        halftimeSubs.map(s => [s.positionId, s.playerInId])
      );

      // Players who are on the field at end of the first half (they "continue" unless subbed).
      const firstHalfFieldLineup = halftimeRotationNumber && halftimeRotationNumber > 1
        ? getLineupAtRotation(halftimeRotationNumber - 1)
        : startingLineup;
      // Positions where the first-half player continues with no explicit sub.
      // Shown as a read-only list so the coach can see the full second-half lineup.
      const continuingEntries = Array.from(firstHalfFieldLineup.entries())
        .filter(([posId]) => !halftimeSubsLineup.has(posId))
        .map(([posId, playerId]) => ({
          position: positions.find(p => p.id === posId),
          player: rotationPlayers.find(p => p.id === playerId),
        }))
        .filter(e => e.position && e.player);

      return (
        <div className="rotation-details-panel">
          <div className="panel-header">
            <h4>Halftime</h4>
            <button
              className="ht-edit-link"
              onClick={() => setPlannerTab('lineup')}
              aria-label="Edit halftime lineup in the Lineup tab"
            >
              Edit in Lineup tab →
            </button>
          </div>

          {halftimeSubs.length === 0 ? (
            <p className="ht-readonly-empty">No halftime changes — first half lineup continues.</p>
          ) : (
            <>
              <div className="planned-subs-list">
                {halftimeSubs.map((sub, idx) => {
                  const playerOut = rotationPlayers.find(p => p.id === sub.playerOutId);
                  const playerIn = rotationPlayers.find(p => p.id === sub.playerInId);
                  const position = positions.find(p => p.id === sub.positionId);
                  return (
                    <div key={idx} className="planned-sub-item planned-sub-item--halftime">
                      <div className="sub-position-label">{position?.abbreviation}</div>
                      <div className="sub-players">
                        <div className="sub-player sub-out">
                          <span className="player-number">#{playerOut?.playerNumber || 0}</span>
                          <span className="player-name">{playerOut?.firstName} {playerOut?.lastName}</span>
                        </div>
                        <div className="sub-arrow">→</div>
                        <div className="sub-player sub-in">
                          <span className="player-number">#{playerIn?.playerNumber || 0}</span>
                          <span className="player-name">{playerIn?.firstName} {playerIn?.lastName}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {continuingEntries.length > 0 && (
                <div className="halftime-continuing-section">
                  <p className="halftime-continuing-label">Continuing from first half:</p>
                  <div className="halftime-continuing-list">
                    {continuingEntries.map(({ position, player }) => (
                      <div key={position!.id} className="halftime-continuing-row">
                        <span className="continuing-position">{position!.abbreviation}</span>
                        <span className="continuing-player">
                          #{player!.playerNumber} {player!.firstName} {player!.lastName}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      );
    }

    // If the user somehow selects the halftime rotation as a number,
    // redirect to the halftime panel to keep edits consistent.
    if (selectedRotation === halftimeRotationNumber) {
      setSelectedRotation('halftime');
      return null;
    }

    // Rotation logic
    const rotation = rotations.find(r => r.rotationNumber === selectedRotation);
    if (!rotation) return null;

    let subs: PlannedSubstitution[] = [];
    try { subs = JSON.parse(rotation.plannedSubstitutions as string); } catch (e) { logError('Parse rotation subs in renderSelectedDetails', e); }
    const currentLineup = getLineupAtRotation(rotation.rotationNumber);

    return (
      <div className="rotation-details-panel">
        <div className="panel-header">
          <h4>Rotation {rotation.rotationNumber} ({rotation.gameMinute}')</h4>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span className="subs-count">{subs.length} Substitutions</span>
            <button
              onClick={() => handleCopyFromPreviousRotation(rotation.rotationNumber)}
              className="secondary-button"
              style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }}
            >
              Reset to Previous Lineup
            </button>
          </div>
        </div>

        {/* Substitutions List */}
        {subs.length > 0 && (
          <div style={{ marginBottom: '1rem' }}>
            <h4 style={{ marginBottom: '0.5rem' }}>Planned Substitutions</h4>
            <div className="planned-subs-list">
              {subs.map((sub, idx) => {
                const playerOut = rotationPlayers.find(p => p.id === sub.playerOutId);
                const playerIn = rotationPlayers.find(p => p.id === sub.playerInId);
                const position = positions.find(p => p.id === sub.positionId);

                return (
                  <div key={idx} className="planned-sub-item" style={{ background: '#fff9c4', border: '2px solid #fdd835' }}>
                    <div className="sub-position-label">{position?.abbreviation}</div>
                    <div className="sub-players">
                      <div className="sub-player sub-out">
                        <span className="player-number">#{playerOut?.playerNumber || 0}</span>
                        <span className="player-name">
                          {playerOut?.firstName} {playerOut?.lastName}
                        </span>
                      </div>
                      <div className="sub-arrow">→</div>
                      <div className="sub-player sub-in">
                        <span className="player-number">#{playerIn?.playerNumber || 0}</span>
                        <span className="player-name">
                          {playerIn?.firstName} {playerIn?.lastName}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="rotation-lineup-custom">
          <div className="position-lineup-grid">
            {positions.map((position) => {
              const assignedPlayerId = currentLineup.get(position.id);
              const assignedPlayer = rotationPlayers.find((p) => p.id === assignedPlayerId);

              return (
                <div key={position.id} className="position-slot">
                  <div className="position-label">{position.abbreviation}</div>
                  {assignedPlayer ? (
                    <button
                      className="assigned-player clickable"
                      onClick={() => setSwapModalData({
                        rotationNumber: rotation.rotationNumber,
                        positionId: position.id,
                        currentPlayerId: assignedPlayer.id,
                      })}
                      style={{
                        cursor: 'pointer',
                        border: '2px solid var(--primary-green)',
                        background: 'white'
                      }}
                    >
                      <span style={{ fontSize: '0.85rem', opacity: 0.9, color: 'black' }}>#{assignedPlayer.playerNumber || 0}</span>
                      <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'black' }}>
                        {assignedPlayer.firstName} {assignedPlayer.lastName}
                      </span>
                      <span style={{ marginLeft: 'auto', fontSize: '0.8rem' }}>🔄</span>
                    </button>
                  ) : (
                    <select
                      className="player-select"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          const newLineup = new Map(currentLineup);
                          newLineup.set(position.id, e.target.value);
                          handleRotationLineupChange(rotation.rotationNumber, newLineup);
                        }
                      }}
                    >
                      <option value="">Select player...</option>
                      {rotationPlayers
                        .filter((p) => !Array.from(currentLineup.values()).includes(p.id))
                        .map((player) => (
                          <option key={player.id} value={player.id}>
                            #{player.playerNumber || 0} {player.firstName} {player.lastName}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
          <div className="bench-area">
            <h4>Bench</h4>
            <div className="bench-players">
              {rotationPlayers
                .filter((p) => !Array.from(currentLineup.values()).includes(p.id))
                .map((player) => (
                  <div key={player.id} className="bench-player">
                    <span className="player-number">#{player.playerNumber || 0}</span>
                    <span className="player-name">
                      {player.firstName} {player.lastName}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderRotationTimeline = () => {
    // Create timeline items with starting lineup first, then all rotations.
    // The halftime rotation is displayed as "HT" in the timeline but is still a rotation item.
    const timelineItems: Array<{ type: 'rotation'; rotation?: PlannedRotation; minute?: number }> = [];

    if (gamePlan && rotations.length > 0) {
      rotations.forEach((rotation) => {
        timelineItems.push({ type: 'rotation', rotation });
      });
    }

    return (
      <div className="planner-section" ref={timelineRef}>
        {timelineItems.length > 0 && (
          <div className="planner-timeline-strip">
            {timelineItems.map((item) => {
              const isHalftime = item.type === 'rotation' && item.rotation?.rotationNumber === halftimeRotationNumber;
              const isSelected = isHalftime
                ? selectedRotation === 'halftime'
                : selectedRotation === item.rotation?.rotationNumber;

              let subsCount = 0;
              if (item.type === 'rotation' && item.rotation) {
                try {
                  subsCount = JSON.parse(item.rotation.plannedSubstitutions as string).length;
                } catch {
                  subsCount = 0;
                }
              }

              if (isHalftime) {
                return (
                  <button
                    key={item.rotation!.id}
                    className={`planner-timeline-pill planner-timeline-pill--halftime${isSelected ? ' planner-timeline-pill--active' : ''}`}
                    onClick={() => handleRotationClick('halftime')}
                  >
                    HT
                    {subsCount > 0 && (
                      <span className="planner-sub-badge">{subsCount}</span>
                    )}
                  </button>
                );
              }

              return (
                <button
                  key={item.rotation!.id}
                  className={`planner-timeline-pill${isSelected ? ' planner-timeline-pill--active' : ''}`}
                  onClick={() => handleRotationClick(item.rotation!.rotationNumber)}
                >
                  {item.rotation!.gameMinute}'
                  {subsCount > 0 && (
                    <span className="planner-sub-badge">{subsCount}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

      </div>
    );
  };

  const renderPlayTime = () => (
    <div className="projected-playtime">
      <h4>Projected Play Time</h4>
      <div className="playtime-bars">
        {rotationPlayers
          .map((player) => {
            const data = playTimeData.get(player.id);
            const totalMinutes = data?.totalMinutes || 0;
            const percentage = (totalMinutes / (halfLengthMinutes * 2)) * 100;
            return { player, totalMinutes, percentage };
          })
          .sort((a, b) => b.totalMinutes - a.totalMinutes)
          .map(({ player, totalMinutes, percentage }) => (
            <div key={player.id} className="playtime-bar-container">
              <div className="playtime-label">
                #{player.playerNumber} {player.firstName} {player.lastName}
              </div>
              <div className="playtime-bar-wrapper">
                <div className="playtime-bar" style={{ width: `${Math.min(100, percentage)}%` }} />
              </div>
              <div className="playtime-minutes">{totalMinutes}m</div>
            </div>
          ))}
      </div>
    </div>
  );

  return (
    <AvailabilityProvider availabilities={availabilities}>
      <div className="game-planner-container">

        {/* Sticky Header */}
        <div className="planner-sticky-header">
          <button onClick={onBack} className="planner-back-btn">←</button>
          <span className="planner-title">vs {game.opponent}</span>
          <details className="planner-overflow">
            <summary className="planner-overflow-btn">⋮</summary>
            <div className="planner-overflow-menu">
              <button onClick={() => setShowCopyModal(true)} className="planner-overflow-item">
                Copy from Previous Game
              </button>
            </div>
          </details>
        </div>

        {/* Tab Nav */}
        <nav className="planner-tab-nav" role="tablist">
          {(['availability', 'lineup', 'rotations'] as const).map((tab) => {
            const label = tab === 'availability' ? 'Availability' : tab === 'lineup' ? 'Lineup' : 'Rotations';
            // Badge: lineup tab shows ✓ when all positions filled, rotations tab shows unfilled count
            let badge: string | null = null;
            if (tab === 'lineup' && gamePlan) {
              const firstHalfFull = startingLineup.size >= positions.length;
              const secondHalfFull = rotations.length === 0 || halftimeLineupForDisplay.size >= positions.length;
              if (firstHalfFull && secondHalfFull) badge = '✓';
            }
            if (tab === 'rotations' && rotations.length > 0) {
              const unfilledCount = rotations.filter(r => {
                try { return JSON.parse(r.plannedSubstitutions as string).length === 0; } catch { return true; }
              }).length;
              if (unfilledCount > 0) badge = String(unfilledCount);
            }
            return (
              <button
                key={tab}
                role="tab"
                aria-selected={plannerTab === tab}
                className={`planner-tab ${plannerTab === tab ? 'planner-tab--active' : ''}`}
                onClick={() => setPlannerTab(tab)}
              >
                {label}
                {badge && <span className="planner-tab-badge">{badge}</span>}
              </button>
            );
          })}
        </nav>

        {/* Tab Panels */}
        {plannerTab === 'availability' && (
          <div className="planner-tab-panel">
            <PlayerAvailabilityGrid
              players={players}
              gameId={game.id}
              coaches={team.coaches || []}
            />
          </div>
        )}

        {plannerTab === 'lineup' && (
          <div className="planner-tab-panel">
            {validationErrors.length > 0 && (
              <div className="validation-errors">
                <ul>{validationErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              </div>
            )}
            {gamePlan ? (
              <>
                <div className="planner-section">
                  <div className="panel-header">
                    <h4>First Half Starting Lineup</h4>
                  </div>
                  <LineupBuilder
                    positions={positions}
                    availablePlayers={startingLineupPlayers}
                    lineup={startingLineup}
                    onLineupChange={handleLineupChange}
                    showPreferredPositions={true}
                  />
                </div>

                {rotations.length > 0 && (
                  <>
                    <div className="lineup-halftime-divider">
                      <span>Half Time</span>
                    </div>
                    <div className="planner-section planner-section--second-half">
                      <div className="panel-header">
                        <h4>Second Half Starting Lineup</h4>
                      </div>
                      <p className="planner-section-subtitle">
                        Changes here update the Rotations tab automatically
                      </p>
                      <LineupBuilder
                        positions={positions}
                        availablePlayers={rotationPlayers}
                        lineup={halftimeLineupForDisplay}
                        onLineupChange={handleHalftimeLineupChange}
                        showPreferredPositions={true}
                      />
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="planner-empty-state">
                <p>Set up your rotation schedule first.</p>
                <button onClick={() => setPlannerTab('rotations')} className="btn-primary">
                  Set up Rotations →
                </button>
              </div>
            )}
          </div>
        )}

        {plannerTab === 'rotations' && (
          <div className="planner-tab-panel">
            {/* Rotation interval + create/update plan — always at the top */}
            <div className="planner-setup-card">
              <div className="planner-setup-label">Rotation every</div>
              <div className="interval-pill-group">
                {[5, 10, 15].map(min => (
                  <button
                    key={min}
                    className={`interval-pill ${rotationIntervalMinutes === min ? 'interval-pill--active' : ''}`}
                    onClick={() => setRotationIntervalMinutes(min)}
                  >
                    {min} min
                  </button>
                ))}
              </div>
              <button
                onClick={handleUpdatePlan}
                className="btn-primary planner-create-btn"
                disabled={isGenerating}
              >
                {isGenerating ? 'Saving...' : gamePlan ? 'Update Plan' : 'Create Game Plan'}
              </button>
              {rotations.length > 0 && (
                <button
                  onClick={handleAutoGenerateRotations}
                  className="secondary-button planner-create-btn"
                  disabled={isGenerating}
                >
                  🔄 Auto-Generate
                </button>
              )}
            </div>

            {planWarnings.length > 0 && (
              <div className="plan-warnings-banner">
                {planWarnings.map((w, i) => (
                  <p key={i} className="plan-warning-item">⚠️ {w}</p>
                ))}
              </div>
            )}

            {/* Timeline + selected detail + playtime */}
            {gamePlan && rotations.length > 0 ? (
              <>
                {renderRotationTimeline()}
                {renderSelectedDetails()}
                {renderPlayTime()}
              </>
            ) : gamePlan ? (
              <div className="planner-empty-state">
                <p>Click "Create Game Plan" above to generate rotations.</p>
              </div>
            ) : null}
          </div>
        )}

        {/* Existing modals (unchanged) */}
        {showCopyModal && (
          <div className="modal-overlay" onClick={() => setShowCopyModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h3>Copy Plan from Previous Game</h3>
              <div className="previous-games-list">
                {previousGames.length === 0 ? (
                  <p>No previous games with plans found</p>
                ) : (
                  previousGames.map((prevGame) => (
                    <button
                      key={prevGame.id}
                      className="game-option"
                      onClick={() => handleCopyFromGame(prevGame.id)}
                    >
                      <div className="game-info">
                        <strong>{prevGame.opponent}</strong>
                        <span>{new Date(prevGame.gameDate || "").toLocaleDateString()}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
              <button onClick={() => setShowCopyModal(false)} className="secondary-button">
                Cancel
              </button>
            </div>
          </div>
        )}

        {swapModalData && (() => {
          // Get lineup BEFORE this rotation's subs are applied (to know who's on field)
          const currentLineup = getLineupAtRotation(swapModalData.rotationNumber - 1);
          const currentPlayer = players.find((p: PlayerWithRoster) => p.id === swapModalData.currentPlayerId);
          const position = positions.find((p: FormationPosition) => p.id === swapModalData.positionId);
          // For swaps in rotations/halftime, include late-arrival players
          const availablePlayers = players.filter(
            (p: PlayerWithRoster) => {
              const status = getPlayerAvailability(p.id);
              return status === "available" || status === "late-arrival";
            }
          );

          return (
            <div className="modal-overlay" onClick={() => setSwapModalData(null)}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <h3>Swap Player</h3>
                <p style={{ marginBottom: '1rem' }}>
                  <strong>{position?.abbreviation}</strong>: {currentPlayer?.firstName} {currentPlayer?.lastName} #{currentPlayer?.playerNumber}
                </p>
                <h4>Select replacement:</h4>
                <div className="previous-games-list" style={{ maxHeight: '400px' }}>
                  {availablePlayers
                    .filter((p: PlayerWithRoster) => p.id !== swapModalData.currentPlayerId)
                    .map((player: PlayerWithRoster) => {
                      const isOnField = Array.from(currentLineup.values()).includes(player.id);
                      return (
                        <button
                          key={player.id}
                          className="game-option"
                          onClick={() => handleSwapPlayer(player.id)}
                          style={{
                            opacity: isOnField ? 0.6 : 1,
                            background: isOnField ? '#fff3e0' : 'white',
                          }}
                        >
                          <div className="game-info">
                            <strong>#{player.playerNumber} {player.firstName} {player.lastName}</strong>
                            {isOnField && <span style={{ color: '#ff9800', fontSize: '0.85rem' }}>Currently on field</span>}
                          </div>
                        </button>
                      );
                    })}
                </div>
                <button onClick={() => setSwapModalData(null)} className="secondary-button">
                  Cancel
                </button>
              </div>
            </div>
          );
        })()}
      </div>
    </AvailabilityProvider>
  );
}
