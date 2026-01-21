import { useEffect, useState, useRef } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import {
  calculatePlayTime,
  copyGamePlan,
  updatePlayerAvailability,
  type PlannedSubstitution,
} from "../services/rotationPlannerService";
import { LineupBuilder } from "./LineupBuilder";
import { useTeamData, type PlayerWithRoster as PlayerWithRosterBase } from "../hooks/useTeamData";

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
          if (plan.startingLineup) {
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
        setRotations([...currentPlanRotations].sort((a, b) => a.rotationNumber - b.rotationNumber));
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
      
      // Filter games that have plans
      const gamesWithPlans = await Promise.all(
        previousGamesResult.data.map(async (g) => {
          const planResult = await client.models.GamePlan.list({
            filter: { gameId: { eq: g.id } },
          });
          return planResult.data.length > 0 ? g : null;
        })
      );
      
      const validGames: Game[] = [];
      for (const g of gamesWithPlans) {
        if (g !== null) {
          validGames.push(g);
        }
      }
      
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

  const getPlayerAvailability = (playerId: string): string => {
    const availability = availabilities.find((a) => a.playerId === playerId);
    return availability?.status || "available";
  };

  const handleAvailabilityToggle = async (playerId: string) => {
    const currentStatus = getPlayerAvailability(playerId);
    const statusCycle = ["available", "absent", "late-arrival", "injured"];
    const currentIndex = statusCycle.indexOf(currentStatus);
    const newStatus = statusCycle[(currentIndex + 1) % statusCycle.length] as
      | "available"
      | "absent"
      | "late-arrival"
      | "injured";

    try {
      await updatePlayerAvailability(
        game.id,
        playerId,
        newStatus,
        undefined,
        team.coaches || []
      );
      // Data will update automatically via observeQuery subscription
    } catch (error) {
      console.error("Error updating availability:", error);
      alert("Failed to update player availability");
    }
  };

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
      }
    }
  };

  const handleUpdatePlan = async () => {
    // Validate starting lineup
    if (startingLineup.size === 0) {
      alert("Please select a starting lineup first");
      return;
    }

    if (startingLineup.size > maxPlayersOnField) {
      alert(`Starting lineup cannot exceed ${maxPlayersOnField} players`);
      return;
    }

    setIsGenerating(true);
    setValidationErrors([]);

    try {
      const lineupArray = Array.from(startingLineup.entries()).map(([positionId, playerId]) => ({
        playerId,
        positionId,
      }));

      // Calculate total rotations
      const rotationsPerHalf = Math.max(0, Math.floor(halfLengthMinutes / rotationIntervalMinutes) - 1);
      const totalRotations = rotationsPerHalf * 2;
      
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
        const rotationInHalf = i <= rotationsPerHalf ? i : i - rotationsPerHalf;
        const gameMinute = half === 1 
          ? rotationInHalf * rotationIntervalMinutes
          : halfLengthMinutes + (rotationInHalf * rotationIntervalMinutes);

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
    }
  };

  const handleCopyFromGame = async (sourceGameId: string) => {
    try {
      setShowCopyModal(false);
      setIsGenerating(true);

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
          selectedElement.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
        }
      }
    }, 100);
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

    try {
      await client.models.PlannedRotation.update({
        id: rotation.id,
        plannedSubstitutions: JSON.stringify(subs),
      });
      // Data will update automatically via observeQuery subscriptions
    } catch (error) {
      console.error("Error updating rotation:", error);
      alert("Failed to update rotation");
    }
  };

  const handleCopyFromPreviousRotation = async (rotationNumber: number) => {
    const rotation = rotations.find((r) => r.rotationNumber === rotationNumber);
    if (!rotation) return;

    // Copy the lineup (no substitutions)
    try {
      await client.models.PlannedRotation.update({
        id: rotation.id,
        plannedSubstitutions: JSON.stringify([]),
      });
      // Data will update automatically via observeQuery subscriptions
      
      // Select this rotation to edit it
      setSelectedRotation(rotationNumber);
    } catch (error) {
      console.error("Error copying rotation:", error);
      alert("Failed to copy from previous rotation");
    }
  };

  const handleSwapPlayer = async (newPlayerId: string) => {
    if (!swapModalData) return;

    const { rotationNumber, positionId, currentPlayerId } = swapModalData;
    const currentLineup = getLineupAtRotation(rotationNumber);
    const newLineup = new Map(currentLineup);

    // Find if the new player is already in the lineup
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

  // Calculate lineup state at each rotation
  const getLineupAtRotation = (rotationNumber: number): Map<string, string> => {
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
    
    return lineup;
  };

  const renderAvailabilityGrid = () => {
    const getStatusColor = (status: string) => {
      switch (status) {
        case "available":
          return "#4caf50";
        case "absent":
          return "#f44336";
        case "injured":
          return "#ff9800";
        case "late-arrival":
          return "#fdd835";
        default:
          return "#9e9e9e";
      }
    };

    const getStatusLabel = (status: string) => {
      switch (status) {
        case "available":
          return "✓";
        case "absent":
          return "✗";
        case "injured":
          return "🩹";
        case "late-arrival":
          return "⏰";
        default:
          return "?";
      }
    };

    return (
      <div className="planner-section">
        <h3>Player Availability</h3>
        <div className="availability-grid">
          {players.map((player) => {
            const status = getPlayerAvailability(player.id);
            return (
              <button
                key={player.id}
                className="availability-card"
                onClick={() => handleAvailabilityToggle(player.id)}
                style={{ borderColor: getStatusColor(status) }}
              >
                <div
                  className="availability-status"
                  style={{ backgroundColor: getStatusColor(status) }}
                >
                  {getStatusLabel(status)}
                </div>
                <div className="player-info">
                  <span className="player-number">#{player.playerNumber}</span>
                  <span className="player-name">
                    {player.firstName} {player.lastName}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
        <p className="availability-legend">
          Click player cards to cycle: Available → Absent → Late Arrival → Injured
        </p>
      </div>
    );
  };

  const renderRotationTimeline = () => {

    const playTimeData = gamePlan && rotations.length > 0 ? calculatePlayTime(
      rotations,
      Array.from(startingLineup.entries()).map(([positionId, playerId]) => ({
        playerId,
        positionId,
      })),
      rotationIntervalMinutes,
      halfLengthMinutes * 2
    ) : new Map();

    // For starting lineup: exclude late-arrival and unavailable players
    const startingLineupPlayers = players.filter(
      (p) => {
        const status = getPlayerAvailability(p.id);
        return status === "available";
      }
    );

    // For rotations and halftime: include late-arrival players
    const rotationPlayers = players.filter(
      (p) => {
        const status = getPlayerAvailability(p.id);
        return status === "available" || status === "late-arrival";
      }
    );

    const rotationsPerHalf = gamePlan ? Math.floor(halfLengthMinutes / rotationIntervalMinutes) - 1 : 0;

    // Create timeline items with starting lineup first, then HT marker between halves
    const timelineItems: Array<{ type: 'starting' | 'rotation' | 'halftime'; rotation?: PlannedRotation; minute?: number }> = [];
    
    // Add starting lineup as first item
    timelineItems.push({ type: 'starting' });
    
    if (gamePlan && rotations.length > 0) {
      rotations.forEach((rotation, index) => {
        // Add halftime marker before first rotation of second half
        if (index === rotationsPerHalf) {
          timelineItems.push({ type: 'halftime', minute: halfLengthMinutes });
        }
        timelineItems.push({ type: 'rotation', rotation });
      });
    }

    const renderSelectedDetails = () => {
      if (selectedRotation === null) return null;

      if (selectedRotation === 'starting') {
        return (
          <div className="rotation-details-panel">
            <h4>Starting Lineup</h4>
            <LineupBuilder
              positions={positions}
              availablePlayers={startingLineupPlayers}
              lineup={startingLineup}
              onLineupChange={handleLineupChange}
              showPreferredPositions={true}
            />
          </div>
        );
      }

      if (selectedRotation === 'halftime') {
        const halfTimeLineup = rotations.length > 0 && rotationsPerHalf > 0 
          ? getLineupAtRotation(rotationsPerHalf)
          : new Map(startingLineup);
        
        // Get the first rotation of second half for making halftime changes
        const secondHalfStartRotation = rotations.find(r => r.rotationNumber === rotationsPerHalf + 1);

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
                              {assignedPlayer.firstName.charAt(0)}. {assignedPlayer.lastName}
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
                          {assignedPlayer.firstName.charAt(0)}. {assignedPlayer.lastName}
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
        <div className="timeline-container" ref={timelineRef}>
          <div className="timeline-header">
            <div className="timeline-labels">
              {timelineItems.map((item, index) => {
                const isSelected = item.type === 'starting' 
                  ? selectedRotation === 'starting'
                  : item.type === 'halftime'
                    ? selectedRotation === 'halftime'
                    : selectedRotation === item.rotation?.rotationNumber;

                const activeClass = isSelected ? 'active' : '';

                if (item.type === 'starting') {
                  return (
                    <div
                      key="starting"
                      className={`timeline-marker starting-marker clickable ${activeClass}`}
                      onClick={() => handleRotationClick('starting')}
                      style={{ cursor: 'pointer' }}
                    >
                      Start
                    </div>
                  );
                }
                if (item.type === 'halftime') {
                  return (
                    <div
                      key={`ht-${index}`}
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
            {timelineItems.map((item, index) => {
              const isSelected = item.type === 'starting' 
                ? selectedRotation === 'starting'
                : item.type === 'halftime'
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
                      Setup
                    </button>
                  </div>
                );
              }

              if (item.type === 'halftime') {
                return (
                  <div key={`ht-column-${index}`} className="rotation-column halftime-column">
                    <button
                      className={`rotation-button ${activeClass}`}
                      onClick={() => handleRotationClick('halftime')}
                    >
                      Halftime
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

        {renderSelectedDetails()}

        <div className="projected-playtime">
          <h4>Projected Play Time</h4>
          <div className="playtime-bars">
            {Array.from(playTimeData.entries())
              .sort((a, b) => b[1].totalMinutes - a[1].totalMinutes)
              .map(([playerId, data]) => {
                const player = players.find((p) => p.id === playerId);
                if (!player) return null;

                const percentage = (data.totalMinutes / (halfLengthMinutes * 2)) * 100;

                return (
                  <div key={playerId} className="playtime-bar-container">
                    <div className="playtime-label">
                      #{player.playerNumber} {player.firstName?.charAt(0)}. {player.lastName}
                    </div>
                    <div className="playtime-bar-wrapper">
                      <div className="playtime-bar" style={{ width: `${percentage}%` }}>
                        {data.totalMinutes}min
                      </div>
                    </div>
                  </div>
                );
              })}
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
            disabled={isGenerating || startingLineup.size === 0}
          >
            {isGenerating ? "Updating..." : (gamePlan ? "Update Plan" : "Create Plan")}
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

      {renderAvailabilityGrid()}
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
        const currentLineup = getLineupAtRotation(swapModalData.rotationNumber);
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
