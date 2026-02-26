import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { GAME_CONFIG } from "../constants/gameConfig";
import type { GamePlan, PlannedRotation, PlannedSubstitution } from "../types/schema";

export type { PlannedSubstitution } from "../types/schema";

const client = generateClient<Schema>();

export interface SimpleRoster {
  id: string;
  playerId: string;
  playerNumber: number;
  preferredPositions?: string;
}

interface PlayerPlayTime {
  playerId: string;
  totalMinutes: number;
  rotations: Array<{ rotationNumber: number; onField: boolean; positionId?: string }>;
}

/**
 * Calculates fair rotation schedule ensuring equal play time
 * Exported for testing purposes
 */
/**
 * Calculate the game minute for a rotation
 * @param rotationNumber - The rotation number (1-indexed)
 * @param rotationsPerHalf - Number of rotations per half
 * @param rotationIntervalMinutes - Minutes between rotations
 * @param halfLengthMinutes - Length of each half in minutes
 * @returns The game minute when this rotation should occur
 */
export function calculateRotationMinute(
  rotationNumber: number,
  rotationsPerHalf: number,
  rotationIntervalMinutes: number,
  halfLengthMinutes: number
): number {
  const half = rotationNumber <= rotationsPerHalf ? 1 : 2;
  
  if (half === 1) {
    // First half: rotation 1 at 10 min, rotation 2 at 20 min, etc.
    return rotationNumber * rotationIntervalMinutes;
  } else {
    // Second half: add half length to the rotation time within second half
    const rotationInSecondHalf = rotationNumber - rotationsPerHalf;
    return halfLengthMinutes + (rotationInSecondHalf * rotationIntervalMinutes);
  }
}

export function calculateFairRotations(
  availablePlayers: SimpleRoster[],
  startingLineup: Array<{ playerId: string; positionId: string }>,
  totalRotations: number,
  rotationsPerHalf: number,
  maxPlayersOnField: number,
  /** Position ID of the goalkeeper slot — never auto-subbed in regular rotations */
  goaliePositionId?: string,
  /** If the coach has already set a halftime lineup, keep it and plan second-half rotations from it */
  halftimeLineup?: Array<{ playerId: string; positionId: string }>
): Array<{ substitutions: PlannedSubstitution[] }> {
  const playerIds = availablePlayers.map(p => p.playerId);
  const rotations: Array<{ substitutions: PlannedSubstitution[] }> = [];
  
  // Build preferred positions lookup: playerId -> Set of positionIds
  const preferredPositionsMap = new Map<string, Set<string>>();
  for (const player of availablePlayers) {
    if (player.preferredPositions) {
      const prefs = player.preferredPositions.split(',').map(s => s.trim()).filter(Boolean);
      preferredPositionsMap.set(player.playerId, new Set(prefs));
    }
  }

  // Check if a player prefers a given position
  const prefersPosition = (playerId: string, positionId: string): boolean => {
    const prefs = preferredPositionsMap.get(playerId);
    return prefs ? prefs.has(positionId) : false;
  };

  /**
   * Given a set of positions to fill and candidate bench players (sorted by least time),
   * return the best assignment: bench players matched to positions they prefer when possible.
   * Falls back to time-based ordering when preferences don't help.
   */
  const assignPlayersToPositions = (
    positionsToFill: string[],
    benchCandidates: Array<{ id: string; time: number }>
  ): Array<{ playerId: string; positionId: string }> => {
    const assignments: Array<{ playerId: string; positionId: string }> = [];
    const usedPlayers = new Set<string>();
    const usedPositions = new Set<string>();

    // Pass 1: Assign bench players to positions they prefer (least time first)
    for (const candidate of benchCandidates) {
      if (usedPlayers.size >= positionsToFill.length) break;
      if (usedPlayers.has(candidate.id)) continue;

      for (const posId of positionsToFill) {
        if (usedPositions.has(posId)) continue;
        if (prefersPosition(candidate.id, posId)) {
          assignments.push({ playerId: candidate.id, positionId: posId });
          usedPlayers.add(candidate.id);
          usedPositions.add(posId);
          break;
        }
      }
    }

    // Pass 2: Fill remaining positions with remaining bench players (least time first)
    for (const candidate of benchCandidates) {
      if (usedPlayers.size >= positionsToFill.length) break;
      if (usedPlayers.has(candidate.id)) continue;

      for (const posId of positionsToFill) {
        if (usedPositions.has(posId)) continue;
        assignments.push({ playerId: candidate.id, positionId: posId });
        usedPlayers.add(candidate.id);
        usedPositions.add(posId);
        break;
      }
    }

    return assignments;
  };

  // Track current field state
  let currentField = new Set(startingLineup.map(s => s.playerId));
  const positionMap = new Map(startingLineup.map(s => [s.playerId, s.positionId]));
  
  // Track play time in rotation units
  const playTimeRotations = new Map<string, number>();
  playerIds.forEach(id => {
    playTimeRotations.set(id, currentField.has(id) ? 1 : 0);
  });

  for (let rotNum = 1; rotNum <= totalRotations; rotNum++) {
    const substitutions: PlannedSubstitution[] = [];
    
    // At halftime, either apply coach-set lineup or auto-swap fresh legs
    if (rotNum === rotationsPerHalf + 1) {
      if (halftimeLineup && halftimeLineup.length > 0) {
        // Coach has set the halftime lineup — diff current state to target and apply it
        const currentPosToPlayer = new Map<string, string>();
        for (const [playerId, positionId] of positionMap.entries()) {
          if (currentField.has(playerId)) {
            currentPosToPlayer.set(positionId, playerId);
          }
        }

        const prevField = new Set(currentField);
        currentField.clear();

        for (const { positionId, playerId: newPlayerId } of halftimeLineup) {
          const currentPlayerId = currentPosToPlayer.get(positionId);
          if (currentPlayerId && currentPlayerId !== newPlayerId) {
            substitutions.push({
              playerOutId: currentPlayerId,
              playerInId: newPlayerId,
              positionId,
            });
          }
          currentField.add(newPlayerId);
          positionMap.set(newPlayerId, positionId);
        }

        // Remove stale positionMap entries for players who left the field
        for (const pid of prevField) {
          if (!currentField.has(pid)) {
            positionMap.delete(pid);
          }
        }
      } else {
        // Auto-compute halftime: swap in bench players with least time
        const benchPlayers = Array.from(playerIds).filter(id => !currentField.has(id));
        const benchWithTime = benchPlayers.map(id => ({
          id,
          time: playTimeRotations.get(id) || 0,
        })).sort((a, b) => a.time - b.time);

        const fieldPlayers = Array.from(currentField);
        const subsNeeded = Math.min(maxPlayersOnField, benchWithTime.length);

        // Collect which positions will be vacated
        const positionsToFill = fieldPlayers.slice(0, subsNeeded).map(pid => positionMap.get(pid)!);
        const playersOut = fieldPlayers.slice(0, subsNeeded);

        // Match bench players to positions using preferred positions
        const assignments = assignPlayersToPositions(positionsToFill, benchWithTime);

        for (let i = 0; i < playersOut.length; i++) {
          const playerOut = playersOut[i];
          const position = positionMap.get(playerOut)!;
          const assignment = assignments.find(a => a.positionId === position);
          if (!assignment) continue;

          substitutions.push({
            playerOutId: playerOut,
            playerInId: assignment.playerId,
            positionId: position,
          });

          currentField.delete(playerOut);
          currentField.add(assignment.playerId);
          positionMap.set(assignment.playerId, position);
        }
      }
    } else {
      // Regular rotation - sub players with most time for those with least.
      // The goalkeeper is never rotated out here; only halftime allows that.
      const benchPlayers = Array.from(playerIds).filter(id => !currentField.has(id));

      if (benchPlayers.length > 0) {
        // Find players on field with most time, excluding the goalkeeper
        const fieldWithTime = Array.from(currentField)
          .filter(id => !goaliePositionId || positionMap.get(id) !== goaliePositionId)
          .map(id => ({
            id,
            time: playTimeRotations.get(id) || 0,
          })).sort((a, b) => b.time - a.time);
        
        // Find bench players with least time
        const benchWithTime = benchPlayers.map(id => ({
          id,
          time: playTimeRotations.get(id) || 0,
        })).sort((a, b) => a.time - b.time);
        
        // Calculate how many subs to make (aim for fair distribution per rotation)
        const subsNeeded = Math.min(
          Math.ceil(maxPlayersOnField / GAME_CONFIG.ROTATION_CALCULATION.MIN_PLAYERS_PER_GROUP),
          benchPlayers.length,
          fieldWithTime.length
        );
        
        // Collect positions being vacated
        const playersOut = fieldWithTime.slice(0, subsNeeded);
        const positionsToFill = playersOut.map(p => positionMap.get(p.id)!);
        
        // Match bench players to positions using preferred positions
        const assignments = assignPlayersToPositions(positionsToFill, benchWithTime);
        
        for (const playerOutEntry of playersOut) {
          const position = positionMap.get(playerOutEntry.id)!;
          const assignment = assignments.find(a => a.positionId === position);
          if (!assignment) continue;
          
          substitutions.push({
            playerOutId: playerOutEntry.id,
            playerInId: assignment.playerId,
            positionId: position,
          });
          
          currentField.delete(playerOutEntry.id);
          currentField.add(assignment.playerId);
          positionMap.set(assignment.playerId, position);
        }
      }
    }
    
    // Update play time tracking
    currentField.forEach(id => {
      playTimeRotations.set(id, (playTimeRotations.get(id) || 0) + 1);
    });
    
    rotations.push({ substitutions });
  }
  
  return rotations;
}

/**
 * Calculates projected play time for each player based on rotation plan
 * @param rotations - Array of planned rotations
 * @param startingLineup - Initial lineup
 * @param rotationIntervalMinutes - Minutes between rotations
 * @param totalGameMinutes - Total game length
 * @returns Map of player ID to projected minutes
 */
export function calculatePlayTime(
  rotations: PlannedRotation[],
  startingLineup: Array<{ playerId: string; positionId: string }>,
  _rotationIntervalMinutes: number,
  totalGameMinutes: number
): Map<string, PlayerPlayTime> {
  const playTime = new Map<string, PlayerPlayTime>();
  const allPlayerIds = new Set<string>();
  
  // Initialize with starting lineup
  const currentField = new Set(startingLineup.map(s => s.playerId));
  startingLineup.forEach(s => {
    allPlayerIds.add(s.playerId);
    playTime.set(s.playerId, {
      playerId: s.playerId,
      totalMinutes: 0,
      rotations: [],
    });
  });
  
  // Add first rotation state
  currentField.forEach(id => {
    const pt = playTime.get(id)!;
    pt.rotations.push({ rotationNumber: 0, onField: true, positionId: startingLineup.find(s => s.playerId === id)?.positionId });
  });
  
  // Process each rotation
  const sortedRotations = [...rotations].sort((a, b) => a.rotationNumber - b.rotationNumber);
  
  sortedRotations.forEach((rotation) => {
    let subs: PlannedSubstitution[] = [];
    try {
      subs = JSON.parse(rotation.plannedSubstitutions as string);
    } catch (e) {
      console.error('[calculatePlayTime] Failed to parse plannedSubstitutions for rotation', rotation.rotationNumber, e);
      return;
    }

    // Apply substitutions
    subs.forEach(sub => {
      currentField.delete(sub.playerOutId);
      currentField.add(sub.playerInId);
      
      allPlayerIds.add(sub.playerInId);
      if (!playTime.has(sub.playerInId)) {
        playTime.set(sub.playerInId, {
          playerId: sub.playerInId,
          totalMinutes: 0,
          rotations: [],
        });
      }
    });
    
    // Record state after this rotation
    allPlayerIds.forEach(id => {
      const pt = playTime.get(id)!;
      pt.rotations.push({
        rotationNumber: rotation.rotationNumber,
        onField: currentField.has(id),
        positionId: subs.find(s => s.playerInId === id)?.positionId,
      });
    });
  });
  
  // Calculate total minutes based on actual game minutes
  allPlayerIds.forEach(playerId => {
    const pt = playTime.get(playerId)!;
    let minutes = 0;
    
    pt.rotations.forEach((rotation, index) => {
      if (rotation.onField) {
        const nextRotation = pt.rotations[index + 1];
        
        // Get the current rotation's game minute
        const currentRotationObj = rotation.rotationNumber === 0 
          ? null 
          : sortedRotations.find(r => r.rotationNumber === rotation.rotationNumber);
        const currentMinute = currentRotationObj?.gameMinute || 0;
        
        if (nextRotation) {
          // Calculate time until next rotation
          const nextRotationObj = sortedRotations.find(r => r.rotationNumber === nextRotation.rotationNumber);
          const nextMinute = nextRotationObj?.gameMinute || 0;
          
          if (nextMinute > currentMinute) {
            minutes += nextMinute - currentMinute;
          } else if (rotation.rotationNumber === 0 && nextMinute > 0) {
            // From start to first rotation
            minutes += nextMinute;
          }
        } else {
          // Last segment - play until end
          minutes += totalGameMinutes - currentMinute;
        }
      }
    });
    
    pt.totalMinutes = minutes;
  });
  
  return playTime;
}

/**
 * Validates a rotation plan for common issues
 * @param rotations - Planned rotations to validate
 * @param maxPlayersOnField - Maximum players allowed on field
 * @returns Array of validation errors (empty if valid)
 */
export function validateRotationPlan(
  rotations: PlannedRotation[],
  maxPlayersOnField: number
): string[] {
  const errors: string[] = [];
  
  if (rotations.length === 0) {
    errors.push('No rotations planned');
    return errors;
  }
  
  // Track field state
  const fieldState = new Set<string>();
  
  rotations.forEach((rotation, index) => {
    let subs: PlannedSubstitution[] = [];
    try {
      subs = JSON.parse(rotation.plannedSubstitutions as string);
    } catch (e) {
      errors.push(`Rotation ${rotation.rotationNumber}: Failed to parse substitutions data`);
      return;
    }

    // Check for duplicate subs in same rotation
    const playerOutIds = subs.map(s => s.playerOutId);
    const playerInIds = subs.map(s => s.playerInId);
    
    if (new Set(playerOutIds).size !== playerOutIds.length) {
      errors.push(`Rotation ${rotation.rotationNumber}: Duplicate players being subbed out`);
    }
    
    if (new Set(playerInIds).size !== playerInIds.length) {
      errors.push(`Rotation ${rotation.rotationNumber}: Duplicate players being subbed in`);
    }
    
    // Check that players being subbed out are actually on field
    subs.forEach(sub => {
      if (index === 0) {
        // First rotation - can't validate yet
      } else if (!fieldState.has(sub.playerOutId)) {
        errors.push(`Rotation ${rotation.rotationNumber}: Player ${sub.playerOutId} not on field`);
      }
      
      // Apply substitution
      fieldState.delete(sub.playerOutId);
      fieldState.add(sub.playerInId);
    });
    
    // Check field doesn't exceed max
    if (fieldState.size > maxPlayersOnField) {
      errors.push(`Rotation ${rotation.rotationNumber}: Too many players on field (${fieldState.size})`);
    }
  });
  
  return errors;
}

/**
 * Copies a game plan from another game
 * @param sourceGameId - Game to copy from
 * @param targetGameId - Game to copy to
 * @param coaches - Coach authorization
 * @returns Created game plan
 */
export async function copyGamePlan(
  sourceGameId: string,
  targetGameId: string,
  coaches: string[]
): Promise<GamePlan | null> {
  // Fetch source game plan
  const sourcePlansResult = await client.models.GamePlan.list({
    filter: { gameId: { eq: sourceGameId } },
  });
  
  const sourcePlan = sourcePlansResult.data[0];
  if (!sourcePlan) {
    console.log('No game plan found for source game');
    return null;
  }
  
  // Fetch source rotations
  const sourceRotationsResult = await client.models.PlannedRotation.list({
    filter: { gamePlanId: { eq: sourcePlan.id } },
  });
  
  // Create new game plan (including starting lineup)
  const newPlanResult = await client.models.GamePlan.create({
    gameId: targetGameId,
    rotationIntervalMinutes: sourcePlan.rotationIntervalMinutes,
    totalRotations: sourcePlan.totalRotations,
    startingLineup: sourcePlan.startingLineup,
    halftimeLineup: sourcePlan.halftimeLineup,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    coaches,
  });
  
  const newPlan = newPlanResult.data;
  if (!newPlan) {
    throw new Error('Failed to create new game plan');
  }
  
  // Copy rotations
  const rotationPromises = sourceRotationsResult.data.map(async (sourceRotation) => {
    return client.models.PlannedRotation.create({
      gamePlanId: newPlan.id,
      rotationNumber: sourceRotation.rotationNumber,
      gameMinute: sourceRotation.gameMinute,
      half: sourceRotation.half,
      plannedSubstitutions: sourceRotation.plannedSubstitutions,
      coaches,
    });
  });
  
  await Promise.all(rotationPromises);
  
  console.log(`Copied ${sourceRotationsResult.data.length} rotations to new plan`);
  
  return newPlan;
}

/**
 * Updates player availability status
 * @param gameId - Game ID
 * @param playerId - Player ID
 * @param status - New availability status
 * @param notes - Optional notes
 * @param coaches - Coach authorization
 */
export async function updatePlayerAvailability(
  gameId: string,
  playerId: string,
  status: 'available' | 'absent' | 'injured' | 'late-arrival',
  notes: string | undefined,
  coaches: string[]
): Promise<void> {
  // Check if availability record exists
  const existingResult = await client.models.PlayerAvailability.list({
    filter: {
      and: [
        { gameId: { eq: gameId } },
        { playerId: { eq: playerId } },
      ],
    },
  });
  
  if (existingResult.data.length > 0) {
    // Update existing
    await client.models.PlayerAvailability.update({
      id: existingResult.data[0].id,
      status,
      markedAt: new Date().toISOString(),
      notes,
    });
  } else {
    // Create new
    await client.models.PlayerAvailability.create({
      gameId,
      playerId,
      status,
      markedAt: new Date().toISOString(),
      notes,
      coaches,
    });
  }
}
