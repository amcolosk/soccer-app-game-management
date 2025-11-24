/**
 * Unit tests for playTimeCalculations utilities
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculatePlayerPlayTime,
  calculatePlayTimeByPosition,
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
  startTime?: string | null;
  endTime?: string | null;
  durationSeconds?: number | null;
  createdAt: string;
  updatedAt: string;
}

interface Game {
  id: string;
  teamId: string;
  opponent: string;
  gameDate: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

describe('playTimeCalculations', () => {
  const mockPlayerId = 'player-123';
  const mockGameId = 'game-456';
  const mockPositionId = 'position-789';
  
  describe('calculatePlayerPlayTime', () => {
    it('should calculate play time from durationSeconds when available', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'record-1',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: mockPositionId,
          startTime: '2024-01-01T10:00:00Z',
          endTime: '2024-01-01T10:20:00Z',
          durationSeconds: 1200, // 20 minutes
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:20:00Z',
        },
        {
          id: 'record-2',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: mockPositionId,
          startTime: '2024-01-01T10:30:00Z',
          endTime: '2024-01-01T10:40:00Z',
          durationSeconds: 600, // 10 minutes
          createdAt: '2024-01-01T10:30:00Z',
          updatedAt: '2024-01-01T10:40:00Z',
        },
      ];

      const total = calculatePlayerPlayTime(mockPlayerId, records);
      expect(total).toBe(1800); // 30 minutes total
    });

    it('should calculate play time from start/end times when durationSeconds is missing', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'record-1',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: mockPositionId,
          startTime: '2024-01-01T10:00:00Z',
          endTime: '2024-01-01T10:15:00Z',
          durationSeconds: null,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:15:00Z',
        },
      ];

      const total = calculatePlayerPlayTime(mockPlayerId, records);
      expect(total).toBe(900); // 15 minutes
    });

    it('should handle active records without game context', () => {
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      
      const records: PlayTimeRecord[] = [
        {
          id: 'record-1',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: mockPositionId,
          startTime: fiveMinutesAgo.toISOString(),
          endTime: null,
          durationSeconds: null,
          createdAt: fiveMinutesAgo.toISOString(),
          updatedAt: fiveMinutesAgo.toISOString(),
        },
      ];

      const total = calculatePlayerPlayTime(mockPlayerId, records);
      // Should be approximately 300 seconds (5 minutes)
      expect(total).toBeGreaterThanOrEqual(299);
      expect(total).toBeLessThanOrEqual(301);
    });

    it('should skip active records when game is not in-progress', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'record-1',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: mockPositionId,
          startTime: '2024-01-01T10:00:00Z',
          endTime: null,
          durationSeconds: null,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:00:00Z',
        },
      ];

      const games = new Map<string, Game>([
        [mockGameId, {
          id: mockGameId,
          teamId: 'team-1',
          opponent: 'Test Team',
          gameDate: '2024-01-01',
          status: 'completed',
          createdAt: '2024-01-01T09:00:00Z',
          updatedAt: '2024-01-01T11:00:00Z',
        } as Game],
      ]);

      const total = calculatePlayerPlayTime(mockPlayerId, records, games);
      expect(total).toBe(0); // Should skip active record for completed game
    });

    it('should count active records when game is in-progress', () => {
      const now = new Date();
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
      
      const records: PlayTimeRecord[] = [
        {
          id: 'record-1',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: mockPositionId,
          startTime: tenMinutesAgo.toISOString(),
          endTime: null,
          durationSeconds: null,
          createdAt: tenMinutesAgo.toISOString(),
          updatedAt: tenMinutesAgo.toISOString(),
        },
      ];

      const games = new Map<string, Game>([
        [mockGameId, {
          id: mockGameId,
          teamId: 'team-1',
          opponent: 'Test Team',
          gameDate: '2024-01-01',
          status: 'in-progress',
          createdAt: '2024-01-01T09:00:00Z',
          updatedAt: now.toISOString(),
        } as Game],
      ]);

      const total = calculatePlayerPlayTime(mockPlayerId, records, games);
      // Should be approximately 600 seconds (10 minutes)
      expect(total).toBeGreaterThanOrEqual(599);
      expect(total).toBeLessThanOrEqual(601);
    });

    it('should filter by playerId correctly', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'record-1',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: mockPositionId,
          startTime: '2024-01-01T10:00:00Z',
          endTime: '2024-01-01T10:20:00Z',
          durationSeconds: 1200,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:20:00Z',
        },
        {
          id: 'record-2',
          playerId: 'other-player',
          gameId: mockGameId,
          positionId: mockPositionId,
          startTime: '2024-01-01T10:00:00Z',
          endTime: '2024-01-01T10:30:00Z',
          durationSeconds: 1800,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:30:00Z',
        },
      ];

      const total = calculatePlayerPlayTime(mockPlayerId, records);
      expect(total).toBe(1200); // Only first record
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
          startTime: '2024-01-01T10:00:00Z',
          endTime: '2024-01-01T10:20:00Z',
          durationSeconds: 1200,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:20:00Z',
        },
        {
          id: 'record-2',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: 'pos-defense',
          startTime: '2024-01-01T10:25:00Z',
          endTime: '2024-01-01T10:35:00Z',
          durationSeconds: 600,
          createdAt: '2024-01-01T10:25:00Z',
          updatedAt: '2024-01-01T10:35:00Z',
        },
        {
          id: 'record-3',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: 'pos-forward',
          startTime: '2024-01-01T10:40:00Z',
          endTime: '2024-01-01T10:50:00Z',
          durationSeconds: 600,
          createdAt: '2024-01-01T10:40:00Z',
          updatedAt: '2024-01-01T10:50:00Z',
        },
      ];

      const positions = new Map([
        ['pos-forward', { positionName: 'Forward' }],
        ['pos-defense', { positionName: 'Defense' }],
      ]);

      const result = calculatePlayTimeByPosition(mockPlayerId, records, positions);
      
      expect(result.get('Forward')).toBe(1800); // 30 minutes
      expect(result.get('Defense')).toBe(600);  // 10 minutes
    });

    it('should handle unknown positions', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'record-1',
          playerId: mockPlayerId,
          gameId: mockGameId,
          positionId: 'unknown-pos',
          startTime: '2024-01-01T10:00:00Z',
          endTime: '2024-01-01T10:10:00Z',
          durationSeconds: 600,
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
          startTime: '2024-01-01T10:00:00Z',
          endTime: '2024-01-01T10:20:00Z',
          durationSeconds: 1200,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:20:00Z',
        },
        {
          id: 'record-2',
          playerId: mockPlayerId,
          gameId: 'game-1', // Same game
          positionId: mockPositionId,
          startTime: '2024-01-01T10:25:00Z',
          endTime: '2024-01-01T10:35:00Z',
          durationSeconds: 600,
          createdAt: '2024-01-01T10:25:00Z',
          updatedAt: '2024-01-01T10:35:00Z',
        },
        {
          id: 'record-3',
          playerId: mockPlayerId,
          gameId: 'game-2', // Different game
          positionId: mockPositionId,
          startTime: '2024-01-02T10:00:00Z',
          endTime: '2024-01-02T10:20:00Z',
          durationSeconds: 1200,
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
          startTime: '2024-01-01T10:00:00Z',
          endTime: '2024-01-01T10:20:00Z',
          durationSeconds: 1200,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:20:00Z',
        },
        {
          id: 'record-2',
          playerId: 'other-player',
          gameId: 'game-2',
          positionId: mockPositionId,
          startTime: '2024-01-02T10:00:00Z',
          endTime: '2024-01-02T10:20:00Z',
          durationSeconds: 1200,
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
          startTime: '2024-01-01T10:00:00Z',
          endTime: null, // Active record
          durationSeconds: null,
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
          startTime: '2024-01-01T10:00:00Z',
          endTime: '2024-01-01T10:20:00Z',
          durationSeconds: 1200,
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
          startTime: '2024-01-01T10:00:00Z',
          endTime: null,
          durationSeconds: null,
          createdAt: '2024-01-01T10:00:00Z',
          updatedAt: '2024-01-01T10:00:00Z',
        },
      ];

      const isPlaying = isPlayerCurrentlyPlaying(mockPlayerId, records);
      expect(isPlaying).toBe(false); // Other player is playing, not this one
    });
  });
});
