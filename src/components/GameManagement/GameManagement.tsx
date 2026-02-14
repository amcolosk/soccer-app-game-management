import { useEffect, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../../amplify/data/resource";
import { trackEvent, AnalyticsEvents } from "../../utils/analytics";
import { formatGameTimeDisplay } from "../../utils/gameTimeUtils";
import { closeActivePlayTimeRecords } from "../../services/substitutionService";
import { updatePlayerAvailability, calculateFairRotations, type PlannedSubstitution } from "../../services/rotationPlannerService";
import { useTeamData } from "../../hooks/useTeamData";
import { useGameSubscriptions } from "./hooks/useGameSubscriptions";
import { useGameTimer } from "./hooks/useGameTimer";
import { GameHeader } from "./GameHeader";
import { GameTimer } from "./GameTimer";
import { GoalTracker } from "./GoalTracker";
import { PlayerNotesPanel } from "./PlayerNotesPanel";
import { RotationWidget } from "./RotationWidget";
import { SubstitutionPanel } from "./SubstitutionPanel";
import { LineupPanel } from "./LineupPanel";
import type { Game, Team, FormationPosition, SubQueue } from "./types";
import { AvailabilityProvider } from "../../contexts/AvailabilityContext";

const client = generateClient<Schema>();

interface GameManagementProps {
  game: Game;
  team: Team;
  onBack: () => void;
}

export function GameManagement({ game, team, onBack }: GameManagementProps) {
  // Load team roster and formation positions with real-time updates
  const { players, positions } = useTeamData(team.id, team.formationId);

  const [currentTime, setCurrentTime] = useState(game.elapsedSeconds || 0);
  const [isRunning, setIsRunning] = useState(false);
  const [substitutionRequest, setSubstitutionRequest] = useState<FormationPosition | null>(null);

  // Game planner integration
  const [isRecalculating, setIsRecalculating] = useState(false);

  const [substitutionQueue, setSubstitutionQueue] = useState<SubQueue[]>([]);

  // Subscriptions hook - manages game observation, data subscriptions, and lineup sync
  const {
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
  } = useGameSubscriptions({
    game,
    team,
    isRunning,
    setCurrentTime,
    setIsRunning,
  });

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

  const getPlayerAvailability = (playerId: string): string => {
    const availability = playerAvailabilities.find(a => a.playerId === playerId);
    return availability?.status || 'available';
  };

  // Detect conflicts between current availability and the rotation plan
  const getPlanConflicts = () => {
    const conflicts: Array<{
      type: 'starter' | 'rotation';
      playerId: string;
      playerName: string;
      status: string;
      rotationNumbers: number[];
    }> = [];

    if (!gamePlan) return conflicts;

    // Check starting lineup
    if (gamePlan.startingLineup) {
      try {
        const sl = JSON.parse(gamePlan.startingLineup as string) as Array<{ playerId: string; positionId: string }>;
        for (const entry of sl) {
          const status = getPlayerAvailability(entry.playerId);
          if (status === 'absent' || status === 'injured') {
            const player = players.find(p => p.id === entry.playerId);
            conflicts.push({
              type: 'starter',
              playerId: entry.playerId,
              playerName: player ? `#${player.playerNumber} ${player.firstName} ${player.lastName}` : 'Unknown',
              status,
              rotationNumbers: [],
            });
          }
        }
      } catch { /* ignore parse errors */ }
    }

    // Check all planned rotations
    for (const rotation of plannedRotations) {
      try {
        const subs: PlannedSubstitution[] = JSON.parse(rotation.plannedSubstitutions as string);
        for (const sub of subs) {
          for (const pid of [sub.playerOutId, sub.playerInId]) {
            const status = getPlayerAvailability(pid);
            if (status === 'absent' || status === 'injured') {
              const player = players.find(p => p.id === pid);
              const existing = conflicts.find(c => c.playerId === pid);
              if (existing) {
                if (!existing.rotationNumbers.includes(rotation.rotationNumber)) {
                  existing.rotationNumbers.push(rotation.rotationNumber);
                }
              } else {
                conflicts.push({
                  type: 'rotation',
                  playerId: pid,
                  playerName: player ? `#${player.playerNumber} ${player.firstName} ${player.lastName}` : 'Unknown',
                  status,
                  rotationNumbers: [rotation.rotationNumber],
                });
              }
            }
          }
        }
      } catch { /* ignore parse errors */ }
    }

    return conflicts;
  };

  // Check which future rotations reference a specific player
  const getRotationsReferencingPlayer = (playerId: string): number[] => {
    const rotationNums: number[] = [];
    const currentMinutes = Math.floor(currentTime / 60);
    for (const rotation of plannedRotations) {
      if (rotation.gameMinute <= currentMinutes) continue;
      try {
        const subs: PlannedSubstitution[] = JSON.parse(rotation.plannedSubstitutions as string);
        if (subs.some(s => s.playerOutId === playerId || s.playerInId === playerId)) {
          rotationNums.push(rotation.rotationNumber);
        }
      } catch { /* ignore */ }
    }
    return rotationNums;
  };

  const handleRecalculateRotations = async () => {
    if (!gamePlan || plannedRotations.length === 0) return;

    if (!gamePlan.startingLineup) {
      alert('No starting lineup found in the game plan.');
      return;
    }

    const confirmed = window.confirm(
      'This will recalculate all rotation substitutions based on current player availability and preferred positions.\n\nExisting rotation substitutions will be overwritten.\n\nContinue?'
    );
    if (!confirmed) return;

    try {
      setIsRecalculating(true);

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

      // Parse starting lineup, filtering out unavailable starters
      const fullLineup = JSON.parse(gamePlan.startingLineup as string) as Array<{ playerId: string; positionId: string }>;
      const lineupArray = fullLineup.filter(entry => {
        const status = getPlayerAvailability(entry.playerId);
        return status === 'available' || status === 'late-arrival';
      });

      if (lineupArray.length === 0) {
        alert('No available players in the starting lineup. Adjust the lineup in the Game Planner first.');
        return;
      }

      const halfLengthMinutes = team.halfLengthMinutes || 30;
      const rotationIntervalMinutes = gamePlan.rotationIntervalMinutes || 10;
      const rotationsPerHalf = Math.max(0, Math.floor(halfLengthMinutes / rotationIntervalMinutes) - 1);

      const generatedRotations = calculateFairRotations(
        availableRoster,
        lineupArray,
        plannedRotations.length,
        rotationsPerHalf,
        team.maxPlayersOnField || positions.length
      );

      // Update each rotation with generated substitutions
      const updates = plannedRotations.map((rotation, idx) => {
        const generated = generatedRotations[idx];
        return client.models.PlannedRotation.update({
          id: rotation.id,
          plannedSubstitutions: JSON.stringify(generated?.substitutions || []),
        });
      });

      await Promise.all(updates);

      alert('Rotations recalculated based on current availability! Review each rotation to verify.');
    } catch (error) {
      console.error('Error recalculating rotations:', error);
      alert('Failed to recalculate rotations.');
    } finally {
      setIsRecalculating(false);
    }
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

      // Remove from lineup so the position shows as empty
      const assignment = lineup.find(l => l.playerId === playerId);
      if (assignment) {
        await client.models.LineupAssignment.delete({ id: assignment.id });
      }

      // Check if this player is in future planned rotations
      const affectedRotations = getRotationsReferencingPlayer(playerId);
      const player = players.find(p => p.id === playerId);
      const playerName = player ? `#${player.playerNumber} ${player.firstName}` : 'Player';

      if (affectedRotations.length > 0) {
        alert(
          `${playerName} marked as injured and removed from the field.\n\n` +
          `⚠️ This player is referenced in planned rotation(s) ${affectedRotations.join(', ')}.\n` +
          `Those rotations will need to be adjusted.`
        );
      } else {
        alert(`${playerName} marked as injured and removed from the field.`);
      }

      // Prompt to substitute if the position is now empty
      if (assignment) {
        const position = positions.find(p => p.id === assignment.positionId);
        if (position) {
          setSubstitutionRequest(position);
        }
      }
    } catch (error) {
      console.error('Error marking player injured:', error);
      alert('Failed to mark player injured');
    }
  };

  const handleStartGame = async () => {
    // Warn if any starters are unavailable
    const unavailableStarters = lineup
      .filter(l => l.isStarter)
      .filter(l => {
        const status = getPlayerAvailability(l.playerId);
        return status === 'absent' || status === 'injured';
      })
      .map(l => {
        const player = players.find(p => p.id === l.playerId);
        const status = getPlayerAvailability(l.playerId);
        return player ? `#${player.playerNumber} ${player.firstName} (${status})` : `Unknown (${status})`;
      });

    if (unavailableStarters.length > 0) {
      const proceed = window.confirm(
        `⚠️ The following starters are unavailable:\n\n${unavailableStarters.join('\n')}\n\nPlease update the lineup before starting. Start anyway?`
      );
      if (!proceed) return;
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
    manuallyPausedRef.current = true; // Prevent observeQuery from auto-resuming
    setIsRunning(false);
    try {
      await client.models.Game.update({
        id: game.id,
        elapsedSeconds: currentTime,
        lastStartTime: null, // Clear lastStartTime to prevent auto-resume from observeQuery
      });
      // Clear the manual pause flag after DB update completes
      manuallyPausedRef.current = false;
    } catch (error) {
      console.error("Error pausing game:", error);
      manuallyPausedRef.current = false;
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

  // Timer hook - handles 1s tick, DB sync every 5s, auto-halftime/auto-end
  useGameTimer({
    game,
    gameState,
    halfLengthSeconds,
    currentTime,
    setCurrentTime,
    isRunning,
    gamePlan,
    plannedRotations,
    onHalftime: handleHalftime,
    onEndGame: handleEndGame,
  });

  const handleSubstitute = (position: FormationPosition) => {
    setSubstitutionRequest(position);
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
  };

  const handleAddTestTime = (minutes: number) => {
    const secondsToAdd = minutes * 60;
    const newTime = currentTime + secondsToAdd;
    setCurrentTime(newTime);
  };

  return (
    <AvailabilityProvider availabilities={playerAvailabilities}>
    <div className="game-management">
      <GameHeader gameState={gameState} onBack={onBack} />

      <GoalTracker
        gameState={gameState}
        game={game}
        team={team}
        players={players}
        goals={goals}
        currentTime={currentTime}
        onScoreUpdate={(ourScore, opponentScore) => {
          setGameState({ ...gameState, ourScore, opponentScore });
        }}
      />

      <PlayerNotesPanel
        gameState={gameState}
        game={game}
        team={team}
        players={players}
        gameNotes={gameNotes}
        currentTime={currentTime}
      />

      <RotationWidget
        gameState={gameState}
        game={game}
        team={team}
        players={players}
        positions={positions}
        gamePlan={gamePlan}
        plannedRotations={plannedRotations}
        currentTime={currentTime}
        lineup={lineup}
        playTimeRecords={playTimeRecords}
        substitutionQueue={substitutionQueue}
        onQueueSubstitution={handleQueueSubstitution}
      />

      <SubstitutionPanel
        gameState={gameState}
        game={game}
        team={team}
        players={players}
        positions={positions}
        lineup={lineup}
        playTimeRecords={playTimeRecords}
        currentTime={currentTime}
        substitutionQueue={substitutionQueue}
        onQueueChange={setSubstitutionQueue}
        substitutionRequest={substitutionRequest}
        onSubstitutionRequestHandled={() => setSubstitutionRequest(null)}
      />

      <GameTimer
        gameState={gameState}
        game={game}
        team={team}
        players={players}
        positions={positions}
        currentTime={currentTime}
        isRunning={isRunning}
        halfLengthSeconds={halfLengthSeconds}
        gamePlan={gamePlan}
        plannedRotations={plannedRotations}
        isRecalculating={isRecalculating}
        onStartGame={handleStartGame}
        onPauseTimer={handlePauseTimer}
        onResumeTimer={handleResumeTimer}
        onHalftime={handleHalftime}
        onStartSecondHalf={handleStartSecondHalf}
        onEndGame={handleEndGame}
        onAddTestTime={handleAddTestTime}
        onRecalculateRotations={handleRecalculateRotations}
        getPlanConflicts={getPlanConflicts}
      />

      <LineupPanel
        gameState={gameState}
        game={game}
        team={team}
        players={players}
        positions={positions}
        lineup={lineup}
        playTimeRecords={playTimeRecords}
        currentTime={currentTime}
        gamePlan={gamePlan}
        onSubstitute={handleSubstitute}
        onMarkInjured={handleMarkInjured}
      />

      {gameState.status !== 'in-progress' && (
        <div className="delete-game-section">
          <button
            onClick={async () => {
              if (window.confirm("Are you sure you want to delete this game? This action cannot be undone.")) {
                try {
                  await client.models.Game.delete({ id: game.id });
                  onBack();
                } catch (error) {
                  console.error("Error deleting game:", error);
                  alert("Failed to delete game");
                }
              }
            }}
            className="btn-delete-game"
          >
            Delete Game
          </button>
        </div>
      )}
    </div>
    </AvailabilityProvider>
  );
}
