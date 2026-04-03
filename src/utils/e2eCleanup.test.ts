import { describe, expect, it, vi } from 'vitest';
import { cleanupAllDataForE2E } from './e2eCleanup';

type CleanupClient = Parameters<typeof cleanupAllDataForE2E>[0];

describe('cleanupAllDataForE2E', () => {
  it('deletes games through deleteGameSafe mutation and never uses Game model delete', async () => {
    const gameList = vi.fn().mockResolvedValue({
      data: [{ id: 'game-1' }, { id: 'game-2' }],
      nextToken: null,
    });

    const gameDelete = vi.fn();

    const makeModel = (ids: string[]) => ({
      list: vi.fn().mockResolvedValue({
        data: ids.map((id) => ({ id })),
        nextToken: null,
      }),
      delete: vi.fn().mockResolvedValue({}),
    });

    const client = {
      models: {
        Game: {
          list: gameList,
          delete: gameDelete,
        },
        PlayTimeRecord: makeModel([]),
        Goal: makeModel([]),
        GameNote: makeModel([]),
        Substitution: makeModel([]),
        LineupAssignment: makeModel([]),
        PlannedRotation: makeModel([]),
        GamePlan: makeModel([]),
        PlayerAvailability: makeModel([]),
      },
      mutations: {
        deleteGameSafe: vi.fn().mockResolvedValue({ data: { success: true }, errors: undefined }),
      },
    };

    const result = await cleanupAllDataForE2E(client as unknown as CleanupClient);

    expect(client.mutations.deleteGameSafe).toHaveBeenCalledTimes(2);
    expect(client.mutations.deleteGameSafe).toHaveBeenCalledWith({ gameId: 'game-1' });
    expect(client.mutations.deleteGameSafe).toHaveBeenCalledWith({ gameId: 'game-2' });
    expect(gameDelete).not.toHaveBeenCalled();
    expect(result.Game).toBe(2);
  });

  it('continues cleanup when one safe game delete fails', async () => {
    const client = {
      models: {
        Game: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'game-1' }, { id: 'game-2' }],
            nextToken: null,
          }),
          delete: vi.fn(),
        },
        PlayTimeRecord: { list: vi.fn().mockResolvedValue({ data: [{ id: 'ptr-1' }], nextToken: null }), delete: vi.fn().mockResolvedValue({}) },
        Goal: { list: vi.fn().mockResolvedValue({ data: [], nextToken: null }), delete: vi.fn().mockResolvedValue({}) },
        GameNote: { list: vi.fn().mockResolvedValue({ data: [], nextToken: null }), delete: vi.fn().mockResolvedValue({}) },
        Substitution: { list: vi.fn().mockResolvedValue({ data: [], nextToken: null }), delete: vi.fn().mockResolvedValue({}) },
        LineupAssignment: { list: vi.fn().mockResolvedValue({ data: [], nextToken: null }), delete: vi.fn().mockResolvedValue({}) },
        PlannedRotation: { list: vi.fn().mockResolvedValue({ data: [], nextToken: null }), delete: vi.fn().mockResolvedValue({}) },
        GamePlan: { list: vi.fn().mockResolvedValue({ data: [], nextToken: null }), delete: vi.fn().mockResolvedValue({}) },
        PlayerAvailability: { list: vi.fn().mockResolvedValue({ data: [], nextToken: null }), delete: vi.fn().mockResolvedValue({}) },
      },
      mutations: {
        deleteGameSafe: vi
          .fn()
          .mockResolvedValueOnce({ data: { success: false }, errors: [{ message: 'denied' }] })
          .mockResolvedValueOnce({ data: { success: true }, errors: undefined }),
      },
    };

    const result = await cleanupAllDataForE2E(client as unknown as CleanupClient);

    expect(client.mutations.deleteGameSafe).toHaveBeenCalledTimes(2);
    expect(result.Game).toBe(1);
    expect(result.PlayTimeRecord).toBe(1);
  });
});
