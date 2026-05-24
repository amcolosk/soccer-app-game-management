/**
 * Unit tests for playTimeCalculations utilities
 */

import { describe, it, expect } from 'vitest';
import {
  calculatePlayerPlayTime,
  calculatePlayTimeByPosition,
  calculateGoalsAssistsByPosition,
  calculateTeamGoalsAssistsByPosition,
  calculateGoalsByPosition,
  normalizeCompletedRecords,
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

    it('TC-HT-01: calculatePlayerPlayTime includes halftime offset G�� correctly excludes halftime pause', () => {
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

    it('TC-HT-02: calculatePlayerPlayTime for halftime subs G�� computes correct duration for sub-on at second half start', () => {
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

  describe('normalizeCompletedRecords', () => {
    it('should close unclosed records using gameEndSeconds', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'r1',
          playerId: mockPlayerId,
          gameId: mockGameId,
          startGameSeconds: 0,
          endGameSeconds: null,
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'r2',
          playerId: mockPlayerId,
          gameId: mockGameId,
          startGameSeconds: 600,
          endGameSeconds: 900,
          createdAt: '',
          updatedAt: '',
        },
      ];
      const result = normalizeCompletedRecords(records, 1200);
      expect(result[0].endGameSeconds).toBe(1200);
      expect(result[1].endGameSeconds).toBe(900); // already closed, unchanged
    });

    it('should not mutate original records', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'r1',
          playerId: mockPlayerId,
          gameId: mockGameId,
          startGameSeconds: 0,
          endGameSeconds: null,
          createdAt: '',
          updatedAt: '',
        },
      ];
      normalizeCompletedRecords(records, 600);
      expect(records[0].endGameSeconds).toBeNull();
    });
  });

  describe('calculateGoalsAssistsByPosition', () => {
    const positions = new Map([
      ['pos-fwd', { positionName: 'Forward', sortOrder: 1 }],
      ['pos-mid', { positionName: 'Midfielder', sortOrder: 2 }],
      ['pos-def', { positionName: 'Defender', sortOrder: 3 }],
    ]);

    it('attributes a goal to the position active at that game-second', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'r1', playerId: mockPlayerId, gameId: mockGameId,
          positionId: 'pos-fwd', startGameSeconds: 0, endGameSeconds: 600,
          createdAt: '', updatedAt: '',
        },
      ];
      const goals = [{ scorerId: mockPlayerId, assistId: null, gameSeconds: 300, gameId: mockGameId }];
      const result = calculateGoalsAssistsByPosition(mockPlayerId, records, goals, positions);
      const row = result.find(r => r.position === 'Forward');
      expect(row?.goals).toBe(1);
      expect(row?.assists).toBe(0);
    });

    it('attributes an assist to the position active at that game-second', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'r1', playerId: mockPlayerId, gameId: mockGameId,
          positionId: 'pos-mid', startGameSeconds: 0, endGameSeconds: 600,
          createdAt: '', updatedAt: '',
        },
      ];
      const goals = [{ scorerId: 'other', assistId: mockPlayerId, gameSeconds: 400, gameId: mockGameId }];
      const result = calculateGoalsAssistsByPosition(mockPlayerId, records, goals, positions);
      const row = result.find(r => r.position === 'Midfielder');
      expect(row?.assists).toBe(1);
      expect(row?.goals).toBe(0);
    });

    it('seeds all play-time positions with 0s even without events', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'r1', playerId: mockPlayerId, gameId: mockGameId,
          positionId: 'pos-fwd', startGameSeconds: 0, endGameSeconds: 600,
          createdAt: '', updatedAt: '',
        },
        {
          id: 'r2', playerId: mockPlayerId, gameId: mockGameId,
          positionId: 'pos-def', startGameSeconds: 600, endGameSeconds: 1200,
          createdAt: '', updatedAt: '',
        },
      ];
      const result = calculateGoalsAssistsByPosition(mockPlayerId, records, [], positions);
      expect(result.some(r => r.position === 'Forward')).toBe(true);
      expect(result.some(r => r.position === 'Defender')).toBe(true);
      result.forEach(r => {
        expect(r.goals).toBe(0);
        expect(r.assists).toBe(0);
      });
    });

    it('places "Unknown position" last', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'r1', playerId: mockPlayerId, gameId: mockGameId,
          positionId: null, startGameSeconds: 0, endGameSeconds: 600,
          createdAt: '', updatedAt: '',
        },
        {
          id: 'r2', playerId: mockPlayerId, gameId: mockGameId,
          positionId: 'pos-fwd', startGameSeconds: 600, endGameSeconds: 1200,
          createdAt: '', updatedAt: '',
        },
      ];
      const result = calculateGoalsAssistsByPosition(mockPlayerId, records, [], positions);
      expect(result[result.length - 1].position).toBe('Unknown position');
    });

    it('sorts rows by sortOrder ascending', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'r1', playerId: mockPlayerId, gameId: mockGameId,
          positionId: 'pos-def', startGameSeconds: 0, endGameSeconds: 400,
          createdAt: '', updatedAt: '',
        },
        {
          id: 'r2', playerId: mockPlayerId, gameId: mockGameId,
          positionId: 'pos-fwd', startGameSeconds: 400, endGameSeconds: 800,
          createdAt: '', updatedAt: '',
        },
        {
          id: 'r3', playerId: mockPlayerId, gameId: mockGameId,
          positionId: 'pos-mid', startGameSeconds: 800, endGameSeconds: 1200,
          createdAt: '', updatedAt: '',
        },
      ];
      const result = calculateGoalsAssistsByPosition(mockPlayerId, records, [], positions);
      expect(result.map(r => r.position)).toEqual(['Forward', 'Midfielder', 'Defender']);
    });

    it('attributes goal with null gameSeconds to Unknown position', () => {
      const records: PlayTimeRecord[] = [
        {
          id: 'r1', playerId: mockPlayerId, gameId: mockGameId,
          positionId: 'pos-fwd', startGameSeconds: 0, endGameSeconds: 600,
          createdAt: '', updatedAt: '',
        },
      ];
      const goals = [{ scorerId: mockPlayerId, assistId: null, gameSeconds: null, gameId: mockGameId }];
      const result = calculateGoalsAssistsByPosition(mockPlayerId, records, goals, positions);
      const unknown = result.find(r => r.position === 'Unknown position');
      expect(unknown?.goals).toBe(1);
    });
  });

  describe('calculateTeamGoalsAssistsByPosition', () => {
    const positions = new Map([
      ['pos-fwd', { positionName: 'Forward' }],
      ['pos-mid', { positionName: 'Midfielder' }],
      ['pos-def', { positionName: 'Defender' }],
    ]);

    const makeRecord = (
      playerId: string,
      gameId: string,
      positionId: string,
      start: number,
      end: number | null
    ): PlayTimeRecord => ({
      id: `r-${playerId}-${start}`,
      playerId,
      gameId,
      positionId,
      startGameSeconds: start,
      endGameSeconds: end,
      createdAt: '',
      updatedAt: '',
    });

    it('attributes a scorer goal to the active position at that game-second', () => {
      const records = [makeRecord('player-1', 'game-1', 'pos-fwd', 0, 600)];
      const goals = [{ scoredByUs: true, scorerId: 'player-1', assistId: null, gameSeconds: 300, gameId: 'game-1' }];
      const result = calculateTeamGoalsAssistsByPosition(goals, records, positions);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ position: 'Forward', goals: 1, assists: 0 });
    });

    it('attributes an assister independently of scorer', () => {
      const records = [
        makeRecord('player-1', 'game-1', 'pos-fwd', 0, 600),
        makeRecord('player-2', 'game-1', 'pos-mid', 0, 600),
      ];
      const goals = [{ scoredByUs: true, scorerId: 'player-1', assistId: 'player-2', gameSeconds: 300, gameId: 'game-1' }];
      const result = calculateTeamGoalsAssistsByPosition(goals, records, positions);
      const fwdRow = result.find(r => r.position === 'Forward')!;
      const midRow = result.find(r => r.position === 'Midfielder')!;
      expect(fwdRow).toEqual({ position: 'Forward', goals: 1, assists: 0 });
      expect(midRow).toEqual({ position: 'Midfielder', goals: 0, assists: 1 });
    });

    it('filters out goals where scoredByUs is false', () => {
      const records = [makeRecord('player-1', 'game-1', 'pos-fwd', 0, 600)];
      const goals = [{ scoredByUs: false, scorerId: 'player-1', assistId: null, gameSeconds: 300, gameId: 'game-1' }];
      const result = calculateTeamGoalsAssistsByPosition(goals, records, positions);
      expect(result).toHaveLength(0);
    });

    it('filters out goals where scoredByUs is null', () => {
      const records = [makeRecord('player-1', 'game-1', 'pos-fwd', 0, 600)];
      const goals = [{ scoredByUs: null, scorerId: 'player-1', assistId: null, gameSeconds: 300, gameId: 'game-1' }];
      const result = calculateTeamGoalsAssistsByPosition(goals, records, positions);
      expect(result).toHaveLength(0);
    });

    it('omits scorer event when no matching PlayTimeRecord exists G�� no Unknown row', () => {
      const records: PlayTimeRecord[] = []; // no records at all
      const goals = [{ scoredByUs: true, scorerId: 'player-1', assistId: null, gameSeconds: 300, gameId: 'game-1' }];
      const result = calculateTeamGoalsAssistsByPosition(goals, records, positions);
      expect(result).toHaveLength(0);
    });

    it('omits scorer event when positionId is not in the positions map', () => {
      const records = [makeRecord('player-1', 'game-1', 'pos-unknown', 0, 600)];
      const goals = [{ scoredByUs: true, scorerId: 'player-1', assistId: null, gameSeconds: 300, gameId: 'game-1' }];
      const result = calculateTeamGoalsAssistsByPosition(goals, records, positions);
      expect(result).toHaveLength(0);
    });

    it('treats null endGameSeconds as an open-ended interval', () => {
      // Record has no end (active/unclosed). Should still match any gameSeconds >= start.
      const records = [makeRecord('player-1', 'game-1', 'pos-fwd', 0, null)];
      const goals = [{ scoredByUs: true, scorerId: 'player-1', assistId: null, gameSeconds: 900, gameId: 'game-1' }];
      const result = calculateTeamGoalsAssistsByPosition(goals, records, positions);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ position: 'Forward', goals: 1, assists: 0 });
    });

    it('applies deterministic overlap rule: chooses record with greatest startGameSeconds', () => {
      // Two overlapping open-ended records for the same player. The one with
      // the greater startGameSeconds (pos-mid, start=300) should win.
      const records = [
        makeRecord('player-1', 'game-1', 'pos-fwd', 0, null),    // start=0, open
        makeRecord('player-1', 'game-1', 'pos-mid', 300, null),  // start=300, open
      ];
      const goals = [{ scoredByUs: true, scorerId: 'player-1', assistId: null, gameSeconds: 450, gameId: 'game-1' }];
      const result = calculateTeamGoalsAssistsByPosition(goals, records, positions);
      expect(result).toHaveLength(1);
      expect(result[0].position).toBe('Midfielder');
    });

    it('sorts rows by goals descending then assists descending', () => {
      // player-4 plays pos-gk which is NOT in the positions map.
      // Goals scored by player-4 (scorer contribution omitted) are used to
      // generate clean assists for other positions without inflating their goal tallies.
      const records = [
        makeRecord('player-1', 'game-1', 'pos-fwd', 0, 600),
        makeRecord('player-2', 'game-1', 'pos-mid', 0, 600),
        makeRecord('player-3', 'game-1', 'pos-def', 0, 600),
        makeRecord('player-4', 'game-1', 'pos-gk', 0, 600), // pos-gk not in positions map
      ];
      const goals = [
        // Forward: 3 goals, 0 assists
        { scoredByUs: true, scorerId: 'player-1', assistId: null, gameSeconds: 50, gameId: 'game-1' },
        { scoredByUs: true, scorerId: 'player-1', assistId: null, gameSeconds: 100, gameId: 'game-1' },
        { scoredByUs: true, scorerId: 'player-1', assistId: null, gameSeconds: 150, gameId: 'game-1' },
        // Midfielder: 2 goals, 1 assist
        { scoredByUs: true, scorerId: 'player-2', assistId: null, gameSeconds: 200, gameId: 'game-1' },
        { scoredByUs: true, scorerId: 'player-2', assistId: null, gameSeconds: 250, gameId: 'game-1' },
        { scoredByUs: true, scorerId: 'player-4', assistId: 'player-2', gameSeconds: 300, gameId: 'game-1' },
        // Defender: 1 goal, 2 assists
        { scoredByUs: true, scorerId: 'player-3', assistId: null, gameSeconds: 350, gameId: 'game-1' },
        { scoredByUs: true, scorerId: 'player-4', assistId: 'player-3', gameSeconds: 400, gameId: 'game-1' },
        { scoredByUs: true, scorerId: 'player-4', assistId: 'player-3', gameSeconds: 450, gameId: 'game-1' },
      ];
      const result = calculateTeamGoalsAssistsByPosition(goals, records, positions);
      expect(result.map(r => r.position)).toEqual(['Forward', 'Midfielder', 'Defender']);
      expect(result[0]).toEqual({ position: 'Forward', goals: 3, assists: 0 });
      expect(result[1]).toEqual({ position: 'Midfielder', goals: 2, assists: 1 });
      expect(result[2]).toEqual({ position: 'Defender', goals: 1, assists: 2 });
    });

    it('breaks goals tie by assists descending', () => {
      // player-4 plays pos-gk (not in positions map) so their scorer contribution
      // is omitted, letting us give player-2 (mid) 2 clean assists without extra goals.
      const records = [
        makeRecord('player-1', 'game-1', 'pos-fwd', 0, 600),
        makeRecord('player-2', 'game-1', 'pos-mid', 0, 600),
        makeRecord('player-4', 'game-1', 'pos-gk', 0, 600), // pos-gk not in positions map
      ];
      const goals = [
        // Forward: 1 goal, 0 assists
        { scoredByUs: true, scorerId: 'player-1', assistId: null, gameSeconds: 100, gameId: 'game-1' },
        // Midfielder: 1 goal, 2 assists (via goals scored by unmapped player-4)
        { scoredByUs: true, scorerId: 'player-2', assistId: null, gameSeconds: 200, gameId: 'game-1' },
        { scoredByUs: true, scorerId: 'player-4', assistId: 'player-2', gameSeconds: 300, gameId: 'game-1' },
        { scoredByUs: true, scorerId: 'player-4', assistId: 'player-2', gameSeconds: 400, gameId: 'game-1' },
      ];
      const result = calculateTeamGoalsAssistsByPosition(goals, records, positions);
      // Both positions have 1 goal; Midfielder wins tie with 2 assists vs 0.
      expect(result[0].position).toBe('Midfielder');
      expect(result[1].position).toBe('Forward');
    });

    it('skips goals with null gameSeconds', () => {
      const records = [makeRecord('player-1', 'game-1', 'pos-fwd', 0, 600)];
      const goals = [{ scoredByUs: true, scorerId: 'player-1', assistId: null, gameSeconds: null, gameId: 'game-1' }];
      const result = calculateTeamGoalsAssistsByPosition(goals, records, positions);
      expect(result).toHaveLength(0);
    });

    it('returns empty array when there are no goals', () => {
      const records = [makeRecord('player-1', 'game-1', 'pos-fwd', 0, 600)];
      const result = calculateTeamGoalsAssistsByPosition([], records, positions);
      expect(result).toHaveLength(0);
    });

    it('accumulates multiple goals for the same position across games', () => {
      const records = [
        makeRecord('player-1', 'game-1', 'pos-fwd', 0, 600),
        makeRecord('player-1', 'game-2', 'pos-fwd', 0, 600),
      ];
      const goals = [
        { scoredByUs: true, scorerId: 'player-1', assistId: null, gameSeconds: 300, gameId: 'game-1' },
        { scoredByUs: true, scorerId: 'player-1', assistId: null, gameSeconds: 300, gameId: 'game-2' },
      ];
      const result = calculateTeamGoalsAssistsByPosition(goals, records, positions);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ position: 'Forward', goals: 2, assists: 0 });
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

    it('omits assist attribution when interval or position data is invalid', () => {
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
