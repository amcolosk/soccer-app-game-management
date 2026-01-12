import { useEffect, useState, useRef } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import {
  generateRotationPlan,
  calculatePlayTime,
  copyGamePlan,
  updatePlayerAvailability,
  type PlannedSubstitution,
  type RotationPlanInput,
} from "../services/rotationPlannerService";
import { sortRosterByNumber } from "../utils/playerUtils";
import { LineupBuilder } from "./LineupBuilder";

const client = generateClient<Schema>();

type Game = Schema["Game"]["type"];
type Team = Schema["Team"]["type"];
type Player = Schema["Player"]["type"];
type FormationPosition = Schema["FormationPosition"]["type"];
type GamePlan = Schema["GamePlan"]["type"];
type PlannedRotation = Schema["PlannedRotation"]["type"];
type PlayerAvailability = Schema["PlayerAvailability"]["type"];

interface PlayerWithRoster extends Player {
  playerNumber?: number;
  preferredPositions?: string;
  availability?: PlayerAvailability;
}

interface GamePlannerProps {
  game: Game;
  team: Team;
  onBack: () => void;
}

export function GamePlanner({ game, team, onBack }: GamePlannerProps) {
  const [players, setPlayers] = useState<PlayerWithRoster[]>([]);
  const [positions, setPositions] = useState<FormationPosition[]>([]);
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
  const timelineRef = useRef<HTMLDivElement>(null);

  const halfLengthMinutes = team.halfLengthMinutes || 30;
  const maxPlayersOnField = team.maxPlayersOnField || 11;

  useEffect(() => {
    loadData();
  }, [game.id, team.id]);

  const loadData = async () => {
    try {
      // Load team roster
      const rosterResult = await client.models.TeamRoster.list({
        filter: { teamId: { eq: team.id } },
      });
      const rosters = sortRosterByNumber([...rosterResult.data]);

      // Load all players
      const playerResult = await client.models.Player.list();
      const allPlayers = playerResult.data;

      // Merge roster with player data
      const playersWithRoster: PlayerWithRoster[] = rosters
        .map((roster) => {
          const player = allPlayers.find((p) => p.id === roster.playerId);
          if (!player) return null;
          return {
            ...player,
            playerNumber: roster.playerNumber,
            preferredPositions: roster.preferredPositions || undefined,
          };
        })
        .filter((p) => p !== null) as PlayerWithRoster[];

      setPlayers(playersWithRoster);

      // Load formation positions
      if (team.formationId) {
        const positionResult = await client.models.FormationPosition.list({
          filter: { formationId: { eq: team.formationId } },
        });
        setPositions(
          [...positionResult.data].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        );
      }

      // Load game plan
      const gamePlanResult = await client.models.GamePlan.list({
        filter: { gameId: { eq: game.id } },
      });

      if (gamePlanResult.data.length > 0) {
        const plan = gamePlanResult.data[0];
        setGamePlan(plan);
        setRotationIntervalMinutes(plan.rotationIntervalMinutes);

        // Load rotations
        const rotationResult = await client.models.PlannedRotation.list({
          filter: { gamePlanId: { eq: plan.id } },
        });
        setRotations([...rotationResult.data].sort((a, b) => a.rotationNumber - b.rotationNumber));

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
      }

      // Load player availability
      const availabilityResult = await client.models.PlayerAvailability.list({
        filter: { gameId: { eq: game.id } },
      });
      setAvailabilities([...availabilityResult.data]);

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
      console.error("Error loading game planner data:", error);
      alert("Failed to load game planner data");
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
      await loadData();
    } catch (error) {
      console.error("Error updating availability:", error);
      alert("Failed to update player availability");
    }
  };

  const handleLineupChange = (positionId: string, playerId: string) => {
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
  };

  const handleGeneratePlan = async () => {
    // Validate starting lineup
    if (startingLineup.size === 0) {
      alert("Please select a starting lineup first");
      return;
    }

    if (startingLineup.size > maxPlayersOnField) {
      alert(`Starting lineup cannot exceed ${maxPlayersOnField} players`);
      return;
    }

    // Get available players only
    const availablePlayers = players.filter(
      (p) => getPlayerAvailability(p.id) === "available"
    );

    if (availablePlayers.length < startingLineup.size) {
      alert("Not enough available players for starting lineup");
      return;
    }

    setIsGenerating(true);
    setValidationErrors([]);

    try {
      // Delete existing plan if any
      if (gamePlan) {
        // Delete rotations first
        const deleteRotationPromises = rotations.map((r) =>
          client.models.PlannedRotation.delete({ id: r.id })
        );
        await Promise.all(deleteRotationPromises);
        
        // Delete plan
        await client.models.GamePlan.delete({ id: gamePlan.id });
      }

      // Prepare input - map to roster objects with required fields
      const rosterData = availablePlayers.map((p) => ({
        id: p.id,
        teamId: team.id,
        playerId: p.id,
        playerNumber: p.playerNumber || 0,
        preferredPositions: p.preferredPositions,
      }));

      const lineupArray = Array.from(startingLineup.entries()).map(([positionId, playerId]) => ({
        playerId,
        positionId,
      }));

      const input: RotationPlanInput = {
        gameId: game.id,
        teamId: team.id,
        halfLengthMinutes,
        maxPlayersOnField,
        rotationIntervalMinutes,
        availablePlayers: rosterData,
        startingLineup: lineupArray,
        coaches: team.coaches || [],
      };

      // Generate plan
      await generateRotationPlan(input);
      
      // Reload data
      await loadData();
      
      alert("Rotation plan generated successfully!");
    } catch (error) {
      console.error("Error generating rotation plan:", error);
      alert("Failed to generate rotation plan");
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
      await loadData();
      
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

  const handleEditSubstitution = async (
    rotationId: string,
    oldSub: PlannedSubstitution,
    newPlayerInId: string
  ) => {
    const rotation = rotations.find((r) => r.id === rotationId);
    if (!rotation) return;

    const subs: PlannedSubstitution[] = JSON.parse(rotation.plannedSubstitutions as string);
    const updatedSubs = subs.map((s) =>
      s.playerOutId === oldSub.playerOutId && s.positionId === oldSub.positionId
        ? { ...s, playerInId: newPlayerInId }
        : s
    );

    try {
      await client.models.PlannedRotation.update({
        id: rotationId,
        plannedSubstitutions: JSON.stringify(updatedSubs),
      });
      await loadData();
    } catch (error) {
      console.error("Error updating substitution:", error);
      alert("Failed to update substitution");
    }
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

    const availablePlayers = players.filter(
      (p) => getPlayerAvailability(p.id) === "available"
    );

    const rotationsPerHalf = gamePlan ? Math.floor(halfLengthMinutes / rotationIntervalMinutes) - 1 : 0;

    // Calculate lineup state at each rotation
    const getLineupAtRotation = (rotationNumber: number): Map<string, string> => {
      const lineup = new Map(startingLineup);
      
      // Apply all substitutions up to this rotation
      for (let i = 0; i < rotations.length && rotations[i].rotationNumber <= rotationNumber; i++) {
        const rotation = rotations[i];
        const subs: PlannedSubstitution[] = JSON.parse(rotation.plannedSubstitutions as string);
        subs.forEach(sub => {
          // Find which position the playerOut is in
          for (const [posId, pId] of lineup.entries()) {
            if (pId === sub.playerOutId) {
              lineup.set(posId, sub.playerInId);
              break;
            }
          }
        });
      }
      
      return lineup;
    };


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
              availablePlayers={availablePlayers}
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

        return (
          <div className="rotation-details-panel">
            <h4>Lineup at Halftime</h4>
            <div className="rotation-lineup-grid">
              {positions.map((position) => {
                const playerId = halfTimeLineup.get(position.id);
                const player = playerId ? players.find(p => p.id === playerId) : null;

                return (
                  <div key={position.id} className="lineup-position-card">
                    <div className="position-header">{position.abbreviation}</div>
                    <div className="player-content">
                      {player ? (
                        <>
                          <span className="player-number">#{player.playerNumber}</span>
                          <span className="player-name">{player.firstName} {player.lastName}</span>
                        </>
                      ) : (
                        <span className="empty-position">-</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      }

      // Rotation logic
      const rotation = rotations.find(r => r.rotationNumber === selectedRotation);
      if (!rotation) return null;

      const subs: PlannedSubstitution[] = JSON.parse(rotation.plannedSubstitutions as string);
      const currentLineup = getLineupAtRotation(rotation.rotationNumber);
      const subsOutIds = new Set(subs.map(s => s.playerOutId));
      const subsInIds = new Set(subs.map(s => s.playerInId));

      return (
        <div className="rotation-details-panel">
          <div className="panel-header">
            <h4>Rotation {rotation.rotationNumber} ({rotation.gameMinute}')</h4>
            <span className="subs-count">{subs.length} Substitutions</span>
          </div>
          
          <div className="rotation-lineup-grid">
            {positions.map((position) => {
              const playerId = currentLineup.get(position.id);
              const player = playerId ? players.find(p => p.id === playerId) : null;
              const isSubbingOut = subsOutIds.has(playerId || '');
              const isSubbingIn = subsInIds.has(playerId || '');
              const sub = subs.find(s => s.positionId === position.id);

              return (
                <div key={position.id} className={`lineup-position-card ${isSubbingOut ? 'subbing-out' : isSubbingIn ? 'subbing-in' : ''}`}>
                  <div className="position-header">{position.abbreviation}</div>
                  <div className="player-content">
                    {player ? (
                      <>
                        <div className="player-main">
                          {isSubbingOut && <span className="status-badge out">OUT</span>}
                          {isSubbingIn && <span className="status-badge in">IN</span>}
                          <span className="player-number">#{player.playerNumber}</span>
                          <span className="player-name">{player.firstName} {player.lastName}</span>
                        </div>
                      </>
                    ) : (
                      <span className="empty-position">-</span>
                    )}
                    
                    {sub && (
                      <div className="sub-action">
                        <span className="arrow">↓</span>
                        <select
                          value={sub.playerInId}
                          onChange={(e) =>
                            handleEditSubstitution(rotation.id, sub, e.target.value)
                          }
                          className="sub-select"
                        >
                          {availablePlayers.map((p) => (
                            <option key={p.id} value={p.id}>
                              #{p.playerNumber} {p.firstName} {p.lastName}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
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
                if (item.type === 'starting') {
                  return (
                    <div
                      key="starting"
                      className="timeline-marker starting-marker"
                    >
                      Start
                    </div>
                  );
                }
                if (item.type === 'halftime') {
                  return (
                    <div
                      key={`ht-${index}`}
                      className="timeline-marker halftime-marker"
                    >
                      HT
                    </div>
                  );
                }
                return (
                  <div
                    key={item.rotation!.id}
                    className="timeline-marker"
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
              disabled={!!gamePlan}
            >
              <option value={5}>5 min</option>
              <option value={10}>10 min</option>
              <option value={15}>15 min</option>
            </select>
          </label>
          <button
            onClick={handleGeneratePlan}
            className="primary-button"
            disabled={isGenerating || startingLineup.size === 0}
          >
            {isGenerating ? "Generating..." : gamePlan ? "Regenerate Plan" : "Generate Plan"}
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
    </div>
  );
}
