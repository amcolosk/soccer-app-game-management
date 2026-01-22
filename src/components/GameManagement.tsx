import { useEffect, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { trackEvent, AnalyticsEvents } from "../utils/analytics";
import {
  calculatePlayerPlayTime,
  formatPlayTime,
  isPlayerCurrentlyPlaying,
} from "../utils/playTimeCalculations";
import {
  isPlayerInLineup,
} from "../utils/lineupUtils";
import { formatGameTimeDisplay, formatMinutesSeconds } from "../utils/gameTimeUtils";
import { executeSubstitution, closeActivePlayTimeRecords } from "../services/substitutionService";
import { updatePlayerAvailability, type PlannedSubstitution } from "../services/rotationPlannerService";
import { PlayerSelect } from "./PlayerSelect";
import { LineupBuilder } from "./LineupBuilder";
import { useTeamData, type PlayerWithRoster as PlayerWithRosterBase } from "../hooks/useTeamData";

const client = generateClient<Schema>();

type Game = Schema["Game"]["type"];
type Team = Schema["Team"]["type"];
type Player = Schema["Player"]["type"];
type FormationPosition = Schema["FormationPosition"]["type"];
type LineupAssignment = Schema["LineupAssignment"]["type"];
type PlayTimeRecord = Schema["PlayTimeRecord"]["type"];
type Goal = Schema["Goal"]["type"];
type GameNote = Schema["GameNote"]["type"];
type GamePlan = Schema["GamePlan"]["type"];
type PlannedRotation = Schema["PlannedRotation"]["type"];
type PlayerAvailability = Schema["PlayerAvailability"]["type"];

// Use hook's PlayerWithRoster type (same structure)
type PlayerWithRoster = PlayerWithRosterBase;

interface GameManagementProps {
  game: Game;
  team: Team;
  onBack: () => void;
}

export function GameManagement({ game, team, onBack }: GameManagementProps) {
  // Load team roster and formation positions with real-time updates
  const { players, positions } = useTeamData(team.id, team.formationId);
  
  const [lineup, setLineup] = useState<LineupAssignment[]>([]);
  const [playTimeRecords, setPlayTimeRecords] = useState<PlayTimeRecord[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [gameNotes, setGameNotes] = useState<GameNote[]>([]);
  const [gameState, setGameState] = useState(game);
  const [currentTime, setCurrentTime] = useState(game.elapsedSeconds || 0);
  const [isRunning, setIsRunning] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [showPositionPicker, setShowPositionPicker] = useState(false);
  const [showSubstitution, setShowSubstitution] = useState(false);
  const [substitutionPosition, setSubstitutionPosition] = useState<FormationPosition | null>(null);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [goalScoredByUs, setGoalScoredByUs] = useState(true);
  const [goalScorerId, setGoalScorerId] = useState("");
  const [goalAssistId, setGoalAssistId] = useState("");
  const [goalNotes, setGoalNotes] = useState("");
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteType, setNoteType] = useState<'gold-star' | 'yellow-card' | 'red-card' | 'other'>('other');
  const [notePlayerId, setNotePlayerId] = useState("");
  const [noteText, setNoteText] = useState("");

  // Game planner integration
  const [gamePlan, setGamePlan] = useState<GamePlan | null>(null);
  const [plannedRotations, setPlannedRotations] = useState<PlannedRotation[]>([]);
  const [playerAvailabilities, setPlayerAvailabilities] = useState<PlayerAvailability[]>([]);
  const [showAvailabilityCheck, setShowAvailabilityCheck] = useState(false);
  const [showRotationModal, setShowRotationModal] = useState(false);
  const [currentRotation, setCurrentRotation] = useState<PlannedRotation | null>(null);
  const [showLateArrivalModal, setShowLateArrivalModal] = useState(false);

  // Substitution queue: array of {playerId, positionId}
  interface SubQueue {
    playerId: string;
    positionId: string;
  }
  
  const handleDeleteGame = async () => {
    if (window.confirm("Are you sure you want to delete this game? This action cannot be undone.")) {
      try {
        await client.models.Game.delete({ id: game.id });
        onBack(); // Navigate back to game list after successful deletion
      } catch (error) {
        console.error("Error deleting game:", error);
        alert("Failed to delete game");
      }
    }
  };
  const [substitutionQueue, setSubstitutionQueue] = useState<SubQueue[]>([]);

  const halfLengthSeconds = (team.halfLengthMinutes || 30) * 60;

  // Store active game info for persistence across refreshes
  useEffect(() => {
    localStorage.setItem('activeGame', JSON.stringify({
      gameId: game.id,
      teamId: team.id,
    }));

    return () => {
      // Clear on unmount if game is completed
      if (gameState.status === 'completed') {
        localStorage.removeItem('activeGame');
      }
    };
  }, [game.id, team.id, gameState.status]);

  // Observe game changes and restore state
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
          
          // Auto-resume timer if game was in progress
          if (updatedGame.status === 'in-progress' && updatedGame.lastStartTime) {
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

  useEffect(() => {
    // Player and position loading now handled by useTeamData hook

    // Load lineup
    const lineupSub = client.models.LineupAssignment.observeQuery({
      filter: { gameId: { eq: game.id } },
    }).subscribe({
      next: (data) => setLineup([...data.items]),
    });

    // Load play time records
    const playTimeSub = client.models.PlayTimeRecord.observeQuery({
      filter: { gameId: { eq: game.id } },
    }).subscribe({
      next: (data) => setPlayTimeRecords([...data.items]),
    });

    // Load goals
    const goalSub = client.models.Goal.observeQuery({
      filter: { gameId: { eq: game.id } },
    }).subscribe({
      next: (data) => setGoals([...data.items].sort((a, b) => {
        if (a.half !== b.half) return a.half - b.half;
        return a.gameSeconds - b.gameSeconds;
      })),
    });

    // Load game notes
    const noteSub = client.models.GameNote.observeQuery({
      filter: { gameId: { eq: game.id } },
    }).subscribe({
      next: (data) => setGameNotes([...data.items].sort((a, b) => {
        if (a.half !== b.half) return a.half - b.half;
        return a.gameSeconds - b.gameSeconds;
      })),
    });

    // Load game plan and rotations
    const gamePlanSub = client.models.GamePlan.observeQuery({
      filter: { gameId: { eq: game.id } },
    }).subscribe({
      next: (data) => {
        if (data.items.length > 0) {
          setGamePlan(data.items[0]);
        }
      },
    });

    const rotationSub = client.models.PlannedRotation.observeQuery().subscribe({
      next: (data) => {
        const gameRotations = data.items.filter(r => {
          // Find the game plan for this game
          return gamePlan && r.gamePlanId === gamePlan.id;
        });
        setPlannedRotations(gameRotations.sort((a, b) => a.rotationNumber - b.rotationNumber));
      },
    });

    const availabilitySub = client.models.PlayerAvailability.observeQuery({
      filter: { gameId: { eq: game.id } },
    }).subscribe({
      next: (data) => setPlayerAvailabilities([...data.items]),
    });

    return () => {
      lineupSub.unsubscribe();
      playTimeSub.unsubscribe();
      goalSub.unsubscribe();
      noteSub.unsubscribe();
      gamePlanSub.unsubscribe();
      rotationSub.unsubscribe();
      availabilitySub.unsubscribe();
    };
  }, [team.id, team.formationId, game.id, gamePlan?.id]);

  // Sync lineup from game plan when available
  useEffect(() => {
    const syncLineupFromGamePlan = async () => {
      if (!gamePlan || gameState.status !== 'scheduled' || lineup.length > 0) {
        return; // Only sync if game is scheduled and no lineup exists yet
      }

      if (!gamePlan.startingLineup) {
        console.log('Game plan has no starting lineup data');
        return;
      }

      try {
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
        console.error('Error syncing lineup from game plan:', error);
      }
    };

    syncLineupFromGamePlan();
  }, [gamePlan, gameState.status, lineup.length, game.id, team.coaches]);

  // Timer effect
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
            handleHalftime();
            return newTime;
          }
          
          // Auto-end game after 2 hours maximum (7200 seconds)
          if (newTime >= 7200) {
            handleEndGame();
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

  const getCurrentGameTime = () => {
    // Return total game time - timer continues from first half into second half
    return currentTime;
  };

  const getPlayerAvailability = (playerId: string): string => {
    const availability = playerAvailabilities.find(a => a.playerId === playerId);
    return availability?.status || 'available';
  };

  const getNextRotation = (): PlannedRotation | null => {
    if (!gamePlan || plannedRotations.length === 0) return null;
    
    const currentMinutes = Math.floor(currentTime / 60);
    return plannedRotations.find(r => {
      return r.half === gameState.currentHalf && 
             r.gameMinute > currentMinutes;
    }) || null;
  };

  const handleMarkInjured = async (playerId: string) => {
    try {
      await updatePlayerAvailability(
        game.id,
        playerId,
        'injured',
        `Injured at ${formatGameTimeDisplay(currentTime, gameState.currentHalf || 1)}`,
        team.coaches || []
      );
      
      // Close active play time record
      await closeActivePlayTimeRecords(playTimeRecords, currentTime, [playerId]);
      
      alert('Player marked as injured');
    } catch (error) {
      console.error('Error marking player injured:', error);
      alert('Failed to mark player injured');
    }
  };

  const handleLateArrival = async (playerId: string) => {
    try {
      await updatePlayerAvailability(
        game.id,
        playerId,
        'available',
        `Arrived late at ${formatGameTimeDisplay(currentTime, gameState.currentHalf || 1)}`,
        team.coaches || []
      );
      
      setShowLateArrivalModal(false);
      alert('Player marked as available');
    } catch (error) {
      console.error('Error marking late arrival:', error);
      alert('Failed to update player availability');
    }
  };

  const handleStartGame = async () => {
    // Show availability check if there's a game plan
    if (gamePlan && gameState.status === 'scheduled') {
      setShowAvailabilityCheck(true);
      return;
    }

    try {
      const startTime = new Date().toISOString();
      
      await client.models.Game.update({
        id: game.id,
        status: 'in-progress',
        lastStartTime: startTime,
      });

      // Create play time records for all starters using game time
      // Only create if they don't already have an active record (no endGameSeconds)
      const startersWithoutActiveRecords = lineup
        .filter(l => l.isStarter)
        .filter(l => {
          const hasActiveRecord = playTimeRecords.some(
            r => r.playerId === l.playerId && r.endGameSeconds === null
          );
          return !hasActiveRecord;
        });

      const starterPromises = startersWithoutActiveRecords.map(l =>
        client.models.PlayTimeRecord.create({
          gameId: game.id,
          playerId: l.playerId,
          positionId: l.positionId,
          startGameSeconds: currentTime,
          coaches: team.coaches, // Copy coaches array from team
        })
      );

      await Promise.all(starterPromises);

      setGameState({ ...gameState, status: 'in-progress' });
      setIsRunning(true);
      trackEvent(AnalyticsEvents.GAME_STARTED.category, AnalyticsEvents.GAME_STARTED.action);
    } catch (error) {
      console.error("Error starting game:", error);
      alert("Failed to start game");
    }
  };

  const handlePauseTimer = async () => {
    setIsRunning(false);
    try {
      await client.models.Game.update({
        id: game.id,
        elapsedSeconds: currentTime,
        lastStartTime: null, // Clear lastStartTime to prevent auto-resume from observeQuery
      });
    } catch (error) {
      console.error("Error pausing game:", error);
    }
  };

  const handleResumeTimer = async () => {
    setIsRunning(true);
    try {
      await client.models.Game.update({
        id: game.id,
        lastStartTime: new Date().toISOString(),
        elapsedSeconds: currentTime,
      });
    } catch (error) {
      console.error("Error resuming game:", error);
    }
  };

  const handleHalftime = async () => {
    setIsRunning(false);
    
    try {
      const halftimeSeconds = currentTime; // Capture current time before any async operations
      
      // End all active play time records
      // Close all active play time records at halftime
      await closeActivePlayTimeRecords(playTimeRecords, halftimeSeconds);

      // Update game status - preserve the exact halftime seconds
      await client.models.Game.update({
        id: game.id,
        status: 'halftime',
        elapsedSeconds: halftimeSeconds,
      });
      
      // Ensure current time stays at halftime value
      setCurrentTime(halftimeSeconds);
    } catch (error) {
      console.error("Error setting halftime:", error);
    }
  };

  const handleStartSecondHalf = async () => {
    try {
      const startTime = new Date().toISOString();
      const resumeTime = currentTime; // Capture current time to continue from
      console.log(`Starting second half at time ${resumeTime}s`);
      
      // Create play time records for all players currently in lineup for second half
      const starters = lineup.filter(l => l.isStarter);
      console.log(`Starting second half: Creating ${starters.length} play time records`);
      
      const starterPromises = starters.map(l => {
        console.log(`Creating record for player ${l.playerId} at position ${l.positionId}`);
        return client.models.PlayTimeRecord.create({
          gameId: game.id,
          playerId: l.playerId,
          positionId: l.positionId,
          startGameSeconds: resumeTime,
          coaches: team.coaches, // Copy coaches array from team
        });
      });

      await Promise.all(starterPromises);
      console.log('All second half play time records created');

      // Update game status - keep resumeTime to continue from halftime
      await client.models.Game.update({
        id: game.id,
        status: 'in-progress',
        currentHalf: 2,
        lastStartTime: startTime,
        elapsedSeconds: resumeTime, // Continue from halftime time
      });

      // Explicitly set current time and start running
      setCurrentTime(resumeTime);
      console.log(`Resuming game at time ${resumeTime}s`);
      setIsRunning(true);
    } catch (error) {
      console.error("Error starting second half:", error);
    }
  };

  const handleEndGame = async () => {
    try {
      const endGameTime = currentTime;
      
      // Stop the timer first and capture the final time
      setIsRunning(false);
      
      // End all active play time records
      await closeActivePlayTimeRecords(playTimeRecords, endGameTime);
      
      // Update game with final time - use endGameTime to ensure consistency
      await client.models.Game.update({
        id: game.id,
        status: 'completed',
        elapsedSeconds: endGameTime,
      });
      
      // Update local state with the exact end time
      setGameState({ ...gameState, status: 'completed', elapsedSeconds: endGameTime });
      setCurrentTime(endGameTime);
      trackEvent(AnalyticsEvents.GAME_COMPLETED.category, AnalyticsEvents.GAME_COMPLETED.action);
    } catch (error) {
      console.error("Error ending game:", error);
    }
  };

  const handlePlayerClick = (player: Player) => {
    const existing = lineup.find(l => l.playerId === player.id);
    
    if (existing) {
      // Remove from lineup
      handleRemoveFromLineup(existing.id);
    } else {
      // Show position picker to add to lineup
      const startersCount = lineup.filter(l => l.isStarter).length;
      if (startersCount >= team.maxPlayersOnField) {
        alert(`Maximum ${team.maxPlayersOnField} starters allowed`);
        return;
      }
      setSelectedPlayer(player);
      setShowPositionPicker(true);
    }
  };

  const handleEmptyPositionClick = (position: FormationPosition) => {
    const startersCount = lineup.filter(l => l.isStarter).length;
    if (startersCount >= team.maxPlayersOnField) {
      alert(`Maximum ${team.maxPlayersOnField} starters allowed`);
      return;
    }

    // Show substitution modal with available players for this position
    setSubstitutionPosition(position);
    setShowSubstitution(true);
  };

  const handleRemoveFromLineup = async (lineupId: string) => {
    try {
      await client.models.LineupAssignment.delete({ id: lineupId });
    } catch (error) {
      console.error("Error removing from lineup:", error);
      alert("Failed to remove player from lineup");
    }
  };

  const handleClearAllPositions = async () => {
    if (!confirm(`Remove all ${startersCount} players from the lineup?`)) {
      return;
    }

    try {
      const deletePromises = lineup.map(assignment =>
        client.models.LineupAssignment.delete({ id: assignment.id })
      );
      await Promise.all(deletePromises);
    } catch (error) {
      console.error("Error clearing lineup:", error);
      alert("Failed to clear lineup");
    }
  };

  const handleAssignPosition = async (positionId: string, playerId?: string) => {
    const playerToAssign = playerId || selectedPlayer?.id;
    if (!playerToAssign) return;

    try {
      await client.models.LineupAssignment.create({
        gameId: game.id,
        playerId: playerToAssign,
        positionId: positionId,
        isStarter: true,
        coaches: team.coaches, // Copy coaches array from team
      });

      // If game has started, create a play time record
      if (gameState.status === 'in-progress') {
        await client.models.PlayTimeRecord.create({
          gameId: game.id,
          playerId: playerToAssign,
          positionId: positionId,
          startGameSeconds: currentTime,
          coaches: team.coaches, // Copy coaches array from team
        });
      }

      setSelectedPlayer(null);
      setShowPositionPicker(false);
      setShowSubstitution(false);
      setSubstitutionPosition(null);
    } catch (error) {
      console.error("Error adding to lineup:", error);
      alert("Failed to add player to lineup");
    }
  };

  const isInLineup = (playerId: string) => {
    return isPlayerInLineup(playerId, lineup);
  };

  const getPlayerPosition = (playerId: string) => {
    const assignment = lineup.find(l => l.playerId === playerId);
    if (!assignment?.positionId) return null;
    return positions.find(p => p.id === assignment.positionId);
  };

  const getPositionPlayer = (positionId: string) => {
    const assignment = lineup.find(l => l.positionId === positionId && l.isStarter);
    if (!assignment) return null;
    return players.find(p => p.id === assignment.playerId);
  };

  const handleSubstitute = (position: FormationPosition) => {
    setSubstitutionPosition(position);
    setShowSubstitution(true);
  };

  const handleQueueSubstitution = (playerId: string, positionId: string) => {
    // Check if already queued for this position
    const alreadyQueued = substitutionQueue.some(
      q => q.playerId === playerId && q.positionId === positionId
    );
    if (alreadyQueued) {
      alert("This player is already queued for this position");
      return;
    }

    // Check if player is already queued for a different position
    const queuedElsewhere = substitutionQueue.find(q => q.playerId === playerId);
    if (queuedElsewhere) {
      alert("This player is already queued for another position");
      return;
    }

    setSubstitutionQueue([...substitutionQueue, { playerId, positionId }]);
    setShowSubstitution(false);
    setSubstitutionPosition(null);
  };

  const handleRemoveFromQueue = (playerId: string, positionId: string) => {
    setSubstitutionQueue(substitutionQueue.filter(
      q => !(q.playerId === playerId && q.positionId === positionId)
    ));
  };

  const handleAddTestTime = async (minutes: number) => {
    const secondsToAdd = minutes * 60;
    const newTime = currentTime + secondsToAdd;
    setCurrentTime(newTime);
  };

  const handleExecuteAllSubstitutions = async () => {
    if (substitutionQueue.length === 0) return;

    const confirmMessage = `Execute all ${substitutionQueue.length} queued substitutions?`;
    if (!confirm(confirmMessage)) return;

    try {
      // Process all substitutions
      for (const queueItem of substitutionQueue) {
        const { playerId: newPlayerId, positionId } = queueItem;

        const currentAssignment = lineup.find(
          l => l.positionId === positionId && l.isStarter
        );
        if (!currentAssignment) continue;

        const oldPlayerId = currentAssignment.playerId;

        await executeSubstitution(
          game.id,
          oldPlayerId,
          newPlayerId,
          positionId,
          currentTime,
          gameState.currentHalf || 1,
          playTimeRecords,
          currentAssignment.id,
          team.coaches || [] // Pass coaches array from team
        );
      }

      // Clear the entire queue
      setSubstitutionQueue([]);
    } catch (error) {
      console.error("Error executing all substitutions:", error);
      alert("Failed to execute all substitutions. Some may have been completed.");
    }
  };

  const handleExecuteSubstitution = async (queueItem: SubQueue) => {
    const { playerId: newPlayerId, positionId } = queueItem;

    const currentAssignment = lineup.find(
      l => l.positionId === positionId && l.isStarter
    );
    if (!currentAssignment) {
      alert("No player currently in this position");
      return;
    }

    const oldPlayerId = currentAssignment.playerId;

    try {
      await executeSubstitution(
        game.id,
        oldPlayerId,
        newPlayerId,
        positionId,
        currentTime,
        gameState.currentHalf || 1,
        playTimeRecords,
        currentAssignment.id,
        team.coaches || [] // Pass coaches array from team
      );

      // Remove from queue
      handleRemoveFromQueue(newPlayerId, positionId);
    } catch (error) {
      console.error("Error making substitution:", error);
      alert("Failed to make substitution");
    }
  };

  const handleMakeSubstitution = async (newPlayerId: string) => {
    if (!substitutionPosition) return;

    const currentAssignment = lineup.find(
      l => l.positionId === substitutionPosition.id && l.isStarter
    );
    if (!currentAssignment) return;

    const oldPlayerId = currentAssignment.playerId;

    try {
      await executeSubstitution(
        game.id,
        oldPlayerId,
        newPlayerId,
        substitutionPosition.id,
        currentTime,
        gameState.currentHalf || 1,
        playTimeRecords,
        currentAssignment.id,
        team.coaches || [] // Pass coaches array from team
      );

      setShowSubstitution(false);
      setSubstitutionPosition(null);
    } catch (error) {
      console.error("Error making substitution:", error);
      alert("Failed to make substitution");
    }
  };

  // Use shared calculation utilities
  const getPlayerPlayTimeSeconds = (playerId: string): number => {
    return calculatePlayerPlayTime(playerId, playTimeRecords, currentTime);
  };

  const getPlayerPlayTime = (playerId: string): string => {
    const totalSeconds = calculatePlayerPlayTime(playerId, playTimeRecords, currentTime);
    return formatPlayTime(totalSeconds, 'short');
  };

  const isCurrentlyPlaying = (playerId: string) => {
    return isPlayerCurrentlyPlaying(playerId, playTimeRecords);
  };

  const handleOpenGoalModal = (scoredByUs: boolean) => {
    setGoalScoredByUs(scoredByUs);
    setGoalScorerId("");
    setGoalAssistId("");
    setGoalNotes("");
    setShowGoalModal(true);
  };

  const handleRecordGoal = async () => {
    if (goalScoredByUs && !goalScorerId) {
      alert("Please select who scored the goal");
      return;
    }

    try {
      await client.models.Goal.create({
        gameId: game.id,
        scoredByUs: goalScoredByUs,
        gameSeconds: getCurrentGameTime(),
        half: gameState.currentHalf || 1,
        scorerId: goalScoredByUs && goalScorerId ? goalScorerId : undefined,
        assistId: goalScoredByUs && goalAssistId ? goalAssistId : undefined,
        notes: goalNotes || undefined,
        timestamp: new Date().toISOString(),
        coaches: team.coaches, // Copy coaches array from team
      });

      // Update game score
      const newOurScore = goalScoredByUs ? (gameState.ourScore || 0) + 1 : (gameState.ourScore || 0);
      const newOpponentScore = !goalScoredByUs ? (gameState.opponentScore || 0) + 1 : (gameState.opponentScore || 0);

      await client.models.Game.update({
        id: game.id,
        ourScore: newOurScore,
        opponentScore: newOpponentScore,
      });

      setGameState({ ...gameState, ourScore: newOurScore, opponentScore: newOpponentScore });
      setShowGoalModal(false);
    } catch (error) {
      console.error("Error recording goal:", error);
      alert("Failed to record goal");
    }
  };

  const handleOpenNoteModal = (type: 'gold-star' | 'yellow-card' | 'red-card' | 'other') => {
    setNoteType(type);
    setNotePlayerId("");
    setNoteText("");
    setShowNoteModal(true);
  };

  const handleSaveNote = async () => {
    try {
      // For completed games, use the total game time; otherwise use current half time
      const timeInSeconds = gameState.status === 'completed' ? currentTime : getCurrentGameTime();
      
      await client.models.GameNote.create({
        gameId: game.id,
        noteType,
        playerId: notePlayerId || undefined,
        gameSeconds: timeInSeconds,
        half: gameState.currentHalf || 2, // Default to 2nd half for completed games
        notes: noteText || undefined,
        timestamp: new Date().toISOString(),
        coaches: team.coaches, // Copy coaches array from team
      });

      setShowNoteModal(false);
    } catch (error) {
      console.error("Error saving note:", error);
      alert("Failed to save note");
    }
  };

  const getNoteIcon = (type: string) => {
    switch (type) {
      case 'gold-star': return '⭐';
      case 'yellow-card': return '🟨';
      case 'red-card': return '🟥';
      default: return '📝';
    }
  };

  const getNoteLabel = (type: string) => {
    switch (type) {
      case 'gold-star': return 'Gold Star';
      case 'yellow-card': return 'Yellow Card';
      case 'red-card': return 'Red Card';
      default: return 'Note';
    }
  };

  const startersCount = lineup.filter(l => l.isStarter).length;

  return (
    <div className="game-management">
      <div className="game-header">
        <button onClick={onBack} className="btn-back">
          ← Back to Games
        </button>
        <div className="game-title">
          <h1>vs {gameState.opponent}</h1>
          <span className={`location-badge ${gameState.isHome ? 'home' : 'away'}`}>
            {gameState.isHome ? '🏠 Home' : '✈️ Away'}
          </span>
        </div>
      </div>

      {/* Score Display */}
      <div className="score-display">
        <div className="score-team">
          <div className="team-name">Us</div>
          <div className="score">{gameState.ourScore || 0}</div>
        </div>
        <div className="score-divider">-</div>
        <div className="score-team">
          <div className="team-name">{gameState.opponent}</div>
          <div className="score">{gameState.opponentScore || 0}</div>
        </div>
      </div>

      {/* Goal Buttons */}
      {gameState.status !== 'scheduled' && gameState.status !== 'completed' && (
        <div className="goal-buttons">
          <button onClick={() => handleOpenGoalModal(true)} className="btn-goal btn-goal-us">
            ⚽ Goal - Us
          </button>
          <button onClick={() => handleOpenGoalModal(false)} className="btn-goal btn-goal-opponent">
            ⚽ Goal - {gameState.opponent}
          </button>
        </div>
      )}

      {/* Note Buttons */}
      {gameState.status !== 'scheduled' && (
        <div className="note-buttons">
          {gameState.status === 'completed' ? (
            <>
              <button onClick={() => handleOpenNoteModal('gold-star')} className="btn-note btn-note-gold">
                ⭐ Gold Star
              </button>
              <button onClick={() => handleOpenNoteModal('other')} className="btn-note btn-note-other">
                📝 Note
              </button>
            </>
          ) : (
            <>
              <button onClick={() => handleOpenNoteModal('gold-star')} className="btn-note btn-note-gold">
                ⭐ Gold Star
              </button>
              <button onClick={() => handleOpenNoteModal('yellow-card')} className="btn-note btn-note-yellow">
                🟨 Yellow Card
              </button>
              <button onClick={() => handleOpenNoteModal('red-card')} className="btn-note btn-note-red">
                🟥 Red Card
              </button>
              <button onClick={() => handleOpenNoteModal('other')} className="btn-note btn-note-other">
                📝 Note
              </button>
            </>
          )}
        </div>
      )}

      {/* Next Rotation Countdown */}
      {gameState.status === 'in-progress' && gamePlan && (
        <>
          {(() => {
            const nextRotation = getNextRotation();
            if (nextRotation) {
              const currentMinutes = Math.floor(currentTime / 60);
              const minutesUntil = nextRotation.gameMinute - currentMinutes;
              
              return (
                <div className="rotation-countdown-banner">
                  <div className="countdown-info">
                    <span className="countdown-label">Next Rotation:</span>
                    <span className="countdown-time">{minutesUntil} min</span>
                    <span className="countdown-detail">at {nextRotation.gameMinute}'</span>
                  </div>
                  <button 
                    onClick={() => {
                      setCurrentRotation(nextRotation);
                      setShowRotationModal(true);
                    }}
                    className="btn-view-rotation"
                  >
                    View Plan
                  </button>
                </div>
              );
            }
            return null;
          })()}
          
          <div className="planner-actions">
            <button 
              onClick={() => setShowLateArrivalModal(true)}
              className="btn-secondary"
            >
              + Add Late Arrival
            </button>
          </div>
        </>
      )}

      {/* Substitution Queue */}
      {substitutionQueue.length > 0 && gameState.status === 'in-progress' && (
        <div className="sub-queue-section">
          <div className="sub-queue-header">
            <h3>Substitution Queue ({substitutionQueue.length})</h3>
            <button 
              onClick={handleExecuteAllSubstitutions}
              className="btn-sub-all"
              title="Execute all queued substitutions at once"
            >
              ⚽ Sub All Now
            </button>
          </div>
          <p className="sub-queue-hint">Players ready to substitute in when referee allows</p>
          <div className="sub-queue-list">
            {substitutionQueue.map((queueItem) => {
              const player = players.find(p => p.id === queueItem.playerId);
              const position = positions.find(p => p.id === queueItem.positionId);
              const currentAssignment = lineup.find(l => l.positionId === queueItem.positionId && l.isStarter);
              const currentPlayer = currentAssignment ? players.find(p => p.id === currentAssignment.playerId) : null;
              
              if (!player || !position) return null;

              return (
                <div key={`${queueItem.playerId}-${queueItem.positionId}`} className="sub-queue-item">
                  <div className="sub-queue-info">
                    <div className="sub-queue-position">
                      {position.abbreviation} - {position.positionName}
                    </div>
                    <div className="sub-queue-players">
                      <span className="player-out">
                        {currentPlayer ? `#${currentPlayer.playerNumber} ${currentPlayer.firstName}` : 'N/A'}
                      </span>
                      <span className="sub-arrow">→</span>
                      <span className="player-in">
                        #{player.playerNumber} {player.firstName} {player.lastName}
                      </span>
                    </div>
                  </div>
                  <div className="sub-queue-actions">
                    <button
                      onClick={() => handleExecuteSubstitution(queueItem)}
                      className="btn-execute-sub"
                      title="Execute substitution now"
                    >
                      ✓ Sub Now
                    </button>
                    <button
                      onClick={() => handleRemoveFromQueue(queueItem.playerId, queueItem.positionId)}
                      className="btn-remove-queue"
                      title="Remove from queue"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Game Timer */}
      <div className="game-timer-card">
        <div className="timer-display">
          <div className="half-indicator">
            {gameState.currentHalf === 1 ? 'First Half' : 'Second Half'}
          </div>
          <div className="time-display">
            {formatPlayTime(getCurrentGameTime(), 'short')}
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
              onClick={() => handleAddTestTime(1)} 
              className="btn-test-time"
              title="Add 1 minute for testing"
            >
              +1 min
            </button>
            <button 
              onClick={() => handleAddTestTime(5)} 
              className="btn-test-time"
              title="Add 5 minutes for testing"
            >
              +5 min
            </button>
          </div>
        )}

        <div className="timer-controls">
          {gameState.status === 'scheduled' && (
            <button onClick={handleStartGame} className="btn-primary btn-large">
              Start Game
            </button>
          )}

          {gameState.status === 'in-progress' && (
            <>
              {isRunning ? (
                <button onClick={handlePauseTimer} className="btn-secondary">
                  ⏸ Pause
                </button>
              ) : (
                <button onClick={handleResumeTimer} className="btn-primary">
                  ▶ Resume
                </button>
              )}
              {gameState.currentHalf === 1 && (
                <button onClick={handleHalftime} className="btn-secondary">
                  End First Half
                </button>
              )}
              {gameState.currentHalf === 2 && (
                <button onClick={handleEndGame} className="btn-secondary">
                  End Game
                </button>
              )}
            </>
          )}

          {gameState.status === 'halftime' && (
            <div className="halftime-controls">
              <div className="halftime-message">
                <h3>⏸️ Halftime</h3>
                <p>Adjust your lineup below if needed, then start the second half</p>
              </div>
              <button onClick={handleStartSecondHalf} className="btn-primary btn-large">
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

      {/* Position-based Lineup */}
      <div className="lineup-section">
        <div className="lineup-header">
          <h2>
            {gameState.status === 'halftime' ? 'Second Half Lineup' : 'Starting Lineup'} ({startersCount}/{team.maxPlayersOnField})
          </h2>
          {gameState.status === 'halftime' && startersCount > 0 && (
            <button onClick={handleClearAllPositions} className="btn-clear-lineup">
              Clear All Positions
            </button>
          )}
        </div>
        {gameState.status === 'halftime' && (
          <p className="halftime-lineup-hint">
            Make substitutions now for the start of the second half. Players will start with fresh play time tracking.
          </p>
        )}

        {positions.length === 0 ? (
          <p className="empty-state">
            No positions defined. Go to the Positions tab to add field positions first.
          </p>
        ) : gameState.status === 'scheduled' ? (
          <LineupBuilder
            positions={positions}
            availablePlayers={players.filter(p => p.isActive)}
            lineup={new Map(lineup.filter(l => l.positionId && l.playerId).map(l => [l.positionId as string, l.playerId]))}
            onLineupChange={async (positionId, playerId) => {
              // Find existing assignment for this position
              const existing = lineup.find(l => l.positionId === positionId);
              
              if (playerId === '') {
                // Remove player from position
                if (existing) {
                  await client.models.LineupAssignment.delete({ id: existing.id });
                }
              } else {
                // Check if player is already assigned to another position
                const playerExisting = lineup.find(l => l.playerId === playerId);
                if (playerExisting) {
                  await client.models.LineupAssignment.delete({ id: playerExisting.id });
                }
                
                // Add or update assignment
                if (existing) {
                  await client.models.LineupAssignment.update({
                    id: existing.id,
                    playerId,
                  });
                } else {
                  await client.models.LineupAssignment.create({
                    gameId: game.id,
                    playerId,
                    positionId,
                    isStarter: true,
                    coaches: team.coaches,
                  });
                }
              }
            }}
            showPreferredPositions={true}
          />
        ) : (
          <>
            <div className="position-lineup-grid">
              {positions.map((position) => {
                const assignedPlayer = getPositionPlayer(position.id);
                return (
                  <div key={position.id} className="position-slot">
                    <div className="position-header">
                      {position.abbreviation && (
                        <span className="position-abbr-small">{position.abbreviation}</span>
                      )}
                      <span className="position-name-small">{position.positionName}</span>
                    </div>
                    {assignedPlayer ? (
                      <div className="assigned-player-slot">
                        <div className="assigned-player">
                          <span className="player-number-small">#{assignedPlayer.playerNumber}</span>
                          <span className="player-name-small">
                            {assignedPlayer.firstName} {assignedPlayer.lastName}
                          </span>
                          {gameState.status !== 'in-progress' ? (
                            <button
                              onClick={() => {
                                const assignment = lineup.find(l => l.positionId === position.id);
                                if (assignment) handleRemoveFromLineup(assignment.id);
                              }}
                              className="btn-remove-small"
                            >
                              ✕
                            </button>
                          ) : (
                            <div className="player-actions">
                              <button
                                onClick={() => handleSubstitute(position)}
                                className="btn-substitute"
                                title="Make substitution"
                              >
                                ⇄
                              </button>
                              {gamePlan && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm(`Mark ${assignedPlayer.firstName} as injured?`)) {
                                      handleMarkInjured(assignedPlayer.id);
                                    }
                                  }}
                                  className="btn-mark-injured"
                                  title="Mark player as injured"
                                >
                                  🩹
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        {isCurrentlyPlaying(assignedPlayer.id) && (
                          <div className="play-time-indicator">
                            ⚽ Playing: {getPlayerPlayTime(assignedPlayer.id)}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div 
                        className={`empty-slot ${(gameState.status === 'halftime' || gameState.status === 'scheduled') ? 'clickable' : ''}`}
                        onClick={() => handleEmptyPositionClick(position)}
                        title={(gameState.status === 'halftime' || gameState.status === 'scheduled') ? 'Click to assign player' : ''}
                      >
                        Empty
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {gameState.status !== 'scheduled' && (
              <>
                <h3 style={{ marginTop: '2rem' }}>Available Players</h3>
                <p className="lineup-hint">Click a player to assign them to a position</p>

                <div className="player-list">
                  {players.map((player) => {
                    const inLineup = isInLineup(player.id);
                    const assignedPosition = getPlayerPosition(player.id);
                    const playTime = getPlayerPlayTime(player.id);
                    const playing = isCurrentlyPlaying(player.id);
                    return (
                      <div
                        key={player.id}
                        className={`player-card clickable ${inLineup ? 'in-lineup' : ''} ${playing ? 'currently-playing' : ''}`}
                        onClick={() => handlePlayerClick(player)}
                      >
                        <div className="player-number">#{player.playerNumber}</div>
                        <div className="player-info">
                          <h3>{player.firstName} {player.lastName}</h3>
                          {assignedPosition && (
                            <p className="player-position">
                              Playing: {assignedPosition.positionName}
                            </p>
                          )}
                          {playTime !== '0:00' && (
                            <p className="player-play-time">
                              ⏱️ Time played: {playTime}
                            </p>
                          )}
                        </div>
                        {inLineup && <span className="checkmark">✓</span>}
                        {playing && <span className="playing-badge">On Field</span>}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Position Picker Modal */}
      {showPositionPicker && selectedPlayer && (
        <div className="modal-overlay" onClick={() => setShowPositionPicker(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Assign {selectedPlayer.firstName} {selectedPlayer.lastName} to Position</h2>
            <div className="position-picker-grid">
              {positions.map((position) => {
                const occupied = getPositionPlayer(position.id);
                return (
                  <button
                    key={position.id}
                    className={`position-picker-btn ${occupied ? 'occupied' : ''}`}
                    onClick={() => handleAssignPosition(position.id)}
                    disabled={!!occupied}
                  >
                    <div className="position-picker-label">
                      {position.abbreviation && (
                        <span className="abbr">{position.abbreviation}</span>
                      )}
                      <span className="name">{position.positionName}</span>
                    </div>
                    {occupied && (
                      <div className="occupied-by">
                        #{occupied.playerNumber} {occupied.firstName}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setShowPositionPicker(false)}
              className="btn-secondary"
              style={{ marginTop: '1rem', width: '100%' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Substitution Modal */}
      {showSubstitution && substitutionPosition && (
        <div className="modal-overlay" onClick={() => setShowSubstitution(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            {(() => {
              const currentAssignment = lineup.find((a: LineupAssignment) => a.positionId === substitutionPosition.id);
              const isEmptyPosition = !currentAssignment;
              const currentPlayer = currentAssignment ? players.find((p: Player) => p.id === currentAssignment.playerId) : null;
              
              return (
                <>
                  <h2>{isEmptyPosition ? 'Assign Player to Position' : 'Substitution'}</h2>
                  <p className="modal-subtitle">
                    Position: {positions.find(p => p.id === substitutionPosition.id)?.positionName || 'Unknown'}
                  </p>
                  {currentPlayer && (
                    <p className="modal-subtitle">
                      Coming Off: #{currentPlayer.playerNumber} {currentPlayer.firstName}
                    </p>
                  )}
                  {!isEmptyPosition && (
                    <p style={{ fontSize: '0.9em', color: '#666', marginBottom: '1rem' }}>
                      Queue players when ready, execute when referee allows
                    </p>
                  )}
                  {isEmptyPosition && (
                    <p style={{ fontSize: '0.9em', color: '#666', marginBottom: '1rem' }}>
                      Select a player to assign to this position
                    </p>
                  )}
                  <div className="position-picker-list">
                    {(() => {
                      const currentPosition = positions.find(p => p.id === substitutionPosition.id);
                      const positionName = currentPosition?.positionName || '';
                      const positionAbbr = currentPosition?.abbreviation || '';
                      
                      // Filter available players
                      const availablePlayers = players
                        .filter(p => isEmptyPosition ? !isInLineup(p.id) : !isCurrentlyPlaying(p.id))
                        .filter(p => !substitutionQueue.some(q => q.playerId === p.id));
                      
                      // Separate recommended players (those with this position as preferred)
                      const recommendedPlayers = availablePlayers.filter(p => {
                        if (!p.preferredPositions) return false;
                        const preferredPositions = p.preferredPositions.split(', ');
                        // Check if the position ID, name, or abbreviation is in their preferred positions
                        return preferredPositions.some((pref: string) => 
                          pref === substitutionPosition.id || 
                          pref === positionName || 
                          pref === positionAbbr
                        );
                      });
                      // Sort recommended players by number
                      const sortedRecommendedPlayers = [...recommendedPlayers].sort((a, b) => 
                        (a.playerNumber || 999) - (b.playerNumber || 999)
                      );
                      
                      // Other players not in recommended list
                      const otherPlayers = availablePlayers
                        .filter(p => !recommendedPlayers.includes(p))
                        .sort((a, b) => (a.playerNumber || 999) - (b.playerNumber || 999));
                      
                      return (
                        <>
                          {sortedRecommendedPlayers.length > 0 && (
                            <>
                              <div className="player-section-header">
                                <span className="section-label">⭐ Recommended Players</span>
                                <span className="section-hint">Prefer this position</span>
                              </div>
                              {sortedRecommendedPlayers.map((player: PlayerWithRoster) => {
                                const playTimeSeconds = getPlayerPlayTimeSeconds(player.id);
                                return (
                                  <div key={player.id} className="sub-player-item recommended">
                                    <div className="sub-player-info">
                                      <span>#{player.playerNumber} {player.firstName} {player.lastName}</span>
                                      <span className="player-play-time">
                                        {formatMinutesSeconds(playTimeSeconds)}
                                      </span>
                                    </div>
                                    <div className="sub-player-actions">
                                      {isEmptyPosition ? (
                                        <button
                                          onClick={() => handleAssignPosition(substitutionPosition.id, player.id)}
                                          className="btn-primary"
                                          title="Assign to position"
                                        >
                                          Assign
                                        </button>
                                      ) : (
                                        <>
                                          <button
                                            onClick={() => handleQueueSubstitution(player.id, substitutionPosition.id)}
                                            className="btn-queue"
                                            title="Add to substitution queue"
                                          >
                                            Queue
                                          </button>
                                          <button
                                            onClick={() => handleMakeSubstitution(player.id)}
                                            className="btn-sub-now"
                                            title="Substitute immediately"
                                          >
                                            Sub Now
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </>
                          )}
                          
                          {otherPlayers.length > 0 && (
                            <>
                              {recommendedPlayers.length > 0 && (
                                <div className="player-section-header">
                                  <span className="section-label">Other Players</span>
                                </div>
                              )}
                              {otherPlayers.map((player: PlayerWithRoster) => {
                                const playTimeSeconds = getPlayerPlayTimeSeconds(player.id);
                                return (
                                  <div key={player.id} className="sub-player-item">
                                    <div className="sub-player-info">
                                      <span>#{player.playerNumber} {player.firstName} {player.lastName}</span>
                                      <span className="player-play-time">
                                        {formatMinutesSeconds(playTimeSeconds)}
                                      </span>
                                    </div>
                                    <div className="sub-player-actions">
                                      {isEmptyPosition ? (
                                        <button
                                          onClick={() => handleAssignPosition(substitutionPosition.id, player.id)}
                                          className="btn-primary"
                                          title="Assign to position"
                                        >
                                          Assign
                                        </button>
                                      ) : (
                                        <>
                                          <button
                                            onClick={() => handleQueueSubstitution(player.id, substitutionPosition.id)}
                                            className="btn-queue"
                                            title="Add to substitution queue"
                                          >
                                            Queue
                                          </button>
                                          <button
                                            onClick={() => handleMakeSubstitution(player.id)}
                                            className="btn-sub-now"
                                            title="Substitute immediately"
                                          >
                                            Sub Now
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </>
              );
            })()}

            <button
              onClick={() => setShowSubstitution(false)}
              className="btn-secondary"
              style={{ marginTop: '1rem', width: '100%' }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Goal Recording Modal */}
      {showGoalModal && (
        <div className="modal-overlay" onClick={() => setShowGoalModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Record Goal</h2>
            <p className="modal-subtitle">
              {goalScoredByUs ? 'Our Goal' : `${gameState.opponent} Goal`} - {formatGameTimeDisplay(getCurrentGameTime(), gameState.currentHalf || 1)}
            </p>
            
            {goalScoredByUs && (
              <>
                <div className="form-group">
                  <label htmlFor="goalScorer">Who Scored? *</label>
                  <PlayerSelect
                    id="goalScorer"
                    players={players}
                    value={goalScorerId}
                    onChange={setGoalScorerId}
                    placeholder="Select player..."
                    className="w-full"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="goalAssist">Assisted By (optional)</label>
                  <PlayerSelect
                    id="goalAssist"
                    players={players}
                    value={goalAssistId}
                    onChange={setGoalAssistId}
                    excludeId={goalScorerId}
                    placeholder="No assist / Select player..."
                    className="w-full"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="goalNotes">Notes (optional)</label>
                  <textarea
                    id="goalNotes"
                    value={goalNotes}
                    onChange={(e) => setGoalNotes(e.target.value)}
                    placeholder="e.g., header, penalty, great shot..."
                    rows={3}
                    style={{ padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', resize: 'vertical' }}
                  />
                </div>
              </>
            )}

            {!goalScoredByUs && (
              <div className="form-group">
                <label htmlFor="goalNotes">Notes (optional)</label>
                <textarea
                  id="goalNotes"
                  value={goalNotes}
                  onChange={(e) => setGoalNotes(e.target.value)}
                  placeholder="Any notes about the goal..."
                  rows={3}
                  style={{ padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', resize: 'vertical' }}
                />
              </div>
            )}

            <div className="form-actions">
              <button onClick={handleRecordGoal} className="btn-primary">
                Record Goal
              </button>
              <button onClick={() => setShowGoalModal(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Goals List */}
      {goals.length > 0 && (
        <div className="goals-section">
          <h3>Goals</h3>
          <div className="goals-list">
            {goals.map((goal) => {
              const scorer = goal.scorerId ? players.find(p => p.id === goal.scorerId) : null;
              const assist = goal.assistId ? players.find(p => p.id === goal.assistId) : null;
              return (
                <div key={goal.id} className={`goal-card ${goal.scoredByUs ? 'goal-us' : 'goal-opponent'}`}>
                  <div className="goal-icon">⚽</div>
                  <div className="goal-info">
                    <div className="goal-header">
                      <span className="goal-minute">{Math.floor(goal.gameSeconds / 60)}'</span>
                      <span className="goal-half">({goal.half === 1 ? '1st' : '2nd'} Half)</span>
                    </div>
                    {goal.scoredByUs ? (
                      <>
                        {scorer && (
                          <div className="goal-scorer">
                            #{scorer.playerNumber} {scorer.firstName} {scorer.lastName}
                          </div>
                        )}
                        {assist && (
                          <div className="goal-assist">
                            Assist: #{assist.playerNumber} {assist.firstName}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="goal-opponent-label">{gameState.opponent}</div>
                    )}
                    {goal.notes && <div className="goal-notes">{goal.notes}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Note Modal */}
      {showNoteModal && (
        <div className="modal-overlay" onClick={() => setShowNoteModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{getNoteIcon(noteType)} {getNoteLabel(noteType)}</h2>
            {gameState.status === 'completed' ? (
              <p className="modal-subtitle">
                Post-Game Note
              </p>
            ) : (
              <p className="modal-subtitle">
                {formatGameTimeDisplay(getCurrentGameTime(), gameState.currentHalf || 1)}
              </p>
            )}
            
            <div className="form-group">
              <label htmlFor="notePlayer">Player (optional)</label>
              <PlayerSelect
                id="notePlayer"
                players={players}
                value={notePlayerId}
                onChange={setNotePlayerId}
                placeholder="None / General note"
                className="w-full"
              />
            </div>

            <div className="form-group">
              <label htmlFor="noteText">Note</label>
              <textarea
                id="noteText"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add your note here..."
                rows={4}
                style={{ padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)', resize: 'vertical' }}
              />
            </div>

            <div className="form-actions">
              <button onClick={handleSaveNote} className="btn-primary">
                Save Note
              </button>
              <button onClick={() => setShowNoteModal(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game Notes List */}
      {gameNotes.length > 0 && (
        <div className="notes-section">
          <h3>Game Notes</h3>
          <div className="notes-list">
            {gameNotes.map((note) => {
              const notePlayer = note.playerId ? players.find(p => p.id === note.playerId) : null;
              return (
                <div key={note.id} className={`note-card note-${note.noteType}`}>
                  <div className="note-icon">{getNoteIcon(note.noteType)}</div>
                  <div className="note-info">
                    <div className="note-header">
                      <span className="note-type">{getNoteLabel(note.noteType)}</span>
                      <span className="note-time">{Math.floor(note.gameSeconds / 60)}' ({note.half === 1 ? '1st' : '2nd'} Half)</span>
                    </div>
                    {notePlayer && (
                      <div className="note-player">
                        #{notePlayer.playerNumber} {notePlayer.firstName} {notePlayer.lastName}
                      </div>
                    )}
                    {note.notes && <div className="note-text">{note.notes}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      
      {/* Delete Game Button */}
      <div className="delete-game-section">
        <button 
          onClick={handleDeleteGame}
          className="btn-delete-game"
        >
          Delete Game
        </button>
      </div>

      {/* Availability Check Modal */}
      {showAvailabilityCheck && (
        <div className="modal-overlay" onClick={() => setShowAvailabilityCheck(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Player Availability Check</h3>
            <p className="modal-subtitle">Confirm which players are present before starting the game</p>
            
            <div className="availability-check-list">
              {players.map((player) => {
                const status = getPlayerAvailability(player.id);
                const statusColor = status === 'available' ? '#4caf50' : 
                                  status === 'absent' ? '#f44336' : 
                                  status === 'late-arrival' ? '#fdd835' : '#ff9800';
                
                return (
                  <div key={player.id} className="availability-check-item">
                    <div
                      className="availability-indicator"
                      style={{ backgroundColor: statusColor }}
                    />
                    <span className="player-name">
                      #{player.playerNumber} {player.firstName} {player.lastName}
                    </span>
                    <select
                      value={status}
                      onChange={(e) => {
                        updatePlayerAvailability(
                          game.id,
                          player.id,
                          e.target.value as any,
                          undefined,
                          team.coaches || []
                        );
                      }}
                      className="availability-select"
                    >
                      <option value="available">Present</option>
                      <option value="absent">Absent</option>
                      <option value="late-arrival">Expected Late</option>
                      <option value="injured">Injured</option>
                    </select>
                  </div>
                );
              })}
            </div>

            <div className="form-actions">
              <button
                onClick={async () => {
                  setShowAvailabilityCheck(false);
                  // Actually start the game
                  const startTime = new Date().toISOString();
                  
                  await client.models.Game.update({
                    id: game.id,
                    status: 'in-progress',
                    lastStartTime: startTime,
                  });

                  // Only create records for starters who don't already have an active record
                  const startersWithoutActiveRecords = lineup
                    .filter(l => l.isStarter)
                    .filter(l => {
                      const hasActiveRecord = playTimeRecords.some(
                        r => r.playerId === l.playerId && r.endGameSeconds === null
                      );
                      return !hasActiveRecord;
                    });

                  const starterPromises = startersWithoutActiveRecords.map(l =>
                    client.models.PlayTimeRecord.create({
                      gameId: game.id,
                      playerId: l.playerId,
                      positionId: l.positionId,
                      startGameSeconds: currentTime,
                      coaches: team.coaches,
                    })
                  );

                  await Promise.all(starterPromises);

                  setGameState({ ...gameState, status: 'in-progress' });
                  setIsRunning(true);
                }}
                className="btn-primary"
              >
                Start Game
              </button>
              <button
                onClick={() => setShowAvailabilityCheck(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rotation Modal */}
      {showRotationModal && currentRotation && (
        <div className="modal-overlay" onClick={() => setShowRotationModal(false)}>
          <div className="modal-content rotation-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Planned Rotation - {currentRotation.gameMinute}'</h3>
            <p className="modal-subtitle">
              Suggested substitutions for this rotation. Plan remains as reference only.
            </p>

            <div className="planned-subs-list">
              {(() => {
                const subs: PlannedSubstitution[] = JSON.parse(currentRotation.plannedSubstitutions as string);
                return subs.map((sub, idx) => {
                  const playerOut = players.find(p => p.id === sub.playerOutId);
                  const playerIn = players.find(p => p.id === sub.playerInId);
                  const position = positions.find(p => p.id === sub.positionId);
                  const outAvailability = getPlayerAvailability(sub.playerOutId);
                  const inAvailability = getPlayerAvailability(sub.playerInId);

                  const getAvailabilityBadge = (status: string) => {
                    if (status === 'injured' || status === 'absent') {
                      return <span className="availability-badge unavailable">⚠️ {status}</span>;
                    }
                    if (status === 'late-arrival') {
                      return <span className="availability-badge late">⏰ late</span>;
                    }
                    return <span className="availability-badge available">✓</span>;
                  };

                  return (
                    <div key={idx} className="planned-sub-item">
                      <div className="sub-position-label">{position?.abbreviation}</div>
                      <div className="sub-players">
                        <div className="sub-player sub-out">
                          <span className="player-number">#{playerOut?.playerNumber}</span>
                          <span className="player-name">
                            {playerOut?.firstName} {playerOut?.lastName}
                          </span>
                          {getAvailabilityBadge(outAvailability)}
                        </div>
                        <div className="sub-arrow">→</div>
                        <div className="sub-player sub-in">
                          <span className="player-number">#{playerIn?.playerNumber}</span>
                          <span className="player-name">
                            {playerIn?.firstName} {playerIn?.lastName}
                          </span>
                          {getAvailabilityBadge(inAvailability)}
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            <div className="form-actions">
              <button
                onClick={() => setShowRotationModal(false)}
                className="btn-primary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Late Arrival Modal */}
      {showLateArrivalModal && (
        <div className="modal-overlay" onClick={() => setShowLateArrivalModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Add Late Arrival</h3>
            <p className="modal-subtitle">Select a player who has arrived</p>

            <div className="late-arrival-list">
              {players
                .filter(p => {
                  const status = getPlayerAvailability(p.id);
                  return status === 'absent' || status === 'late-arrival';
                })
                .map((player) => (
                  <button
                    key={player.id}
                    className="late-arrival-option"
                    onClick={() => handleLateArrival(player.id)}
                  >
                    <span className="player-number">#{player.playerNumber}</span>
                    <span className="player-name">
                      {player.firstName} {player.lastName}
                    </span>
                    <span className="status-badge">
                      {getPlayerAvailability(player.id)}
                    </span>
                  </button>
                ))}
            </div>

            {players.filter(p => {
              const status = getPlayerAvailability(p.id);
              return status === 'absent' || status === 'late-arrival';
            }).length === 0 && (
              <p className="empty-state">No players marked as absent or late</p>
            )}

            <div className="form-actions">
              <button
                onClick={() => setShowLateArrivalModal(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
