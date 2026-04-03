/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  deleteGameCascade,
  deleteTeamCascade,
  deletePlayerCascade,
  deleteFormationCascade,
  getPlayerImpact,
} from './cascadeDeleteService';

const { mockList } = vi.hoisted(() => ({
  mockList: vi.fn(),
}));

const {
  mockDeleteGameSafe,
  mockDeleteTeamSafe,
  mockDeletePlayerSafe,
  mockDeleteFormationSafe,
} = vi.hoisted(() => ({
  mockDeleteGameSafe: vi.fn(),
  mockDeleteTeamSafe: vi.fn(),
  mockDeletePlayerSafe: vi.fn(),
  mockDeleteFormationSafe: vi.fn(),
}));

function createMockModel() {
  return {
    list: mockList,
  };
}

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    mutations: {
      deleteGameSafe: mockDeleteGameSafe,
      deleteTeamSafe: mockDeleteTeamSafe,
      deletePlayerSafe: mockDeletePlayerSafe,
      deleteFormationSafe: mockDeleteFormationSafe,
    },
    models: {
      PlayTimeRecord: createMockModel(),
      Goal: createMockModel(),
      GameNote: createMockModel(),
    },
  })),
}));

function setupListResponses(responses: Map<string, { id: string }[]>) {
  mockList.mockImplementation((opts?: any) => {
    if (opts?.filter) {
      for (const [, filterValue] of Object.entries(opts.filter)) {
        const eqValue = (filterValue as any)?.eq;
        if (eqValue && responses.has(eqValue)) {
          return Promise.resolve({ data: responses.get(eqValue)!, nextToken: null });
        }
      }
    }
    return Promise.resolve({ data: [], nextToken: null });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockResolvedValue({ data: [], nextToken: null });
  mockDeleteGameSafe.mockResolvedValue({ data: { success: true }, errors: undefined });
  mockDeleteTeamSafe.mockResolvedValue({ data: { success: true }, errors: undefined });
  mockDeletePlayerSafe.mockResolvedValue({ data: { success: true }, errors: undefined });
  mockDeleteFormationSafe.mockResolvedValue({ data: { success: true }, errors: undefined });
});

describe('authoritative safe-delete mutations', () => {
  it('calls deleteGameSafe mutation for game deletion', async () => {
    await deleteGameCascade('game-1');
    expect(mockDeleteGameSafe).toHaveBeenCalledWith({ gameId: 'game-1' });
  });

  it('calls deleteTeamSafe mutation for team deletion', async () => {
    await deleteTeamCascade('team-1');
    expect(mockDeleteTeamSafe).toHaveBeenCalledWith({ teamId: 'team-1' });
  });

  it('calls deletePlayerSafe mutation for player deletion', async () => {
    await deletePlayerCascade('player-1');
    expect(mockDeletePlayerSafe).toHaveBeenCalledWith({ playerId: 'player-1' });
  });

  it('calls deleteFormationSafe mutation for formation deletion', async () => {
    await deleteFormationCascade('formation-1');
    expect(mockDeleteFormationSafe).toHaveBeenCalledWith({ formationId: 'formation-1' });
  });

  it('throws when authoritative game delete mutation returns errors', async () => {
    mockDeleteGameSafe.mockResolvedValueOnce({
      data: null,
      errors: [{ message: 'deleteGameSafe failed and rollback was incomplete' }],
    });

    await expect(deleteGameCascade('game-1')).rejects.toThrow(/rollback was incomplete/i);
  });

  it('throws when authoritative team delete mutation returns errors', async () => {
    mockDeleteTeamSafe.mockResolvedValueOnce({
      data: null,
      errors: [{ message: 'deleteTeamSafe failed' }],
    });

    await expect(deleteTeamCascade('team-1')).rejects.toThrow(/deleteteamsafe failed/i);
  });

  it('throws when authoritative player delete mutation returns errors', async () => {
    mockDeletePlayerSafe.mockResolvedValueOnce({
      data: null,
      errors: [{ message: 'deletePlayerSafe failed' }],
    });

    await expect(deletePlayerCascade('player-1')).rejects.toThrow(/deleteplayersafe failed/i);
  });

  it('throws when authoritative formation delete mutation does not return success=true', async () => {
    mockDeleteFormationSafe.mockResolvedValueOnce({
      data: null,
      errors: undefined,
    });

    await expect(deleteFormationCascade('formation-1')).rejects.toThrow(/failed to delete formation safely/i);
  });

  it('throws when authoritative team delete mutation omits success flag', async () => {
    mockDeleteTeamSafe.mockResolvedValueOnce({
      data: { deletedCounts: { games: 1 } },
      errors: undefined,
    });

    await expect(deleteTeamCascade('team-1')).rejects.toThrow(/failed to delete team safely/i);
  });
});

describe('getPlayerImpact', () => {
  it('returns zero counts when player has no associated records', async () => {
    mockList.mockResolvedValue({ data: [], nextToken: null });

    const result = await getPlayerImpact('player-1');

    expect(result).toEqual({ playTimeCount: 0, goalCount: 0, noteCount: 0 });
  });

  it('returns correct counts for play time, goals, and notes', async () => {
    setupListResponses(
      new Map([
        ['player-1', [{ id: 'pt-1' }, { id: 'pt-2' }, { id: 'goal-1' }, { id: 'note-1' }]],
      ]),
    );

    const result = await getPlayerImpact('player-1');

    expect(result.playTimeCount).toBe(4);
    expect(result.goalCount).toBe(4);
    expect(result.noteCount).toBe(4);
  });

  it('passes list limit and filter values', async () => {
    await getPlayerImpact('player-42');

    for (const call of mockList.mock.calls) {
      expect(call[0]?.limit).toBe(1000);
    }

    const filtersUsed = mockList.mock.calls.map((c) => c[0]?.filter);
    expect(filtersUsed.some((f) => f?.playerId?.eq === 'player-42' || f?.scorerId?.eq === 'player-42')).toBe(true);
  });
});
