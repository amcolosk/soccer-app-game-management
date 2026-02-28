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
  availableFromMinute?: number;   // null/undefined = available from game start (0)
  availableUntilMinute?: number;  // null/undefined = available until game end
}

interface RotationOptions {
  rotationIntervalMinutes: number;
  halfLengthMinutes: number;
  positions?: Array<{ id: string; abbreviation?: string | null }>;
}

export interface RotationResult {
  rotations: Array<{ substitutions: PlannedSubstitution[] }>;
  warnings: string[];
}

type PositionGroup = 'GOALKEEPER' | 'STRIKER' | 'MIDFIELDER' | 'DEFENDER' | 'UNKNOWN';

function inferPositionGroup(abbreviation?: string | null): PositionGroup {
  if (!abbreviation) return 'UNKNOWN';
  const upper = abbreviation.toUpperCase().trim();
  if (['GK', 'G', 'GOAL'].includes(upper)) return 'GOALKEEPER';
  if (['FW', 'FWD', 'ST', 'S', 'CF', 'LW', 'RW', 'W', 'WF'].includes(upper)) return 'STRIKER';
  if (['MF', 'MID', 'CM', 'RM', 'LM', 'AM', 'DM', 'CAM', 'CDM'].includes(upper)) return 'MIDFIELDER';
  if (['DF', 'DEF', 'CB', 'LB', 'RB', 'LWB', 'RWB'].includes(upper)) return 'DEFENDER';
  return 'UNKNOWN';
}

const MAX_CONTINUOUS_ROTATIONS: Record<PositionGroup, number> = {
  GOALKEEPER: Infinity,
  STRIKER: 1,
  MIDFIELDER: 2,
  DEFENDER: 2,
  UNKNOWN: 2,
};

interface PlayerPlayTime {
  playerId: string;
  totalMinutes: number;
  rotations: Array<{ rotationNumber: number; onField: boolean; positionId?: string }>;
}

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
  halftimeLineup?: Array<{ playerId: string; positionId: string }>,
  options?: RotationOptions
): RotationResult {
  const warnings: string[] = [];
  const rotationIntervalMinutes = options?.rotationIntervalMinutes ?? 5;
  const halfLengthMinutes = options?.halfLengthMinutes ?? 30;
  const totalGameMinutes = halfLengthMinutes * 2;

  // Build position group map from options
  const positionGroupMap = new Map<string, PositionGroup>();
  if (options?.positions) {
    for (const pos of options.positions) {
      positionGroupMap.set(pos.id, inferPositionGroup(pos.abbreviation));
    }
  }

  const playerIds = availablePlayers.map(p => p.playerId);
  const playerById = new Map<string, SimpleRoster>(availablePlayers.map(p => [p.playerId, p]));

  // Build preferred positions lookup: playerId -> Set of positionIds
  const preferredPositionsMap = new Map<string, Set<string>>();
  for (const player of availablePlayers) {
    if (player.preferredPositions) {
      const prefs = player.preferredPositions.split(',').map(s => s.trim()).filter(Boolean);
      preferredPositionsMap.set(player.playerId, new Set(prefs));
    }
  }

  const prefersPosition = (playerId: string, positionId: string): boolean => {
    const prefs = preferredPositionsMap.get(playerId);
    return prefs ? prefs.has(positionId) : false;
  };

  // GK preference: player has goaliePositionId in their preferredPositions
  const isGkPreferred = (playerId: string): boolean => {
    if (!goaliePositionId) return false;
    return prefersPosition(playerId, goaliePositionId);
  };

  // Pre-loop validation
  // TC-09: Check for GK-preferred players
  if (goaliePositionId) {
    const hasGoalieCandidates = availablePlayers.some(p => isGkPreferred(p.playerId));
    if (!hasGoalieCandidates) {
      warnings.push('No eligible goalies available. Please assign a goalkeeper manually.');
    }
  }

  // TC-10: Short bench detection — skip fatigue and 50% rules
  const noSubsAvailable = availablePlayers.length <= maxPlayersOnField;

  /**
   * Assign bench candidates to positions respecting GK lock and preferences.
   * When gkLocked=true, only GK-preferred players may fill the GK position.
   */
  const assignPlayersToPositions = (
    positionsToFill: string[],
    benchCandidates: Array<{ id: string; time: number }>,
    gkLocked = false
  ): Array<{ playerId: string; positionId: string }> => {
    const assignments: Array<{ playerId: string; positionId: string }> = [];
    const usedPlayers = new Set<string>();
    const usedPositions = new Set<string>();

    const canFillPosition = (candidateId: string, posId: string): boolean => {
      if (gkLocked && posId === goaliePositionId && !isGkPreferred(candidateId)) return false;
      return true;
    };

    // Pass 1: preferred positions
    for (const candidate of benchCandidates) {
      if (usedPlayers.size >= positionsToFill.length) break;
      if (usedPlayers.has(candidate.id)) continue;
      for (const posId of positionsToFill) {
        if (usedPositions.has(posId)) continue;
        if (!canFillPosition(candidate.id, posId)) continue;
        if (prefersPosition(candidate.id, posId)) {
          assignments.push({ playerId: candidate.id, positionId: posId });
          usedPlayers.add(candidate.id);
          usedPositions.add(posId);
          break;
        }
      }
    }

    // Pass 2: any remaining position
    for (const candidate of benchCandidates) {
      if (usedPlayers.size >= positionsToFill.length) break;
      if (usedPlayers.has(candidate.id)) continue;
      for (const posId of positionsToFill) {
        if (usedPositions.has(posId)) continue;
        if (!canFillPosition(candidate.id, posId)) continue;
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

  // Play time tracking (minutes)
  const playTimeMinutes = new Map<string, number>();
  playerIds.forEach(id => playTimeMinutes.set(id, 0));

  // Consecutive on-field intervals (reset to 0 when benched or at halftime)
  const continuousRotations = new Map<string, number>();
  playerIds.forEach(id => continuousRotations.set(id, 0));

  // Half field tracking
  const halfOnField = { first: new Set<string>(), second: new Set<string>() };

  const rotations: Array<{ substitutions: PlannedSubstitution[] }> = [];

  for (let rotNum = 1; rotNum <= totalRotations; rotNum++) {
    const isHalftime = rotNum === rotationsPerHalf + 1;
    const isFirstHalf = rotNum <= rotationsPerHalf;
    const isSecondHalf = rotNum > rotationsPerHalf + 1;
    const isLastFirstHalfRotation = rotNum === rotationsPerHalf;
    const isLastRotation = rotNum === totalRotations;
    const substitutions: PlannedSubstitution[] = [];

    // Step 1: Accumulate play time and update continuousRotations BEFORE computing subs
    currentField.forEach(id => {
      playTimeMinutes.set(id, (playTimeMinutes.get(id) ?? 0) + rotationIntervalMinutes);
      continuousRotations.set(id, (continuousRotations.get(id) ?? 0) + 1);
      if (isFirstHalf || isHalftime) halfOnField.first.add(id);
      if (isSecondHalf) halfOnField.second.add(id);
    });

    // Current game minute after this interval has elapsed
    const currentGameMinute = rotNum <= rotationsPerHalf + 1
      ? rotNum * rotationIntervalMinutes
      : halfLengthMinutes + (rotNum - rotationsPerHalf - 1) * rotationIntervalMinutes;

    const minutesRemaining = totalGameMinutes - currentGameMinute;

    // Helper: is a player eligible to be on field at this game minute?
    const isEligible = (id: string): boolean => {
      const p = playerById.get(id);
      if (!p) return false;
      const from = p.availableFromMinute ?? 0;
      const until = p.availableUntilMinute ?? totalGameMinutes;
      return currentGameMinute >= from && currentGameMinute < until;
    };

    if (isHalftime) {
      // --- Halftime handling ---
      if (halftimeLineup && halftimeLineup.length > 0) {
        // Coach-set lineup: diff and apply
        const currentPosToPlayer = new Map<string, string>();
        for (const [playerId, positionId] of positionMap.entries()) {
          if (currentField.has(playerId)) currentPosToPlayer.set(positionId, playerId);
        }

        const prevField = new Set(currentField);
        currentField.clear();

        for (const { positionId, playerId: newPlayerId } of halftimeLineup) {
          const currentPlayerId = currentPosToPlayer.get(positionId);
          if (currentPlayerId && currentPlayerId !== newPlayerId) {
            substitutions.push({ playerOutId: currentPlayerId, playerInId: newPlayerId, positionId });
          }
          currentField.add(newPlayerId);
          positionMap.set(newPlayerId, positionId);
        }

        for (const pid of prevField) {
          if (!currentField.has(pid)) positionMap.delete(pid);
        }
      } else {
        // Auto-compute halftime with GK lock
        const benchPlayers = playerIds.filter(id => !currentField.has(id));
        const eligibleBench = benchPlayers.filter(id => isEligible(id));
        const benchWithTime = eligibleBench
          .map(id => ({ id, time: playTimeMinutes.get(id) ?? 0 }))
          .sort((a, b) => a.time - b.time);

        const hasGkBench = goaliePositionId ? benchWithTime.some(p => isGkPreferred(p.id)) : false;

        const fieldWithTime = Array.from(currentField)
          .map(pid => ({
            id: pid,
            time: playTimeMinutes.get(pid) ?? 0,
            isGk: goaliePositionId ? positionMap.get(pid) === goaliePositionId : false,
          }))
          .sort((a, b) => b.time - a.time);

        const subsNeeded = Math.min(maxPlayersOnField, benchWithTime.length);
        const positionsToFill: string[] = [];
        const playersOut: string[] = [];
        let swapped = 0;

        for (const fp of fieldWithTime) {
          if (swapped >= subsNeeded) break;
          const pos = positionMap.get(fp.id)!;
          // GK can only be swapped if there's a GK-preferred bench candidate
          if (fp.isGk && !hasGkBench) continue;
          positionsToFill.push(pos);
          playersOut.push(fp.id);
          swapped++;
        }

        const assignments = assignPlayersToPositions(positionsToFill, benchWithTime, true);

        for (let i = 0; i < playersOut.length; i++) {
          const playerOut = playersOut[i];
          const position = positionMap.get(playerOut)!;
          const assignment = assignments.find(a => a.positionId === position);
          if (!assignment) continue;

          substitutions.push({ playerOutId: playerOut, playerInId: assignment.playerId, positionId: position });
          currentField.delete(playerOut);
          currentField.add(assignment.playerId);
          positionMap.set(assignment.playerId, position);
          positionMap.delete(playerOut);
        }
      }

      // Reset continuousRotations at halftime
      playerIds.forEach(id => continuousRotations.set(id, 0));

    } else {
      // --- Regular rotation ---
      const benchPlayers = playerIds.filter(id => !currentField.has(id));

      if (!noSubsAvailable && benchPlayers.length > 0) {
        const eligibleBench = benchPlayers.filter(id => isEligible(id));

        // Forced-off: availability window closed
        const forcedOff: string[] = [];
        for (const id of currentField) {
          const p = playerById.get(id);
          const until = p?.availableUntilMinute;
          if (until !== undefined && until !== null && currentGameMinute >= until) {
            // GK cannot be forced off mid-game (Rule 1.4)
            if (goaliePositionId && positionMap.get(id) === goaliePositionId) continue;
            forcedOff.push(id);
          }
        }

        // Fatigue-based forced-off (only when position data available)
        if (options?.positions) {
          for (const id of currentField) {
            if (forcedOff.includes(id)) continue;
            if (goaliePositionId && positionMap.get(id) === goaliePositionId) continue;
            const pos = positionMap.get(id);
            if (!pos) continue;
            const group = positionGroupMap.get(pos) ?? 'UNKNOWN';
            const maxCont = MAX_CONTINUOUS_ROTATIONS[group];
            if (isFinite(maxCont) && (continuousRotations.get(id) ?? 0) >= maxCont) {
              forcedOff.push(id);
            }
          }
        }

        // Must-on: 50% risk bench players (Rules 1.3, 2.2)
        const mustOn: string[] = [];
        for (const id of eligibleBench) {
          const p = playerById.get(id)!;
          const availTime = (p.availableUntilMinute ?? totalGameMinutes) - (p.availableFromMinute ?? 0);
          const threshold = availTime * 0.5;
          const played = playTimeMinutes.get(id) ?? 0;
          if (played + minutesRemaining <= threshold) {
            mustOn.push(id);
          }
        }

        // Per-half coverage: last rotation of each half — prioritize players not yet on field
        const notYetInHalf: string[] = [];
        if (isLastFirstHalfRotation || (isLastRotation && isSecondHalf)) {
          const halfSet = isLastFirstHalfRotation ? halfOnField.first : halfOnField.second;
          for (const id of eligibleBench) {
            if (!halfSet.has(id) && !mustOn.includes(id)) notYetInHalf.push(id);
          }
        }

        // Build prioritized bench list
        const priorityBench = [...mustOn, ...notYetInHalf].filter((id, i, a) => a.indexOf(id) === i);
        const normalBench = eligibleBench.filter(id => !priorityBench.includes(id));

        const sortedBench = [
          ...priorityBench.map(id => ({ id, time: playTimeMinutes.get(id) ?? 0 })).sort((a, b) => a.time - b.time),
          ...normalBench.map(id => ({ id, time: playTimeMinutes.get(id) ?? 0 })).sort((a, b) => a.time - b.time),
        ];

        // How many subs?
        const nonGkField = Array.from(currentField).filter(
          id => !goaliePositionId || positionMap.get(id) !== goaliePositionId
        );
        const baseSubsNeeded = Math.min(
          Math.ceil(maxPlayersOnField / GAME_CONFIG.ROTATION_CALCULATION.MIN_PLAYERS_PER_GROUP),
          eligibleBench.length,
          nonGkField.length
        );
        const totalSubsNeeded = Math.min(
          Math.max(forcedOff.length, Math.max(mustOn.length, baseSubsNeeded)),
          eligibleBench.length
        );

        if (totalSubsNeeded > 0) {
          // Players going out: forcedOff first, then most-time non-GK
          const additionalNeeded = Math.max(0, totalSubsNeeded - forcedOff.length);
          const candidatesForOut = nonGkField
            .filter(id => !forcedOff.includes(id))
            .map(id => ({ id, time: playTimeMinutes.get(id) ?? 0 }))
            .sort((a, b) => b.time - a.time);

          const allPlayersOut = [...forcedOff, ...candidatesForOut.slice(0, additionalNeeded).map(p => p.id)];
          const positionsToFill = allPlayersOut
            .map(id => positionMap.get(id))
            .filter((pos): pos is string => pos !== undefined);

          if (positionsToFill.length > 0 && sortedBench.length > 0) {
            const assignments = assignPlayersToPositions(positionsToFill, sortedBench, false);

            for (const playerOutId of allPlayersOut) {
              const position = positionMap.get(playerOutId);
              if (!position) continue;
              const assignment = assignments.find(a => a.positionId === position);
              if (!assignment) continue;

              substitutions.push({ playerOutId, playerInId: assignment.playerId, positionId: position });
              currentField.delete(playerOutId);
              currentField.add(assignment.playerId);
              positionMap.set(assignment.playerId, position);
            }
          }
        }
      }
    }

    // Reset continuousRotations for players who went to bench
    for (const id of playerIds) {
      if (!currentField.has(id)) continuousRotations.set(id, 0);
    }

    rotations.push({ substitutions });
  }

  return { rotations, warnings };
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
  coaches: string[],
  availableFromMinute?: number | null,
  availableUntilMinute?: number | null
): Promise<void> {
  // Validate availability window values
  if (availableFromMinute !== undefined && availableFromMinute !== null) {
    if (!Number.isInteger(availableFromMinute) || availableFromMinute < 0) {
      throw new Error('availableFromMinute must be a non-negative integer');
    }
  }
  if (availableUntilMinute !== undefined && availableUntilMinute !== null) {
    if (!Number.isInteger(availableUntilMinute) || availableUntilMinute < 0) {
      throw new Error('availableUntilMinute must be a non-negative integer');
    }
  }
  if (
    availableFromMinute !== undefined && availableFromMinute !== null &&
    availableUntilMinute !== undefined && availableUntilMinute !== null &&
    availableFromMinute >= availableUntilMinute
  ) {
    throw new Error('availableFromMinute must be less than availableUntilMinute');
  }

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
      ...(availableFromMinute !== undefined && { availableFromMinute }),
      ...(availableUntilMinute !== undefined && { availableUntilMinute: availableUntilMinute }),
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
      ...(availableFromMinute !== undefined && { availableFromMinute }),
      ...(availableUntilMinute !== undefined && { availableUntilMinute: availableUntilMinute }),
    });
  }
}
