import { useEffect, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

type Game = Schema["Game"]["type"];
type Team = Schema["Team"]["type"];
type Player = Schema["Player"]["type"];
type FieldPosition = Schema["FieldPosition"]["type"];
type LineupAssignment = Schema["LineupAssignment"]["type"];
type PlayTimeRecord = Schema["PlayTimeRecord"]["type"];
type Goal = Schema["Goal"]["type"];
type GameNote = Schema["GameNote"]["type"];

interface GameManagementProps {
  game: Game;
  team: Team;
  onBack: () => void;
}

export function GameManagement({ game, team, onBack }: GameManagementProps) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [positions, setPositions] = useState<FieldPosition[]>([]);
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
  const [substitutionPosition, setSubstitutionPosition] = useState<FieldPosition | null>(null);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [goalScoredByUs, setGoalScoredByUs] = useState(true);
  const [goalScorerId, setGoalScorerId] = useState("");
  const [goalAssistId, setGoalAssistId] = useState("");
  const [goalNotes, setGoalNotes] = useState("");
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteType, setNoteType] = useState<'gold-star' | 'yellow-card' | 'red-card' | 'other'>('other');
  const [notePlayerId, setNotePlayerId] = useState("");
  const [noteText, setNoteText] = useState("");
  const [isUpdatingTime, setIsUpdatingTime] = useState(false);

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
      seasonId: team.seasonId,
    }));

    return () => {
      // Clear on unmount if game is completed
      if (gameState.status === 'completed') {
        localStorage.removeItem('activeGame');
      }
    };
  }, [game.id, team.id, team.seasonId, gameState.status]);

  // Observe game changes and restore state
  useEffect(() => {
    const gameSub = client.models.Game.observeQuery({
      filter: { id: { eq: game.id } },
    }).subscribe({
      next: (data) => {
        if (data.items.length > 0) {
          const updatedGame = data.items[0];
          setGameState(updatedGame);
          
          // Don't update time if we're currently updating it ourselves
          if (isUpdatingTime) {
            return;
          }
          
          // Restore elapsed time from database
          if (updatedGame.elapsedSeconds !== null && updatedGame.elapsedSeconds !== undefined) {
            setCurrentTime(updatedGame.elapsedSeconds);
          }
          
          // Auto-resume timer if game was in progress
          if (updatedGame.status === 'in-progress' && updatedGame.lastStartTime) {
            const lastStart = new Date(updatedGame.lastStartTime).getTime();
            const now = Date.now();
            const additionalSeconds = Math.floor((now - lastStart) / 1000);
            setCurrentTime((updatedGame.elapsedSeconds || 0) + additionalSeconds);
            setIsRunning(true);
          }
        }
      },
    });

    return () => {
      gameSub.unsubscribe();
    };
  }, [game.id, isUpdatingTime]);

  useEffect(() => {
    // Load players
    const playerSub = client.models.Player.observeQuery({
      filter: { teamId: { eq: team.id } },
    }).subscribe({
      next: (data) => setPlayers([...data.items].sort((a, b) => a.playerNumber - b.playerNumber)),
    });

    // Load positions
    const positionSub = client.models.FieldPosition.observeQuery({
      filter: { teamId: { eq: team.id } },
    }).subscribe({
      next: (data) => setPositions([...data.items].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))),
    });

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
        return a.gameMinute - b.gameMinute;
      })),
    });

    // Load game notes
    const noteSub = client.models.GameNote.observeQuery({
      filter: { gameId: { eq: game.id } },
    }).subscribe({
      next: (data) => setGameNotes([...data.items].sort((a, b) => {
        if (a.half !== b.half) return a.half - b.half;
        return a.gameMinute - b.gameMinute;
      })),
    });

    return () => {
      playerSub.unsubscribe();
      positionSub.unsubscribe();
      lineupSub.unsubscribe();
      playTimeSub.unsubscribe();
      goalSub.unsubscribe();
      noteSub.unsubscribe();
    };
  }, [team.id, game.id]);

  // Timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    let saveInterval: NodeJS.Timeout;
    
    if (isRunning && gameState.status === 'in-progress') {
      interval = setInterval(() => {
        setCurrentTime(prev => {
          const newTime = prev + 1;
          
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

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getCurrentHalfTime = () => {
    if (gameState.currentHalf === 1) {
      return Math.min(currentTime, halfLengthSeconds);
    }
    return Math.max(0, currentTime - halfLengthSeconds);
  };

  const handleStartGame = async () => {
    try {
      const startTime = new Date().toISOString();
      
      await client.models.Game.update({
        id: game.id,
        status: 'in-progress',
        lastStartTime: startTime,
      });

      // Create play time records for all starters
      const starterPromises = lineup
        .filter(l => l.isStarter)
        .map(l =>
          client.models.PlayTimeRecord.create({
            gameId: game.id,
            playerId: l.playerId,
            positionId: l.positionId,
            startTime: startTime,
          })
        );

      await Promise.all(starterPromises);

      setGameState({ ...gameState, status: 'in-progress' });
      setIsRunning(true);
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
      });
    } catch (error) {
      console.error("Error pausing game:", error);
    }
  };

  const handleResumeTimer = () => {
    setIsRunning(true);
  };

  const handleHalftime = async () => {
    setIsRunning(false);
    try {
      const endTime = new Date().toISOString();
      
      // End all active play time records
      const activeRecords = playTimeRecords.filter(r => !r.endTime);
      console.log(`Halftime: Closing ${activeRecords.length} active play time records`);
      
      const endPromises = activeRecords.map(async (record) => {
        const startTime = new Date(record.startTime!);
        const durationSeconds = Math.floor((new Date(endTime).getTime() - startTime.getTime()) / 1000);
        
        console.log(`Closing record for player ${record.playerId}, duration: ${durationSeconds}s`);
        
        return client.models.PlayTimeRecord.update({
          id: record.id,
          endTime: endTime,
          durationSeconds: durationSeconds,
        });
      });

      await Promise.all(endPromises);
      console.log('All play time records closed successfully');

      await client.models.Game.update({
        id: game.id,
        status: 'halftime',
        elapsedSeconds: currentTime,
      });
      setGameState({ ...gameState, status: 'halftime' });
    } catch (error) {
      console.error("Error setting halftime:", error);
    }
  };

  const handleStartSecondHalf = async () => {
    try {
      const startTime = new Date().toISOString();
      
      await client.models.Game.update({
        id: game.id,
        status: 'in-progress',
        currentHalf: 2,
        lastStartTime: startTime,
        elapsedSeconds: 0, // Reset timer for second half
      });

      // Create play time records for all players currently in lineup for second half
      const starters = lineup.filter(l => l.isStarter);
      console.log(`Starting second half: Creating ${starters.length} play time records`);
      
      const starterPromises = starters.map(l => {
        console.log(`Creating record for player ${l.playerId} at position ${l.positionId}`);
        return client.models.PlayTimeRecord.create({
          gameId: game.id,
          playerId: l.playerId,
          positionId: l.positionId,
          startTime: startTime,
        });
      });

      await Promise.all(starterPromises);
      console.log('All second half play time records created');

      setCurrentTime(0); // Reset the display timer to 0:00
      setGameState({ ...gameState, status: 'in-progress', currentHalf: 2 });
      setIsRunning(true);
    } catch (error) {
      console.error("Error starting second half:", error);
    }
  };

  const handleEndGame = async () => {
    setIsRunning(false);
    try {
      const endTime = new Date().toISOString();
      
      // End all active play time records
      const activeRecords = playTimeRecords.filter(r => !r.endTime);
      console.log(`Ending game: Closing ${activeRecords.length} active play time records`);
      
      const endPromises = activeRecords.map(async (record) => {
        const startTime = new Date(record.startTime!);
        const durationSeconds = Math.floor((new Date(endTime).getTime() - startTime.getTime()) / 1000);
        
        console.log(`Closing record for player ${record.playerId}, duration: ${durationSeconds}s`);
        
        return client.models.PlayTimeRecord.update({
          id: record.id,
          endTime: endTime,
          durationSeconds: durationSeconds,
        });
      });

      await Promise.all(endPromises);
      console.log('All play time records closed successfully');
      
      await client.models.Game.update({
        id: game.id,
        status: 'completed',
        elapsedSeconds: currentTime,
      });
      setGameState({ ...gameState, status: 'completed' });
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

  const handleEmptyPositionClick = (position: FieldPosition) => {
    // Only allow filling empty positions at halftime or when scheduled
    if (gameState.status !== 'halftime' && gameState.status !== 'scheduled') {
      return;
    }

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
      });

      // If game has started, create a play time record
      if (gameState.status === 'in-progress') {
        await client.models.PlayTimeRecord.create({
          gameId: game.id,
          playerId: playerToAssign,
          positionId: positionId,
          startTime: new Date().toISOString(),
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
    return lineup.some(l => l.playerId === playerId);
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

  const handleSubstitute = (position: FieldPosition) => {
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
    const millisecondsToAdd = secondsToAdd * 1000;
    const newTime = currentTime + secondsToAdd;
    
    setIsUpdatingTime(true);
    setCurrentTime(newTime);
    
    try {
      // Update game elapsed time
      await client.models.Game.update({
        id: game.id,
        elapsedSeconds: newTime,
      });

      // TESTING TIME ONLY
      // Adjust start times for all active play time records
      // by moving them back in time to simulate the time passing
      const activeRecords = playTimeRecords.filter(r => !r.endTime);
      const updatePromises = activeRecords.map(async (record) => {
        const currentStartTime = new Date(record.startTime!);
        const adjustedStartTime = new Date(currentStartTime.getTime() - millisecondsToAdd);
        
        return client.models.PlayTimeRecord.update({
          id: record.id,
          startTime: adjustedStartTime.toISOString(),
        });
      });

      await Promise.all(updatePromises);
      // END TESTING TIME ONLY

    } catch (error) {
      console.error("Error updating time:", error);
    } finally {
      // Reset the flag after a brief delay to allow the database update to propagate
      setTimeout(() => setIsUpdatingTime(false), 500);
    }
  };

  const handleExecuteAllSubstitutions = async () => {
    if (substitutionQueue.length === 0) return;

    const confirmMessage = `Execute all ${substitutionQueue.length} queued substitutions?`;
    if (!confirm(confirmMessage)) return;

    const timestamp = new Date().toISOString();
    const gameMinute = Math.floor(currentTime / 60);
    const half = gameState.currentHalf || 1;

    try {
      // Process all substitutions
      for (const queueItem of substitutionQueue) {
        const { playerId: newPlayerId, positionId } = queueItem;

        const currentAssignment = lineup.find(
          l => l.positionId === positionId && l.isStarter
        );
        if (!currentAssignment) continue;

        const oldPlayerId = currentAssignment.playerId;

        // End play time for outgoing player
        const activePlayTime = playTimeRecords.find(
          r => r.playerId === oldPlayerId && !r.endTime
        );
        if (activePlayTime) {
          const startTime = new Date(activePlayTime.startTime!);
          const durationSeconds = Math.floor((new Date(timestamp).getTime() - startTime.getTime()) / 1000);
          
          await client.models.PlayTimeRecord.update({
            id: activePlayTime.id,
            endTime: timestamp,
            durationSeconds: durationSeconds,
          });
        }

        // Remove old assignment
        await client.models.LineupAssignment.delete({ id: currentAssignment.id });

        // Create new assignment
        await client.models.LineupAssignment.create({
          gameId: game.id,
          playerId: newPlayerId,
          positionId: positionId,
          isStarter: true,
        });

        // Start play time for incoming player
        await client.models.PlayTimeRecord.create({
          gameId: game.id,
          playerId: newPlayerId,
          positionId: positionId,
          startTime: timestamp,
        });

        // Record substitution
        await client.models.Substitution.create({
          gameId: game.id,
          playerOutId: oldPlayerId,
          playerInId: newPlayerId,
          positionId: positionId,
          gameMinute: gameMinute,
          half: half,
          timestamp: timestamp,
        });
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
      // End play time for outgoing player
      const activePlayTime = playTimeRecords.find(
        r => r.playerId === oldPlayerId && !r.endTime
      );
      if (activePlayTime) {
        const endTime = new Date().toISOString();
        const startTime = new Date(activePlayTime.startTime!);
        const durationSeconds = Math.floor((new Date(endTime).getTime() - startTime.getTime()) / 1000);
        
        await client.models.PlayTimeRecord.update({
          id: activePlayTime.id,
          endTime: endTime,
          durationSeconds: durationSeconds,
        });
      }

      // Remove old assignment
      await client.models.LineupAssignment.delete({ id: currentAssignment.id });

      // Create new assignment
      await client.models.LineupAssignment.create({
        gameId: game.id,
        playerId: newPlayerId,
        positionId: positionId,
        isStarter: true,
      });

      // Start play time for incoming player
      await client.models.PlayTimeRecord.create({
        gameId: game.id,
        playerId: newPlayerId,
        positionId: positionId,
        startTime: new Date().toISOString(),
      });

      // Record substitution
      await client.models.Substitution.create({
        gameId: game.id,
        playerOutId: oldPlayerId,
        playerInId: newPlayerId,
        positionId: positionId,
        gameMinute: Math.floor(currentTime / 60),
        half: gameState.currentHalf || 1,
        timestamp: new Date().toISOString(),
      });

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
      // End play time for outgoing player
      const activePlayTime = playTimeRecords.find(
        r => r.playerId === oldPlayerId && !r.endTime
      );
      if (activePlayTime) {
        const endTime = new Date().toISOString();
        const startTime = new Date(activePlayTime.startTime!);
        const durationSeconds = Math.floor((new Date(endTime).getTime() - startTime.getTime()) / 1000);
        
        await client.models.PlayTimeRecord.update({
          id: activePlayTime.id,
          endTime: endTime,
          durationSeconds: durationSeconds,
        });
      }

      // Remove old assignment
      await client.models.LineupAssignment.delete({ id: currentAssignment.id });

      // Create new assignment
      await client.models.LineupAssignment.create({
        gameId: game.id,
        playerId: newPlayerId,
        positionId: substitutionPosition.id,
        isStarter: true,
      });

      // Start play time for incoming player
      await client.models.PlayTimeRecord.create({
        gameId: game.id,
        playerId: newPlayerId,
        positionId: substitutionPosition.id,
        startTime: new Date().toISOString(),
      });

      // Record substitution
      await client.models.Substitution.create({
        gameId: game.id,
        playerOutId: oldPlayerId,
        playerInId: newPlayerId,
        positionId: substitutionPosition.id,
        gameMinute: Math.floor(currentTime / 60),
        half: gameState.currentHalf || 1,
        timestamp: new Date().toISOString(),
      });

      setShowSubstitution(false);
      setSubstitutionPosition(null);
    } catch (error) {
      console.error("Error making substitution:", error);
      alert("Failed to make substitution");
    }
  };

  const getPlayerPlayTimeSeconds = (playerId: string): number => {
    const records = playTimeRecords.filter(r => r.playerId === playerId);
    let totalSeconds = 0;

    records.forEach(record => {
      if (record.endTime && record.durationSeconds) {
        totalSeconds += record.durationSeconds;
      } else if (!record.endTime && record.startTime) {
        // Currently playing - calculate from start time to now
        const startTime = new Date(record.startTime);
        const now = new Date();
        totalSeconds += Math.floor((now.getTime() - startTime.getTime()) / 1000);
      }
    });

    return totalSeconds;
  };

  const getPlayerPlayTime = (playerId: string): string => {
    const totalSeconds = getPlayerPlayTimeSeconds(playerId);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const isCurrentlyPlaying = (playerId: string) => {
    return playTimeRecords.some(r => r.playerId === playerId && !r.endTime);
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
      const gameMinute = Math.floor(getCurrentHalfTime() / 60);
      
      await client.models.Goal.create({
        gameId: game.id,
        scoredByUs: goalScoredByUs,
        gameMinute,
        half: gameState.currentHalf || 1,
        scorerId: goalScoredByUs && goalScorerId ? goalScorerId : undefined,
        assistId: goalScoredByUs && goalAssistId ? goalAssistId : undefined,
        notes: goalNotes || undefined,
        timestamp: new Date().toISOString(),
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
      const timeInSeconds = gameState.status === 'completed' ? currentTime : getCurrentHalfTime();
      const gameMinute = Math.floor(timeInSeconds / 60);
      
      await client.models.GameNote.create({
        gameId: game.id,
        noteType,
        playerId: notePlayerId || undefined,
        gameMinute,
        half: gameState.currentHalf || 2, // Default to 2nd half for completed games
        notes: noteText || undefined,
        timestamp: new Date().toISOString(),
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
            {formatTime(getCurrentHalfTime())}
          </div>
          <div className="time-limit">
            / {formatTime(halfLengthSeconds)}
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
                            <button
                              onClick={() => handleSubstitute(position)}
                              className="btn-substitute"
                              title="Make substitution"
                            >
                              ⇄
                            </button>
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
                        if (!p.preferredPosition) return false;
                        const preferredPositions = p.preferredPosition.split(', ');
                        // Check if the position ID, name, or abbreviation is in their preferred positions
                        return preferredPositions.some(pref => 
                          pref === substitutionPosition.id || 
                          pref === positionName || 
                          pref === positionAbbr
                        );
                      }).sort((a, b) => (a.playerNumber ?? 0) - (b.playerNumber ?? 0));
                      
                      // Other players not in recommended list
                      const otherPlayers = availablePlayers
                        .filter(p => !recommendedPlayers.includes(p))
                        .sort((a, b) => (a.playerNumber ?? 0) - (b.playerNumber ?? 0));
                      
                      return (
                        <>
                          {recommendedPlayers.length > 0 && (
                            <>
                              <div className="player-section-header">
                                <span className="section-label">⭐ Recommended Players</span>
                                <span className="section-hint">Prefer this position</span>
                              </div>
                              {recommendedPlayers.map(player => {
                                const playTimeSeconds = getPlayerPlayTimeSeconds(player.id);
                                return (
                                  <div key={player.id} className="sub-player-item recommended">
                                    <div className="sub-player-info">
                                      <span>#{player.playerNumber} {player.firstName} {player.lastName}</span>
                                      <span className="player-play-time">
                                        {Math.floor(playTimeSeconds / 60)}:{String(playTimeSeconds % 60).padStart(2, '0')}
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
                              {otherPlayers.map(player => {
                                const playTimeSeconds = getPlayerPlayTimeSeconds(player.id);
                                return (
                                  <div key={player.id} className="sub-player-item">
                                    <div className="sub-player-info">
                                      <span>#{player.playerNumber} {player.firstName} {player.lastName}</span>
                                      <span className="player-play-time">
                                        {Math.floor(playTimeSeconds / 60)}:{String(playTimeSeconds % 60).padStart(2, '0')}
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
              {goalScoredByUs ? 'Our Goal' : `${gameState.opponent} Goal`} - {Math.floor(getCurrentHalfTime() / 60)}' ({gameState.currentHalf === 1 ? '1st' : '2nd'} Half)
            </p>
            
            {goalScoredByUs && (
              <>
                <div className="form-group">
                  <label htmlFor="goalScorer">Who Scored? *</label>
                  <select
                    id="goalScorer"
                    value={goalScorerId}
                    onChange={(e) => setGoalScorerId(e.target.value)}
                    style={{ padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                  >
                    <option value="">Select player...</option>
                    {players
                      .sort((a, b) => (a.playerNumber ?? 0) - (b.playerNumber ?? 0))
                      .map(player => (
                        <option key={player.id} value={player.id}>
                          #{player.playerNumber} {player.firstName} {player.lastName}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="goalAssist">Assisted By (optional)</label>
                  <select
                    id="goalAssist"
                    value={goalAssistId}
                    onChange={(e) => setGoalAssistId(e.target.value)}
                    style={{ padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                  >
                    <option value="">No assist / Select player...</option>
                    {players
                      .filter(p => p.id !== goalScorerId)
                      .sort((a, b) => (a.playerNumber ?? 0) - (b.playerNumber ?? 0))
                      .map(player => (
                        <option key={player.id} value={player.id}>
                          #{player.playerNumber} {player.firstName} {player.lastName}
                        </option>
                      ))}
                  </select>
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
                      <span className="goal-minute">{goal.gameMinute}'</span>
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
                {Math.floor(getCurrentHalfTime() / 60)}' ({gameState.currentHalf === 1 ? '1st' : '2nd'} Half)
              </p>
            )}
            
            <div className="form-group">
              <label htmlFor="notePlayer">Player (optional)</label>
              <select
                id="notePlayer"
                value={notePlayerId}
                onChange={(e) => setNotePlayerId(e.target.value)}
                style={{ padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}
              >
                <option value="">None / General note</option>
                {players
                  .sort((a, b) => (a.playerNumber ?? 0) - (b.playerNumber ?? 0))
                  .map(player => (
                    <option key={player.id} value={player.id}>
                      #{player.playerNumber} {player.firstName} {player.lastName}
                    </option>
                  ))}
              </select>
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
                      <span className="note-time">{note.gameMinute}' ({note.half === 1 ? '1st' : '2nd'} Half)</span>
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
    </div>
  );
}
