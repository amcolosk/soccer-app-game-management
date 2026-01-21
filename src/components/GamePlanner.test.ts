import { describe, it, expect } from 'vitest';

/**
 * Unit tests for GamePlanner lineup and substitution logic
 * Testing the core algorithms without UI dependencies
 */

interface PlannedSubstitution {
  playerOutId: string;
  playerInId: string;
  positionId: string;
}

/**
 * Simulates the getLineupAtRotation logic from GamePlanner.tsx
 * This is the function that applies substitutions to calculate the lineup at a given rotation
 */
function getLineupAtRotation(
  startingLineup: Map<string, string>,
  rotations: Array<{ rotationNumber: number; plannedSubstitutions: PlannedSubstitution[] }>,
  targetRotationNumber: number
): Map<string, string> {
  const lineup = new Map(startingLineup);
  
  // Apply all substitutions up to this rotation
  for (let i = 0; i < rotations.length && rotations[i].rotationNumber <= targetRotationNumber; i++) {
    const rotation = rotations[i];
    const subs = rotation.plannedSubstitutions;
    
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
}

/**
 * Simulates creating a swap between two players
 */
function createSwapSubstitutions(
  previousLineup: Map<string, string>,
  targetPositionId: string,
  newPlayerId: string
): Map<string, string> {
  const newLineup = new Map(previousLineup);
  
  // Find if the new player is already in the lineup
  let oldPositionOfNewPlayer: string | null = null;
  for (const [posId, pId] of newLineup.entries()) {
    if (pId === newPlayerId) {
      oldPositionOfNewPlayer = posId;
      break;
    }
  }
  
  if (oldPositionOfNewPlayer && oldPositionOfNewPlayer !== targetPositionId) {
    // Swap: the new player is in the lineup at a different position
    const playerAtTargetPosition = newLineup.get(targetPositionId);
    if (playerAtTargetPosition) {
      // Put the target player in the old position
      newLineup.set(oldPositionOfNewPlayer, playerAtTargetPosition);
    } else {
      // Remove from old position
      newLineup.delete(oldPositionOfNewPlayer);
    }
  }
  
  // Set the new player at the target position
  newLineup.set(targetPositionId, newPlayerId);
  
  return newLineup;
}

/**
 * Calculate substitutions by comparing two lineups
 */
function calculateSubstitutions(
  previousLineup: Map<string, string>,
  newLineup: Map<string, string>
): PlannedSubstitution[] {
  const subs: PlannedSubstitution[] = [];
  
  for (const [positionId, newPlayerId] of newLineup.entries()) {
    const oldPlayerId = previousLineup.get(positionId);
    if (oldPlayerId && newPlayerId && oldPlayerId !== newPlayerId) {
      subs.push({
        playerOutId: oldPlayerId,
        playerInId: newPlayerId,
        positionId,
      });
    }
  }
  
  return subs;
}

describe('GamePlanner Lineup Logic', () => {
  describe('getLineupAtRotation', () => {
    it('should return starting lineup when no rotations', () => {
      const startingLineup = new Map([
        ['pos1', 'A'],
        ['pos2', 'B'],
        ['pos3', 'C'],
      ]);
      
      const result = getLineupAtRotation(startingLineup, [], 1);
      
      expect(result.size).toBe(3);
      expect(result.get('pos1')).toBe('A');
      expect(result.get('pos2')).toBe('B');
      expect(result.get('pos3')).toBe('C');
    });
    
    it('should apply a simple bench-to-field substitution', () => {
      const startingLineup = new Map([
        ['pos1', 'A'],
        ['pos2', 'B'],
        ['pos3', 'C'],
      ]);
      
      const rotations = [{
        rotationNumber: 1,
        plannedSubstitutions: [{
          playerOutId: 'A',
          playerInId: 'D', // D from bench
          positionId: 'pos1',
        }],
      }];
      
      const result = getLineupAtRotation(startingLineup, rotations, 1);
      
      expect(result.size).toBe(3);
      expect(result.get('pos1')).toBe('D');
      expect(result.get('pos2')).toBe('B');
      expect(result.get('pos3')).toBe('C');
    });
    
    it('should handle swapping two players in the lineup', () => {
      const startingLineup = new Map([
        ['pos1', 'A'],
        ['pos2', 'B'],
        ['pos3', 'C'],
        ['pos4', 'D'],
        ['pos5', 'E'],
      ]);
      
      // Swap A (pos1) with B (pos2)
      const rotations = [{
        rotationNumber: 1,
        plannedSubstitutions: [
          {
            playerOutId: 'A',
            playerInId: 'B',
            positionId: 'pos1',
          },
          {
            playerOutId: 'B',
            playerInId: 'A',
            positionId: 'pos2',
          },
        ],
      }];
      
      const result = getLineupAtRotation(startingLineup, rotations, 1);
      
      expect(result.size).toBe(5);
      expect(result.get('pos1')).toBe('B');
      expect(result.get('pos2')).toBe('A');
      expect(result.get('pos3')).toBe('C');
      expect(result.get('pos4')).toBe('D');
      expect(result.get('pos5')).toBe('E');
    });
    
    it('should handle multiple rotations in sequence', () => {
      const startingLineup = new Map([
        ['pos1', 'A'],
        ['pos2', 'B'],
        ['pos3', 'C'],
      ]);
      
      const rotations = [
        {
          rotationNumber: 1,
          plannedSubstitutions: [{
            playerOutId: 'A',
            playerInId: 'D',
            positionId: 'pos1',
          }],
        },
        {
          rotationNumber: 2,
          plannedSubstitutions: [{
            playerOutId: 'B',
            playerInId: 'E',
            positionId: 'pos2',
          }],
        },
      ];
      
      const result = getLineupAtRotation(startingLineup, rotations, 2);
      
      expect(result.size).toBe(3);
      expect(result.get('pos1')).toBe('D');
      expect(result.get('pos2')).toBe('E');
      expect(result.get('pos3')).toBe('C');
    });
  });
  
  describe('Swap Logic', () => {
    it('should swap two field players correctly', () => {
      const previousLineup = new Map([
        ['pos1', 'A'],
        ['pos2', 'B'],
        ['pos3', 'C'],
        ['pos4', 'D'],
        ['pos5', 'E'],
      ]);
      
      // User clicks on pos1 (A) and selects B to swap
      const newLineup = createSwapSubstitutions(previousLineup, 'pos1', 'B');
      
      expect(newLineup.size).toBe(5);
      expect(newLineup.get('pos1')).toBe('B');
      expect(newLineup.get('pos2')).toBe('A');
      expect(newLineup.get('pos3')).toBe('C');
      expect(newLineup.get('pos4')).toBe('D');
      expect(newLineup.get('pos5')).toBe('E');
    });
    
    it('should substitute a bench player for a field player', () => {
      const previousLineup = new Map([
        ['pos1', 'A'],
        ['pos2', 'B'],
        ['pos3', 'C'],
      ]);
      
      // User clicks on pos1 (A) and selects F from bench
      const newLineup = createSwapSubstitutions(previousLineup, 'pos1', 'F');
      
      expect(newLineup.size).toBe(3);
      expect(newLineup.get('pos1')).toBe('F');
      expect(newLineup.get('pos2')).toBe('B');
      expect(newLineup.get('pos3')).toBe('C');
    });
    
    it('should handle swap followed by getLineupAtRotation', () => {
      const startingLineup = new Map([
        ['pos1', 'A'],
        ['pos2', 'B'],
        ['pos3', 'C'],
        ['pos4', 'D'],
        ['pos5', 'E'],
      ]);
      
      // Rotation 1: Swap A with B
      const rot1Lineup = createSwapSubstitutions(startingLineup, 'pos1', 'B');
      const rot1Subs = calculateSubstitutions(startingLineup, rot1Lineup);
      
      // Apply the substitutions using getLineupAtRotation
      const result = getLineupAtRotation(startingLineup, [{
        rotationNumber: 1,
        plannedSubstitutions: rot1Subs,
      }], 1);
      
      expect(result.size).toBe(5);
      expect(result.get('pos1')).toBe('B');
      expect(result.get('pos2')).toBe('A');
      expect(result.get('pos3')).toBe('C');
      expect(result.get('pos4')).toBe('D');
      expect(result.get('pos5')).toBe('E');
    });
    
    it('should handle the exact scenario from the E2E test bug', () => {
      // Starting lineup has 5 players
      const startingLineup = new Map([
        ['pos1', 'A'],
        ['pos2', 'B'],
        ['pos3', 'C'],
        ['pos4', 'D'],
        ['pos5', 'E'],
      ]);
      
      // Rotation 1: User swaps the first field player (A) with a player already in the lineup (B)
      const rot1Lineup = createSwapSubstitutions(startingLineup, 'pos1', 'B');
      const rot1Subs = calculateSubstitutions(startingLineup, rot1Lineup);
      
      console.log('Rotation 1 substitutions:', rot1Subs);
      
      // Now get the lineup at rotation 1 (this is what the UI renders)
      const lineupAtRot1 = getLineupAtRotation(startingLineup, [{
        rotationNumber: 1,
        plannedSubstitutions: rot1Subs,
      }], 1);
      
      console.log('Lineup at rotation 1:', Array.from(lineupAtRot1.entries()));
      
      // This should still have 5 players!
      expect(lineupAtRot1.size).toBe(5);
      expect(lineupAtRot1.get('pos1')).toBe('B');
      expect(lineupAtRot1.get('pos2')).toBe('A');
      expect(lineupAtRot1.get('pos3')).toBe('C');
      expect(lineupAtRot1.get('pos4')).toBe('D');
      expect(lineupAtRot1.get('pos5')).toBe('E');
    });
  });
});
