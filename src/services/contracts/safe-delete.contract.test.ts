import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteFormationCascade,
  deleteGameCascade,
  deletePlayerCascade,
  deleteTeamCascade,
} from '../cascadeDeleteService';

type MutationError = { message?: string };

type MutationResult = {
  data?: unknown;
  errors?: MutationError[];
};

const {
  mockDeleteFormationSafe,
  mockDeleteGameSafe,
  mockDeletePlayerSafe,
  mockDeleteTeamSafe,
  mockList,
} = vi.hoisted(() => ({
  mockDeleteFormationSafe: vi.fn<(args: { formationId: string }) => Promise<MutationResult>>(),
  mockDeleteGameSafe: vi.fn<(args: { gameId: string }) => Promise<MutationResult>>(),
  mockDeletePlayerSafe: vi.fn<(args: { playerId: string }) => Promise<MutationResult>>(),
  mockDeleteTeamSafe: vi.fn<(args: { teamId: string }) => Promise<MutationResult>>(),
  mockList: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    mutations: {
      deleteFormationSafe: mockDeleteFormationSafe,
      deleteGameSafe: mockDeleteGameSafe,
      deletePlayerSafe: mockDeletePlayerSafe,
      deleteTeamSafe: mockDeleteTeamSafe,
    },
    models: {
      PlayTimeRecord: { list: mockList },
      Goal: { list: mockList },
      GameNote: { list: mockList },
    },
  })),
}));

describe('safe-delete contract (service/client boundary)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteFormationSafe.mockResolvedValue({ data: { success: true }, errors: undefined });
    mockDeleteGameSafe.mockResolvedValue({ data: { success: true }, errors: undefined });
    mockDeletePlayerSafe.mockResolvedValue({ data: { success: true }, errors: undefined });
    mockDeleteTeamSafe.mockResolvedValue({ data: { success: true }, errors: undefined });
    mockList.mockResolvedValue({ data: [], nextToken: null });
  });

  it('sends expected request shapes for safe-delete mutations', async () => {
    await deleteFormationCascade('formation-11');
    await deleteTeamCascade('team-22');
    await deletePlayerCascade('player-33');
    await deleteGameCascade('game-44');

    expect(mockDeleteFormationSafe).toHaveBeenCalledWith({ formationId: 'formation-11' });
    expect(mockDeleteTeamSafe).toHaveBeenCalledWith({ teamId: 'team-22' });
    expect(mockDeletePlayerSafe).toHaveBeenCalledWith({ playerId: 'player-33' });
    expect(mockDeleteGameSafe).toHaveBeenCalledWith({ gameId: 'game-44' });
  });

  it('accepts AWSJSON success payload mapping for mutation responses', async () => {
    mockDeleteFormationSafe.mockResolvedValueOnce({
      data: JSON.stringify({ success: true, deletedPositions: 7 }),
      errors: undefined,
    });

    await expect(deleteFormationCascade('formation-awsjson')).resolves.toBeUndefined();
  });

  it('surfaces auth semantics for unauthorized delete operations', async () => {
    mockDeleteTeamSafe.mockResolvedValueOnce({
      data: null,
      errors: [{ message: 'Unauthorized' }],
    });

    await expect(deleteTeamCascade('team-protected')).rejects.toThrow(/unauthorized/i);
  });

  it('surfaces domain guard errors from safe-delete mutations', async () => {
    mockDeleteFormationSafe.mockResolvedValueOnce({
      data: null,
      errors: [{ message: 'Cannot delete formation currently assigned to team "Aces"' }],
    });

    await expect(deleteFormationCascade('formation-in-use')).rejects.toThrow(/cannot delete formation/i);
  });

  it('treats missing success flag as a contract failure', async () => {
    mockDeletePlayerSafe.mockResolvedValueOnce({
      data: { deleted: true },
      errors: undefined,
    });

    await expect(deletePlayerCascade('player-bad-contract')).rejects.toThrow(/failed to delete player safely/i);
  });
});