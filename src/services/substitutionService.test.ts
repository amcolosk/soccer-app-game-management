import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { closeActivePlayTimeRecords, executeSubstitution } from './substitutionService';
import type { PlayTimeRecord } from '../types/schema';

// ---------------------------------------------------------------------------
// Mock setup — vi.hoisted ensures these exist before vi.mock hoisting runs
// ---------------------------------------------------------------------------

const {
  mockPlayTimeRecordUpdate,
  mockPlayTimeRecordCreate,
  mockPlayTimeRecordList,
  mockLineupAssignmentDelete,
  mockLineupAssignmentCreate,
  mockSubstitutionCreate,
} = vi.hoisted(() => ({
  mockPlayTimeRecordUpdate: vi.fn(),
  mockPlayTimeRecordCreate: vi.fn(),
  mockPlayTimeRecordList: vi.fn(),
  mockLineupAssignmentDelete: vi.fn(),
  mockLineupAssignmentCreate: vi.fn(),
  mockSubstitutionCreate: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      PlayTimeRecord: {
        update: mockPlayTimeRecordUpdate,
        create: mockPlayTimeRecordCreate,
        list: mockPlayTimeRecordList,
      },
      LineupAssignment: {
        delete: mockLineupAssignmentDelete,
        create: mockLineupAssignmentCreate,
      },
      Substitution: {
        create: mockSubstitutionCreate,
      },
    },
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<PlayTimeRecord>): PlayTimeRecord {
  return {
    id: 'record-1',
    playerId: 'player-1',
    positionId: 'pos-1',
    gameId: 'game-1',
    startGameSeconds: 0,
    endGameSeconds: null,
    coaches: ['coach-1'],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  } as PlayTimeRecord;
}

// ---------------------------------------------------------------------------
// closeActivePlayTimeRecords
// ---------------------------------------------------------------------------

describe('closeActivePlayTimeRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlayTimeRecordUpdate.mockResolvedValue({ data: {} });
    mockPlayTimeRecordCreate.mockResolvedValue({ data: {} });
    mockPlayTimeRecordList.mockResolvedValue({ data: [], nextToken: null });
  });

  it('should close active records with the correct endGameSeconds', async () => {
    const records = [
      makeRecord({ id: '1', playerId: 'player-1', endGameSeconds: null }),
      makeRecord({ id: '2', playerId: 'player-2', endGameSeconds: null }),
      makeRecord({ id: '3', playerId: 'player-3', endGameSeconds: 500 }), // already closed
    ];

    await closeActivePlayTimeRecords(records, 600);

    expect(mockPlayTimeRecordUpdate).toHaveBeenCalledTimes(2);
    expect(mockPlayTimeRecordUpdate).toHaveBeenCalledWith({ id: '1', endGameSeconds: 600 });
    expect(mockPlayTimeRecordUpdate).toHaveBeenCalledWith({ id: '2', endGameSeconds: 600 });
    expect(mockPlayTimeRecordUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ id: '3' }));
  });

  it('should skip records that already have endGameSeconds set', async () => {
    const records = [
      makeRecord({ id: '1', endGameSeconds: 300 }),
      makeRecord({ id: '2', endGameSeconds: 400 }),
    ];

    await closeActivePlayTimeRecords(records, 600);

    expect(mockPlayTimeRecordUpdate).not.toHaveBeenCalled();
  });

  it('should close only specified player records when playerIds provided', async () => {
    const records = [
      makeRecord({ id: '1', playerId: 'player-1', endGameSeconds: null }),
      makeRecord({ id: '2', playerId: 'player-2', endGameSeconds: null }),
      makeRecord({ id: '3', playerId: 'player-3', endGameSeconds: null }),
    ];

    await closeActivePlayTimeRecords(records, 600, ['player-1', 'player-3']);

    expect(mockPlayTimeRecordUpdate).toHaveBeenCalledTimes(2);
    expect(mockPlayTimeRecordUpdate).toHaveBeenCalledWith({ id: '1', endGameSeconds: 600 });
    expect(mockPlayTimeRecordUpdate).toHaveBeenCalledWith({ id: '3', endGameSeconds: 600 });
    expect(mockPlayTimeRecordUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ id: '2' }));
  });

  it('should handle an empty records array without throwing', async () => {
    await expect(closeActivePlayTimeRecords([], 600)).resolves.not.toThrow();
    expect(mockPlayTimeRecordUpdate).not.toHaveBeenCalled();
  });

  it('should handle records with no active records without throwing', async () => {
    const records = [
      makeRecord({ id: '1', endGameSeconds: 300 }),
      makeRecord({ id: '2', endGameSeconds: 400 }),
    ];

    await expect(closeActivePlayTimeRecords(records, 600)).resolves.not.toThrow();
    expect(mockPlayTimeRecordUpdate).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // With gameId — DB query and retry path
  // ---------------------------------------------------------------------------

  describe('with gameId', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should query the DB and close records not yet in React state', async () => {
      const inMemory = [makeRecord({ id: '1', playerId: 'player-1', endGameSeconds: null })];
      const dbOnlyRecord = makeRecord({ id: 'db-only', playerId: 'player-2', endGameSeconds: null });

      // Initial query returns both; retry returns nothing new
      mockPlayTimeRecordList
        .mockResolvedValueOnce({ data: [inMemory[0], dbOnlyRecord], nextToken: null })
        .mockResolvedValueOnce({ data: [], nextToken: null });

      const promise = closeActivePlayTimeRecords(inMemory, 600, undefined, 'game-1');
      await vi.runAllTimersAsync();
      await promise;

      expect(mockPlayTimeRecordUpdate).toHaveBeenCalledWith({ id: '1', endGameSeconds: 600 });
      expect(mockPlayTimeRecordUpdate).toHaveBeenCalledWith({ id: 'db-only', endGameSeconds: 600 });
    });

    it('should paginate through all DB pages until nextToken is null', async () => {
      const page1 = makeRecord({ id: '1', endGameSeconds: null });
      const page2 = makeRecord({ id: '2', endGameSeconds: null });

      mockPlayTimeRecordList
        .mockResolvedValueOnce({ data: [page1], nextToken: 'token-abc' }) // page 1
        .mockResolvedValueOnce({ data: [page2], nextToken: null })         // page 2
        .mockResolvedValueOnce({ data: [], nextToken: null });              // retry

      const promise = closeActivePlayTimeRecords([], 600, undefined, 'game-1');
      await vi.runAllTimersAsync();
      await promise;

      // list called twice for pagination + once for retry
      expect(mockPlayTimeRecordList).toHaveBeenCalledTimes(3);
      expect(mockPlayTimeRecordUpdate).toHaveBeenCalledWith({ id: '1', endGameSeconds: 600 });
      expect(mockPlayTimeRecordUpdate).toHaveBeenCalledWith({ id: '2', endGameSeconds: 600 });
    });

    it('should pass nextToken in subsequent paginated requests', async () => {
      mockPlayTimeRecordList
        .mockResolvedValueOnce({ data: [], nextToken: 'my-token' })
        .mockResolvedValueOnce({ data: [], nextToken: null })
        .mockResolvedValueOnce({ data: [], nextToken: null });

      const promise = closeActivePlayTimeRecords([], 600, undefined, 'game-1');
      await vi.runAllTimersAsync();
      await promise;

      expect(mockPlayTimeRecordList.mock.calls[1][0]).toMatchObject({ nextToken: 'my-token' });
    });

    it('should perform a retry pass after the initial close to catch stragglers', async () => {
      const straggler = makeRecord({ id: 'straggler', endGameSeconds: null });

      // Initial scan finds nothing; after delay, retry finds a straggler
      mockPlayTimeRecordList
        .mockResolvedValueOnce({ data: [], nextToken: null })
        .mockResolvedValueOnce({ data: [straggler], nextToken: null });

      const promise = closeActivePlayTimeRecords([], 600, undefined, 'game-1');
      await vi.runAllTimersAsync();
      await promise;

      expect(mockPlayTimeRecordList).toHaveBeenCalledTimes(2);
      expect(mockPlayTimeRecordUpdate).toHaveBeenCalledWith({ id: 'straggler', endGameSeconds: 600 });
    });

    it('should not close records that are already closed when found in the retry pass', async () => {
      const alreadyClosed = makeRecord({ id: '1', endGameSeconds: 600 });

      mockPlayTimeRecordList
        .mockResolvedValueOnce({ data: [], nextToken: null })
        .mockResolvedValueOnce({ data: [alreadyClosed], nextToken: null });

      const promise = closeActivePlayTimeRecords([], 600, undefined, 'game-1');
      await vi.runAllTimersAsync();
      await promise;

      expect(mockPlayTimeRecordUpdate).not.toHaveBeenCalled();
    });

    it('should fall back to in-memory records when the DB query throws', async () => {
      const inMemory = [makeRecord({ id: '1', endGameSeconds: null })];
      mockPlayTimeRecordList.mockRejectedValueOnce(new Error('Network error'));

      const promise = closeActivePlayTimeRecords(inMemory, 600, undefined, 'game-1');
      await vi.runAllTimersAsync();
      await promise;

      // In-memory record still gets closed despite DB failure
      expect(mockPlayTimeRecordUpdate).toHaveBeenCalledWith({ id: '1', endGameSeconds: 600 });
    });

    it('should filter merged DB records by playerIds', async () => {
      const dbRecords = [
        makeRecord({ id: '1', playerId: 'player-1', endGameSeconds: null }),
        makeRecord({ id: '2', playerId: 'player-2', endGameSeconds: null }),
      ];

      mockPlayTimeRecordList
        .mockResolvedValueOnce({ data: dbRecords, nextToken: null })
        .mockResolvedValueOnce({ data: [], nextToken: null });

      const promise = closeActivePlayTimeRecords([], 600, ['player-1'], 'game-1');
      await vi.runAllTimersAsync();
      await promise;

      expect(mockPlayTimeRecordUpdate).toHaveBeenCalledTimes(1);
      expect(mockPlayTimeRecordUpdate).toHaveBeenCalledWith({ id: '1', endGameSeconds: 600 });
    });
  });
});

// ---------------------------------------------------------------------------
// executeSubstitution
// ---------------------------------------------------------------------------

describe('executeSubstitution', () => {
  const coaches = ['coach-1'];

  beforeEach(() => {
    vi.clearAllMocks();
    mockPlayTimeRecordUpdate.mockResolvedValue({ data: {} });
    mockPlayTimeRecordCreate.mockResolvedValue({ data: {} });
    mockLineupAssignmentDelete.mockResolvedValue({ data: {} });
    mockLineupAssignmentCreate.mockResolvedValue({ data: {} });
    mockSubstitutionCreate.mockResolvedValue({ data: {} });
  });

  it('should close the active play time record for the outgoing player', async () => {
    const records = [
      makeRecord({ id: 'record-1', playerId: 'old-player', positionId: 'position-1', endGameSeconds: null }),
    ];

    await executeSubstitution('game-1', 'old-player', 'new-player', 'position-1', 600, 1, records, 'assignment-1', coaches);

    expect(mockPlayTimeRecordUpdate).toHaveBeenCalledWith({ id: 'record-1', endGameSeconds: 600 });
  });

  it('should delete the old lineup assignment', async () => {
    await executeSubstitution('game-1', 'old-player', 'new-player', 'position-1', 600, 1, [], 'assignment-1', coaches);

    expect(mockLineupAssignmentDelete).toHaveBeenCalledWith({ id: 'assignment-1' });
  });

  it('should create a new lineup assignment for the incoming player', async () => {
    await executeSubstitution('game-1', 'old-player', 'new-player', 'position-1', 600, 1, [], 'assignment-1', coaches);

    expect(mockLineupAssignmentCreate).toHaveBeenCalledWith({
      gameId: 'game-1',
      playerId: 'new-player',
      positionId: 'position-1',
      isStarter: true,
      coaches,
    });
  });

  it('should create a play time record for the incoming player', async () => {
    await executeSubstitution('game-1', 'old-player', 'new-player', 'position-1', 600, 1, [], 'assignment-1', coaches);

    expect(mockPlayTimeRecordCreate).toHaveBeenCalledWith({
      gameId: 'game-1',
      playerId: 'new-player',
      positionId: 'position-1',
      startGameSeconds: 600,
      coaches,
    });
  });

  it('should record the substitution with correct half and game seconds', async () => {
    await executeSubstitution('game-1', 'old-player', 'new-player', 'position-1', 600, 1, [], 'assignment-1', coaches);

    expect(mockSubstitutionCreate).toHaveBeenCalledWith({
      gameId: 'game-1',
      positionId: 'position-1',
      playerOutId: 'old-player',
      playerInId: 'new-player',
      half: 1,
      gameSeconds: 600,
      coaches,
    });
  });

  it('should execute all 5 operations for a complete substitution', async () => {
    const records = [
      makeRecord({ id: 'record-1', playerId: 'old-player', positionId: 'position-1', endGameSeconds: null }),
    ];

    await executeSubstitution('game-1', 'old-player', 'new-player', 'position-1', 600, 1, records, 'assignment-1', coaches);

    expect(mockPlayTimeRecordUpdate).toHaveBeenCalledTimes(1);   // close old record
    expect(mockLineupAssignmentDelete).toHaveBeenCalledTimes(1); // remove old assignment
    expect(mockLineupAssignmentCreate).toHaveBeenCalledTimes(1); // add new assignment
    expect(mockPlayTimeRecordCreate).toHaveBeenCalledTimes(1);   // start new record
    expect(mockSubstitutionCreate).toHaveBeenCalledTimes(1);     // log substitution
  });

  it('should skip the play time update when no active record exists for the outgoing player', async () => {
    // Record exists but belongs to a different player
    const records = [
      makeRecord({ id: 'record-1', playerId: 'different-player', positionId: 'position-1', endGameSeconds: null }),
    ];

    await executeSubstitution('game-1', 'old-player', 'new-player', 'position-1', 600, 1, records, 'assignment-1', coaches);

    expect(mockPlayTimeRecordUpdate).not.toHaveBeenCalled();
    // All other 4 operations still execute
    expect(mockLineupAssignmentDelete).toHaveBeenCalled();
    expect(mockLineupAssignmentCreate).toHaveBeenCalled();
    expect(mockPlayTimeRecordCreate).toHaveBeenCalled();
    expect(mockSubstitutionCreate).toHaveBeenCalled();
  });

  it('should skip the play time update when the matching record is already closed', async () => {
    const records = [
      makeRecord({ id: 'record-1', playerId: 'old-player', positionId: 'position-1', endGameSeconds: 300 }),
    ];

    await executeSubstitution('game-1', 'old-player', 'new-player', 'position-1', 600, 1, records, 'assignment-1', coaches);

    expect(mockPlayTimeRecordUpdate).not.toHaveBeenCalled();
  });

  it('should use correct half and game seconds for second half substitutions', async () => {
    const records = [
      makeRecord({ id: 'record-1', playerId: 'old-player', positionId: 'position-1', startGameSeconds: 1800, endGameSeconds: null }),
    ];

    await executeSubstitution('game-1', 'old-player', 'new-player', 'position-1', 2100, 2, records, 'assignment-1', coaches);

    expect(mockPlayTimeRecordUpdate).toHaveBeenCalledWith({ id: 'record-1', endGameSeconds: 2100 });
    expect(mockSubstitutionCreate).toHaveBeenCalledWith(expect.objectContaining({ half: 2, gameSeconds: 2100 }));
  });

  it('should only close the record matching both the outgoing player AND the position', async () => {
    const records = [
      makeRecord({ id: 'wrong-pos',    playerId: 'old-player',    positionId: 'different-position', endGameSeconds: null }),
      makeRecord({ id: 'wrong-player', playerId: 'other-player',   positionId: 'position-1',         endGameSeconds: null }),
      makeRecord({ id: 'correct',      playerId: 'old-player',    positionId: 'position-1',         endGameSeconds: null }),
    ];

    await executeSubstitution('game-1', 'old-player', 'new-player', 'position-1', 600, 1, records, 'assignment-1', coaches);

    expect(mockPlayTimeRecordUpdate).toHaveBeenCalledTimes(1);
    expect(mockPlayTimeRecordUpdate).toHaveBeenCalledWith({ id: 'correct', endGameSeconds: 600 });
  });

  it('should pass the coaches array to all create operations', async () => {
    const multiCoaches = ['coach-1', 'coach-2', 'coach-3'];

    await executeSubstitution('game-1', 'old-player', 'new-player', 'position-1', 600, 1, [], 'assignment-1', multiCoaches);

    expect(mockLineupAssignmentCreate).toHaveBeenCalledWith(expect.objectContaining({ coaches: multiCoaches }));
    expect(mockPlayTimeRecordCreate).toHaveBeenCalledWith(expect.objectContaining({ coaches: multiCoaches }));
    expect(mockSubstitutionCreate).toHaveBeenCalledWith(expect.objectContaining({ coaches: multiCoaches }));
  });
});
