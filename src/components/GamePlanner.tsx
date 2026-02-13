import { useEffect, useState, useRef, useMemo } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import {
  calculatePlayTime,
  calculateFairRotations,
  copyGamePlan,
  type PlannedSubstitution,
} from "../services/rotationPlannerService";
import { LineupBuilder } from "./LineupBuilder";
import { PlayerAvailabilityGrid } from "./PlayerAvailabilityGrid";
import { useTeamData, type PlayerWithRoster as PlayerWithRosterBase } from "../hooks/useTeamData";
import { UI_CONSTANTS } from "../constants/ui";

const client = generateClient<Schema>();

type Game = Schema["Game"]["type"];
type Team = Schema["Team"]["type"];
type FormationPosition = Schema["FormationPosition"]["type"];
type GamePlan = Schema["GamePlan"]["type"];
type PlannedRotation = Schema["PlannedRotation"]["type"];
type PlayerAvailability = Schema["PlayerAvailability"]["type"];

// Extend the base PlayerWithRoster from the hook with availability
interface PlayerWithRoster extends PlayerWithRosterBase {
  availability?: PlayerAvailability;
}

interface GamePlannerProps {
  game: Game;
  team: Team;
  onBack: () => void;
}

export function GamePlanner({ game, team, onBack }: GamePlannerProps) {
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
        console.error("Error parsing buffered starting lineup:", error);
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
  
  // Extend players with availability data
  const [players, setPlayers] = useState<PlayerWithRoster[]>([]);
  const [gamePlan, setGamePlan] = useState<GamePlan | null>(null);
  const [rotations, setRotations] = useState<PlannedRotation[]>([]);
  const [availabilities, setAvailabilities] = useState<PlayerAvailability[]>([]);
  const [startingLineup, setStartingLineup] = useState<Map<string, string>>(new Map()); // positionId -> playerId
  const [rotationIntervalMinutes, setRotationIntervalMinutes] = useState(10);
  const [selectedRotation, setSelectedRotation] = useState<number | 'starting' | 'halftime' | null>(null);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [previousGames, setPreviousGames] = useState<Game[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [swapModalData, setSwapModalData] = useState<{
    rotationNumber: number;
    positionId: string;
    currentPlayerId: string;
  } | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

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
                console.error("Error parsing starting lineup:", error);
              }
            }
          }
        } else {
          setGamePlan(null);
          gamePlanIdRef.current = null;
          setStartingLineup(new Map());
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

    // Set up reactive subscription for player availability
    const availabilitySub = client.models.PlayerAvailability.observeQuery({
      filter: { gameId: { eq: game.id } },
    }).subscribe({
      next: (data) => {
        setAvailabilities([...data.items]);
      },
    });

    // Load previous games once (doesn't need real-time updates)
    loadPreviousGames();

    return () => {
      gamePlanSub.unsubscribe();
      rotationSub.unsubscribe();
      availabilitySub.unsubscribe();
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
      console.error("Error loading previous games:", error);
    }
  };

  // Auto-select 'starting' when there's no game plan yet to show setup immediately
  useEffect(() => {
    if (gamePlan === null && selectedRotation === null) {
      setSelectedRotation('starting');
    }
  }, [gamePlan, selectedRotation]);

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
        console.error("Error auto-saving starting lineup:", error);
      } finally {
        pendingLineupSaves.current--;
        flushBufferedLineup();
      }
    }
  };

  const handleUpdatePlan = async () => {
    // Validate starting lineup
    if (startingLineup.size > maxPlayersOnField) {
      alert(`Starting lineup cannot exceed ${maxPlayersOnField} players`);
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

      // Create or update plan
      if (!currentPlan) {
        const gamePlanResult = await client.models.GamePlan.create({
          gameId: game.id,
          rotationIntervalMinutes,
          totalRotations,
          startingLineup: JSON.stringify(lineupArray),
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
          // Update gameMinute if it changed due to interval change
          // We preserve plannedSubstitutions!
          if (existingRotation.gameMinute !== gameMinute) {
            operations.push(client.models.PlannedRotation.update({
              id: existingRotation.id,
              gameMinute,
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

      await Promise.all(operations);
      
      // Data will update automatically via observeQuery subscriptions
      
      alert(gamePlan ? "Plan updated successfully!" : "Plan created successfully! Now set up each rotation.");
    } catch (error) {
      console.error("Error updating rotation plan:", error);
      alert("Failed to update rotation plan");
    } finally {
      setIsGenerating(false);
      pendingLineupSaves.current--;
      pendingRotationSaves.current--;
      flushBufferedLineup();
      flushBufferedRotations();
    }
  };

  const handleAutoGenerateRotations = async () => {
    if (!gamePlan || rotations.length === 0) {
      alert('Create a plan first before auto-generating rotations.');
      return;
    }

    if (startingLineup.size === 0) {
      alert('Set up a starting lineup first.');
      return;
    }

    const confirmed = window.confirm(
      'This will overwrite all current rotation substitutions with auto-generated fair rotations based on player availability.\n\nContinue?'
    );
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
        }));

      const lineupArray = Array.from(startingLineup.entries()).map(([positionId, playerId]) => ({
        playerId,
        positionId,
      }));

      const rotationsPerHalf = Math.max(0, Math.floor(halfLengthMinutes / rotationIntervalMinutes) - 1);

      const generatedRotations = calculateFairRotations(
        availableRoster,
        lineupArray,
        rotations.length,
        rotationsPerHalf,
        team.maxPlayersOnField || positions.length
      );

      // Update each rotation with generated substitutions
      const updates = rotations.map((rotation, idx) => {
        const generated = generatedRotations[idx];
        return client.models.PlannedRotation.update({
          id: rotation.id,
          plannedSubstitutions: JSON.stringify(generated?.substitutions || []),
        });
      });

      await Promise.all(updates);

      alert('Rotations auto-generated! Review each rotation to verify.');
    } catch (error) {
      console.error('Error auto-generating rotations:', error);
      alert('Failed to auto-generate rotations.');
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
      
      alert("Plan copied successfully!");
    } catch (error) {
      console.error("Error copying game plan:", error);
      alert("Failed to copy game plan");
    } finally {
      setIsGenerating(false);
      pendingLineupSaves.current--;
      pendingRotationSaves.current--;
      flushBufferedLineup();
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
        const subs: PlannedSubstitution[] = JSON.parse(subsJson);
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
      console.error("Error updating rotation:", error);
      alert("Failed to update rotation");
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

      // Recalculate downstream rotations so their subs stay consistent
      await recalculateDownstreamRotations(
        rotationNumber,
        new Map([[rotationNumber, emptySubsJson]])
      );
      // Data will update automatically via observeQuery subscriptions
      
      // Select this rotation to edit it
      setSelectedRotation(rotationNumber);
    } catch (error) {
      console.error("Error copying rotation:", error);
      alert("Failed to copy from previous rotation");
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
      const subs: PlannedSubstitution[] = JSON.parse(rotation.plannedSubstitutions as string);

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



  const renderRotationTimeline = () => {
    // Use memoized values - these are now calculated efficiently at the component level
    const rotationsPerHalf = gamePlan ? Math.floor(halfLengthMinutes / rotationIntervalMinutes) - 1 : 0;

    // Create timeline items with starting lineup first, then all rotations.
    // The halftime rotation is displayed as "HT" in the timeline but is still a rotation item.
    const timelineItems: Array<{ type: 'starting' | 'rotation'; rotation?: PlannedRotation; minute?: number }> = [];
    
    // Identify the halftime rotation: the first rotation in the second half.
    const halftimeRotationNumber = rotations.find(r => r.half === 2)?.rotationNumber
      ?? (rotationsPerHalf > 0 ? rotationsPerHalf + 1 : undefined);

    if (gamePlan && rotations.length > 0) {
      timelineItems.push({ type: 'starting', minute: 0 });
      rotations.forEach((rotation) => {
        timelineItems.push({ type: 'rotation', rotation });
      });
    }

    const renderSelectedDetails = () => {
      if (selectedRotation === null) return null;

      if (selectedRotation === 'starting') {
        return (
          <div className="rotation-details-panel">
            <div className="panel-header">
              <h4>Starting Lineup</h4>
              <div className="setup-controls">
                <label className="interval-selector">
                  Rotation every:
                  <select
                    value={rotationIntervalMinutes}
                    onChange={(e) => setRotationIntervalMinutes(Number(e.target.value))}
                  >
                    <option value={5}>5 min</option>
                    <option value={10}>10 min</option>
                    <option value={15}>15 min</option>
                  </select>
                </label>
                <button
                  onClick={handleUpdatePlan}
                  className="primary-button"
                  disabled={isGenerating}
                >
                  {isGenerating ? "Updating..." : (gamePlan ? "Update Plan" : "Create Plan")}
                </button>
                {gamePlan && rotations.length > 0 && (
                  <button
                    onClick={handleAutoGenerateRotations}
                    className="secondary-button"
                    disabled={isGenerating}
                    title="Auto-generate fair rotation substitutions based on current availability"
                  >
                    🔄 Auto-Generate Rotations
                  </button>
                )}
              </div>
            </div>
            <LineupBuilder
              positions={positions}
              availablePlayers={startingLineupPlayers}
              lineup={startingLineup}
              onLineupChange={handleLineupChange}
              showPreferredPositions={true}
              getPlayerAvailability={getPlayerAvailability}
            />
          </div>
        );
      }

      if (selectedRotation === 'halftime') {
        // Get the halftime rotation (first rotation of second half)
        const secondHalfStartRotation = halftimeRotationNumber
          ? rotations.find(r => r.rotationNumber === halftimeRotationNumber)
          : undefined;

        // Show the lineup AFTER the halftime rotation's subs are applied,
        // consistent with how regular rotations display their result lineup.
        // This ensures handleSwapPlayer (which uses getLineupAtRotation(rotationNumber))
        // starts from the same lineup the user sees.
        const halfTimeLineup = secondHalfStartRotation
          ? getLineupAtRotation(secondHalfStartRotation.rotationNumber)
          : (rotations.length > 0
              ? getLineupAtRotation(rotations[rotations.length - 1].rotationNumber)
              : new Map(startingLineup));

        return (
          <div className="rotation-details-panel">
            <div className="panel-header">
              <h4>Lineup at Halftime</h4>
              {secondHalfStartRotation && (
                <button
                  onClick={() => handleCopyFromPreviousRotation(secondHalfStartRotation.rotationNumber)}
                  className="secondary-button"
                  style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }}
                >
                  Copy from First Half
                </button>
              )}
            </div>
            
            {secondHalfStartRotation ? (
              <div className="rotation-lineup-custom">
                <div className="position-lineup-grid">
                  {positions.map((position) => {
                    const assignedPlayerId = halfTimeLineup.get(position.id);
                    const assignedPlayer = rotationPlayers.find((p) => p.id === assignedPlayerId);

                    return (
                      <div key={position.id} className="position-slot">
                        <div className="position-label">{position.abbreviation}</div>
                        {assignedPlayer ? (
                          <button
                            className="assigned-player clickable"
                            onClick={() => setSwapModalData({
                              rotationNumber: secondHalfStartRotation.rotationNumber,
                              positionId: position.id,
                              currentPlayerId: assignedPlayer.id,
                            })}
                            style={{ cursor: 'pointer', border: '2px solid #ff9800' }}
                          >
                            <span className="player-number">#{assignedPlayer.playerNumber || 0}</span>
                            <span className="player-name-short">
                              {assignedPlayer.firstName} {assignedPlayer.lastName.charAt(0)}.
                            </span>
                            <span style={{ marginLeft: 'auto', fontSize: '0.8rem' }}>🔄</span>
                          </button>
                        ) : (
                          <select
                            className="player-select"
                            value=""
                            onChange={(e) => {
                              if (e.target.value) {
                                const newLineup = new Map(halfTimeLineup);
                                newLineup.set(position.id, e.target.value);
                                handleRotationLineupChange(secondHalfStartRotation.rotationNumber, newLineup);
                              }
                            }}
                          >
                            <option value="">Select player...</option>
                            {rotationPlayers
                              .filter((p) => !Array.from(halfTimeLineup.values()).includes(p.id))
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
                      .filter((p) => !Array.from(halfTimeLineup.values()).includes(p.id))
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
            ) : (
              <p>Create rotations first by clicking "Update Plan"</p>
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

      const subs: PlannedSubstitution[] = JSON.parse(rotation.plannedSubstitutions as string);
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
                Copy from Previous
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
                          {assignedPlayer.firstName} {assignedPlayer.lastName.charAt(0)}.
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

    return (
      <div className="planner-section">
        <h3>Game Plan</h3>
        {timelineItems.length > 0 && (
        <div className="timeline-container" ref={timelineRef}>
          <div className="timeline-header">
            <div className="timeline-labels">
              {timelineItems.map((item) => {
                const isHalftime = item.type === 'rotation' && item.rotation?.rotationNumber === halftimeRotationNumber;
                const isSelected = item.type === 'starting'
                  ? selectedRotation === 'starting'
                  : isHalftime
                    ? selectedRotation === 'halftime'
                    : selectedRotation === item.rotation?.rotationNumber;

                const activeClass = isSelected ? 'active' : '';

                if (item.type === 'starting') {
                  return (
                    <div
                      key="starting"
                      className={`timeline-marker clickable ${activeClass}`}
                      onClick={() => handleRotationClick('starting')}
                      style={{ cursor: 'pointer' }}
                    >
                      0'
                    </div>
                  );
                }
                if (isHalftime) {
                  return (
                    <div
                      key={item.rotation!.id}
                      className={`timeline-marker halftime-marker clickable ${activeClass}`}
                      onClick={() => handleRotationClick('halftime')}
                      style={{ cursor: 'pointer' }}
                    >
                      HT
                    </div>
                  );
                }
                return (
                  <div
                    key={item.rotation!.id}
                    className={`timeline-marker clickable ${activeClass}`}
                    onClick={() => handleRotationClick(item.rotation!.rotationNumber)}
                    style={{ cursor: 'pointer' }}
                  >
                    {item.rotation!.gameMinute}'
                  </div>
                );
              })}
            </div>
          </div>

          <div className="timeline-rotations">
            {timelineItems.map((item) => {
              const isHalftime = item.type === 'rotation' && item.rotation?.rotationNumber === halftimeRotationNumber;
              const isSelected = item.type === 'starting'
                ? selectedRotation === 'starting'
                : isHalftime
                  ? selectedRotation === 'halftime'
                  : selectedRotation === item.rotation!.rotationNumber;

              const activeClass = isSelected ? 'active' : '';

              if (item.type === 'starting') {
                return (
                  <div key="starting-column" className="rotation-column">
                    <button
                      className={`rotation-button ${activeClass}`}
                      onClick={() => handleRotationClick('starting')}
                    >
                      Lineup
                    </button>
                  </div>
                );
              }

              if (isHalftime) {
                const rotation = item.rotation!;
                const subsCount = JSON.parse(rotation.plannedSubstitutions as string).length;
                return (
                  <div key={rotation.id} className="rotation-column halftime-column">
                    <button
                      className={`rotation-button ${activeClass}`}
                      onClick={() => handleRotationClick('halftime')}
                    >
                      {subsCount > 0 ? `${subsCount} subs` : 'Halftime'}
                    </button>
                  </div>
                );
              }

              const rotation = item.rotation!;
              const subsCount = JSON.parse(rotation.plannedSubstitutions as string).length;

              return (
                <div key={rotation.id} className="rotation-column">
                  <button
                    className={`rotation-button ${activeClass}`}
                    onClick={() => handleRotationClick(rotation.rotationNumber)}
                  >
                    {subsCount} subs
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        )}

        {renderSelectedDetails()}

        <div className="projected-playtime">
          <h4>Projected Play Time</h4>
          <div className="playtime-bars">
            {rotationPlayers
              .map((player) => {
                const data = playTimeData.get(player.id);
                const totalMinutes = data?.totalMinutes || 0;
                const percentage = (totalMinutes / (halfLengthMinutes * 2)) * 100;

                return {
                  player,
                  totalMinutes,
                  percentage,
                };
              })
              .sort((a, b) => b.totalMinutes - a.totalMinutes)
              .map(({ player, totalMinutes, percentage }) => (
                <div key={player.id} className="playtime-bar-container">
                  <div className="playtime-label">
                    #{player.playerNumber} {player.firstName} {player.lastName?.charAt(0)}.
                  </div>
                  <div className="playtime-bar-wrapper">
                    <div className="playtime-bar" style={{ width: `${percentage}%` }}>
                      {totalMinutes}min
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="game-planner-container">
      <div className="planner-header">
        <button onClick={onBack} className="back-button">
          ← Back
        </button>
        <h2>Game Plan: {game.opponent}</h2>
        <div className="planner-actions">
          <button onClick={() => setShowCopyModal(true)} className="secondary-button">
            Copy from Previous
          </button>
        </div>
      </div>

      {validationErrors.length > 0 && (
        <div className="validation-errors">
          <h4>Validation Errors:</h4>
          <ul>
            {validationErrors.map((error, idx) => (
              <li key={idx}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <PlayerAvailabilityGrid
        players={players}
        gameId={game.id}
        coaches={team.coaches || []}
        getPlayerAvailability={getPlayerAvailability}
      />
      {renderRotationTimeline()}

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
  );
}
