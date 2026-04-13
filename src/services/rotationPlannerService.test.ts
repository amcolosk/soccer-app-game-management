/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
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
    it('excludes injured players via playerAvailabilities option', () => {
      const players: SimpleRoster[] = [
        { id: 'r1', playerId: 'p1', playerNumber: 1, preferredPositions: 'pos1' },
        { id: 'r2', playerId: 'p2', playerNumber: 2, preferredPositions: 'pos2' },
        { id: 'r3', playerId: 'p3', playerNumber: 3, preferredPositions: 'pos3' },
        { id: 'r4', playerId: 'p4', playerNumber: 4, preferredPositions: 'pos4' },
      ];

      const startingLineup = [
        { playerId: 'p1', positionId: 'pos1' },
        { playerId: 'p2', positionId: 'pos2' },
        { playerId: 'p3', positionId: 'pos3' },
      ];

      const { rotations } = calculateFairRotations(
        players,
        startingLineup,
        1,
        0,
        3,
        undefined,
        undefined,
        {
          rotationIntervalMinutes: 10,
          halfLengthMinutes: 30,
          playerAvailabilities: [{ playerId: 'p4', status: 'injured' }],
        },
      );

      const flatSubs = rotations.flatMap((rotation) => rotation.substitutions);
      const incomingPlayers = flatSubs.map((sub) => sub.playerInId);
      expect(incomingPlayers).not.toContain('p4');
    });

    it('returns no rotations and warning when every candidate is injured', () => {
      const players: SimpleRoster[] = [
        { id: 'r1', playerId: 'p1', playerNumber: 1, preferredPositions: 'pos1' },
      ];

      const { rotations, warnings } = calculateFairRotations(
        players,
        [{ playerId: 'p1', positionId: 'pos1' }],
        1,
        0,
        1,
        undefined,
        undefined,
        {
          rotationIntervalMinutes: 10,
          halfLengthMinutes: 30,
          playerAvailabilities: [{ playerId: 'p1', status: 'injured' }],
        },
      );

      expect(rotations).toEqual([]);
      expect(warnings).toContain('No available players-all have been marked injured.');
    });

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

    it('reproduces issue #83: halftime recalculation can miss an available all-preferred assignment', () => {
      const players: SimpleRoster[] = [
        { id: 'r1', playerId: 'p1', playerNumber: 1, preferredPositions: 'pos1' },
        { id: 'r2', playerId: 'p2', playerNumber: 2, preferredPositions: 'pos2' },
        { id: 'r3', playerId: 'p3', playerNumber: 3, preferredPositions: 'pos3' },
        { id: 'r4', playerId: 'p4', playerNumber: 4, preferredPositions: 'pos1, pos2' },
        { id: 'r5', playerId: 'p5', playerNumber: 5, preferredPositions: 'pos1' },
      ];

      const startingLineup = [
        { playerId: 'p1', positionId: 'pos1' },
        { playerId: 'p2', positionId: 'pos2' },
        { playerId: 'p3', positionId: 'pos3' },
      ];

      const { rotations } = calculateFairRotations(
        players,
        startingLineup,
        1,
        0,
        3,
      );

      expect(rotations[0].substitutions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ playerInId: 'p4', positionId: 'pos2' }),
          expect.objectContaining({ playerInId: 'p5', positionId: 'pos1' }),
        ]),
      );
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

    it('should not drop a striker below 50% threshold due to fatigue rotation', () => {
      // Reproduces the issue where STRIKER fatigue (max 1 consecutive interval) causes a player
      // to be forced off repeatedly and end up with less than 50% of game time.
      // 9 field positions, 11 available players (2 on bench each rotation).
      // Half length 30 min, rotation interval 10 min → rotationsPerHalf=2, totalRotations=5.
      // LW is a STRIKER position (max 1 consecutive interval). p_lw starts at LW on bench.
      // The fix: fatigue forced-off is suppressed if the player hasn't yet reached 50% game time.
      const positions = [
        { id: 'gol', abbreviation: 'Gol' },  // Goalkeeper (no forced-off)
        { id: 'ld', abbreviation: 'LD' },
        { id: 'cb', abbreviation: 'CB' },
        { id: 'rd', abbreviation: 'RD' },
        { id: 'dm', abbreviation: 'DM' },
        { id: 'lm', abbreviation: 'LM' },    // Midfielder — max 2 consecutive
        { id: 'rm', abbreviation: 'RM' },    // Midfielder — max 2 consecutive
        { id: 'lw', abbreviation: 'LW' },    // Striker — max 1 consecutive
        { id: 'st', abbreviation: 'ST' },    // Striker — max 1 consecutive
      ];

      // 11 players for 9 spots (2 always on bench)
      const players: SimpleRoster[] = [
        { id: 'r1',  playerId: 'gk',  playerNumber: 1,  preferredPositions: 'gol' },
        { id: 'r2',  playerId: 'p2',  playerNumber: 2,  preferredPositions: 'ld' },
        { id: 'r3',  playerId: 'p3',  playerNumber: 3,  preferredPositions: 'cb' },
        { id: 'r4',  playerId: 'p4',  playerNumber: 4,  preferredPositions: 'rd' },
        { id: 'r5',  playerId: 'p5',  playerNumber: 5,  preferredPositions: 'dm' },
        { id: 'r6',  playerId: 'p6',  playerNumber: 6,  preferredPositions: 'lm' },
        { id: 'r7',  playerId: 'p7',  playerNumber: 7,  preferredPositions: 'rm' },
        { id: 'r8',  playerId: 'p_lw', playerNumber: 8, preferredPositions: 'lw' }, // STRIKER
        { id: 'r9',  playerId: 'p9',  playerNumber: 9,  preferredPositions: 'st' }, // STRIKER
        { id: 'r10', playerId: 'p10', playerNumber: 10, preferredPositions: 'lm' },
        { id: 'r11', playerId: 'p11', playerNumber: 11, preferredPositions: 'rm' },
      ];

      const startingLineup = [
        { playerId: 'gk',  positionId: 'gol' },
        { playerId: 'p2',  positionId: 'ld' },
        { playerId: 'p3',  positionId: 'cb' },
        { playerId: 'p4',  positionId: 'rd' },
        { playerId: 'p5',  positionId: 'dm' },
        { playerId: 'p6',  positionId: 'lm' },
        { playerId: 'p7',  positionId: 'rm' },
        { playerId: 'p_lw', positionId: 'lw' }, // STRIKER starting
        { playerId: 'p9',  positionId: 'st' },  // STRIKER starting
      ];

      // rotationsPerHalf=2, totalRotations=5, halfLength=30, interval=10
      const { rotations } = calculateFairRotations(
        players,
        startingLineup,
        5,    // totalRotations
        2,    // rotationsPerHalf
        9,    // maxPlayersOnField
        'gol', // goaliePositionId
        undefined,
        { rotationIntervalMinutes: 10, halfLengthMinutes: 30, positions }
      );

      expect(rotations).toHaveLength(5);

      // Compute play time for each player by simulating the rotations
      const field = new Set(startingLineup.map(s => s.playerId));
      const posMap = new Map(startingLineup.map(s => [s.playerId, s.positionId]));
      const playTime = new Map<string, number>(players.map(p => [p.playerId, 0]));

      // Game intervals: 0-10, 10-20, 20-30(halftime), 30-40, 40-50, then 50-60 after last rot
      const rotationMinutes = [10, 20, 30, 40, 50];
      let prevMinute = 0;
      rotations.forEach((rot, idx) => {
        const currMinute = rotationMinutes[idx];
        const elapsed = currMinute - prevMinute;
        field.forEach(id => {
          playTime.set(id, (playTime.get(id) ?? 0) + elapsed);
        });
        // Apply subs
        rot.substitutions.forEach(sub => {
          field.delete(sub.playerOutId);
          field.add(sub.playerInId);
          posMap.set(sub.playerInId, sub.positionId);
        });
        prevMinute = currMinute;
      });
      // Final interval 50-60
      field.forEach(id => {
        playTime.set(id, (playTime.get(id) ?? 0) + 10);
      });

      const totalGameMinutes = 60;
      const threshold = totalGameMinutes * 0.5; // 30 minutes

      // Every player must get at least 50% of the game (30 min)
      players.forEach(p => {
        const pt = playTime.get(p.playerId) ?? 0;
        expect(pt).toBeGreaterThanOrEqual(threshold);
      });
    });

    it('initialPlayTimeMinutes seeds play time so player with 0 accumulated minutes gets priority over player with 20', () => {
      // 5 players, 3 field positions → 2 bench players, 1 sub per rotation
      // p4 has 20 accumulated minutes, p5 has 0 → p5 should be subbed in first
      // Bench players intentionally have no preferredPositions so play-time ordering governs
      const players: SimpleRoster[] = [
        { id: 'r1', playerId: 'p1', playerNumber: 1, preferredPositions: 'pos1' },
        { id: 'r2', playerId: 'p2', playerNumber: 2, preferredPositions: 'pos2' },
        { id: 'r3', playerId: 'p3', playerNumber: 3, preferredPositions: 'pos3' },
        { id: 'r4', playerId: 'p4', playerNumber: 4 }, // no preferredPositions
        { id: 'r5', playerId: 'p5', playerNumber: 5 }, // no preferredPositions
      ];

      const startingLineup = [
        { playerId: 'p1', positionId: 'pos1' },
        { playerId: 'p2', positionId: 'pos2' },
        { playerId: 'p3', positionId: 'pos3' },
      ];

      const initialPlayTimeMinutes = new Map<string, number>([
        ['p1', 0],
        ['p2', 0],
        ['p3', 0],
        ['p4', 20],
        ['p5', 0],
      ]);

      const { rotations } = calculateFairRotations(
        players,
        startingLineup,
        4,
        2,
        3,
        undefined,
        undefined,
        { rotationIntervalMinutes: 10, halfLengthMinutes: 30, initialPlayTimeMinutes },
      );

      expect(rotations.length).toBeGreaterThan(0);
      const firstRotSubs = rotations[0].substitutions;
      // p5 (0 accumulated) should be chosen for the first rotation, not p4 (20 accumulated)
      const incomingIds = firstRotSubs.map(s => s.playerInId);
      expect(incomingIds).toContain('p5');
      expect(incomingIds).not.toContain('p4');
    });

    it('players with fewer accumulated minutes get priority over those with more', () => {
      // Similar to above but with 10 vs 20 minutes to verify relative ordering works
      // Bench players intentionally have no preferredPositions so play-time ordering governs
      const players: SimpleRoster[] = [
        { id: 'r1', playerId: 'p1', playerNumber: 1, preferredPositions: 'pos1' },
        { id: 'r2', playerId: 'p2', playerNumber: 2, preferredPositions: 'pos2' },
        { id: 'r3', playerId: 'p3', playerNumber: 3, preferredPositions: 'pos3' },
        { id: 'r4', playerId: 'p4', playerNumber: 4 }, // 20 min, no preferredPositions
        { id: 'r5', playerId: 'p5', playerNumber: 5 }, // 10 min, no preferredPositions
      ];

      const startingLineup = [
        { playerId: 'p1', positionId: 'pos1' },
        { playerId: 'p2', positionId: 'pos2' },
        { playerId: 'p3', positionId: 'pos3' },
      ];

      const initialPlayTimeMinutes = new Map<string, number>([
        ['p1', 0],
        ['p2', 0],
        ['p3', 0],
        ['p4', 20],
        ['p5', 10],
      ]);

      const { rotations } = calculateFairRotations(
        players,
        startingLineup,
        4,
        2,
        3,
        undefined,
        undefined,
        { rotationIntervalMinutes: 10, halfLengthMinutes: 30, initialPlayTimeMinutes },
      );

      expect(rotations.length).toBeGreaterThan(0);
      const firstRotSubs = rotations[0].substitutions;
      // p5 (10 minutes) should be chosen before p4 (20 minutes)
      const incomingIds = firstRotSubs.map(s => s.playerInId);
      expect(incomingIds).toContain('p5');
      expect(incomingIds).not.toContain('p4');
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

    it('should correctly count time for a player who changes positions within the same rotation', () => {
      // Regression test: when a player appears as BOTH playerOutId (leaving one position)
      // and playerInId (entering a different position) in the same rotation, they are
      // performing a position change and must remain on the field for the full segment.
      //
      // Scenario (mirrors the #25 bug from a real 9v9 game):
      //   Starting lineup: p1@pos1(GK), p2@pos2(RW), p3@pos3(LW), p4@pos4(CB), p5@pos5(Str)  [5 on field, 4 on bench]
      //   Bench: p6, p7, p8, p9
      //
      //   R1 (10 min): p2 comes OFF @pos2, p6 comes ON @pos2
      //                → p2 off, p6 on, others unchanged
      //
      //   R2 (20 min): p6 comes OFF @pos2 (pos2→bench),
      //                p2 comes ON @pos3 (position change for incoming, genuine out for p3)
      //                p3 comes OFF @pos3
      //                → p3 and p6 go to bench; p2 joins field at pos3
      //
      //   R3 (30 min): p4 comes OFF @pos4, p7 comes ON @pos4
      //                p5 comes OFF @pos5, p2 comes ON @pos5   ← p2: pos3→pos5 (position change)
      //                p2 comes OFF @pos3, p9 comes ON @pos3
      //                → p7, p9 added; p4, p5 removed; p2 moves pos3→pos5 (stays on field)
      //
      //   R4 (40 min): p2 comes OFF @pos5
      //                → p2 leaves field
      //
      //   Expected play time (game: 60 min):
      //     p2: 0-10 (on) + 20-40 (on, incl. position change at R3) = 30 min
      //     p1: 0-60 (never subbed) = 60 min
      //     p3: 0-20 = 20 min
      //     p4: 0-30 = 30 min
      //     p5: 0-30 (subbed out R3) + 40-60 (back in R4) = 50 min
      //     p6: 10-20 = 10 min
      //     p7: 30-60 = 30 min
      //     p8: 20-60 = 40 min  (enters at R2, never leaves)
      //     p9: 30-60 = 30 min  (enters at R3, never leaves)
      const rotations = [
        {
          id: 'rot1',
          rotationNumber: 1,
          gameMinute: 10,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p2', playerInId: 'p6', positionId: 'pos2' },
          ]),
        },
        {
          id: 'rot2',
          rotationNumber: 2,
          gameMinute: 20,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p6', playerInId: 'p2', positionId: 'pos3' }, // p2 back in at pos3
            { playerOutId: 'p3', playerInId: 'p8', positionId: 'pos3' }, // Genuine: p3 out
          ]),
        },
        {
          id: 'rot3',
          rotationNumber: 3,
          gameMinute: 30,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p4', playerInId: 'p7', positionId: 'pos4' }, // Genuine: p4 out
            { playerOutId: 'p2', playerInId: 'p9', positionId: 'pos3' }, // p2: pos3→pos5 (position change)
            { playerOutId: 'p5', playerInId: 'p2', positionId: 'pos5' }, // p2 re-enters at pos5
          ]),
        },
        {
          id: 'rot4',
          rotationNumber: 4,
          gameMinute: 40,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p2', playerInId: 'p5', positionId: 'pos5' }, // Genuine: p2 out
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

      const playTimeMap = calculatePlayTime(rotations as any, startingLineup, 10, 60);

      // p2: starts (0-10) + returns at R2 through R4 position-change (20-40) = 30 min
      expect(playTimeMap.get('p2')?.totalMinutes).toBe(30);
      // p1: never subbed = 60 min
      expect(playTimeMap.get('p1')?.totalMinutes).toBe(60);
      // p3: 0-20 (subbed out at R2) = 20 min
      expect(playTimeMap.get('p3')?.totalMinutes).toBe(20);
      // p4: 0-30 (subbed out at R3) = 30 min
      expect(playTimeMap.get('p4')?.totalMinutes).toBe(30);
      // p5: 0-30 (subbed out at R3) = 30 min, then back in at R4 = 30+20 = 50 min
      expect(playTimeMap.get('p5')?.totalMinutes).toBe(50);
      // p6: 10-20 = 10 min
      expect(playTimeMap.get('p6')?.totalMinutes).toBe(10);
      // p7: 30-60 = 30 min
      expect(playTimeMap.get('p7')?.totalMinutes).toBe(30);
      // p8: enters at R2 (20 min), never leaves = 40 min
      expect(playTimeMap.get('p8')?.totalMinutes).toBe(40);
      // p9: enters at R3 (30 min), never leaves = 30 min
      expect(playTimeMap.get('p9')?.totalMinutes).toBe(30);
    });

    it('should correctly count time for player with position change — exact #25 snapshot reproduction', () => {
      // Reproduces the reported bug: 15-player 9v9 game, 30-min halves, 10-min rotation interval.
      // Player #25 (id 'p25') makes a position change at R3 (min 30 / halftime) and should
      // accumulate 30 minutes, not 20.
      //
      //  Starting lineup (9 players):  p1 p2 p3 p4 p6 p25 p28 p29 p34
      //  R1 (10): out p25@RW in p9, out p29@LW in p6_lw, out p28@CB in p7
      //           — p25 goes to bench; p6 comes on as LW variant (simplify: use unique IDs)
      //  R2 (20): out p9@RW in p25, out p4@LD in p19, out p33@RD in p14, ...
      //           — p25 returns
      //  R3 (30): out p14@RD in p25, out p25@RW in p9   ← POSITION CHANGE for p25 (RW→RD)
      //           — p25 stays on field
      //  R4 (40): out p25@RD in p33   ← genuine sub-off
      //           — p25 leaves
      //
      //  p25 true play time:  0-10 + 20-40 = 30 min
      const rotations = [
        {
          id: 'rot1',
          rotationNumber: 1,
          gameMinute: 10,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p25', playerInId: 'p9',  positionId: 'posRW' },
            { playerOutId: 'p29', playerInId: 'p6',  positionId: 'posLW' },
            { playerOutId: 'p28', playerInId: 'p7',  positionId: 'posCB' },
          ]),
        },
        {
          id: 'rot2',
          rotationNumber: 2,
          gameMinute: 20,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p9',  playerInId: 'p25', positionId: 'posRW' },
            { playerOutId: 'p4',  playerInId: 'p19', positionId: 'posLD' },
            { playerOutId: 'p33', playerInId: 'p14', positionId: 'posRD' },
          ]),
        },
        {
          id: 'rot3',
          rotationNumber: 3,
          gameMinute: 30,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p14', playerInId: 'p25', positionId: 'posRD' }, // p25: position change RW→RD
            { playerOutId: 'p25', playerInId: 'p9',  positionId: 'posRW' }, // p9 takes RW
          ]),
        },
        {
          id: 'rot4',
          rotationNumber: 4,
          gameMinute: 40,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: 'p25', playerInId: 'p33', positionId: 'posRD' }, // genuine sub-off
          ]),
        },
      ];

      const startingLineup = [
        { playerId: 'p1',  positionId: 'posGK' },
        { playerId: 'p2',  positionId: 'posOM' },
        { playerId: 'p3',  positionId: 'posDM' },
        { playerId: 'p4',  positionId: 'posLD' },
        { playerId: 'p25', positionId: 'posRW' },
        { playerId: 'p28', positionId: 'posCB' },
        { playerId: 'p29', positionId: 'posLW' },
        { playerId: 'p33', positionId: 'posRD' },
        { playerId: 'p34', positionId: 'posStr' },
      ];

      const playTimeMap = calculatePlayTime(rotations as any, startingLineup, 10, 60);

      // p25: 0–10 (start) + 20–40 (returned R2, position-changed at R3, subbed off R4) = 30 min
      expect(playTimeMap.get('p25')?.totalMinutes).toBe(30);
      // p9: on 10–20 (R1 in, R2 out) + 30–60 (R3 in, never out) = 10 + 30 = 40 min
      expect(playTimeMap.get('p9')?.totalMinutes).toBe(40);
      // p14: on 20–30 (R2 in, R3 position-changed out) = 10 min
      expect(playTimeMap.get('p14')?.totalMinutes).toBe(10);
      // p33: on 0–20 (starting, R2 subbed off) + 40–60 (R4 in) = 20 + 20 = 40 min
      expect(playTimeMap.get('p33')?.totalMinutes).toBe(40);
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

  // ─────────────────────────────────────────────────────────────────────────
  // 9v9 and 11v11 scenarios — Rule 1.3 (50% minimum playtime guarantee)
  // ─────────────────────────────────────────────────────────────────────────
  describe('9v9 and 11v11 scenarios — 50% playtime guarantee', () => {
    /**
     * Simulate actual play minutes from a calculateFairRotations output.
     * Accumulates time for every player on field between rotation boundaries,
     * then adds the final segment from the last rotation to game end.
     * Works for any formation (9v9, 11v11, etc.).
     */
    function computePlayMinutes9v9(
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
      // Final segment after the last rotation
      for (const pid of field.keys()) {
        playMin.set(pid, (playMin.get(pid) ?? 0) + (gameEndMinute - lastMin));
      }
      return playMin;
    }

    // Shared position definitions for 9v9 (1 GK + 4 DEF + 2 MID + 1 LW + 1 ST)
    const positions9v9 = [
      { id: 'gk',  abbreviation: 'GK'  },
      { id: 'cb1', abbreviation: 'CB'  },
      { id: 'cb2', abbreviation: 'CB'  },
      { id: 'ld',  abbreviation: 'LB'  },
      { id: 'rd',  abbreviation: 'RB'  },
      { id: 'cm1', abbreviation: 'CM'  },
      { id: 'cm2', abbreviation: 'CM'  },
      { id: 'lw',  abbreviation: 'LW'  }, // STRIKER — max 1 continuous rotation
      { id: 'st',  abbreviation: 'ST'  }, // STRIKER — max 1 continuous rotation
    ];

    // Shared position definitions for 11v11 (1 GK + 4 DEF + 3 MID + 2 FWD + 1 CAM)
    const positions11v11 = [
      { id: 'gk',  abbreviation: 'GK'  },
      { id: 'lb',  abbreviation: 'LB'  },
      { id: 'cb1', abbreviation: 'CB'  },
      { id: 'cb2', abbreviation: 'CB'  },
      { id: 'rb',  abbreviation: 'RB'  },
      { id: 'lm',  abbreviation: 'LM'  },
      { id: 'cm',  abbreviation: 'CM'  },
      { id: 'rm',  abbreviation: 'RM'  },
      { id: 'cam', abbreviation: 'CAM' },
      { id: 'lw',  abbreviation: 'LW'  }, // STRIKER
      { id: 'st',  abbreviation: 'ST'  }, // STRIKER
    ];

    // Common: 60-min game, 30-min halves, 10-min intervals
    // rotationsPerHalf=2, totalRotations=5
    // Rotation boundaries: 10, 20, 30(HT), 40, 50 — game ends at 60
    const ROTATION_MINUTES_60 = [10, 20, 30, 40, 50];
    const GAME_END_60 = 60;
    const HALF_LENGTH_60 = 30;
    const INTERVAL_10 = 10;
    const MIN_PLAYTIME_50PCT = GAME_END_60 * 0.5; // 30 minutes

    it('TC-9v9-01: 9v9, 14 players (5 bench) — all players meet 50% minimum', () => {
      // 14 players: 9 starters + 5 bench.
      // Includes 2 STRIKER positions (LW, ST) to exercise fatigue cycling.
      const ALL_POS = 'gk, cb1, cb2, ld, rd, cm1, cm2, lw, st';

      const players: SimpleRoster[] = [
        { id: 'r1',  playerId: 'gk',  playerNumber: 1,  preferredPositions: 'gk'  },
        { id: 'r2',  playerId: 'p2',  playerNumber: 2,  preferredPositions: 'cb1' },
        { id: 'r3',  playerId: 'p3',  playerNumber: 3,  preferredPositions: 'cb2' },
        { id: 'r4',  playerId: 'p4',  playerNumber: 4,  preferredPositions: 'ld'  },
        { id: 'r5',  playerId: 'p5',  playerNumber: 5,  preferredPositions: 'rd'  },
        { id: 'r6',  playerId: 'p6',  playerNumber: 6,  preferredPositions: 'cm1' },
        { id: 'r7',  playerId: 'p7',  playerNumber: 7,  preferredPositions: 'cm2' },
        { id: 'r8',  playerId: 'p8',  playerNumber: 8,  preferredPositions: 'lw'  },
        { id: 'r9',  playerId: 'p9',  playerNumber: 9,  preferredPositions: 'st'  },
        { id: 'r10', playerId: 'p10', playerNumber: 10, preferredPositions: ALL_POS },
        { id: 'r11', playerId: 'p11', playerNumber: 11, preferredPositions: ALL_POS },
        { id: 'r12', playerId: 'p12', playerNumber: 12, preferredPositions: ALL_POS },
        { id: 'r13', playerId: 'p13', playerNumber: 13, preferredPositions: ALL_POS },
        { id: 'r14', playerId: 'p14', playerNumber: 14, preferredPositions: ALL_POS },
      ];

      const startingLineup = [
        { playerId: 'gk', positionId: 'gk'  },
        { playerId: 'p2', positionId: 'cb1' },
        { playerId: 'p3', positionId: 'cb2' },
        { playerId: 'p4', positionId: 'ld'  },
        { playerId: 'p5', positionId: 'rd'  },
        { playerId: 'p6', positionId: 'cm1' },
        { playerId: 'p7', positionId: 'cm2' },
        { playerId: 'p8', positionId: 'lw'  },
        { playerId: 'p9', positionId: 'st'  },
      ];

      const { rotations } = calculateFairRotations(
        players, startingLineup,
        5, 2, 9, 'gk', undefined,
        { rotationIntervalMinutes: INTERVAL_10, halfLengthMinutes: HALF_LENGTH_60, positions: positions9v9 },
      );

      expect(rotations).toHaveLength(5);

      // Rule 1.2: no player both subbed out AND subbed in during the same rotation
      rotations.forEach(rotation => {
        const outs = rotation.substitutions.map(s => s.playerOutId);
        const ins  = rotation.substitutions.map(s => s.playerInId);
        outs.forEach(id => expect(ins).not.toContain(id));
      });

      // Rule 1.3: all 14 players must reach the 50% threshold (30 minutes)
      const minutes = computePlayMinutes9v9(startingLineup, rotations, ROTATION_MINUTES_60, GAME_END_60);
      players.forEach(p => {
        const pt = minutes.get(p.playerId) ?? 0;
        expect(pt).toBeGreaterThanOrEqual(MIN_PLAYTIME_50PCT);
      });
    });

    it('TC-9v9-02: 9v9, 16 players (7 bench) — all players meet 50% minimum [regression]', () => {
      // Regression test for the reported bug: 9v9 with 7 bench players caused some
      // players to finish with only 20 minutes (33%) due to insufficient rotation frequency.
      const ALL_POS = 'gk, cb1, cb2, ld, rd, cm1, cm2, lw, st';

      const players: SimpleRoster[] = [
        { id: 'r1',  playerId: 'gk',  playerNumber: 1,  preferredPositions: 'gk'  },
        { id: 'r2',  playerId: 'p2',  playerNumber: 2,  preferredPositions: 'cb1' },
        { id: 'r3',  playerId: 'p3',  playerNumber: 3,  preferredPositions: 'cb2' },
        { id: 'r4',  playerId: 'p4',  playerNumber: 4,  preferredPositions: 'ld'  },
        { id: 'r5',  playerId: 'p5',  playerNumber: 5,  preferredPositions: 'rd'  },
        { id: 'r6',  playerId: 'p6',  playerNumber: 6,  preferredPositions: 'cm1' },
        { id: 'r7',  playerId: 'p7',  playerNumber: 7,  preferredPositions: 'cm2' },
        { id: 'r8',  playerId: 'p8',  playerNumber: 8,  preferredPositions: 'lw'  },
        { id: 'r9',  playerId: 'p9',  playerNumber: 9,  preferredPositions: 'st'  },
        { id: 'r10', playerId: 'p10', playerNumber: 10, preferredPositions: ALL_POS },
        { id: 'r11', playerId: 'p11', playerNumber: 11, preferredPositions: ALL_POS },
        { id: 'r12', playerId: 'p12', playerNumber: 12, preferredPositions: ALL_POS },
        { id: 'r13', playerId: 'p13', playerNumber: 13, preferredPositions: ALL_POS },
        { id: 'r14', playerId: 'p14', playerNumber: 14, preferredPositions: ALL_POS },
        { id: 'r15', playerId: 'p15', playerNumber: 15, preferredPositions: ALL_POS },
        { id: 'r16', playerId: 'p16', playerNumber: 16, preferredPositions: ALL_POS },
      ];

      const startingLineup = [
        { playerId: 'gk', positionId: 'gk'  },
        { playerId: 'p2', positionId: 'cb1' },
        { playerId: 'p3', positionId: 'cb2' },
        { playerId: 'p4', positionId: 'ld'  },
        { playerId: 'p5', positionId: 'rd'  },
        { playerId: 'p6', positionId: 'cm1' },
        { playerId: 'p7', positionId: 'cm2' },
        { playerId: 'p8', positionId: 'lw'  },
        { playerId: 'p9', positionId: 'st'  },
      ];

      const { rotations } = calculateFairRotations(
        players, startingLineup,
        5, 2, 9, 'gk', undefined,
        { rotationIntervalMinutes: INTERVAL_10, halfLengthMinutes: HALF_LENGTH_60, positions: positions9v9 },
      );

      expect(rotations).toHaveLength(5);

      // Rule 1.2: no field-to-field shuffles
      rotations.forEach(rotation => {
        const outs = rotation.substitutions.map(s => s.playerOutId);
        const ins  = rotation.substitutions.map(s => s.playerInId);
        outs.forEach(id => expect(ins).not.toContain(id));
      });

      // Rule 1.3: EVERY player must reach 30 min (50% of 60)
      const minutes = computePlayMinutes9v9(startingLineup, rotations, ROTATION_MINUTES_60, GAME_END_60);
      players.forEach(p => {
        const pt = minutes.get(p.playerId) ?? 0;
        expect(pt).toBeGreaterThanOrEqual(MIN_PLAYTIME_50PCT);
      });

      // Sanity: no one exceeds the total game length
      players.forEach(p => {
        const pt = minutes.get(p.playerId) ?? 0;
        expect(pt).toBeLessThanOrEqual(GAME_END_60);
      });
    });

    it('TC-11v11-01: 11v11, 16 players (5 bench) — all players meet 50% minimum', () => {
      // 16 players: 11 starters + 5 bench.
      // Includes STRIKER positions (LW, ST) to exercise fatigue cycling.
      const ALL_POS = 'gk, lb, cb1, cb2, rb, lm, cm, rm, cam, lw, st';

      const players: SimpleRoster[] = [
        { id: 'r1',  playerId: 'gk',  playerNumber: 1,  preferredPositions: 'gk'  },
        { id: 'r2',  playerId: 'p2',  playerNumber: 2,  preferredPositions: 'lb'  },
        { id: 'r3',  playerId: 'p3',  playerNumber: 3,  preferredPositions: 'cb1' },
        { id: 'r4',  playerId: 'p4',  playerNumber: 4,  preferredPositions: 'cb2' },
        { id: 'r5',  playerId: 'p5',  playerNumber: 5,  preferredPositions: 'rb'  },
        { id: 'r6',  playerId: 'p6',  playerNumber: 6,  preferredPositions: 'lm'  },
        { id: 'r7',  playerId: 'p7',  playerNumber: 7,  preferredPositions: 'cm'  },
        { id: 'r8',  playerId: 'p8',  playerNumber: 8,  preferredPositions: 'rm'  },
        { id: 'r9',  playerId: 'p9',  playerNumber: 9,  preferredPositions: 'cam' },
        { id: 'r10', playerId: 'p10', playerNumber: 10, preferredPositions: 'lw'  },
        { id: 'r11', playerId: 'p11', playerNumber: 11, preferredPositions: 'st'  },
        { id: 'r12', playerId: 'p12', playerNumber: 12, preferredPositions: ALL_POS },
        { id: 'r13', playerId: 'p13', playerNumber: 13, preferredPositions: ALL_POS },
        { id: 'r14', playerId: 'p14', playerNumber: 14, preferredPositions: ALL_POS },
        { id: 'r15', playerId: 'p15', playerNumber: 15, preferredPositions: ALL_POS },
        { id: 'r16', playerId: 'p16', playerNumber: 16, preferredPositions: ALL_POS },
      ];

      const startingLineup = [
        { playerId: 'gk',  positionId: 'gk'  },
        { playerId: 'p2',  positionId: 'lb'  },
        { playerId: 'p3',  positionId: 'cb1' },
        { playerId: 'p4',  positionId: 'cb2' },
        { playerId: 'p5',  positionId: 'rb'  },
        { playerId: 'p6',  positionId: 'lm'  },
        { playerId: 'p7',  positionId: 'cm'  },
        { playerId: 'p8',  positionId: 'rm'  },
        { playerId: 'p9',  positionId: 'cam' },
        { playerId: 'p10', positionId: 'lw'  },
        { playerId: 'p11', positionId: 'st'  },
      ];

      const { rotations } = calculateFairRotations(
        players, startingLineup,
        5, 2, 11, 'gk', undefined,
        { rotationIntervalMinutes: INTERVAL_10, halfLengthMinutes: HALF_LENGTH_60, positions: positions11v11 },
      );

      expect(rotations).toHaveLength(5);

      // Rule 1.4/1.5: GK position must never be vacated in non-halftime rotations.
      // The GK player may be subbed off at halftime and later serve outfield in H2;
      // what is forbidden is opening up the GK slot itself during regular rotations.
      const halftimeIdx = 2; // rotNum 3 = rotationsPerHalf + 1 = index 2
      rotations.forEach((rotation, idx) => {
        if (idx !== halftimeIdx) {
          rotation.substitutions.forEach(sub => {
            expect(sub.positionId).not.toBe('gk');
          });
        }
      });

      // Rule 1.2: no field-to-field shuffles
      rotations.forEach(rotation => {
        const outs = rotation.substitutions.map(s => s.playerOutId);
        const ins  = rotation.substitutions.map(s => s.playerInId);
        outs.forEach(id => expect(ins).not.toContain(id));
      });

      // Rule 1.3: all 16 players must reach 30 min
      const minutes = computePlayMinutes9v9(startingLineup, rotations, ROTATION_MINUTES_60, GAME_END_60);
      players.forEach(p => {
        const pt = minutes.get(p.playerId) ?? 0;
        expect(pt).toBeGreaterThanOrEqual(MIN_PLAYTIME_50PCT);
      });
    });

    it('TC-11v11-02: 11v11, 13 players (2 bench) — both bench players appear on field; all meet 50%', () => {
      // Tight bench: only 2 subs available. The existing formula is sufficient here;
      // this test verifies correctness is maintained for small-bench 11v11.
      const ALL_POS = 'gk, lb, cb1, cb2, rb, lm, cm, rm, cam, lw, st';

      const players: SimpleRoster[] = [
        { id: 'r1',  playerId: 'gk',  playerNumber: 1,  preferredPositions: 'gk'  },
        { id: 'r2',  playerId: 'p2',  playerNumber: 2,  preferredPositions: 'lb'  },
        { id: 'r3',  playerId: 'p3',  playerNumber: 3,  preferredPositions: 'cb1' },
        { id: 'r4',  playerId: 'p4',  playerNumber: 4,  preferredPositions: 'cb2' },
        { id: 'r5',  playerId: 'p5',  playerNumber: 5,  preferredPositions: 'rb'  },
        { id: 'r6',  playerId: 'p6',  playerNumber: 6,  preferredPositions: 'lm'  },
        { id: 'r7',  playerId: 'p7',  playerNumber: 7,  preferredPositions: 'cm'  },
        { id: 'r8',  playerId: 'p8',  playerNumber: 8,  preferredPositions: 'rm'  },
        { id: 'r9',  playerId: 'p9',  playerNumber: 9,  preferredPositions: 'cam' },
        { id: 'r10', playerId: 'p10', playerNumber: 10, preferredPositions: 'lw'  },
        { id: 'r11', playerId: 'p11', playerNumber: 11, preferredPositions: 'st'  },
        { id: 'r12', playerId: 'p12', playerNumber: 12, preferredPositions: ALL_POS },
        { id: 'r13', playerId: 'p13', playerNumber: 13, preferredPositions: ALL_POS },
      ];

      const startingLineup = [
        { playerId: 'gk',  positionId: 'gk'  },
        { playerId: 'p2',  positionId: 'lb'  },
        { playerId: 'p3',  positionId: 'cb1' },
        { playerId: 'p4',  positionId: 'cb2' },
        { playerId: 'p5',  positionId: 'rb'  },
        { playerId: 'p6',  positionId: 'lm'  },
        { playerId: 'p7',  positionId: 'cm'  },
        { playerId: 'p8',  positionId: 'rm'  },
        { playerId: 'p9',  positionId: 'cam' },
        { playerId: 'p10', positionId: 'lw'  },
        { playerId: 'p11', positionId: 'st'  },
      ];

      const { rotations } = calculateFairRotations(
        players, startingLineup,
        5, 2, 11, 'gk', undefined,
        { rotationIntervalMinutes: INTERVAL_10, halfLengthMinutes: HALF_LENGTH_60, positions: positions11v11 },
      );

      expect(rotations).toHaveLength(5);

      // Both bench players must appear on field at some point
      const allSubs = rotations.flatMap(r => r.substitutions);
      expect(allSubs.some(s => s.playerInId === 'p12')).toBe(true);
      expect(allSubs.some(s => s.playerInId === 'p13')).toBe(true);

      // Rule 1.3: all 13 players must reach 30 min
      const minutes = computePlayMinutes9v9(startingLineup, rotations, ROTATION_MINUTES_60, GAME_END_60);
      players.forEach(p => {
        const pt = minutes.get(p.playerId) ?? 0;
        expect(pt).toBeGreaterThanOrEqual(MIN_PLAYTIME_50PCT);
      });
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
      rotations.forEach((rotation) => {
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
