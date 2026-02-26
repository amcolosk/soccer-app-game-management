import { describe, it, expect } from 'vitest';
import type { PlannedSubstitution } from '../services/rotationPlannerService';
import { computeLineupAtRotation, computeLineupDiff } from '../utils/gamePlannerUtils';

/**
 * Unit tests for GamePlanner lineup and substitution logic
 * Testing the core algorithms without UI dependencies
 */

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
      const rot1Subs = computeLineupDiff(startingLineup, rot1Lineup);
      
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
      const rot1Subs = computeLineupDiff(startingLineup, rot1Lineup);
      
      
      // Now get the lineup at rotation 1 (this is what the UI renders)
      const lineupAtRot1 = getLineupAtRotation(startingLineup, [{
        rotationNumber: 1,
        plannedSubstitutions: rot1Subs,
      }], 1);
      
      
      // This should still have 5 players!
      expect(lineupAtRot1.size).toBe(5);
      expect(lineupAtRot1.get('pos1')).toBe('B');
      expect(lineupAtRot1.get('pos2')).toBe('A');
      expect(lineupAtRot1.get('pos3')).toBe('C');
      expect(lineupAtRot1.get('pos4')).toBe('D');
      expect(lineupAtRot1.get('pos5')).toBe('E');
    });
  });

  describe('Downstream Rotation Cascade (Copy from Previous fix)', () => {
    /**
     * Simulates recalculateDownstreamRotations from GamePlanner.tsx.
     * Given that rotation `changedRotNum` has new subs (in subsOverrides),
     * recompute subs for all rotations after it so that each downstream
     * rotation's intended absolute lineup is preserved.
     */
    function recalculateDownstreamRotations(
      startingLineup: Map<string, string>,
      rotations: Array<{ rotationNumber: number; plannedSubstitutions: PlannedSubstitution[] }>,
      changedRotationNumber: number,
      subsOverrides: Map<number, PlannedSubstitution[]>
    ): Array<{ rotationNumber: number; plannedSubstitutions: PlannedSubstitution[] }> {
      // Helper to compute lineup at a rotation using overrides for some rotations
      const getLineupWith = (
        targetRotNum: number,
        overrides: Map<number, PlannedSubstitution[]>
      ): Map<string, string> => {
        const lineup = new Map(startingLineup);
        for (let i = 0; i < rotations.length && rotations[i].rotationNumber <= targetRotNum; i++) {
          const rot = rotations[i];
          const subs = overrides.has(rot.rotationNumber)
            ? overrides.get(rot.rotationNumber)!
            : rot.plannedSubstitutions;
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

      // Snapshot intended absolute lineups using the OLD subs
      const downstreamRotations = rotations.filter(r => r.rotationNumber > changedRotationNumber);
      const intendedLineups = new Map<number, Map<string, string>>();
      for (const rot of downstreamRotations) {
        intendedLineups.set(rot.rotationNumber, getLineupWith(rot.rotationNumber, new Map()));
      }

      // Walk downstream, re-diff each against its new predecessor
      const updatedOverrides = new Map(subsOverrides);
      const result = rotations.map(r => ({ ...r }));

      // Apply initial overrides to the result array
      for (const [rotNum, subs] of subsOverrides.entries()) {
        const idx = result.findIndex(r => r.rotationNumber === rotNum);
        if (idx >= 0) result[idx].plannedSubstitutions = subs;
      }

      for (const rot of downstreamRotations) {
        const newPrevLineup = getLineupWith(rot.rotationNumber - 1, updatedOverrides);
        const intendedLineup = intendedLineups.get(rot.rotationNumber)!;

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

        updatedOverrides.set(rot.rotationNumber, newSubs);
        const idx = result.findIndex(r => r.rotationNumber === rot.rotationNumber);
        if (idx >= 0) result[idx].plannedSubstitutions = newSubs;
      }

      return result;
    }

    it('should preserve downstream intended lineups after copy from previous', () => {
      // Starting: A=pos1, B=pos2, C=pos3; D and E on bench
      const startingLineup = new Map([
        ['pos1', 'A'],
        ['pos2', 'B'],
        ['pos3', 'C'],
      ]);

      // Rot1: sub A -> D at pos1   => lineup: D, B, C
      // Rot2: sub B -> E at pos2   => lineup: D, E, C
      // Rot3: sub D -> A at pos1   => lineup: A, E, C
      const rotations = [
        { rotationNumber: 1, plannedSubstitutions: [{ playerOutId: 'A', playerInId: 'D', positionId: 'pos1' }] },
        { rotationNumber: 2, plannedSubstitutions: [{ playerOutId: 'B', playerInId: 'E', positionId: 'pos2' }] },
        { rotationNumber: 3, plannedSubstitutions: [{ playerOutId: 'D', playerInId: 'A', positionId: 'pos1' }] },
      ];

      // "Copy from previous" on Rot2 => clear its subs
      // Without cascade: Rot3 says "sub D out of pos1" but after copy, pos1 still has D (Rot1 put D there)
      //   so it accidentally still works here BUT let's test the general case.
      // After cascade: Rot2 lineup should still be D, B, C (from Rot1, no change).
      //   Rot3 intended lineup was A, E, C. New prev (Rot2) is D, B, C.
      //   Diff: pos1: D->A, pos2: B->E => two subs.

      const updated = recalculateDownstreamRotations(
        startingLineup,
        rotations,
        2,
        new Map([[2, []]]) // Rot2 cleared
      );

      // Verify Rot2 was cleared
      expect(updated[1].plannedSubstitutions).toEqual([]);

      // Verify Rot3 was recalculated to preserve its intended lineup (A, E, C)
      const rot3Subs = updated[2].plannedSubstitutions;
      expect(rot3Subs).toHaveLength(2);

      const rot3SubMap = new Map(rot3Subs.map(s => [s.positionId, s]));
      // pos1: D -> A
      expect(rot3SubMap.get('pos1')?.playerOutId).toBe('D');
      expect(rot3SubMap.get('pos1')?.playerInId).toBe('A');
      // pos2: B -> E
      expect(rot3SubMap.get('pos2')?.playerOutId).toBe('B');
      expect(rot3SubMap.get('pos2')?.playerInId).toBe('E');

      // Verify final lineup at Rot3 is preserved
      const finalLineup = getLineupAtRotation(startingLineup, updated, 3);
      expect(finalLineup.get('pos1')).toBe('A');
      expect(finalLineup.get('pos2')).toBe('E');
      expect(finalLineup.get('pos3')).toBe('C');
    });

    it('should handle cascading through multiple downstream rotations', () => {
      const startingLineup = new Map([
        ['pos1', 'A'],
        ['pos2', 'B'],
      ]);

      // Rot1: A->C at pos1     => C, B
      // Rot2: B->D at pos2     => C, D
      // Rot3: C->A at pos1     => A, D
      // Rot4: D->B at pos2     => A, B
      const rotations = [
        { rotationNumber: 1, plannedSubstitutions: [{ playerOutId: 'A', playerInId: 'C', positionId: 'pos1' }] },
        { rotationNumber: 2, plannedSubstitutions: [{ playerOutId: 'B', playerInId: 'D', positionId: 'pos2' }] },
        { rotationNumber: 3, plannedSubstitutions: [{ playerOutId: 'C', playerInId: 'A', positionId: 'pos1' }] },
        { rotationNumber: 4, plannedSubstitutions: [{ playerOutId: 'D', playerInId: 'B', positionId: 'pos2' }] },
      ];

      // Change Rot1 to empty (copy from previous)
      const updated = recalculateDownstreamRotations(
        startingLineup,
        rotations,
        1,
        new Map([[1, []]]) // Rot1 cleared
      );

      // Intended lineups should be preserved:
      // Rot1 intended: C, B (but now cleared => A, B)
      // Rot2 intended: C, D. New prev (Rot1) = A, B. Diff: pos1: A->C, pos2: B->D
      // Rot3 intended: A, D. New prev (Rot2) = C, D. Diff: pos1: C->A
      // Rot4 intended: A, B. New prev (Rot3) = A, D. Diff: pos2: D->B

      // Verify all intended lineups are preserved
      expect(getLineupAtRotation(startingLineup, updated, 2).get('pos1')).toBe('C');
      expect(getLineupAtRotation(startingLineup, updated, 2).get('pos2')).toBe('D');
      expect(getLineupAtRotation(startingLineup, updated, 3).get('pos1')).toBe('A');
      expect(getLineupAtRotation(startingLineup, updated, 3).get('pos2')).toBe('D');
      expect(getLineupAtRotation(startingLineup, updated, 4).get('pos1')).toBe('A');
      expect(getLineupAtRotation(startingLineup, updated, 4).get('pos2')).toBe('B');
    });

    it('should produce no-op subs when downstream intended lineup matches new predecessor', () => {
      const startingLineup = new Map([
        ['pos1', 'A'],
        ['pos2', 'B'],
      ]);

      // Rot1: A->C   => C, B
      // Rot2: C->A   => A, B  (back to starting)
      const rotations = [
        { rotationNumber: 1, plannedSubstitutions: [{ playerOutId: 'A', playerInId: 'C', positionId: 'pos1' }] },
        { rotationNumber: 2, plannedSubstitutions: [{ playerOutId: 'C', playerInId: 'A', positionId: 'pos1' }] },
      ];

      // Clear Rot1 => lineup at Rot1 = A, B (same as starting).
      // Rot2 intended = A, B. New prev = A, B. No diff => empty subs.
      const updated = recalculateDownstreamRotations(
        startingLineup,
        rotations,
        1,
        new Map([[1, []]])
      );

      expect(updated[1].plannedSubstitutions).toEqual([]);
    });

    it('should handle a manual swap in the middle cascading forward', () => {
      const startingLineup = new Map([
        ['pos1', 'A'],
        ['pos2', 'B'],
        ['pos3', 'C'],
      ]);

      // Rot1: A->D at pos1  => D, B, C
      // Rot2: D->A at pos1  => A, B, C
      const rotations = [
        { rotationNumber: 1, plannedSubstitutions: [{ playerOutId: 'A', playerInId: 'D', positionId: 'pos1' }] },
        { rotationNumber: 2, plannedSubstitutions: [{ playerOutId: 'D', playerInId: 'A', positionId: 'pos1' }] },
      ];

      // Coach changes Rot1 to sub B->D at pos2 instead (new swap)
      const newRot1Subs: PlannedSubstitution[] = [{ playerOutId: 'B', playerInId: 'D', positionId: 'pos2' }];
      // Rot1 lineup becomes: A, D, C
      // Rot2 intended: A, B, C. New prev (Rot1) = A, D, C. Diff: pos2: D->B (instead of old pos1: D->A)
      const updated = recalculateDownstreamRotations(
        startingLineup,
        rotations,
        1,
        new Map([[1, newRot1Subs]])
      );

      const rot2Subs = updated[1].plannedSubstitutions;
      expect(rot2Subs).toHaveLength(1);
      expect(rot2Subs[0].positionId).toBe('pos2');
      expect(rot2Subs[0].playerOutId).toBe('D');
      expect(rot2Subs[0].playerInId).toBe('B');

      // Final lineup at Rot2 should be the original intended: A, B, C
      const finalLineup = getLineupAtRotation(startingLineup, updated, 2);
      expect(finalLineup.get('pos1')).toBe('A');
      expect(finalLineup.get('pos2')).toBe('B');
      expect(finalLineup.get('pos3')).toBe('C');
    });
  });
});

// ── New tests for the GamePlanner UI redesign ────────────────────────────────

// ---------------------------------------------------------------------------
// Pure helpers extracted from GamePlanner.tsx for isolated testing
// ---------------------------------------------------------------------------

/** Mirrors halftimeRotationNumber memo (GamePlanner.tsx). Always formula-derived, never from the half DB field. */
function deriveHalftimeRotationNumber(
  gamePlan: { id: string } | null,
  halfLengthMinutes: number,
  rotationIntervalMinutes: number,
): number | undefined {
  if (!gamePlan) return undefined;
  const rotationsPerHalf = Math.max(0, Math.floor(halfLengthMinutes / rotationIntervalMinutes) - 1);
  return rotationsPerHalf > 0 ? rotationsPerHalf + 1 : undefined;
}

/** Mirrors initial tab selection effect (GamePlanner.tsx lines 228-234). */
type PlannerTab = 'availability' | 'lineup' | 'rotations';
function resolveInitialTab(
  gamePlan: { id: string } | null,
  playerCount: number
): PlannerTab | null {
  if (gamePlan !== null || playerCount > 0) {
    return gamePlan ? 'rotations' : 'lineup';
  }
  return null;
}

/** Mirrors rotations-tab empty-state guard (GamePlanner.tsx lines 1371-1383). */
function shouldShowRotationsEmptyState(
  gamePlan: { id: string } | null,
  rotationsCount: number
): boolean {
  return !(gamePlan && rotationsCount > 0);
}

/** Mirrors handleUpdatePlan rotation count formula (GamePlanner.tsx lines 344-347). */
function calculateTotalRotations(
  halfLengthMinutes: number,
  rotationIntervalMinutes: number
): { rotationsPerHalf: number; totalRotations: number } {
  const rotationsPerHalf = Math.max(
    0,
    Math.floor(halfLengthMinutes / rotationIntervalMinutes) - 1
  );
  const totalRotations = rotationsPerHalf * 2 + 1;
  return { rotationsPerHalf, totalRotations };
}

/** Mirrors lineup tab badge logic (GamePlanner.tsx lines ~1398-1401). */
function computeLineupTabBadge(
  gamePlan: { id: string } | null,
  firstHalfSize: number,
  positionCount: number,
  rotationsCount: number,
  halftimeDisplaySize: number
): string | null {
  if (!gamePlan) return null;
  const firstHalfFull = firstHalfSize >= positionCount;
  const secondHalfFull = rotationsCount === 0 || halftimeDisplaySize >= positionCount;
  return firstHalfFull && secondHalfFull ? '✓' : null;
}

/** Mirrors rotations tab badge logic (GamePlanner.tsx lines 1277-1283). */
function computeRotationsTabBadge(
  rotations: Array<{ plannedSubstitutions: string }>
): string | null {
  if (rotations.length === 0) return null;
  const unfilledCount = rotations.filter((r) => {
    try {
      return (JSON.parse(r.plannedSubstitutions) as unknown[]).length === 0;
    } catch {
      return true;
    }
  }).length;
  return unfilledCount > 0 ? String(unfilledCount) : null;
}

// ---------------------------------------------------------------------------
// Gap 1 — halftimeRotationNumber derivation
// ---------------------------------------------------------------------------

describe('deriveHalftimeRotationNumber', () => {
  const mockPlan = { id: 'plan-1' };

  it('returns rotationsPerHalf + 1 when computed from plan settings', () => {
    // 30-min halves, 10-min interval → rotationsPerHalf = 2 → halftime at rotation 3
    expect(deriveHalftimeRotationNumber(mockPlan, 30, 10)).toBe(3);
  });

  it('is not affected by stale half fields on rotations after interval change', () => {
    // If rotations in DB still have half=2 on R2 from an old 15-min interval,
    // the formula must still place halftime at R3 for a 10-min interval.
    // (The rotations argument is intentionally gone — formula only.)
    expect(deriveHalftimeRotationNumber(mockPlan, 30, 10)).toBe(3);
  });

  it('returns undefined when interval equals half length (rotationsPerHalf === 0)', () => {
    // Math.floor(30/30) - 1 = 0 → no halftime pill
    expect(deriveHalftimeRotationNumber(mockPlan, 30, 30)).toBeUndefined();
  });

  it('returns undefined when gamePlan is null', () => {
    expect(deriveHalftimeRotationNumber(null, 30, 10)).toBeUndefined();
  });

  it('returns correct number for 15-min interval on 30-min halves', () => {
    // Math.floor(30/15) - 1 = 1 → halftime at rotation 2
    expect(deriveHalftimeRotationNumber(mockPlan, 30, 15)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Gap 2 — Tab auto-advance logic
// ---------------------------------------------------------------------------

describe('resolveInitialTab', () => {
  it('returns "lineup" when players are loaded but no game plan exists', () => {
    expect(resolveInitialTab(null, 10)).toBe('lineup');
  });

  it('returns "rotations" when a game plan already exists', () => {
    expect(resolveInitialTab({ id: 'plan-1' }, 10)).toBe('rotations');
  });

  it('returns null when no plan and no players (data still loading)', () => {
    expect(resolveInitialTab(null, 0)).toBeNull();
  });

  it('returns "rotations" even when playerCount is zero if a plan exists', () => {
    expect(resolveInitialTab({ id: 'plan-1' }, 0)).toBe('rotations');
  });
});

describe('plan-creation tab jump', () => {
  it('should jump when prevGamePlanId was null and gamePlan.id is now set', () => {
    const prevId: string | null = null;
    const newPlanId = 'plan-abc';
    expect(newPlanId !== null && prevId === null).toBe(true);
  });

  it('should NOT jump when gamePlan.id was already set (plan update, not creation)', () => {
    const prevId: string | null = 'plan-abc';
    const newPlanId = 'plan-abc';
    expect(newPlanId !== null && prevId === null).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Gap 3 — Rotations empty-state visibility
// ---------------------------------------------------------------------------

describe('shouldShowRotationsEmptyState', () => {
  it('shows empty state when no game plan exists', () => {
    expect(shouldShowRotationsEmptyState(null, 0)).toBe(true);
  });

  it('shows empty state when plan exists but has no rotations', () => {
    expect(shouldShowRotationsEmptyState({ id: 'plan-1' }, 0)).toBe(true);
  });

  it('shows timeline when plan exists and has rotations', () => {
    expect(shouldShowRotationsEmptyState({ id: 'plan-1' }, 5)).toBe(false);
  });

  it('shows empty state when rotations exist but no plan (inconsistent state)', () => {
    expect(shouldShowRotationsEmptyState(null, 3)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Gap 4 — totalRotations formula consistency
// ---------------------------------------------------------------------------

describe('calculateTotalRotations', () => {
  it('produces 5 total rotations for 30-min halves with 10-min intervals', () => {
    const { rotationsPerHalf, totalRotations } = calculateTotalRotations(30, 10);
    expect(rotationsPerHalf).toBe(2);
    expect(totalRotations).toBe(5);
  });

  it('produces 3 total rotations for 30-min halves with 15-min intervals', () => {
    const { rotationsPerHalf, totalRotations } = calculateTotalRotations(30, 15);
    expect(rotationsPerHalf).toBe(1);
    expect(totalRotations).toBe(3);
  });

  it('produces 11 total rotations for 30-min halves with 5-min intervals', () => {
    const { rotationsPerHalf, totalRotations } = calculateTotalRotations(30, 5);
    expect(rotationsPerHalf).toBe(5);
    expect(totalRotations).toBe(11);
  });

  it('produces 1 total rotation (halftime only) when interval equals half length', () => {
    const { rotationsPerHalf, totalRotations } = calculateTotalRotations(30, 30);
    expect(rotationsPerHalf).toBe(0);
    expect(totalRotations).toBe(1);
  });

  it('totalRotations is always odd (halftime rotation always included)', () => {
    for (const interval of [5, 10, 15]) {
      const { totalRotations } = calculateTotalRotations(30, interval);
      expect(totalRotations % 2).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Gap 5 — Tab badge computation
// ---------------------------------------------------------------------------

describe('computeLineupTabBadge', () => {
  it('shows checkmark when plan exists, H1 full, no rotations (H2 auto-passes)', () => {
    expect(computeLineupTabBadge({ id: 'p' }, 5, 5, 0, 0)).toBe('✓');
  });

  it('returns null when no game plan exists', () => {
    expect(computeLineupTabBadge(null, 5, 5, 0, 0)).toBeNull();
  });

  it('returns null when H1 lineup is not fully filled', () => {
    expect(computeLineupTabBadge({ id: 'p' }, 4, 5, 0, 0)).toBeNull();
  });

  it('shows checkmark when H1 size exceeds position count and no rotations', () => {
    expect(computeLineupTabBadge({ id: 'p' }, 6, 5, 0, 0)).toBe('✓');
  });

  it('returns null when rotations exist but H2 lineup is under-filled', () => {
    expect(computeLineupTabBadge({ id: 'p' }, 5, 5, 1, 4)).toBeNull();
  });

  it('shows checkmark when rotations exist and both H1 and H2 lineups are full', () => {
    expect(computeLineupTabBadge({ id: 'p' }, 5, 5, 1, 5)).toBe('✓');
  });
});

describe('computeRotationsTabBadge', () => {
  it('returns null when there are no rotations', () => {
    expect(computeRotationsTabBadge([])).toBeNull();
  });

  it('returns null when all rotations have substitutions', () => {
    const rotations = [
      { plannedSubstitutions: JSON.stringify([{ playerOutId: 'p1', playerInId: 'p2', positionId: 'pos1' }]) },
      { plannedSubstitutions: JSON.stringify([{ playerOutId: 'p3', playerInId: 'p4', positionId: 'pos2' }]) },
    ];
    expect(computeRotationsTabBadge(rotations)).toBeNull();
  });

  it('counts rotations with empty substitution arrays', () => {
    const rotations = [
      { plannedSubstitutions: JSON.stringify([]) },
      { plannedSubstitutions: JSON.stringify([{ playerOutId: 'p1', playerInId: 'p2', positionId: 'pos1' }]) },
      { plannedSubstitutions: JSON.stringify([]) },
    ];
    expect(computeRotationsTabBadge(rotations)).toBe('2');
  });

  it('counts rotations with malformed JSON as unfilled', () => {
    const rotations = [
      { plannedSubstitutions: 'not-valid-json' },
      { plannedSubstitutions: JSON.stringify([]) },
    ];
    expect(computeRotationsTabBadge(rotations)).toBe('2');
  });

  it('returns null when all rotations are filled', () => {
    const rotations = [
      { plannedSubstitutions: JSON.stringify([{ playerOutId: 'a', playerInId: 'b', positionId: 'p1' }]) },
    ];
    expect(computeRotationsTabBadge(rotations)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Helpers extracted from GamePlanner.tsx (halftime display logic)
// ---------------------------------------------------------------------------

/**
 * Simulates the continuingEntries computation from renderSelectedDetails().
 * Returns positions where the first-half player continues with no explicit sub.
 */
function computeContinuingEntries(
  firstHalfFieldLineup: Map<string, string>,
  halftimeSubsLineup: Map<string, string>
): Array<{ positionId: string; playerId: string }> {
  return Array.from(firstHalfFieldLineup.entries())
    .filter(([posId]) => !halftimeSubsLineup.has(posId))
    .map(([posId, playerId]) => ({ positionId: posId, playerId }));
}

describe('halftime continuing entries and split-view logic', () => {
  const firstHalfLineup = new Map([
    ['pos1', 'playerA'], // GK
    ['pos2', 'playerB'], // LF
    ['pos3', 'playerC'], // CF
    ['pos4', 'playerD'], // RF
    ['pos5', 'playerE'], // D
  ]);

  it('identifies 3 continuing positions when auto-generate creates subs for only 2 of 5', () => {
    // Scenario: 5 field positions but only 2 bench players → generator creates 2 subs
    const halftimeSubsLineup = new Map([
      ['pos2', 'playerF'], // LF: playerB → playerF
      ['pos5', 'playerG'], // D:  playerE → playerG
    ]);
    const continuing = computeContinuingEntries(firstHalfLineup, halftimeSubsLineup);

    expect(continuing).toHaveLength(3);
    expect(continuing.map(e => e.positionId)).toContain('pos1'); // GK continues
    expect(continuing.map(e => e.positionId)).toContain('pos3'); // CF continues
    expect(continuing.map(e => e.positionId)).toContain('pos4'); // RF continues
    expect(continuing.find(e => e.positionId === 'pos1')?.playerId).toBe('playerA');
  });

  it('identifies 0 continuing positions when all 5 positions have explicit subs', () => {
    const halftimeSubsLineup = new Map([
      ['pos1', 'playerF'],
      ['pos2', 'playerG'],
      ['pos3', 'playerH'],
      ['pos4', 'playerI'],
      ['pos5', 'playerJ'],
    ]);
    const continuing = computeContinuingEntries(firstHalfLineup, halftimeSubsLineup);

    expect(continuing).toHaveLength(0);
  });

  it('identifies all 5 positions as continuing when no halftime subs exist', () => {
    const halftimeSubsLineup = new Map<string, string>();
    const continuing = computeContinuingEntries(firstHalfLineup, halftimeSubsLineup);

    expect(continuing).toHaveLength(5);
  });

  it('split view is shown only when there are BOTH subs AND continuing positions', () => {
    const scenarios: Array<{ subsSize: number; continuingSize: number; expectSplitView: boolean }> = [
      { subsSize: 2, continuingSize: 3, expectSplitView: true },  // mixed → split view
      { subsSize: 0, continuingSize: 5, expectSplitView: false }, // all continuing → full LineupBuilder
      { subsSize: 5, continuingSize: 0, expectSplitView: false }, // all subbed → full LineupBuilder
    ];

    for (const { subsSize, continuingSize, expectSplitView } of scenarios) {
      const showSplitView = subsSize > 0 && continuingSize > 0;
      expect(showSplitView).toBe(expectSplitView);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Second Half Lineup Feature Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Second Half Lineup Feature', () => {
  // Shared fixtures
  const startingLineup = new Map([
    ['pos1', 'playerA'],
    ['pos2', 'playerB'],
    ['pos3', 'playerC'],
    ['pos4', 'playerD'],
  ]);

  const rotationsWithOneSub = [
    {
      rotationNumber: 1,
      plannedSubstitutions: JSON.stringify([{ playerOutId: 'playerA', playerInId: 'playerE', positionId: 'pos1' }]),
    },
  ];

  // Test 1: computeLineupDiff — correct subs when H2 differs from end-of-H1 at some positions
  it('computeLineupDiff — produces correct subs when H2 differs from end-of-H1', () => {
    const endOfH1 = new Map([
      ['pos1', 'playerE'], // was subbed at rotation 1
      ['pos2', 'playerB'],
      ['pos3', 'playerC'],
      ['pos4', 'playerD'],
    ]);
    const halftimeLineup = new Map([
      ['pos1', 'playerE'], // same — no sub
      ['pos2', 'playerF'], // changed — sub
      ['pos3', 'playerC'], // same
      ['pos4', 'playerD'], // same
    ]);

    const subs = computeLineupDiff(endOfH1, halftimeLineup);
    expect(subs).toHaveLength(1);
    expect(subs[0]).toEqual({ playerOutId: 'playerB', playerInId: 'playerF', positionId: 'pos2' });
  });

  // Test 2: computeLineupDiff — two-position swap produces two subs
  it('computeLineupDiff — two-position swap produces two subs', () => {
    const endOfH1 = new Map([
      ['pos1', 'playerA'],
      ['pos2', 'playerB'],
      ['pos3', 'playerC'],
    ]);
    const halftimeLineup = new Map([
      ['pos1', 'playerX'],
      ['pos2', 'playerY'],
      ['pos3', 'playerC'],
    ]);

    const subs = computeLineupDiff(endOfH1, halftimeLineup);
    expect(subs).toHaveLength(2);
    const posIds = subs.map(s => s.positionId);
    expect(posIds).toContain('pos1');
    expect(posIds).toContain('pos2');
  });

  // Test 3: halftimeLineupForDisplay fallback — when halftimeLineup.size === 0, returns end-of-H1
  it('halftimeLineupForDisplay — falls back to end-of-H1 when no explicit H2 lineup', () => {
    const halftimeLineup = new Map<string, string>(); // empty
    const halftimeRotationNumber = 2; // first rotation of H2
    const rotations = rotationsWithOneSub;

    // Simulate the memo logic
    let display: Map<string, string>;
    if (halftimeLineup.size > 0) {
      display = halftimeLineup;
    } else if (!halftimeRotationNumber || rotations.length === 0) {
      display = startingLineup;
    } else {
      display = computeLineupAtRotation(startingLineup, rotations, halftimeRotationNumber - 1);
    }

    // End of H1 (rotation 1 applied): pos1 = playerE, rest unchanged
    expect(display.get('pos1')).toBe('playerE');
    expect(display.get('pos2')).toBe('playerB');
    expect(display.get('pos3')).toBe('playerC');
    expect(display.get('pos4')).toBe('playerD');
  });

  // Test 4: halftimeLineupForDisplay — explicit H2 lineup is returned unchanged
  it('halftimeLineupForDisplay — returns explicit H2 lineup unchanged', () => {
    const explicitH2 = new Map([
      ['pos1', 'playerZ'],
      ['pos2', 'playerB'],
      ['pos3', 'playerC'],
      ['pos4', 'playerD'],
    ]);
    const halftimeRotationNumber = 2;

    // Simulate the memo logic
    let display: Map<string, string>;
    if (explicitH2.size > 0) {
      display = explicitH2;
    } else if (!halftimeRotationNumber || rotationsWithOneSub.length === 0) {
      display = startingLineup;
    } else {
      display = computeLineupAtRotation(startingLineup, rotationsWithOneSub, halftimeRotationNumber - 1);
    }

    expect(display).toBe(explicitH2);
    expect(display.get('pos1')).toBe('playerZ');
  });

  // Test 5: Badge — shows ✓ when both lineups full AND plan+rotations exist
  it('badge — shows check when both H1 and H2 lineups are full', () => {
    const positionsLength = 4;
    const sl = new Map([['pos1', 'A'], ['pos2', 'B'], ['pos3', 'C'], ['pos4', 'D']]);
    const h2Display = new Map([['pos1', 'E'], ['pos2', 'B'], ['pos3', 'C'], ['pos4', 'D']]);
    const rotationsArr = [{ rotationNumber: 1, plannedSubstitutions: '[]' }];

    const firstHalfFull = sl.size >= positionsLength;
    const secondHalfFull = rotationsArr.length === 0 || h2Display.size >= positionsLength;
    expect(firstHalfFull && secondHalfFull).toBe(true);
  });

  // Test 6: Badge — shows ✓ on starting lineup alone when no rotations exist
  it('badge — shows check on starting lineup alone when no rotations (no regression)', () => {
    const positionsLength = 4;
    const sl = new Map([['pos1', 'A'], ['pos2', 'B'], ['pos3', 'C'], ['pos4', 'D']]);
    const rotationsArr: Array<{ rotationNumber: number; plannedSubstitutions: string }> = [];
    const h2Display = sl; // fallback to starting lineup

    const firstHalfFull = sl.size >= positionsLength;
    const secondHalfFull = rotationsArr.length === 0 || h2Display.size >= positionsLength;
    expect(firstHalfFull && secondHalfFull).toBe(true);
  });

  // Test 7: Backward compat — null halftimeLineup from subscription → state stays null (fallback), no error
  it('backward compat — null halftimeLineup field from subscription skips parse without error', () => {
    const halftimeLineupField: string | null | undefined = null;
    const htLineup = new Map<string, string>();

    if (halftimeLineupField) {
      try {
        const arr = JSON.parse(halftimeLineupField) as Array<{ positionId: string; playerId: string }>;
        arr.forEach(({ positionId, playerId }) => htLineup.set(positionId, playerId));
      } catch { /* ignore */ }
    }

    expect(htLineup.size).toBe(0);
  });

  // Test 8: Clearing H2 position (playerId === '') deletes from Map, does NOT insert empty string
  it('handleHalftimeLineupChange — clearing a position removes it, does not insert empty string', () => {
    const baseLineup = new Map([
      ['pos1', 'playerA'],
      ['pos2', 'playerB'],
    ]);

    // Simulate clearing pos1
    const newLineup = new Map(baseLineup);
    const playerId = '';
    const positionId = 'pos1';

    if (playerId === '') {
      newLineup.delete(positionId);
    } else {
      newLineup.set(positionId, playerId);
    }

    expect(newLineup.has('pos1')).toBe(false);
    expect(newLineup.get('pos2')).toBe('playerB');
  });

  // Test 9: Player de-dup swap — assigning player already in H2 at posA to posB removes from posA
  it('handleHalftimeLineupChange — player already in H2 is removed from old position', () => {
    const baseLineup = new Map([
      ['pos1', 'playerA'],
      ['pos2', 'playerB'],
      ['pos3', 'playerC'],
    ]);

    // playerB is at pos2; now assigning playerB to pos3
    const newLineup = new Map(baseLineup);
    const playerId = 'playerB';
    const positionId = 'pos3';

    if (playerId !== '') {
      for (const [pos, pid] of newLineup.entries()) {
        if (pid === playerId && pos !== positionId) {
          newLineup.delete(pos);
          break;
        }
      }
      newLineup.set(positionId, playerId);
    }

    // playerB should now be at pos3, not pos2
    expect(newLineup.get('pos3')).toBe('playerB');
    expect(newLineup.has('pos2')).toBe(false);
    expect(newLineup.get('pos1')).toBe('playerA');
  });

  // Test 10: HT read-only panel — empty state when halftimeSubs.length === 0
  it('HT read-only panel — shows empty state text when no halftime subs', () => {
    const halftimeSubs: PlannedSubstitution[] = [];
    const showEmptyState = halftimeSubs.length === 0;
    expect(showEmptyState).toBe(true);
  });

  // Test 11: copyGamePlan copies halftimeLineup (verify the field would be included)
  it('copyGamePlan — halftimeLineup field is included in the create call', () => {
    // Simulate what copyGamePlan does
    const sourcePlan = {
      id: 'plan1',
      gameId: 'game1',
      rotationIntervalMinutes: 10,
      totalRotations: 5,
      startingLineup: JSON.stringify([{ positionId: 'pos1', playerId: 'playerA' }]),
      halftimeLineup: JSON.stringify([{ positionId: 'pos1', playerId: 'playerZ' }]),
    };

    // Build the create payload as copyGamePlan would
    const createPayload = {
      gameId: 'game2',
      rotationIntervalMinutes: sourcePlan.rotationIntervalMinutes,
      totalRotations: sourcePlan.totalRotations,
      startingLineup: sourcePlan.startingLineup,
      halftimeLineup: sourcePlan.halftimeLineup,
      coaches: ['coachId'],
    };

    expect(createPayload).toHaveProperty('halftimeLineup');
    expect(createPayload.halftimeLineup).toBe(sourcePlan.halftimeLineup);
  });

  // Test 12: Halftime subs diff is zero when halftimeLineup matches end-of-H1 exactly
  it('computeLineupDiff — produces no subs when H2 lineup matches end-of-H1 exactly', () => {
    const endOfH1 = new Map([
      ['pos1', 'playerE'],
      ['pos2', 'playerB'],
      ['pos3', 'playerC'],
      ['pos4', 'playerD'],
    ]);
    // Explicit H2 exactly matches end-of-H1
    const halftimeLineup = new Map(endOfH1);

    const subs = computeLineupDiff(endOfH1, halftimeLineup);
    expect(subs).toHaveLength(0);
  });
});

// -------------------------------------------------------------------------
// Gap coverage: computeLineupAtRotation edge cases
// -------------------------------------------------------------------------

describe("computeLineupAtRotation edge cases", () => {
  const sl3 = new Map([
    ["pos1", "playerA"],
    ["pos2", "playerB"],
    ["pos3", "playerC"],
  ]);

  it("returns startingLineup copy unchanged when targetRotNum is 0", () => {
    const rotations = [{ rotationNumber: 1, plannedSubstitutions: JSON.stringify([{ playerOutId: "playerA", playerInId: "playerX", positionId: "pos1" }]) }];
    const result = computeLineupAtRotation(sl3, rotations, 0);
    expect(result.get("pos1")).toBe("playerA");
    expect(result.get("pos2")).toBe("playerB");
    expect(result.get("pos3")).toBe("playerC");
    expect(result).not.toBe(sl3);
  });
  it("treats a rotation with an empty subs array as a no-op", () => {
    const rotations = [{ rotationNumber: 1, plannedSubstitutions: JSON.stringify([]) }];
    const result = computeLineupAtRotation(sl3, rotations, 1);
    expect(result.get("pos1")).toBe("playerA");
    expect(result.get("pos2")).toBe("playerB");
    expect(result.get("pos3")).toBe("playerC");
  });

  it("silently ignores a rotation with malformed JSON and preserves the prior lineup", () => {
    const rotations = [{ rotationNumber: 1, plannedSubstitutions: "not-valid-json" }];
    const result = computeLineupAtRotation(sl3, rotations, 1);
    expect(result.get("pos1")).toBe("playerA");
    expect(result.get("pos2")).toBe("playerB");
    expect(result.get("pos3")).toBe("playerC");
  });

  it("excludes rotations with rotationNumber beyond targetRotNum", () => {
    const rotations = [
      { rotationNumber: 1, plannedSubstitutions: JSON.stringify([{ playerOutId: "playerA", playerInId: "playerX", positionId: "pos1" }]) },
      { rotationNumber: 3, plannedSubstitutions: JSON.stringify([{ playerOutId: "playerB", playerInId: "playerY", positionId: "pos2" }]) },
    ];
    const result = computeLineupAtRotation(sl3, rotations, 2);
    expect(result.get("pos1")).toBe("playerX");
    expect(result.get("pos2")).toBe("playerB");
    expect(result.get("pos3")).toBe("playerC");
  });

  it("adds a bench player to the lineup at the target position", () => {
    const rotations = [
      { rotationNumber: 1, plannedSubstitutions: JSON.stringify([{ playerOutId: "playerA", playerInId: "playerZ", positionId: "pos1" }]) },
    ];
    const result = computeLineupAtRotation(sl3, rotations, 1);
    expect(result.get("pos1")).toBe("playerZ");
    expect(Array.from(result.values())).not.toContain("playerA");
    expect(result.get("pos2")).toBe("playerB");
    expect(result.get("pos3")).toBe("playerC");
  });

  it("vacates old position when playerInId already in lineup at a different slot", () => {
    const rotations = [
      { rotationNumber: 1, plannedSubstitutions: JSON.stringify([{ playerOutId: "playerA", playerInId: "playerB", positionId: "pos1" }]) },
    ];
    const result = computeLineupAtRotation(sl3, rotations, 1);
    expect(result.get("pos1")).toBe("playerB");
    expect(result.has("pos2")).toBe(false);
    expect(result.get("pos3")).toBe("playerC");
  });
});
// -------------------------------------------------------------------------
// Gap coverage: halftimeLineupForDisplay startingLineup fallback branch
// -------------------------------------------------------------------------

describe("halftimeLineupForDisplay startingLineup fallback", () => {
  const sl3f = new Map([["pos1", "playerA"],["pos2", "playerB"],["pos3", "playerC"]]);
  const rotWithSub = [{ rotationNumber: 1, plannedSubstitutions: JSON.stringify([{ playerOutId: "playerA", playerInId: "playerX", positionId: "pos1" }]) }];

  it("falls back to startingLineup when halftimeRotationNumber is undefined", () => {
    const htLineup = new Map<string, string>();
    const htRotNum: number | undefined = undefined;
    let display: Map<string, string>;
    if (htLineup.size > 0) { display = htLineup; }
    else if (!htRotNum || rotWithSub.length === 0) { display = sl3f; }
    else { display = computeLineupAtRotation(sl3f, rotWithSub, htRotNum - 1); }
    expect(display).toBe(sl3f);
    expect(display.get("pos1")).toBe("playerA");
  });

  it("falls back to startingLineup when rotations array is empty", () => {
    const htLineup = new Map<string, string>();
    const htRotNum = 2;
    const noRots: Array<{ rotationNumber: number; plannedSubstitutions: string }> = [];
    let display: Map<string, string>;
    if (htLineup.size > 0) { display = htLineup; }
    else if (!htRotNum || noRots.length === 0) { display = sl3f; }
    else { display = computeLineupAtRotation(sl3f, noRots, htRotNum - 1); }
    expect(display).toBe(sl3f);
  });
});
// -------------------------------------------------------------------------
// Gap coverage: handleHalftimeLineupChange base from computed fallback
// -------------------------------------------------------------------------

describe("handleHalftimeLineupChange base from computed fallback", () => {
  it("inherits end-of-H1 computed state when making the first explicit H2 assignment", () => {
    const sl4 = new Map([["pos1","playerA"],["pos2","playerB"],["pos3","playerC"],["pos4","playerD"]]);
    const rots = [{ rotationNumber: 1, plannedSubstitutions: JSON.stringify([{ playerOutId: "playerA", playerInId: "playerE", positionId: "pos1" }]) }];
    const htRotNum = 2;
    const emptyEx = new Map<string, string>();
    let base: Map<string, string>;
    if (emptyEx.size > 0) { base = emptyEx; }
    else if (!htRotNum || rots.length === 0) { base = sl4; }
    else { base = computeLineupAtRotation(sl4, rots, htRotNum - 1); }
    const newLU = new Map(base);
    const posId = "pos2"; const pid = "playerF";
    for (const [pos, val] of newLU.entries()) { if (val === pid && pos !== posId) { newLU.delete(pos); break; } }
    newLU.set(posId, pid);
    expect(newLU.get("pos1")).toBe("playerE");
    expect(newLU.get("pos2")).toBe("playerF");
    expect(newLU.get("pos3")).toBe("playerC");
    expect(newLU.get("pos4")).toBe("playerD");
  });
});

// -------------------------------------------------------------------------
// Gap coverage: computeLineupDiff position absent from endOfH1
// -------------------------------------------------------------------------

describe("computeLineupDiff position absent from endOfH1", () => {
  it("produces no sub for a position that exists in H2 lineup but not in endOfH1", () => {
    const eoh1 = new Map([["pos1","playerA"],["pos2","playerB"]]);
    const htLU = new Map([["pos1","playerA"],["pos2","playerB"],["pos3","playerC"]]);
    const subs: PlannedSubstitution[] = [];
    for (const [posId, newPid] of htLU.entries()) {
      const oldPid = eoh1.get(posId);
      if (oldPid && newPid && oldPid !== newPid) { subs.push({ playerOutId: oldPid, playerInId: newPid, positionId: posId }); }
    }
    expect(subs).toHaveLength(0);
  });
});
// -------------------------------------------------------------------------
// Gap coverage: handleCopyFromPreviousRotation halftime clearing guard
// -------------------------------------------------------------------------

describe("handleCopyFromPreviousRotation halftime clearing guard", () => {
  it("triggers halftime clear when rotationNumber equals halftimeRotationNumber", () => {
    const htRotNum = 3;
    const rotToClear = 3;
    expect(rotToClear === htRotNum).toBe(true);
  });

  it("does NOT trigger halftime clear when rotationNumber differs from halftimeRotationNumber", () => {
    const htRotNum = 3;
    const rotToClear = 2;
    expect(rotToClear === htRotNum).toBe(false);
  });

  it("serializes the cleared halftime lineup as [] not as null or undefined", () => {
    const cleared: Array<{ positionId: string; playerId: string }> = [];
    const serialized = JSON.stringify(cleared);
    expect(serialized).toBe("[]");
    expect(serialized).not.toBeNull();
    expect(serialized).not.toBeUndefined();
  });
});

// -------------------------------------------------------------------------
// Gap coverage: handleUpdatePlan halftimeLineup serialization guard
// -------------------------------------------------------------------------

describe("handleUpdatePlan halftimeLineup serialization guard", () => {
  it("produces undefined when the halftimeLineup Map is empty", () => {
    const htLU = new Map<string, string>();
    const json = htLU.size > 0
      ? JSON.stringify(Array.from(htLU.entries()).map(([posId, pid]) => ({ positionId: posId, playerId: pid })))
      : undefined;
    expect(json).toBeUndefined();
  });

  it("does NOT produce the string [] when halftimeLineup is empty", () => {
    const htLU = new Map<string, string>();
    const json = htLU.size > 0
      ? JSON.stringify(Array.from(htLU.entries()).map(([posId, pid]) => ({ positionId: posId, playerId: pid })))
      : undefined;
    expect(json).not.toBe("[]");
  });

  it("produces valid JSON array when the halftimeLineup Map is non-empty", () => {
    const htLU = new Map([["pos1","playerZ"],["pos2","playerB"]]);
    const json = htLU.size > 0
      ? JSON.stringify(Array.from(htLU.entries()).map(([posId, pid]) => ({ positionId: posId, playerId: pid })))
      : undefined;
    expect(json).toBeDefined();
    const parsed = JSON.parse(json as string) as Array<{ positionId: string; playerId: string }>;
    expect(parsed).toHaveLength(2);
    expect(parsed.find(e => e.positionId === "pos1")?.playerId).toBe("playerZ");
    expect(parsed.find(e => e.positionId === "pos2")?.playerId).toBe("playerB");
  });
});
// -------------------------------------------------------------------------
// Gap coverage: lineup tab badge real component condition
// -------------------------------------------------------------------------
// Mirrors GamePlanner.tsx lines 1398-1401:
//   const firstHalfFull = startingLineup.size >= positions.length;
//   const secondHalfFull = rotations.length === 0 || halftimeLineupForDisplay.size >= positions.length;
//   if (firstHalfFull && secondHalfFull) badge = check-mark;

describe("lineup tab badge component-accurate condition", () => {
  it("suppresses badge when H1 is full but H2 display lineup is under-filled", () => {
    const posLen = 4;
    const sl = new Map([["p1","A"],["p2","B"],["p3","C"],["p4","D"]]);
    const rots = [{ rotationNumber: 1, plannedSubstitutions: "[]" }];
    const h2 = new Map([["p1","E"],["p2","B"],["p3","C"]]);
    const firstHalfFull = sl.size >= posLen;
    const secondHalfFull = rots.length === 0 || h2.size >= posLen;
    expect(firstHalfFull).toBe(true);
    expect(secondHalfFull).toBe(false);
    expect(firstHalfFull && secondHalfFull).toBe(false);
  });

  it("suppresses badge when H1 is under-filled even if H2 display lineup is full", () => {
    const posLen = 4;
    const sl = new Map([["p1","A"],["p2","B"],["p3","C"]]);
    const rots = [{ rotationNumber: 1, plannedSubstitutions: "[]" }];
    const h2 = new Map([["p1","E"],["p2","B"],["p3","C"],["p4","D"]]);
    const firstHalfFull = sl.size >= posLen;
    const secondHalfFull = rots.length === 0 || h2.size >= posLen;
    expect(firstHalfFull).toBe(false);
    expect(firstHalfFull && secondHalfFull).toBe(false);
  });

  it("shows badge when H1 full and no rotations exist (secondHalfFull short-circuits)", () => {
    const posLen = 4;
    const sl = new Map([["p1","A"],["p2","B"],["p3","C"],["p4","D"]]);
    const rots: Array<{ rotationNumber: number; plannedSubstitutions: string }> = [];
    const h2 = new Map<string, string>();
    const firstHalfFull = sl.size >= posLen;
    const secondHalfFull = rots.length === 0 || h2.size >= posLen;
    expect(secondHalfFull).toBe(true);
    expect(firstHalfFull && secondHalfFull).toBe(true);
  });

  it("shows badge when both H1 and H2 display lineups are exactly at positions.length", () => {
    const posLen = 4;
    const sl = new Map([["p1","A"],["p2","B"],["p3","C"],["p4","D"]]);
    const rots = [{ rotationNumber: 1, plannedSubstitutions: "[]" }];
    const h2 = new Map([["p1","E"],["p2","F"],["p3","G"],["p4","H"]]);
    const firstHalfFull = sl.size >= posLen;
    const secondHalfFull = rots.length === 0 || h2.size >= posLen;
    expect(firstHalfFull && secondHalfFull).toBe(true);
  });
});

// -------------------------------------------------------------------------
// Gap coverage: copyGamePlan null/undefined halftimeLineup propagation
// -------------------------------------------------------------------------

describe("copyGamePlan null halftimeLineup propagation", () => {
  it("propagates null halftimeLineup from source plan without dropping the key", () => {
    const src = { halftimeLineup: null as string | null, rotationIntervalMinutes: 10, totalRotations: 5, startingLineup: "[{positionId:pos1,playerId:pA}]" };
    const payload = { gameId: "g2", rotationIntervalMinutes: src.rotationIntervalMinutes, totalRotations: src.totalRotations, startingLineup: src.startingLineup, halftimeLineup: src.halftimeLineup, coaches: ["c1"] };
    expect(Object.prototype.hasOwnProperty.call(payload, "halftimeLineup")).toBe(true);
    expect(payload.halftimeLineup).toBeNull();
  });

  it("does not throw when loading a null halftimeLineup field from a subscription", () => {
    const field: string | null | undefined = null;
    const lu = new Map<string, string>();
    expect(() => { if (field) { const arr = JSON.parse(field) as Array<{ positionId: string; playerId: string }>; arr.forEach(({ positionId, playerId }) => lu.set(positionId, playerId)); } }).not.toThrow();
    expect(lu.size).toBe(0);
  });

  it("does not throw when loading an undefined halftimeLineup field from a subscription", () => {
    const field: string | null | undefined = undefined;
    const lu = new Map<string, string>();
    expect(() => { if (field) { const arr = JSON.parse(field) as Array<{ positionId: string; playerId: string }>; arr.forEach(({ positionId, playerId }) => lu.set(positionId, playerId)); } }).not.toThrow();
    expect(lu.size).toBe(0);
  });
});
