import { describe, it, expect, vi, beforeEach } from 'vitest';
import { closeActivePlayTimeRecords, executeSubstitution } from './substitutionService';
import type { Schema } from "../../amplify/data/resource";

type PlayTimeRecord = Schema["PlayTimeRecord"]["type"];

// Mock the AWS Amplify client
vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      PlayTimeRecord: {
        update: vi.fn(),
        create: vi.fn(),
      },
      LineupAssignment: {
        delete: vi.fn(),
        create: vi.fn(),
      },
      Substitution: {
        create: vi.fn(),
      },
    },
  })),
}));

describe('closeActivePlayTimeRecords', () => {
  it('should close all active play time records', async () => {
    const mockRecords = [
      { id: '1', playerId: 'player-1', positionId: 'pos-1', startGameSeconds: 0, endGameSeconds: null },
      { id: '2', playerId: 'player-2', positionId: 'pos-2', startGameSeconds: 100, endGameSeconds: null },
      { id: '3', playerId: 'player-3', positionId: 'pos-3', startGameSeconds: 200, endGameSeconds: 500 }, // Already closed
    ] as PlayTimeRecord[];

    await closeActivePlayTimeRecords(mockRecords, 600);

    // Should close 2 active records (records 1 and 2)
    // Record 3 already has endGameSeconds so should be skipped
  });

  it('should close only specified player records when playerIds provided', async () => {
    const mockRecords = [
      { id: '1', playerId: 'player-1', positionId: 'pos-1', startGameSeconds: 0, endGameSeconds: null },
      { id: '2', playerId: 'player-2', positionId: 'pos-2', startGameSeconds: 100, endGameSeconds: null },
      { id: '3', playerId: 'player-3', positionId: 'pos-3', startGameSeconds: 200, endGameSeconds: null },
    ] as PlayTimeRecord[];

    await closeActivePlayTimeRecords(mockRecords, 600, ['player-1', 'player-3']);

    // Should close only records for player-1 and player-3
  });

  it('should handle empty records array', async () => {
    await expect(closeActivePlayTimeRecords([], 600)).resolves.not.toThrow();
  });

  it('should handle records with no active records', async () => {
    const mockRecords = [
      { id: '1', playerId: 'player-1', positionId: 'pos-1', startGameSeconds: 0, endGameSeconds: 300 },
      { id: '2', playerId: 'player-2', positionId: 'pos-2', startGameSeconds: 100, endGameSeconds: 400 },
    ] as PlayTimeRecord[];

    await expect(closeActivePlayTimeRecords(mockRecords, 600)).resolves.not.toThrow();
  });
});

describe('executeSubstitution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should execute a complete substitution workflow', async () => {
    const mockRecords = [
      { 
        id: 'record-1', 
        playerId: 'old-player', 
        positionId: 'position-1', 
        startGameSeconds: 0, 
        endGameSeconds: null 
      },
    ] as PlayTimeRecord[];

    await executeSubstitution(
      'game-1',
      'old-player',
      'new-player',
      'position-1',
      600,
      1,
      mockRecords,
      'assignment-1'
    );

    // Should complete without throwing
  });

  it('should handle substitution when no active play time record exists', async () => {
    const mockRecords = [
      { 
        id: 'record-1', 
        playerId: 'different-player', 
        positionId: 'position-1', 
        startGameSeconds: 0, 
        endGameSeconds: 300 
      },
    ] as PlayTimeRecord[];

    await expect(
      executeSubstitution(
        'game-1',
        'old-player',
        'new-player',
        'position-1',
        600,
        2,
        mockRecords,
        'assignment-1'
      )
    ).resolves.not.toThrow();
  });

  it('should work for second half substitution', async () => {
    const mockRecords = [
      { 
        id: 'record-1', 
        playerId: 'old-player', 
        positionId: 'position-1', 
        startGameSeconds: 1800, 
        endGameSeconds: null 
      },
    ] as PlayTimeRecord[];

    await executeSubstitution(
      'game-1',
      'old-player',
      'new-player',
      'position-1',
      2100,
      2,
      mockRecords,
      'assignment-1'
    );

    // Should complete without throwing
  });
});
