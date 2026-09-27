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

  it('deletes every assignment for the position except the one to keep', async () => {
    mockLineupAssignmentList.mockResolvedValue({
      data: [
        { id: 'keep-1', playerId: 'player-current', positionId: 'pos-1' },
        { id: 'orphan-1', playerId: 'player-stale', positionId: 'pos-1' },
      ],
    });
    mockLineupAssignmentDelete.mockResolvedValue({ data: {}, errors: [] });

    await cleanupDuplicateAssignmentsForPosition('game-1', 'pos-1', 'keep-1');

    expect(mockLineupAssignmentList).toHaveBeenCalledWith({
      filter: { gameId: { eq: 'game-1' }, positionId: { eq: 'pos-1' } },
    });
    expect(mockLineupAssignmentDelete).toHaveBeenCalledTimes(1);
    expect(mockLineupAssignmentDelete).toHaveBeenCalledWith({ id: 'orphan-1' });
  });

  it('deletes every assignment for the position when nothing should be kept', async () => {
    mockLineupAssignmentList.mockResolvedValue({
      data: [
        { id: 'orphan-1', playerId: 'player-a', positionId: 'pos-1' },
        { id: 'orphan-2', playerId: 'player-b', positionId: 'pos-1' },
      ],
    });
    mockLineupAssignmentDelete.mockResolvedValue({ data: {}, errors: [] });

    await cleanupDuplicateAssignmentsForPosition('game-1', 'pos-1', null);

    expect(mockLineupAssignmentDelete).toHaveBeenCalledTimes(2);
  });

  it('does nothing when only the kept assignment exists', async () => {
    mockLineupAssignmentList.mockResolvedValue({
      data: [{ id: 'keep-1', playerId: 'player-current', positionId: 'pos-1' }],
    });

    await cleanupDuplicateAssignmentsForPosition('game-1', 'pos-1', 'keep-1');

    expect(mockLineupAssignmentDelete).not.toHaveBeenCalled();
  });

  it('swallows a delete failure for one orphan without throwing', async () => {
    mockLineupAssignmentList.mockResolvedValue({
      data: [
        { id: 'keep-1', playerId: 'player-current', positionId: 'pos-1' },
        { id: 'orphan-1', playerId: 'player-stale', positionId: 'pos-1' },
      ],
    });
    mockLineupAssignmentDelete.mockRejectedValue(new Error('network blip'));

    await expect(
      cleanupDuplicateAssignmentsForPosition('game-1', 'pos-1', 'keep-1'),
    ).resolves.toBeUndefined();
  });

  it('swallows a query failure without throwing', async () => {
    mockLineupAssignmentList.mockRejectedValue(new Error('offline'));

    await expect(
      cleanupDuplicateAssignmentsForPosition('game-1', 'pos-1', 'keep-1'),
    ).resolves.toBeUndefined();
    expect(mockLineupAssignmentDelete).not.toHaveBeenCalled();
  });
});
