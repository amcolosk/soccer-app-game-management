/**
 * Unit tests for playTimeCalculations utilities
 */

import { describe, it, expect } from 'vitest';
import {
  calculatePlayerPlayTime,
  calculatePlayTimeByPosition,
  calculateGoalsByPosition,
  formatPlayTime,
  countGamesPlayed,
  isPlayerCurrentlyPlaying,
} from './playTimeCalculations';

// Mock types for testing - only include fields used by the calculation functions
interface PlayTimeRecord {
  id: string;
  playerId: string;
  gameId: string;
  positionId?: string | null;
  startGameSeconds: number;
  endGameSeconds?: number | null;
  createdAt: string;
  updatedAt: string;
}

interface Goal {
  id: string;
  gameId: string;
  scoredByUs: boolean;
  gameSeconds: number;
  scorerId?: string | null;
  assistId?: string | null;
  createdAt: string;
  updatedAt: string;
}


describe('playTimeCalculations', () => {
  const mockPlayerId = 'player-123';
  const mockGameId = 'game-456';
  const mockPositionId = 'position-789';
  
  describe('calculatePlayerPlayTime', () => {
    it('should calculate play time from completed records', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'record-1',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: mockPositionId,
          startGameSeconds: 0,
          endGameSeconds: 1200, // Played from 0 to 20 minutes (1200 seconds)
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:20:00Z',
        },
        {
          id: 'record-2',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: mockPositionId,
          startGameSeconds: 1200,
          endGameSeconds: 1800, // Played from 20 to 30 minutes (600 seconds)
          createdAt: '2024-01-01T10:30:00Z',
          updatedAt: '2024-01-01T10:40:00Z',
        },
      ];

      const total = calculatePlayerPlayTime(mockPlayerId, records);
      expect(total).toBe(1800); // 30 minutes total (1200 + 600)
    });

    it('should calculate play time from single record', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'record-1',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: mockPositionId,
          startGameSeconds: 0,
          endGameSeconds: 900, // Played from 0 to 15 minutes
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:15:00Z',
        },
      ];

      const total = calculatePlayerPlayTime(mockPlayerId, records);
      expect(total).toBe(900); // 15 minutes
    });

    it('should handle active records with current game time', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'record-1',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: mockPositionId,
          startGameSeconds: 0,
          endGameSeconds: null, // Still playing
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:00:00Z',
        },
      ];

      const currentGameTime = 300; // Game at 5 minutes (300 seconds)
      const total = calculatePlayerPlayTime(mockPlayerId, records, currentGameTime);
      expect(total).toBe(300); // Player has been on field for 5 minutes
    });

    it('should return 0 for active records without current game time', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'record-1',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: mockPositionId,
          startGameSeconds: 0,
          endGameSeconds: null, // Still playing
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:00:00Z',
        },
      ];

      const total = calculatePlayerPlayTime(mockPlayerId, records);
      expect(total).toBe(0); // No currentGameTime provided, so active record contributes 0
    });

    it('should count active records with provided current game time', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'record-1',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: mockPositionId,
          startGameSeconds: 0,
          endGameSeconds: null, // Still playing
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:00:00Z',
        },
      ];

      const currentGameTime = 600; // Game at 10 minutes
      const total = calculatePlayerPlayTime(mockPlayerId, records, currentGameTime);
      expect(total).toBe(600); // Player has been on field for 10 minutes
    });

    it('should filter by playerId correctly', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'record-1',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: mockPositionId,
          startGameSeconds: 0,
          endGameSeconds: 1200,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:20:00Z',
        },
        {
          id: 'record-2',
          playerId: 'other-player',
          gameId: mockGameId,
          positionId: mockPositionId,
          startGameSeconds: 0,
          endGameSeconds: 1800,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:30:00Z',
        },
      ];

      const total = calculatePlayerPlayTime(mockPlayerId, records);
      expect(total).toBe(1200); // Only first record
    });

    it('TC-HT-01: calculatePlayerPlayTime includes halftime offset — correctly excludes halftime pause', () => {
      // Simulate: Game starts T=0. Halftime starts T=1800 (30m). Second half starts T=2400 (40m). Current T=4200 (70m).
      // Total game time is 60m (3600s), Halftime was 10m (600s).
      const records: PlayTimeRecord[] = [
        {
          id: 'rec-1', playerId: mockPlayerId, gameId: mockGameId, positionId: 'pos-1',
          startGameSeconds: 0,
          endGameSeconds: null, // Still on field
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        }
      ];

      // Assuming calculatePlayerPlayTime signature takes a halftimeOffsetSeconds in the future.
      // We will write the test as it should work after implementation. If the signature doesn't support it,
      // it will fail (which is the goal of this test phase).
      const total = calculatePlayerPlayTime(mockPlayerId, records, 4200, 600); // 4200s elapsed, 600s HT offset
      
      // Expected total: 4200 - 600 = 3600 seconds (60 mins)
      expect(total).toBe(3600);
    });

    it('TC-HT-02: calculatePlayerPlayTime for halftime subs — computes correct duration for sub-on at second half start', () => {
      // Game started T=0. HT T=1800. H2 started T=2400. Current T=4200.
      // Player subbed ON at T=2400 (start of second half).
      const records: PlayTimeRecord[] = [
        {
          id: 'rec-1', playerId: mockPlayerId, gameId: mockGameId, positionId: 'pos-1',
          startGameSeconds: 2400,
          endGameSeconds: null, // Still on field
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        }
      ];

      // Since they came on AT 2400, their play time is simply currentGameTime(4200) - startGameSeconds(2400) = 1800s.
      // Halftime offset (600s) shouldn't double-penalize them if startGameSeconds is already past the offset.
      const total = calculatePlayerPlayTime(mockPlayerId, records, 4200, 600);
      
      expect(total).toBe(1800); // 30 mins
    });
  });

  describe('calculatePlayTimeByPosition', () => {
    it('should group play time by position', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'record-1',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: 'pos-forward',
          startGameSeconds: 0,
          endGameSeconds: 1200,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:20:00Z',
        },
        {
          id: 'record-2',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: 'pos-defense',
          startGameSeconds: 1200,
          endGameSeconds: 1800,
          createdAt: '2024-01-01T10:25:00Z',
          updatedAt: '2024-01-01T10:35:00Z',
        },
        {
          id: 'record-3',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: 'pos-forward',
          startGameSeconds: 1800,
          endGameSeconds: 2400,
          createdAt: '2024-01-01T10:40:00Z',
          updatedAt: '2024-01-01T10:50:00Z',
        },
      ];

      const positions = new Map([
        ['pos-forward', { positionName: 'Forward' }],
        ['pos-defense', { positionName: 'Defense' }],
      ]);

      const result = calculatePlayTimeByPosition(mockPlayerId, records, positions);
      
      expect(result.get('Forward')).toBe(1800); // 30 minutes (1200 + 600)
      expect(result.get('Defense')).toBe(600);  // 10 minutes
    });

    it('should handle unknown positions', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'record-1',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: 'unknown-pos',
          startGameSeconds: 0,
          endGameSeconds: 600,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:10:00Z',
        },
      ];

      const positions = new Map();

      const result = calculatePlayTimeByPosition(mockPlayerId, records, positions);
      
      expect(result.get('Unknown')).toBe(600);
    });
  });

  describe('formatPlayTime', () => {
    it('should format time in short format (MM:SS)', () => {
      expect(formatPlayTime(90)).toBe('1:30');
      expect(formatPlayTime(65)).toBe('1:05');
      expect(formatPlayTime(3661)).toBe('61:01'); // Over an hour
    });

    it('should format time in long format (Hh MMm)', () => {
      expect(formatPlayTime(90, 'long')).toBe('1m');
      expect(formatPlayTime(3600, 'long')).toBe('1h 0m');
      expect(formatPlayTime(3660, 'long')).toBe('1h 1m');
      expect(formatPlayTime(5400, 'long')).toBe('1h 30m');
      expect(formatPlayTime(7200, 'long')).toBe('2h 0m');
    });

    it('should format time in verbose format', () => {
      expect(formatPlayTime(30, 'verbose')).toBe('30 seconds');
      expect(formatPlayTime(60, 'verbose')).toBe('1 minute');
      expect(formatPlayTime(120, 'verbose')).toBe('2 minutes');
      expect(formatPlayTime(3600, 'verbose')).toBe('1 hour');
      expect(formatPlayTime(3660, 'verbose')).toBe('1 hour 1 minute');
      expect(formatPlayTime(7200, 'verbose')).toBe('2 hours');
      expect(formatPlayTime(7320, 'verbose')).toBe('2 hours 2 minutes');
    });

    it('should handle zero seconds', () => {
      expect(formatPlayTime(0)).toBe('0:00');
      expect(formatPlayTime(0, 'long')).toBe('0m');
      expect(formatPlayTime(0, 'verbose')).toBe('0 seconds');
    });
  });

  describe('countGamesPlayed', () => {
    it('should count unique games', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'record-1',
          playerId: mockPlayerId,
          gameId: 'game-1',
          positionId: mockPositionId,
          startGameSeconds: 0,
          endGameSeconds: 1200,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:20:00Z',
        },
        {
          id: 'record-2',
          playerId: mockPlayerId,
          gameId: 'game-1', // Same game
          positionId: mockPositionId,
          startGameSeconds: 1200,
          endGameSeconds: 1800,
          createdAt: '2024-01-01T10:25:00Z',
          updatedAt: '2024-01-01T10:35:00Z',
        },
        {
          id: 'record-3',
          playerId: mockPlayerId,
          gameId: 'game-2', // Different game
          positionId: mockPositionId,
          startGameSeconds: 0,
          endGameSeconds: 1200,
          createdAt: '2024-01-02T10:00:00Z',
          updatedAt: '2024-01-02T10:20:00Z',
        },
      ];

      const count = countGamesPlayed(mockPlayerId, records);
      expect(count).toBe(2); // Two unique games
    });

    it('should return 0 for no records', () => {
      const count = countGamesPlayed(mockPlayerId, []);
      expect(count).toBe(0);
    });

    it('should filter by playerId', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'record-1',
          playerId: mockPlayerId,
          gameId: 'game-1',
          positionId: mockPositionId,
          startGameSeconds: 0,
          endGameSeconds: 1200,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:20:00Z',
        },
        {
          id: 'record-2',
          playerId: 'other-player',
          gameId: 'game-2',
          positionId: mockPositionId,
          startGameSeconds: 0,
          endGameSeconds: 1200,
          createdAt: '2024-01-02T10:00:00Z',
          updatedAt: '2024-01-02T10:20:00Z',
        },
      ];

      const count = countGamesPlayed(mockPlayerId, records);
      expect(count).toBe(1); // Only first record
    });
  });

  describe('isPlayerCurrentlyPlaying', () => {
    it('should return true when player has active record', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'record-1',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: mockPositionId,
          startGameSeconds: 0,
          endGameSeconds: null, // Active record
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:00:00Z',
        },
      ];

      const isPlaying = isPlayerCurrentlyPlaying(mockPlayerId, records);
      expect(isPlaying).toBe(true);
    });

    it('should return false when all records are closed', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'record-1',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: mockPositionId,
          startGameSeconds: 0,
          endGameSeconds: 1200,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:20:00Z',
        },
      ];

      const isPlaying = isPlayerCurrentlyPlaying(mockPlayerId, records);
      expect(isPlaying).toBe(false);
    });

    it('should return false when no records exist', () => {
      const isPlaying = isPlayerCurrentlyPlaying(mockPlayerId, []);
      expect(isPlaying).toBe(false);
    });

    it('should filter by playerId', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'record-1',
          playerId: 'other-player',
          gameId: mockGameId,
          positionId: mockPositionId,
          startGameSeconds: 0,
          endGameSeconds: null,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:00:00Z',
        },
      ];

      const isPlaying = isPlayerCurrentlyPlaying(mockPlayerId, records);
      expect(isPlaying).toBe(false); // Other player is playing, not this one
    });
  });

  describe('calculateGoalsByPosition', () => {
    const positions = new Map([
      ['pos-fw', { positionName: 'Forward' }],
      ['pos-mf', { positionName: 'Midfielder' }],
    ]);

    it('counts only scoredByUs goals and attributes by matching play-time interval', () => {
      const goals: Goal[] = [
        {
          id: 'goal-1',
          gameId: mockGameId,
          scoredByUs: true,
          gameSeconds: 120,
          scorerId: mockPlayerId,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'goal-2',
          gameId: mockGameId,
          scoredByUs: false,
          gameSeconds: 200,
          scorerId: mockPlayerId,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];
      const records: PlayTimeRecord[] = [
        {
          id: 'rec-fw',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: 'pos-fw',
          startGameSeconds: 0,
          endGameSeconds: 600,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];

      expect(calculateGoalsByPosition(goals as never, records as never, positions)).toEqual([
        { positionId: 'pos-fw', positionName: 'Forward', goals: 1, assists: 0 },
      ]);
    });

    it('attributes assists by matching assistant play-time interval', () => {
      const goals: Goal[] = [
        {
          id: 'goal-1',
          gameId: mockGameId,
          scoredByUs: true,
          gameSeconds: 240,
          scorerId: mockPlayerId,
          assistId: 'assist-player',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];
      const records: PlayTimeRecord[] = [
        {
          id: 'rec-scorer',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: 'pos-fw',
          startGameSeconds: 0,
          endGameSeconds: 600,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'rec-assist',
          playerId: 'assist-player',
          gameId: mockGameId,
          positionId: 'pos-mf',
          startGameSeconds: 0,
          endGameSeconds: 600,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];

      expect(calculateGoalsByPosition(goals as never, records as never, positions)).toEqual([
        { positionId: 'pos-fw', positionName: 'Forward', goals: 1, assists: 0 },
        { positionId: 'pos-mf', positionName: 'Midfielder', goals: 0, assists: 1 },
      ]);
    });

    it('uses deterministic tie-break when intervals overlap', () => {
      const goals: Goal[] = [
        {
          id: 'goal-1',
          gameId: mockGameId,
          scoredByUs: true,
          gameSeconds: 400,
          scorerId: mockPlayerId,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];
      const records: PlayTimeRecord[] = [
        {
          id: 'rec-early',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: 'pos-fw',
          startGameSeconds: 0,
          endGameSeconds: 900,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'rec-late',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: 'pos-mf',
          startGameSeconds: 300,
          endGameSeconds: 900,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];

      expect(calculateGoalsByPosition(goals as never, records as never, positions)).toEqual([
        { positionId: 'pos-mf', positionName: 'Midfielder', goals: 1, assists: 0 },
      ]);
    });

    it('omits assist attribution when interval/position data is invalid', () => {
      const goals: Goal[] = [
        {
          id: 'goal-1',
          gameId: mockGameId,
          scoredByUs: true,
          gameSeconds: 200,
          scorerId: mockPlayerId,
          assistId: 'assist-player',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];
      const records: PlayTimeRecord[] = [
        {
          id: 'rec-scorer',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: 'pos-fw',
          startGameSeconds: 0,
          endGameSeconds: 600,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'rec-assist-unmapped',
          playerId: 'assist-player',
          gameId: mockGameId,
          positionId: 'pos-unknown',
          startGameSeconds: 0,
          endGameSeconds: 300,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];

      expect(calculateGoalsByPosition(goals as never, records as never, positions)).toEqual([
        { positionId: 'pos-fw', positionName: 'Forward', goals: 1, assists: 0 },
      ]);
    });

    it('handles open-ended intervals for goal and assist attribution', () => {
      const goals: Goal[] = [
        {
          id: 'goal-1',
          gameId: mockGameId,
          scoredByUs: true,
          gameSeconds: 500,
          scorerId: mockPlayerId,
          assistId: 'assist-player',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];
      const records: PlayTimeRecord[] = [
        {
          id: 'rec-scorer-open',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: 'pos-fw',
          startGameSeconds: 0,
          endGameSeconds: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'rec-assist-open',
          playerId: 'assist-player',
          gameId: mockGameId,
          positionId: 'pos-mf',
          startGameSeconds: 0,
          endGameSeconds: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];

      expect(calculateGoalsByPosition(goals as never, records as never, positions)).toEqual([
        { positionId: 'pos-fw', positionName: 'Forward', goals: 1, assists: 0 },
        { positionId: 'pos-mf', positionName: 'Midfielder', goals: 0, assists: 1 },
      ]);
    });

    it('omits unmatched, null-position, and unmapped position attributions', () => {
      const goals: Goal[] = [
        {
          id: 'goal-unmatched',
          gameId: mockGameId,
          scoredByUs: true,
          gameSeconds: 750,
          scorerId: mockPlayerId,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'goal-null-position',
          gameId: mockGameId,
          scoredByUs: true,
          gameSeconds: 100,
          scorerId: mockPlayerId,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'goal-unmapped-position',
          gameId: mockGameId,
          scoredByUs: true,
          gameSeconds: 200,
          scorerId: mockPlayerId,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];

      const records: PlayTimeRecord[] = [
        {
          id: 'rec-null-position',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: null,
          startGameSeconds: 0,
          endGameSeconds: 150,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'rec-unmapped-position',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: 'pos-unknown',
          startGameSeconds: 150,
          endGameSeconds: 300,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];

      expect(calculateGoalsByPosition(goals as never, records as never, positions)).toEqual([]);
    });

    it('sorts rows by goals desc then assists desc then deterministic ties', () => {
      const goals: Goal[] = [
        {
          id: 'goal-a',
          gameId: mockGameId,
          scoredByUs: true,
          gameSeconds: 100,
          scorerId: mockPlayerId,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'goal-b',
          gameId: mockGameId,
          scoredByUs: true,
          gameSeconds: 200,
          scorerId: mockPlayerId,
          assistId: 'assist-player',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];
      const records: PlayTimeRecord[] = [
        {
          id: 'rec-b',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: 'pos-mf',
          startGameSeconds: 150,
          endGameSeconds: 300,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'rec-a',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: 'pos-fw',
          startGameSeconds: 0,
          endGameSeconds: 150,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'rec-assist',
          playerId: 'assist-player',
          gameId: mockGameId,
          positionId: 'pos-fw',
          startGameSeconds: 150,
          endGameSeconds: 300,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];

      expect(calculateGoalsByPosition(goals as never, records as never, positions)).toEqual([
        { positionId: 'pos-fw', positionName: 'Forward', goals: 1, assists: 1 },
        { positionId: 'pos-mf', positionName: 'Midfielder', goals: 1, assists: 0 },
      ]);
    });
  });
});
