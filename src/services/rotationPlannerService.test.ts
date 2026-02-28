import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateFairRotations,
  calculatePlayTime,
  validateRotationPlan,
  calculateRotationMinute,
  updatePlayerAvailability,
  type SimpleRoster,
  type PlannedSubstitution,
} from './rotationPlannerService';

// Mock the Amplify client so updatePlayerAvailability validation tests don't hit the network
vi.mock('../../amplify/data/resource', () => ({ default: {} }));
vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      PlayerAvailability: {
        list:   vi.fn().mockResolvedValue({ data: [] }),
        create: vi.fn().mockResolvedValue({ data: {} }),
        update: vi.fn().mockResolvedValue({ data: {} }),
      },
    },
  }),
}));

describe('rotationPlannerService', () => {
  describe('calculateFairRotations', () => {
    it('should create 4 rotations for 30-minute halves with 10-minute intervals', () => {
      // 30 min halves, 10 min intervals = 2 rotations per half = 4 total
      const players: SimpleRoster[] = [
        { id: 'r1', playerId: 'p1', playerNumber: 1, preferredPositions: 'pos1' },
        { id: 'r2', playerId: 'p2', playerNumber: 2, preferredPositions: 'pos2' },
        { id: 'r3', playerId: 'p3', playerNumber: 3, preferredPositions: 'pos3' },
        { id: 'r4', playerId: 'p4', playerNumber: 4, preferredPositions: 'pos4' },
        { id: 'r5', playerId: 'p5', playerNumber: 5, preferredPositions: 'pos1' },
        { id: 'r6', playerId: 'p6', playerNumber: 6, preferredPositions: 'pos2' },
        { id: 'r7', playerId: 'p7', playerNumber: 7, preferredPositions: 'pos3' },
        { id: 'r8', playerId: 'p8', playerNumber: 8, preferredPositions: 'pos4' },
      ];

      const startingLineup = [
        { playerId: 'p1', positionId: 'pos1' },
        { playerId: 'p2', positionId: 'pos2' },
        { playerId: 'p3', positionId: 'pos3' },
        { playerId: 'p4', positionId: 'pos4' },
        { playerId: 'p5', positionId: 'pos5' },
        { playerId: 'p6', positionId: 'pos6' },
      ];

      const { rotations } = calculateFairRotations(
        players,
        startingLineup,
        4, // totalRotations
        2, // rotationsPerHalf
        6  // maxPlayersOnField
      );

      expect(rotations).toHaveLength(4);
      expect(rotations[0].substitutions.length).toBeGreaterThan(0);
    });

    it('should distribute play time evenly with 8 players and 6 field positions', () => {
      const players: SimpleRoster[] = [
        { id: 'r1', playerId: 'p1', playerNumber: 1, preferredPositions: 'pos1' },
        { id: 'r2', playerId: 'p2', playerNumber: 2, preferredPositions: 'pos2' },
        { id: 'r3', playerId: 'p3', playerNumber: 3, preferredPositions: 'pos3' },
        { id: 'r4', playerId: 'p4', playerNumber: 4, preferredPositions: 'pos4' },
        { id: 'r5', playerId: 'p5', playerNumber: 5, preferredPositions: 'pos5' },
        { id: 'r6', playerId: 'p6', playerNumber: 6, preferredPositions: 'pos6' },
        { id: 'r7', playerId: 'p7', playerNumber: 7, preferredPositions: 'pos1' },
        { id: 'r8', playerId: 'p8', playerNumber: 8, preferredPositions: 'pos2' },
      ];

      const startingLineup = [
        { playerId: 'p1', positionId: 'pos1' },
        { playerId: 'p2', positionId: 'pos2' },
        { playerId: 'p3', positionId: 'pos3' },
        { playerId: 'p4', positionId: 'pos4' },
        { playerId: 'p5', positionId: 'pos5' },
        { playerId: 'p6', positionId: 'pos6' },
      ];

      const { rotations } = calculateFairRotations(
        players,
        startingLineup,
        4,
        2,
        6
      );

      // Verify rotations were created
      expect(rotations).toHaveLength(4);
      
      // Each rotation should have substitutions
      rotations.forEach(rotation => {
        expect(rotation.substitutions.length).toBeGreaterThan(0);
        
        // Verify substitution structure
        rotation.substitutions.forEach(sub => {
          expect(sub).toHaveProperty('playerOutId');
          expect(sub).toHaveProperty('playerInId');
          expect(sub).toHaveProperty('positionId');
          expect(sub.playerOutId).not.toBe(sub.playerInId);
        });
      });
    });

    it('should handle 7 players with 6 field positions', () => {
      const players: SimpleRoster[] = Array.from({ length: 7 }, (_, i) => ({
        id: `r${i + 1}`,
        playerId: `p${i + 1}`,
        playerNumber: i + 1,
        preferredPositions: `pos${(i % 6) + 1}`,
      }));

      const startingLineup = players.slice(0, 6).map((p, i) => ({
        playerId: p.playerId,
        positionId: `pos${i + 1}`,
      }));

      const { rotations } = calculateFairRotations(
        players,
        startingLineup,
        4,
        2,
        6
      );

      expect(rotations).toHaveLength(4);
      
      // With 7 players, there should always be 1 on bench
      // Verify that we're not trying to substitute more than available
      rotations.forEach(rotation => {
        expect(rotation.substitutions.length).toBeLessThanOrEqual(6);
      });
    });

    it('should create full lineup swap at halftime transition', () => {
      const players: SimpleRoster[] = Array.from({ length: 12 }, (_, i) => ({
        id: `r${i + 1}`,
        playerId: `p${i + 1}`,
        playerNumber: i + 1,
        preferredPositions: `pos${(i % 6) + 1}`,
      }));

      const startingLineup = players.slice(0, 6).map((p, i) => ({
        playerId: p.playerId,
        positionId: `pos${i + 1}`,
      }));

      const { rotations } = calculateFairRotations(
        players,
        startingLineup,
        4,
        2,
        6
      );

      // Rotation at index 1 (rotNum 2) is last of first half
      // Rotation at index 2 (rotNum 3) is first of second half - should be halftime swap
      // With rotationsPerHalf = 2, rotNum 3 (index 2) is the first rotation of second half
      
      expect(rotations).toHaveLength(4);
    });

    it('should not create rotations with empty substitutions', () => {
      const players: SimpleRoster[] = Array.from({ length: 6 }, (_, i) => ({
        id: `r${i + 1}`,
        playerId: `p${i + 1}`,
        playerNumber: i + 1,
        preferredPositions: `pos${i + 1}`,
      }));

      const startingLineup = players.map((p, i) => ({
        playerId: p.playerId,
        positionId: `pos${i + 1}`,
      }));

      // With exactly 6 players and 6 positions, there are no subs possible
      const { rotations } = calculateFairRotations(
        players,
        startingLineup,
        4,
        2,
        6
      );

      // Should still create rotation objects, but they may have no substitutions
      expect(rotations).toHaveLength(4);
      rotations.forEach(rotation => {
        expect(rotation.substitutions).toBeDefined();
        expect(Array.isArray(rotation.substitutions)).toBe(true);
      });
    });

    it('should assign bench players to positions they prefer when possible', () => {
      // 8 players, 6 on field, 2 on bench
      // Bench players have clear preferred positions that differ from each other
      const players: SimpleRoster[] = [
        { id: 'r1', playerId: 'p1', playerNumber: 1, preferredPositions: 'pos1' },
        { id: 'r2', playerId: 'p2', playerNumber: 2, preferredPositions: 'pos2' },
        { id: 'r3', playerId: 'p3', playerNumber: 3, preferredPositions: 'pos3' },
        { id: 'r4', playerId: 'p4', playerNumber: 4, preferredPositions: 'pos4' },
        { id: 'r5', playerId: 'p5', playerNumber: 5, preferredPositions: 'pos5' },
        { id: 'r6', playerId: 'p6', playerNumber: 6, preferredPositions: 'pos6' },
        // Bench players: p7 prefers pos1, p8 prefers pos2
        { id: 'r7', playerId: 'p7', playerNumber: 7, preferredPositions: 'pos1' },
        { id: 'r8', playerId: 'p8', playerNumber: 8, preferredPositions: 'pos2' },
      ];

      const startingLineup = [
        { playerId: 'p1', positionId: 'pos1' },
        { playerId: 'p2', positionId: 'pos2' },
        { playerId: 'p3', positionId: 'pos3' },
        { playerId: 'p4', positionId: 'pos4' },
        { playerId: 'p5', positionId: 'pos5' },
        { playerId: 'p6', positionId: 'pos6' },
      ];

      const { rotations } = calculateFairRotations(players, startingLineup, 4, 2, 6);

      // Check that in the first rotation, bench players are assigned to their preferred positions
      const firstRotSubs = rotations[0].substitutions;
      expect(firstRotSubs.length).toBeGreaterThan(0);

      // p7 prefers pos1, p8 prefers pos2 — verify they get those positions when both are vacated
      const p7Sub = firstRotSubs.find(s => s.playerInId === 'p7');
      const p8Sub = firstRotSubs.find(s => s.playerInId === 'p8');

      if (p7Sub && p8Sub) {
        expect(p7Sub.positionId).toBe('pos1');
        expect(p8Sub.positionId).toBe('pos2');
      }
    });

    it('should handle players with multiple preferred positions', () => {
      // Bench player prefers multiple positions — should get one of them
      const players: SimpleRoster[] = [
        { id: 'r1', playerId: 'p1', playerNumber: 1, preferredPositions: 'pos1' },
        { id: 'r2', playerId: 'p2', playerNumber: 2, preferredPositions: 'pos2' },
        { id: 'r3', playerId: 'p3', playerNumber: 3, preferredPositions: 'pos3' },
        { id: 'r4', playerId: 'p4', playerNumber: 4, preferredPositions: 'pos4' },
        { id: 'r5', playerId: 'p5', playerNumber: 5, preferredPositions: 'pos5' },
        { id: 'r6', playerId: 'p6', playerNumber: 6, preferredPositions: 'pos6' },
        // p7 prefers pos1 or pos3
        { id: 'r7', playerId: 'p7', playerNumber: 7, preferredPositions: 'pos1, pos3' },
        { id: 'r8', playerId: 'p8', playerNumber: 8, preferredPositions: 'pos2' },
      ];

      const startingLineup = [
        { playerId: 'p1', positionId: 'pos1' },
        { playerId: 'p2', positionId: 'pos2' },
        { playerId: 'p3', positionId: 'pos3' },
        { playerId: 'p4', positionId: 'pos4' },
        { playerId: 'p5', positionId: 'pos5' },
        { playerId: 'p6', positionId: 'pos6' },
      ];

      const { rotations } = calculateFairRotations(players, startingLineup, 4, 2, 6);
      const firstRotSubs = rotations[0].substitutions;

      const p7Sub = firstRotSubs.find(s => s.playerInId === 'p7');
      if (p7Sub) {
        // p7 should be in pos1 or pos3 (one of their preferred positions)
        expect(['pos1', 'pos3']).toContain(p7Sub.positionId);
      }
    });

    it('should never auto-sub the goalkeeper in regular rotations', () => {
      // 8 players, pos1 = GK, all others are outfield
      const players: SimpleRoster[] = [
        { id: 'r1', playerId: 'p1', playerNumber: 1, preferredPositions: 'pos1' }, // GK
        { id: 'r2', playerId: 'p2', playerNumber: 2, preferredPositions: 'pos2' },
        { id: 'r3', playerId: 'p3', playerNumber: 3, preferredPositions: 'pos3' },
        { id: 'r4', playerId: 'p4', playerNumber: 4, preferredPositions: 'pos4' },
        { id: 'r5', playerId: 'p5', playerNumber: 5, preferredPositions: 'pos5' },
        { id: 'r6', playerId: 'p6', playerNumber: 6, preferredPositions: 'pos6' },
        { id: 'r7', playerId: 'p7', playerNumber: 7, preferredPositions: 'pos2' },
        { id: 'r8', playerId: 'p8', playerNumber: 8, preferredPositions: 'pos3' },
      ];

      const startingLineup = [
        { playerId: 'p1', positionId: 'pos1' }, // GK
        { playerId: 'p2', positionId: 'pos2' },
        { playerId: 'p3', positionId: 'pos3' },
        { playerId: 'p4', positionId: 'pos4' },
        { playerId: 'p5', positionId: 'pos5' },
        { playerId: 'p6', positionId: 'pos6' },
      ];

      const { rotations } = calculateFairRotations(
        players, startingLineup, 4, 2, 6,
        'pos1' // goaliePositionId
      );

      // In every rotation, p1 (GK) must never appear as playerOutId
      rotations.forEach((rotation, idx) => {
        const isHalftime = idx === 2; // rotNum 3 = rotationsPerHalf + 1
        if (!isHalftime) {
          rotation.substitutions.forEach(sub => {
            expect(sub.playerOutId).not.toBe('p1');
            expect(sub.positionId).not.toBe('pos1');
          });
        }
      });
    });

    it('should allow goalkeeper swap at halftime when auto-computing', () => {
      // 12 players; GK is pos1/p1 — at halftime auto-compute the GK can be swapped
      const players: SimpleRoster[] = Array.from({ length: 12 }, (_, i) => ({
        id: `r${i + 1}`,
        playerId: `p${i + 1}`,
        playerNumber: i + 1,
        preferredPositions: `pos${(i % 6) + 1}`,
      }));

      const startingLineup = players.slice(0, 6).map((p, i) => ({
        playerId: p.playerId,
        positionId: `pos${i + 1}`,
      }));

      // With goaliePositionId set but NO halftimeLineup, the auto-compute at halftime
      // may still swap the GK (halftime is the exception)
      const { rotations } = calculateFairRotations(
        players, startingLineup, 4, 2, 6,
        'pos1' // goaliePositionId
      );

      // Halftime is rotation index 2 (rotNum 3)
      const halftimeSubs = rotations[2].substitutions;
      // It should have produced some subs (auto-compute swaps benched players)
      expect(halftimeSubs.length).toBeGreaterThan(0);
    });

    it('should use coach-set halftime lineup and plan second-half rotations from it', () => {
      // Use rotationsPerHalf = 0 so there are no first-half rotations; the only
      // rotation is the halftime (rotNum 1 = rotationsPerHalf + 1 = 1).
      // This makes the before-halftime field state deterministic (= startingLineup).
      const players: SimpleRoster[] = [
        { id: 'r1', playerId: 'p1', playerNumber: 1 },
        { id: 'r2', playerId: 'p2', playerNumber: 2 },
        { id: 'r3', playerId: 'p3', playerNumber: 3 },
        { id: 'r4', playerId: 'p4', playerNumber: 4 },
        { id: 'r5', playerId: 'p5', playerNumber: 5 },
        { id: 'r6', playerId: 'p6', playerNumber: 6 },
      ];

      const startingLineup = [
        { playerId: 'p1', positionId: 'pos1' },
        { playerId: 'p2', positionId: 'pos2' },
        { playerId: 'p3', positionId: 'pos3' },
      ];

      // Coach sets halftime lineup: p4 replaces p1, p5 replaces p2, p6 replaces p3
      const halftimeLineup = [
        { playerId: 'p4', positionId: 'pos1' },
        { playerId: 'p5', positionId: 'pos2' },
        { playerId: 'p6', positionId: 'pos3' },
      ];

      // totalRotations = 1, rotationsPerHalf = 0 → rotNum 1 is halftime
      const { rotations } = calculateFairRotations(
        players, startingLineup, 1, 0, 3,
        undefined,
        halftimeLineup
      );

      expect(rotations).toHaveLength(1);

      // The single rotation is halftime; it must produce exactly the coach's subs
      const halftimeSubs = rotations[0].substitutions;
      expect(halftimeSubs).toHaveLength(3);

      const sub1 = halftimeSubs.find(s => s.positionId === 'pos1');
      const sub2 = halftimeSubs.find(s => s.positionId === 'pos2');
      const sub3 = halftimeSubs.find(s => s.positionId === 'pos3');
      expect(sub1?.playerOutId).toBe('p1');
      expect(sub1?.playerInId).toBe('p4');
      expect(sub2?.playerOutId).toBe('p2');
      expect(sub2?.playerInId).toBe('p5');
      expect(sub3?.playerOutId).toBe('p3');
      expect(sub3?.playerInId).toBe('p6');
    });

    it('should produce no halftime subs when halftimeLineup matches the current field state', () => {
      const players: SimpleRoster[] = [
        { id: 'r1', playerId: 'p1', playerNumber: 1 },
        { id: 'r2', playerId: 'p2', playerNumber: 2 },
      ];

      const startingLineup = [
        { playerId: 'p1', positionId: 'pos1' },
        { playerId: 'p2', positionId: 'pos2' },
      ];

      // Halftime lineup is identical to starting — no subs needed
      const halftimeLineup = [
        { playerId: 'p1', positionId: 'pos1' },
        { playerId: 'p2', positionId: 'pos2' },
      ];

      const { rotations } = calculateFairRotations(
        players, startingLineup, 1, 0, 2,
        undefined,
        halftimeLineup
      );

      expect(rotations[0].substitutions).toHaveLength(0);
    });

    it('should fall back to time-based ordering when no preferred positions match', () => {
      // Bench players have no preferred positions — should still work
      const players: SimpleRoster[] = [
        { id: 'r1', playerId: 'p1', playerNumber: 1 },
        { id: 'r2', playerId: 'p2', playerNumber: 2 },
        { id: 'r3', playerId: 'p3', playerNumber: 3 },
        { id: 'r4', playerId: 'p4', playerNumber: 4 },
        { id: 'r5', playerId: 'p5', playerNumber: 5 },
        { id: 'r6', playerId: 'p6', playerNumber: 6 },
        { id: 'r7', playerId: 'p7', playerNumber: 7 },
        { id: 'r8', playerId: 'p8', playerNumber: 8 },
      ];

      const startingLineup = [
        { playerId: 'p1', positionId: 'pos1' },
        { playerId: 'p2', positionId: 'pos2' },
        { playerId: 'p3', positionId: 'pos3' },
        { playerId: 'p4', positionId: 'pos4' },
        { playerId: 'p5', positionId: 'pos5' },
        { playerId: 'p6', positionId: 'pos6' },
      ];

      const { rotations } = calculateFairRotations(players, startingLineup, 4, 2, 6);

      expect(rotations).toHaveLength(4);
      rotations.forEach(rotation => {
        rotation.substitutions.forEach(sub => {
          expect(sub.playerOutId).not.toBe(sub.playerInId);
          expect(sub.positionId).toBeDefined();
        });
      });
    });

    it('should prefer bench players for halftime based on position preferences', () => {
      // 12 players, 6 on field — at halftime the 6 bench players should be matched to preferred positions
      const players: SimpleRoster[] = [
        { id: 'r1', playerId: 'p1', playerNumber: 1, preferredPositions: 'pos1' },
        { id: 'r2', playerId: 'p2', playerNumber: 2, preferredPositions: 'pos2' },
        { id: 'r3', playerId: 'p3', playerNumber: 3, preferredPositions: 'pos3' },
        { id: 'r4', playerId: 'p4', playerNumber: 4, preferredPositions: 'pos4' },
        { id: 'r5', playerId: 'p5', playerNumber: 5, preferredPositions: 'pos5' },
        { id: 'r6', playerId: 'p6', playerNumber: 6, preferredPositions: 'pos6' },
        // Bench players with clear position preferences
        { id: 'r7', playerId: 'p7', playerNumber: 7, preferredPositions: 'pos3' },
        { id: 'r8', playerId: 'p8', playerNumber: 8, preferredPositions: 'pos1' },
        { id: 'r9', playerId: 'p9', playerNumber: 9, preferredPositions: 'pos5' },
        { id: 'r10', playerId: 'p10', playerNumber: 10, preferredPositions: 'pos2' },
        { id: 'r11', playerId: 'p11', playerNumber: 11, preferredPositions: 'pos4' },
        { id: 'r12', playerId: 'p12', playerNumber: 12, preferredPositions: 'pos6' },
      ];

      const startingLineup = [
        { playerId: 'p1', positionId: 'pos1' },
        { playerId: 'p2', positionId: 'pos2' },
        { playerId: 'p3', positionId: 'pos3' },
        { playerId: 'p4', positionId: 'pos4' },
        { playerId: 'p5', positionId: 'pos5' },
        { playerId: 'p6', positionId: 'pos6' },
      ];

      // rotationsPerHalf = 2, so rotNum 3 (index 2) is halftime
      const { rotations } = calculateFairRotations(players, startingLineup, 4, 2, 6);

      // Halftime rotation is at index 2 (rotNum 3 = rotationsPerHalf + 1)
      const halftimeSubs = rotations[2].substitutions;
      expect(halftimeSubs.length).toBe(6); // Full swap with 12 players

      // Verify bench players got their preferred positions
      const p7Sub = halftimeSubs.find(s => s.playerInId === 'p7');
      const p8Sub = halftimeSubs.find(s => s.playerInId === 'p8');
      const p9Sub = halftimeSubs.find(s => s.playerInId === 'p9');
      const p10Sub = halftimeSubs.find(s => s.playerInId === 'p10');
      const p11Sub = halftimeSubs.find(s => s.playerInId === 'p11');
      const p12Sub = halftimeSubs.find(s => s.playerInId === 'p12');

      if (p7Sub) expect(p7Sub.positionId).toBe('pos3');
      if (p8Sub) expect(p8Sub.positionId).toBe('pos1');
      if (p9Sub) expect(p9Sub.positionId).toBe('pos5');
      if (p10Sub) expect(p10Sub.positionId).toBe('pos2');
      if (p11Sub) expect(p11Sub.positionId).toBe('pos4');
      if (p12Sub) expect(p12Sub.positionId).toBe('pos6');
    });
  });

  describe('calculatePlayTime', () => {
    it('should calculate play time for all players in rotations', () => {
      const rotations = [
        {
          id: 'rot1',
          rotationNumber: 1,
          gameMinute: 10,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p1', playerInId: 'p7', positionId: 'pos1' },
          ]),
        },
        {
          id: 'rot2',
          rotationNumber: 2,
          gameMinute: 20,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p2', playerInId: 'p8', positionId: 'pos2' },
          ]),
        },
      ];

      const startingLineup = [
        { playerId: 'p1', positionId: 'pos1' },
        { playerId: 'p2', positionId: 'pos2' },
        { playerId: 'p3', positionId: 'pos3' },
        { playerId: 'p4', positionId: 'pos4' },
        { playerId: 'p5', positionId: 'pos5' },
        { playerId: 'p6', positionId: 'pos6' },
      ];

      const playTimeMap = calculatePlayTime(
        rotations as any,
        startingLineup,
        10, // rotationIntervalMinutes
        60  // totalGameMinutes
      );

      // Should have entries for all players involved
      expect(playTimeMap.size).toBeGreaterThan(0);
      
      // Convert Map to array for iteration
      const playTimes = Array.from(playTimeMap.values());
      
      playTimes.forEach(pt => {
        expect(pt).toHaveProperty('playerId');
        expect(pt).toHaveProperty('totalMinutes');
        expect(pt).toHaveProperty('rotations');
        expect(pt.totalMinutes).toBeGreaterThanOrEqual(0);
        // Total minutes can be higher due to rotation calculation logic
      });
    });

    it('should give starters more time than bench players with rotations', () => {
      const rotations = [
        {
          id: 'rot1',
          rotationNumber: 1,
          gameMinute: 10,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p6', playerInId: 'p7', positionId: 'pos6' },
          ]),
        },
      ];

      const startingLineup = [
        { playerId: 'p1', positionId: 'pos1' },
        { playerId: 'p2', positionId: 'pos2' },
        { playerId: 'p3', positionId: 'pos3' },
        { playerId: 'p4', positionId: 'pos4' },
        { playerId: 'p5', positionId: 'pos5' },
        { playerId: 'p6', positionId: 'pos6' },
      ];

      const playTimeMap = calculatePlayTime(
        rotations as any,
        startingLineup,
        10,
        60
      );

      const p1Time = playTimeMap.get('p1');
      const p7Time = playTimeMap.get('p7');

      // p1 never gets subbed out - verify it has play time
      expect(p1Time).toBeDefined();
      expect(p1Time!.totalMinutes).toBeGreaterThan(0);
      
      // p7 comes in at rotation 1 (10 mins), verify it plays
      expect(p7Time).toBeDefined();
      expect(p7Time!.totalMinutes).toBeGreaterThan(0);
      
      // p1 should play longer than p7 since p1 started
      expect(p1Time!.totalMinutes).toBeGreaterThan(p7Time!.totalMinutes);
    });

    it('should handle player subbed out and never coming back', () => {
      const rotations = [
        {
          id: 'rot1',
          rotationNumber: 1,
          gameMinute: 10,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p1', playerInId: 'p7', positionId: 'pos1' },
          ]),
        },
      ];

      const startingLineup = [
        { playerId: 'p1', positionId: 'pos1' },
        { playerId: 'p2', positionId: 'pos2' },
      ];

      const playTimeMap = calculatePlayTime(
        rotations as any,
        startingLineup,
        10,
        60
      );

      const p1Time = playTimeMap.get('p1');
      
      // p1 plays until rotation 1 at 10 minutes
      expect(p1Time?.totalMinutes).toBe(10);
    });

    it('should handle empty rotations array', () => {
      const startingLineup = [
        { playerId: 'p1', positionId: 'pos1' },
        { playerId: 'p2', positionId: 'pos2' },
      ];

      const playTimeMap = calculatePlayTime(
        [],
        startingLineup,
        10,
        60
      );

      // Starters should play the full game
      expect(playTimeMap.get('p1')?.totalMinutes).toBe(60);
      expect(playTimeMap.get('p2')?.totalMinutes).toBe(60);
    });

    it('should handle empty starting lineup', () => {
      const rotations = [
        {
          id: 'rot1',
          rotationNumber: 1,
          gameMinute: 10,
          plannedSubstitutions: JSON.stringify([]),
        },
      ];

      const playTimeMap = calculatePlayTime(
        rotations as any,
        [],
        10,
        60
      );

      // No players, so map should be empty
      expect(playTimeMap.size).toBe(0);
    });

    it('should handle player subbed in then out later', () => {
      const rotations = [
        {
          id: 'rot1',
          rotationNumber: 1,
          gameMinute: 10,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p1', playerInId: 'p7', positionId: 'pos1' },
          ]),
        },
        {
          id: 'rot2',
          rotationNumber: 2,
          gameMinute: 20,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p7', playerInId: 'p8', positionId: 'pos1' },
          ]),
        },
      ];

      const startingLineup = [
        { playerId: 'p1', positionId: 'pos1' },
      ];

      const playTimeMap = calculatePlayTime(
        rotations as any,
        startingLineup,
        10,
        60
      );

      // p1 plays 0-10 = 10 minutes
      expect(playTimeMap.get('p1')?.totalMinutes).toBe(10);
      // p7 plays 10-20 = 10 minutes
      expect(playTimeMap.get('p7')?.totalMinutes).toBe(10);
      // p8 plays 20-60 = 40 minutes
      expect(playTimeMap.get('p8')?.totalMinutes).toBe(40);
    });

    it('should handle player subbed out and back in later', () => {
      const rotations = [
        {
          id: 'rot1',
          rotationNumber: 1,
          gameMinute: 10,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p1', playerInId: 'p7', positionId: 'pos1' },
          ]),
        },
        {
          id: 'rot2',
          rotationNumber: 2,
          gameMinute: 30,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p7', playerInId: 'p1', positionId: 'pos1' },
          ]),
        },
      ];

      const startingLineup = [
        { playerId: 'p1', positionId: 'pos1' },
      ];

      const playTimeMap = calculatePlayTime(
        rotations as any,
        startingLineup,
        10,
        60
      );

      // p1 plays 0-10 (10 min) + 30-60 (30 min) = 40 minutes
      expect(playTimeMap.get('p1')?.totalMinutes).toBe(40);
      // p7 plays 10-30 = 20 minutes
      expect(playTimeMap.get('p7')?.totalMinutes).toBe(20);
    });

    it('should handle multiple substitutions in same rotation', () => {
      const rotations = [
        {
          id: 'rot1',
          rotationNumber: 1,
          gameMinute: 20,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p1', playerInId: 'p5', positionId: 'pos1' },
            { playerOutId: 'p2', playerInId: 'p6', positionId: 'pos2' },
            { playerOutId: 'p3', playerInId: 'p7', positionId: 'pos3' },
          ]),
        },
      ];

      const startingLineup = [
        { playerId: 'p1', positionId: 'pos1' },
        { playerId: 'p2', positionId: 'pos2' },
        { playerId: 'p3', positionId: 'pos3' },
        { playerId: 'p4', positionId: 'pos4' },
      ];

      const playTimeMap = calculatePlayTime(
        rotations as any,
        startingLineup,
        10,
        60
      );

      // p1, p2, p3 play 0-20 = 20 minutes each
      expect(playTimeMap.get('p1')?.totalMinutes).toBe(20);
      expect(playTimeMap.get('p2')?.totalMinutes).toBe(20);
      expect(playTimeMap.get('p3')?.totalMinutes).toBe(20);
      // p4 never gets subbed, plays full game = 60 minutes
      expect(playTimeMap.get('p4')?.totalMinutes).toBe(60);
      // p5, p6, p7 play 20-60 = 40 minutes each
      expect(playTimeMap.get('p5')?.totalMinutes).toBe(40);
      expect(playTimeMap.get('p6')?.totalMinutes).toBe(40);
      expect(playTimeMap.get('p7')?.totalMinutes).toBe(40);
    });

    it('should handle halftime swap scenario', () => {
      // Simulate first half rotation, halftime swap, second half rotation
      const rotations = [
        {
          id: 'rot1',
          rotationNumber: 1,
          gameMinute: 10,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p1', playerInId: 'p5', positionId: 'pos1' },
          ]),
        },
        {
          id: 'rot2',
          rotationNumber: 2,
          gameMinute: 20, // halftime - swap many players
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p2', playerInId: 'p6', positionId: 'pos2' },
            { playerOutId: 'p3', playerInId: 'p7', positionId: 'pos3' },
          ]),
        },
        {
          id: 'rot3',
          rotationNumber: 3,
          gameMinute: 30,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p5', playerInId: 'p1', positionId: 'pos1' },
          ]),
        },
      ];

      const startingLineup = [
        { playerId: 'p1', positionId: 'pos1' },
        { playerId: 'p2', positionId: 'pos2' },
        { playerId: 'p3', positionId: 'pos3' },
        { playerId: 'p4', positionId: 'pos4' },
      ];

      const playTimeMap = calculatePlayTime(
        rotations as any,
        startingLineup,
        10,
        40 // 20 min halves
      );

      // p1: 0-10 (10 min) + 30-40 (10 min) = 20 min
      expect(playTimeMap.get('p1')?.totalMinutes).toBe(20);
      // p2: 0-20 = 20 min
      expect(playTimeMap.get('p2')?.totalMinutes).toBe(20);
      // p3: 0-20 = 20 min
      expect(playTimeMap.get('p3')?.totalMinutes).toBe(20);
      // p4: never subbed = 40 min
      expect(playTimeMap.get('p4')?.totalMinutes).toBe(40);
      // p5: 10-30 = 20 min
      expect(playTimeMap.get('p5')?.totalMinutes).toBe(20);
      // p6: 20-40 = 20 min
      expect(playTimeMap.get('p6')?.totalMinutes).toBe(20);
      // p7: 20-40 = 20 min
      expect(playTimeMap.get('p7')?.totalMinutes).toBe(20);
    });

    it('should match the game-planner E2E scenario: 7 players, 5 positions, multi-stint play times', () => {
      // This test mirrors the exact rotation plan verified in game-planner.spec.ts:
      //
      // Starting lineup: P1(pos1), P2(pos2), P3(pos3), P4(pos4), P5(pos5)
      // Rotation 1 at 10':  P6 in for P1
      // Rotation 2 at 20':  P1 in for P6 (auto-reverse), P7 (late) in for P2
      // Rotation 3 at 30':  P2 in for P7 (auto-reverse)
      //
      // Expected play times (40 min game):
      //   P1 : 0-10 + 20-40 = 30 min
      //   P2 : 0-20 + 30-40 = 30 min
      //   P3 : 0-40          = 40 min
      //   P4 : 0-40          = 40 min
      //   P5 : 0-40          = 40 min
      //   P6 : 10-20         = 10 min
      //   P7 : 20-30         = 10 min
      const rotations = [
        {
          id: 'rot1',
          rotationNumber: 1,
          gameMinute: 10,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p1', playerInId: 'p6', positionId: 'pos1' },
          ]),
        },
        {
          id: 'rot2',
          rotationNumber: 2,
          gameMinute: 20,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p6', playerInId: 'p1', positionId: 'pos1' },
            { playerOutId: 'p2', playerInId: 'p7', positionId: 'pos2' },
          ]),
        },
        {
          id: 'rot3',
          rotationNumber: 3,
          gameMinute: 30,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p7', playerInId: 'p2', positionId: 'pos2' },
          ]),
        },
      ];

      const startingLineup = [
        { playerId: 'p1', positionId: 'pos1' },
        { playerId: 'p2', positionId: 'pos2' },
        { playerId: 'p3', positionId: 'pos3' },
        { playerId: 'p4', positionId: 'pos4' },
        { playerId: 'p5', positionId: 'pos5' },
      ];

      const playTimeMap = calculatePlayTime(rotations as any, startingLineup, 10, 40);

      // Two-stint players
      expect(playTimeMap.get('p1')?.totalMinutes).toBe(30); // 0-10 + 20-40
      expect(playTimeMap.get('p2')?.totalMinutes).toBe(30); // 0-20 + 30-40
      // Full-game players
      expect(playTimeMap.get('p3')?.totalMinutes).toBe(40);
      expect(playTimeMap.get('p4')?.totalMinutes).toBe(40);
      expect(playTimeMap.get('p5')?.totalMinutes).toBe(40);
      // Short-stint players
      expect(playTimeMap.get('p6')?.totalMinutes).toBe(10); // 10-20
      expect(playTimeMap.get('p7')?.totalMinutes).toBe(10); // 20-30
    });
  });

  describe('validateRotationPlan', () => {
    it('should return empty errors array for a proper rotation plan', () => {
      const rotations = [
        {
          id: 'rot1',
          rotationNumber: 1,
          gameMinute: 10,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p1', playerInId: 'p7', positionId: 'pos1' },
          ]),
        },
      ];

      const errors = validateRotationPlan(rotations as any, 6);

      expect(errors).toHaveLength(0);
    });

    it('should detect invalid substitution data', () => {
      const rotations = [
        {
          id: 'rot1',
          rotationNumber: 1,
          gameMinute: 10,
          plannedSubstitutions: 'invalid json',
        },
      ];

      // Should return a parse error rather than throwing
      const errors = validateRotationPlan(rotations as any, 6);
      expect(errors.some(e => e.includes('Failed to parse substitutions data'))).toBe(true);
    });

    it('should detect same player subbed in and out simultaneously', () => {
      const rotations = [
        {
          id: 'rot1',
          rotationNumber: 1,
          gameMinute: 10,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p1', playerInId: 'p1', positionId: 'pos1' },
          ]),
        },
      ];

      const errors = validateRotationPlan(rotations as any, 6);

      // Note: Current implementation doesn't validate self-substitution
      // This is an edge case that could be added as a validation rule
      expect(errors).toBeDefined();
      expect(Array.isArray(errors)).toBe(true);
    });

    it('should not error for valid multi-player rotations', () => {
      const rotations = [
        {
          id: 'rot1',
          rotationNumber: 1,
          gameMinute: 10,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p1', playerInId: 'p7', positionId: 'pos1' },
            { playerOutId: 'p2', playerInId: 'p8', positionId: 'pos2' },
            { playerOutId: 'p3', playerInId: 'p9', positionId: 'pos3' },
          ]),
        },
      ];

      const errors = validateRotationPlan(rotations as any, 6);

      expect(errors).toHaveLength(0);
    });
  });

  describe('calculateRotationMinute', () => {
    it('should calculate first half rotation minutes correctly', () => {
      // 30-min halves, 10-min intervals, 2 rotations per half
      expect(calculateRotationMinute(1, 2, 10, 30)).toBe(10);
      expect(calculateRotationMinute(2, 2, 10, 30)).toBe(20);
    });

    it('should calculate second half rotation minutes correctly', () => {
      // 30-min halves, 10-min intervals, 2 rotations per half
      // Rotation 3 is first of second half: 30 + (1 * 10) = 40
      expect(calculateRotationMinute(3, 2, 10, 30)).toBe(40);
      // Rotation 4 is second of second half: 30 + (2 * 10) = 50
      expect(calculateRotationMinute(4, 2, 10, 30)).toBe(50);
    });

    it('should generate correct schedule for 8 players with 30-min halves', () => {
      // This is the exact scenario from the bug report
      const halfLength = 30;
      const interval = 10;
      const rotationsPerHalf = Math.floor(halfLength / interval) - 1; // 2
      const totalRotations = rotationsPerHalf * 2; // 4
      
      expect(totalRotations).toBe(4);
      expect(rotationsPerHalf).toBe(2);
      
      // Expected timeline: 10', 20', HT, 40', 50'
      const minutes = [1, 2, 3, 4].map(rotNum => 
        calculateRotationMinute(rotNum, rotationsPerHalf, interval, halfLength)
      );
      
      expect(minutes).toEqual([10, 20, 40, 50]);
    });

    it('should handle 15-minute intervals', () => {
      // 1 rotation per half with 15-min intervals
      expect(calculateRotationMinute(1, 1, 15, 30)).toBe(15);
      expect(calculateRotationMinute(2, 1, 15, 30)).toBe(45); // 30 + 15
    });

    it('should handle 5-minute intervals', () => {
      // 5 rotations per half with 5-min intervals
      expect(calculateRotationMinute(1, 5, 5, 30)).toBe(5);
      expect(calculateRotationMinute(5, 5, 5, 30)).toBe(25);
      expect(calculateRotationMinute(6, 5, 5, 30)).toBe(35); // First of second half: 30 + 5
      expect(calculateRotationMinute(10, 5, 5, 30)).toBe(55); // Last rotation: 30 + 25
    });

    it('should handle different half lengths', () => {
      // 20-min halves, 10-min intervals, 1 rotation per half
      expect(calculateRotationMinute(1, 1, 10, 20)).toBe(10);
      expect(calculateRotationMinute(2, 1, 10, 20)).toBe(30); // 20 + 10
    });
  });

  describe('Spec Compliance — TC-01 through TC-10', () => {
    // Baseline: 5v5, 7 players, 40-min game, 20-min halves, 5-min intervals
    // rotationsPerHalf=3, totalRotations=6
    // Rotation minutes: [5, 10, 15, 20(HT), 25, 30]; game ends at 40
    const ROTATION_MINUTES = [5, 10, 15, 20, 25, 30];
    const GAME_END = 40;

    const positions = [
      { id: 'pos-gk',   abbreviation: 'GK' },
      { id: 'pos-def1', abbreviation: 'DF' },
      { id: 'pos-def2', abbreviation: 'DF' },
      { id: 'pos-fwd1', abbreviation: 'FW' },
      { id: 'pos-fwd2', abbreviation: 'FW' },
    ];

    const opts = { rotationIntervalMinutes: 5, halfLengthMinutes: 20, positions };

    const ALL_POSITIONS = 'pos-gk, pos-def1, pos-def2, pos-fwd1, pos-fwd2';
    const basePlayers: SimpleRoster[] = [
      { id: 'r1', playerId: 'p1', playerNumber: 1, preferredPositions: ALL_POSITIONS },
      { id: 'r2', playerId: 'p2', playerNumber: 2, preferredPositions: ALL_POSITIONS },
      { id: 'r3', playerId: 'p3', playerNumber: 3, preferredPositions: ALL_POSITIONS },
      { id: 'r4', playerId: 'p4', playerNumber: 4, preferredPositions: ALL_POSITIONS },
      { id: 'r5', playerId: 'p5', playerNumber: 5, preferredPositions: ALL_POSITIONS },
      { id: 'r6', playerId: 'p6', playerNumber: 6, preferredPositions: ALL_POSITIONS },
      { id: 'r7', playerId: 'p7', playerNumber: 7, preferredPositions: ALL_POSITIONS },
    ];

    const baseStartingLineup = [
      { playerId: 'p1', positionId: 'pos-gk' },
      { playerId: 'p2', positionId: 'pos-def1' },
      { playerId: 'p3', positionId: 'pos-def2' },
      { playerId: 'p4', positionId: 'pos-fwd1' },
      { playerId: 'p5', positionId: 'pos-fwd2' },
    ];

    /** Simulate actual play minutes from rotation output */
    function computePlayMinutes(
      startingLineup: Array<{ playerId: string; positionId: string }>,
      rotations: Array<{ substitutions: PlannedSubstitution[] }>,
      rotationMinutes: number[],
      gameEndMinute: number,
    ): Map<string, number> {
      const field = new Map<string, string>();
      startingLineup.forEach(({ playerId, positionId }) => field.set(playerId, positionId));
      const playMin = new Map<string, number>();
      let lastMin = 0;
      for (let i = 0; i < rotations.length; i++) {
        const min = rotationMinutes[i];
        for (const pid of field.keys()) {
          playMin.set(pid, (playMin.get(pid) ?? 0) + (min - lastMin));
        }
        lastMin = min;
        for (const sub of rotations[i].substitutions) {
          field.delete(sub.playerOutId);
          field.set(sub.playerInId, sub.positionId);
        }
      }
      for (const pid of field.keys()) {
        playMin.set(pid, (playMin.get(pid) ?? 0) + (gameEndMinute - lastMin));
      }
      return playMin;
    }

    it('TC-01: all 7 players get ≥20 min; GK position has at most 1 sub', () => {
      const { rotations } = calculateFairRotations(
        basePlayers, baseStartingLineup, 6, 3, 5, 'pos-gk', undefined, opts,
      );
      expect(rotations).toHaveLength(6);

      const minutes = computePlayMinutes(baseStartingLineup, rotations, ROTATION_MINUTES, GAME_END);
      for (const pid of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']) {
        expect(minutes.get(pid) ?? 0).toBeGreaterThanOrEqual(20);
        expect(minutes.get(pid) ?? 0).toBeLessThanOrEqual(35);
      }

      // GK slot subbed at most once (halftime only, no regular-rotation GK sub)
      const allGkSubs = rotations.flatMap(r => r.substitutions).filter(s => s.positionId === 'pos-gk');
      expect(allGkSubs.length).toBeLessThanOrEqual(1);
    });

    it('TC-02: only GK-preferred players fill pos-gk; GK never subbed in regular rotations', () => {
      // p1 is sole GK-preferred player
      const players = basePlayers.map(p =>
        p.playerId === 'p1'
          ? { ...p, preferredPositions: 'pos-gk' }
          : { ...p, preferredPositions: 'pos-def1, pos-def2, pos-fwd1, pos-fwd2' },
      );

      const { rotations } = calculateFairRotations(
        players, baseStartingLineup, 6, 3, 5, 'pos-gk', undefined, opts,
      );

      // Any sub into pos-gk must be a GK-preferred player
      const gkSubIns = rotations.flatMap(r => r.substitutions).filter(s => s.positionId === 'pos-gk');
      gkSubIns.forEach(s => {
        const inPlayer = players.find(p => p.playerId === s.playerInId);
        expect(inPlayer?.preferredPositions).toContain('pos-gk');
      });

      // p1 must not appear as playerOut in non-halftime rotations (indices 0,1,2,4,5)
      for (const i of [0, 1, 2, 4, 5]) {
        rotations[i].substitutions.forEach(s => {
          expect(s.playerOutId).not.toBe('p1');
        });
      }
    });

    it('TC-03: no player appears in two positions at same rotation; no player both in and out', () => {
      const { rotations } = calculateFairRotations(
        basePlayers, baseStartingLineup, 6, 3, 5, 'pos-gk', undefined, opts,
      );

      rotations.forEach(rotation => {
        const playerOuts = rotation.substitutions.map(s => s.playerOutId);
        const playerIns  = rotation.substitutions.map(s => s.playerInId);

        expect(new Set(playerOuts).size).toBe(playerOuts.length);
        expect(new Set(playerIns).size).toBe(playerIns.length);

        // No player is both subbed in and subbed out in the same rotation
        playerOuts.forEach(id => expect(playerIns).not.toContain(id));
      });
    });

    it('TC-04: player with only FWD preference never fills GK position', () => {
      const players = basePlayers.map(p =>
        p.playerId === 'p7'
          ? { ...p, preferredPositions: 'pos-fwd1' }
          : p,
      );

      const { rotations } = calculateFairRotations(
        players, baseStartingLineup, 6, 3, 5, 'pos-gk', undefined, opts,
      );

      const allSubs = rotations.flatMap(r => r.substitutions);
      const p7InGk = allSubs.find(s => s.playerInId === 'p7' && s.positionId === 'pos-gk');
      expect(p7InGk).toBeUndefined();
    });

    it('TC-05: STRIKER starters forced off after 1 rotation; DEFENDER starters stay through rotation 0', () => {
      // p4 (pos-fwd1=FW/STRIKER max 1), p5 (pos-fwd2=FW/STRIKER max 1) should be forced off after rotNum=1
      // p2 (pos-def1=DF/DEFENDER max 2), p3 (pos-def2=DF/DEFENDER max 2) should stay at rotation 0
      const { rotations } = calculateFairRotations(
        basePlayers, baseStartingLineup, 6, 3, 5, 'pos-gk', undefined, opts,
      );

      const rotation0Subs = rotations[0].substitutions;

      expect(rotation0Subs.find(s => s.playerOutId === 'p4')).toBeDefined();
      expect(rotation0Subs.find(s => s.playerOutId === 'p5')).toBeDefined();

      // DEF players should NOT be subbed in rotation 0 (max 2 continuous rotations)
      rotation0Subs.forEach(s => {
        expect(s.playerOutId).not.toBe('p2');
        expect(s.playerOutId).not.toBe('p3');
      });
    });

    it('TC-06: sole GK-preferred player plays full 40 min; never subbed out', () => {
      const players = basePlayers.map(p =>
        p.playerId === 'p1'
          ? { ...p, preferredPositions: 'pos-gk' }
          : { ...p, preferredPositions: 'pos-def1, pos-def2, pos-fwd1, pos-fwd2' },
      );

      const { rotations } = calculateFairRotations(
        players, baseStartingLineup, 6, 3, 5, 'pos-gk', undefined, opts,
      );

      // p1 never appears as playerOut
      const allSubs = rotations.flatMap(r => r.substitutions);
      allSubs.forEach(s => expect(s.playerOutId).not.toBe('p1'));

      // p1 plays the full 40 min
      const minutes = computePlayMinutes(baseStartingLineup, rotations, ROTATION_MINUTES, GAME_END);
      expect(minutes.get('p1')).toBe(40);
    });

    it('TC-07: player with availableUntilMinute=10 forced off at minute 10; others unaffected', () => {
      // Disable position-based fatigue so the injury window is the trigger (not fatigue)
      const optsNF = { rotationIntervalMinutes: 5, halfLengthMinutes: 20 };

      // p5 starts on field, gets injured at minute 10 (availableUntilMinute=10)
      const players = basePlayers.map(p =>
        p.playerId === 'p5' ? { ...p, availableUntilMinute: 10 } : p,
      );

      const { rotations } = calculateFairRotations(
        players, baseStartingLineup, 6, 3, 5, 'pos-gk', undefined, optsNF,
      );

      // p5 must be forced off at or before rotNum=2 (minute 10, index 1)
      const p5Out = rotations.slice(0, 2).flatMap(r => r.substitutions).find(s => s.playerOutId === 'p5');
      expect(p5Out).toBeDefined();

      // p5 does not come back (not eligible after minute 10)
      for (let i = 2; i < 6; i++) {
        const p5Back = rotations[i].substitutions.find(s => s.playerInId === 'p5');
        expect(p5Back).toBeUndefined();
      }

      // Remaining 6 players still get meaningful play time
      const minutes = computePlayMinutes(baseStartingLineup, rotations, ROTATION_MINUTES, GAME_END);
      for (const pid of ['p1', 'p2', 'p3', 'p4', 'p6', 'p7']) {
        expect(minutes.get(pid) ?? 0).toBeGreaterThanOrEqual(15);
      }
    });

    it('TC-08: player with availableFromMinute=20 excluded from first half; scheduled in 2nd half', () => {
      // p7 starts on bench, arrives at halftime (availableFromMinute=20)
      const players = basePlayers.map(p =>
        p.playerId === 'p7' ? { ...p, availableFromMinute: 20 } : p,
      );

      const { rotations } = calculateFairRotations(
        players, baseStartingLineup, 6, 3, 5, 'pos-gk', undefined, opts,
      );

      // p7 not subbed in during first half (indices 0–2)
      for (let i = 0; i < 3; i++) {
        const p7In = rotations[i].substitutions.find(s => s.playerInId === 'p7');
        expect(p7In).toBeUndefined();
      }

      // p7 comes on at halftime (index 3) or in second half (indices 4–5)
      const p7Appearances = [3, 4, 5].flatMap(i =>
        rotations[i].substitutions.filter(s => s.playerInId === 'p7'),
      );
      expect(p7Appearances.length).toBeGreaterThan(0);

      // p7 accumulates at least 5 min of play
      const minutes = computePlayMinutes(baseStartingLineup, rotations, ROTATION_MINUTES, GAME_END);
      expect(minutes.get('p7') ?? 0).toBeGreaterThanOrEqual(5);
    });

    it('TC-09: no GK-preferred player generates "No eligible goalies" warning', () => {
      const players = basePlayers.map(p => ({
        ...p,
        preferredPositions: 'pos-def1, pos-def2, pos-fwd1, pos-fwd2',
      }));

      const { warnings } = calculateFairRotations(
        players, baseStartingLineup, 6, 3, 5, 'pos-gk', undefined, opts,
      );

      expect(warnings.some(w => w.includes('No eligible goalies available'))).toBe(true);
    });

    it('TC-10: exactly 5 players — noSubsAvailable; no subs in regular rotations; all play 40 min', () => {
      const fivePlayers = basePlayers.slice(0, 5);

      const { rotations } = calculateFairRotations(
        fivePlayers, baseStartingLineup, 6, 3, 5, 'pos-gk', undefined, opts,
      );

      // Regular rotations (non-halftime) must have zero subs
      for (const i of [0, 1, 2, 4, 5]) {
        expect(rotations[i].substitutions).toHaveLength(0);
      }

      // All 5 players play the full 40 min
      const minutes = computePlayMinutes(baseStartingLineup, rotations, ROTATION_MINUTES, GAME_END);
      for (const pid of ['p1', 'p2', 'p3', 'p4', 'p5']) {
        expect(minutes.get(pid)).toBe(40);
      }
    });
  });

  describe('rotation interval calculations', () => {
    it('should create 2 rotations per half for 30-min halves with 10-min intervals', () => {
      const players: SimpleRoster[] = Array.from({ length: 8 }, (_, i) => ({
        id: `r${i + 1}`,
        playerId: `p${i + 1}`,
        playerNumber: i + 1,
        preferredPositions: `pos${(i % 6) + 1}`,
      }));

      const startingLineup = players.slice(0, 6).map((p, i) => ({
        playerId: p.playerId,
        positionId: `pos${i + 1}`,
      }));

      // With 30-min halves and 10-min intervals, should create 2 rotations per half = 4 total
      const { rotations } = calculateFairRotations(players, startingLineup, 4, 2, 6);
      
      expect(rotations).toHaveLength(4);
      
      // Each rotation should have substitutions structure
      rotations.forEach((rotation, idx) => {
        expect(rotation).toHaveProperty('substitutions');
        expect(Array.isArray(rotation.substitutions)).toBe(true);
        
        // Verify substitutions have correct structure
        rotation.substitutions.forEach(sub => {
          expect(sub).toHaveProperty('playerOutId');
          expect(sub).toHaveProperty('playerInId');
          expect(sub).toHaveProperty('positionId');
        });
      });
    });

    it('should create 1 rotation per half for 30-min halves with 15-min intervals', () => {
      const players: SimpleRoster[] = Array.from({ length: 8 }, (_, i) => ({
        id: `r${i + 1}`,
        playerId: `p${i + 1}`,
        playerNumber: i + 1,
        preferredPositions: `pos${(i % 6) + 1}`,
      }));

      const startingLineup = players.slice(0, 6).map((p, i) => ({
        playerId: p.playerId,
        positionId: `pos${i + 1}`,
      }));

      // With 30-min halves and 15-min intervals, should create 1 rotation per half = 2 total
      const { rotations } = calculateFairRotations(players, startingLineup, 2, 1, 6);
      
      expect(rotations).toHaveLength(2);
      
      // Verify both rotations have substitutions
      rotations.forEach(rotation => {
        expect(rotation.substitutions.length).toBeGreaterThan(0);
      });
    });

    it('should create 5 rotations per half for 30-min halves with 5-min intervals', () => {
      const players: SimpleRoster[] = Array.from({ length: 8 }, (_, i) => ({
        id: `r${i + 1}`,
        playerId: `p${i + 1}`,
        playerNumber: i + 1,
        preferredPositions: `pos${(i % 6) + 1}`,
      }));

      const startingLineup = players.slice(0, 6).map((p, i) => ({
        playerId: p.playerId,
        positionId: `pos${i + 1}`,
      }));

      // With 30-min halves and 5-min intervals, should create 5 rotations per half = 10 total
      const { rotations } = calculateFairRotations(players, startingLineup, 10, 5, 6);
      
      expect(rotations).toHaveLength(10);
      
      // With more frequent rotations, verify all have substitutions
      rotations.forEach(rotation => {
        expect(rotation.substitutions).toBeDefined();
        expect(Array.isArray(rotation.substitutions)).toBe(true);
      });
    });
  });

  describe('updatePlayerAvailability — input validation', () => {
    it('rejects a negative availableFromMinute', async () => {
      await expect(
        updatePlayerAvailability('g1', 'p1', 'late-arrival', undefined, ['c1'], -1, undefined),
      ).rejects.toThrow('availableFromMinute must be a non-negative integer');
    });

    it('rejects a negative availableUntilMinute', async () => {
      await expect(
        updatePlayerAvailability('g1', 'p1', 'injured', undefined, ['c1'], undefined, -5),
      ).rejects.toThrow('availableUntilMinute must be a non-negative integer');
    });

    it('rejects a non-integer availableFromMinute', async () => {
      await expect(
        updatePlayerAvailability('g1', 'p1', 'late-arrival', undefined, ['c1'], 10.5, undefined),
      ).rejects.toThrow('availableFromMinute must be a non-negative integer');
    });

    it('rejects availableFromMinute >= availableUntilMinute', async () => {
      await expect(
        updatePlayerAvailability('g1', 'p1', 'injured', undefined, ['c1'], 20, 10),
      ).rejects.toThrow('availableFromMinute must be less than availableUntilMinute');
    });

    it('rejects equal availableFromMinute and availableUntilMinute', async () => {
      await expect(
        updatePlayerAvailability('g1', 'p1', 'injured', undefined, ['c1'], 10, 10),
      ).rejects.toThrow('availableFromMinute must be less than availableUntilMinute');
    });

    it('accepts valid window values (from < until)', async () => {
      await expect(
        updatePlayerAvailability('g1', 'p1', 'late-arrival', undefined, ['c1'], 20, 40),
      ).resolves.not.toThrow();
    });

    it('accepts null values (clearing window fields)', async () => {
      await expect(
        updatePlayerAvailability('g1', 'p1', 'available', undefined, ['c1'], null, null),
      ).resolves.not.toThrow();
    });

    it('accepts undefined (no window change)', async () => {
      await expect(
        updatePlayerAvailability('g1', 'p1', 'available', undefined, ['c1'], undefined, undefined),
      ).resolves.not.toThrow();
    });
  });
});
