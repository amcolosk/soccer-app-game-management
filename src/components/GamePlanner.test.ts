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

/** Mirrors halftimeRotationNumber memo (GamePlanner.tsx lines 265-269). */
function deriveHalftimeRotationNumber(
  gamePlan: { id: string } | null,
  halfLengthMinutes: number,
  rotationIntervalMinutes: number,
  rotations: Array<{ rotationNumber: number; half: number }>
): number | undefined {
  const rotationsPerHalf = gamePlan
    ? Math.floor(halfLengthMinutes / rotationIntervalMinutes) - 1
    : 0;
  return (
    rotations.find((r) => r.half === 2)?.rotationNumber ??
    (rotationsPerHalf > 0 ? rotationsPerHalf + 1 : undefined)
  );
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

/** Mirrors lineup tab badge logic (GamePlanner.tsx lines 1273-1276). */
function computeLineupTabBadge(
  gamePlan: { id: string } | null,
  lineupSize: number,
  positionCount: number
): string | null {
  if (gamePlan && lineupSize >= positionCount) return '✓';
  return null;
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

  it('returns rotationsPerHalf + 1 from fallback when no rotation tagged half === 2', () => {
    // 30-min halves, 10-min interval → rotationsPerHalf = 2 → halftime at rotation 3
    expect(deriveHalftimeRotationNumber(mockPlan, 30, 10, [])).toBe(3);
  });

  it('prefers explicit half === 2 rotation number over the calculated fallback', () => {
    const rotations = [
      { rotationNumber: 2, half: 1 },
      { rotationNumber: 3, half: 2 },
    ];
    expect(deriveHalftimeRotationNumber(mockPlan, 30, 10, rotations)).toBe(3);
  });

  it('returns undefined when interval equals half length (rotationsPerHalf === 0) and no tagged rotation', () => {
    // Math.floor(30/30) - 1 = 0 → no halftime pill
    expect(deriveHalftimeRotationNumber(mockPlan, 30, 30, [])).toBeUndefined();
  });

  it('returns undefined when gamePlan is null', () => {
    expect(deriveHalftimeRotationNumber(null, 30, 10, [])).toBeUndefined();
  });

  it('returns correct number for 15-min interval on 30-min halves', () => {
    // Math.floor(30/15) - 1 = 1 → halftime at rotation 2
    expect(deriveHalftimeRotationNumber(mockPlan, 30, 15, [])).toBe(2);
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
  it('shows checkmark when plan exists and all positions filled', () => {
    expect(computeLineupTabBadge({ id: 'p' }, 5, 5)).toBe('✓');
  });

  it('returns null when no game plan exists', () => {
    expect(computeLineupTabBadge(null, 5, 5)).toBeNull();
  });

  it('returns null when lineup is not fully filled', () => {
    expect(computeLineupTabBadge({ id: 'p' }, 4, 5)).toBeNull();
  });

  it('shows checkmark when lineup size exceeds position count', () => {
    expect(computeLineupTabBadge({ id: 'p' }, 6, 5)).toBe('✓');
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
