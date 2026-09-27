import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanupDuplicateAssignmentsForPosition } from './lineupCleanupService';

const { mockLineupAssignmentList, mockLineupAssignmentDelete } = vi.hoisted(() => ({
  mockLineupAssignmentList: vi.fn(),
  mockLineupAssignmentDelete: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      LineupAssignment: {
        list: mockLineupAssignmentList,
        delete: mockLineupAssignmentDelete,
      },
    },
  })),
}));

describe('cleanupDuplicateAssignmentsForPosition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes an assignment strictly older than the one that was just cleared', async () => {
    mockLineupAssignmentList.mockResolvedValue({
      data: [
        { id: 'orphan-1', playerId: 'player-stale', positionId: 'pos-1', createdAt: '2026-09-27T20:00:00.000Z' },
      ],
    });
    mockLineupAssignmentDelete.mockResolvedValue({ data: {}, errors: [] });

    await cleanupDuplicateAssignmentsForPosition('game-1', 'pos-1', '2026-09-27T21:00:00.000Z');

    expect(mockLineupAssignmentList).toHaveBeenCalledWith({
      filter: { gameId: { eq: 'game-1' }, positionId: { eq: 'pos-1' } },
    });
    expect(mockLineupAssignmentDelete).toHaveBeenCalledTimes(1);
    expect(mockLineupAssignmentDelete).toHaveBeenCalledWith({ id: 'orphan-1' });
  });

  it('never deletes an assignment at or after the one that was just cleared (a concurrent legitimate write)', async () => {
    mockLineupAssignmentList.mockResolvedValue({
      data: [
        // Same timestamp as the cleared assignment: not older, must be left alone.
        { id: 'same-time', playerId: 'player-a', positionId: 'pos-1', createdAt: '2026-09-27T21:00:00.000Z' },
        // Created after the cleared assignment (e.g. another coach's concurrent substitution).
        { id: 'newer', playerId: 'player-b', positionId: 'pos-1', createdAt: '2026-09-27T21:00:05.000Z' },
      ],
    });

    await cleanupDuplicateAssignmentsForPosition('game-1', 'pos-1', '2026-09-27T21:00:00.000Z');

    expect(mockLineupAssignmentDelete).not.toHaveBeenCalled();
  });

  it('deletes multiple older orphans but leaves a newer concurrent write alone', async () => {
    mockLineupAssignmentList.mockResolvedValue({
      data: [
        { id: 'orphan-1', playerId: 'player-a', positionId: 'pos-1', createdAt: '2026-09-27T19:00:00.000Z' },
        { id: 'orphan-2', playerId: 'player-b', positionId: 'pos-1', createdAt: '2026-09-27T20:00:00.000Z' },
        { id: 'newer', playerId: 'player-c', positionId: 'pos-1', createdAt: '2026-09-27T21:00:05.000Z' },
      ],
    });
    mockLineupAssignmentDelete.mockResolvedValue({ data: {}, errors: [] });

    await cleanupDuplicateAssignmentsForPosition('game-1', 'pos-1', '2026-09-27T21:00:00.000Z');

    expect(mockLineupAssignmentDelete).toHaveBeenCalledTimes(2);
    expect(mockLineupAssignmentDelete).toHaveBeenCalledWith({ id: 'orphan-1' });
    expect(mockLineupAssignmentDelete).toHaveBeenCalledWith({ id: 'orphan-2' });
    expect(mockLineupAssignmentDelete).not.toHaveBeenCalledWith({ id: 'newer' });
  });

  it('does nothing when only the kept assignment exists', async () => {
    mockLineupAssignmentList.mockResolvedValue({
      data: [{ id: 'keep-1', playerId: 'player-current', positionId: 'pos-1', createdAt: '2026-09-27T21:00:00.000Z' }],
    });

    await cleanupDuplicateAssignmentsForPosition('game-1', 'pos-1', '2026-09-27T21:00:00.000Z');

    expect(mockLineupAssignmentDelete).not.toHaveBeenCalled();
  });

  it('is a no-op without a cutoff timestamp, rather than guessing', async () => {
    await cleanupDuplicateAssignmentsForPosition('game-1', 'pos-1', null);
    await cleanupDuplicateAssignmentsForPosition('game-1', 'pos-1', undefined);

    expect(mockLineupAssignmentList).not.toHaveBeenCalled();
    expect(mockLineupAssignmentDelete).not.toHaveBeenCalled();
  });

  it('swallows a delete failure for one orphan without throwing', async () => {
    mockLineupAssignmentList.mockResolvedValue({
      data: [
        { id: 'orphan-1', playerId: 'player-stale', positionId: 'pos-1', createdAt: '2026-09-27T20:00:00.000Z' },
      ],
    });
    mockLineupAssignmentDelete.mockRejectedValue(new Error('network blip'));

    await expect(
      cleanupDuplicateAssignmentsForPosition('game-1', 'pos-1', '2026-09-27T21:00:00.000Z'),
    ).resolves.toBeUndefined();
  });

  it('swallows a query failure without throwing', async () => {
    mockLineupAssignmentList.mockRejectedValue(new Error('offline'));

    await expect(
      cleanupDuplicateAssignmentsForPosition('game-1', 'pos-1', '2026-09-27T21:00:00.000Z'),
    ).resolves.toBeUndefined();
    expect(mockLineupAssignmentDelete).not.toHaveBeenCalled();
  });
});
