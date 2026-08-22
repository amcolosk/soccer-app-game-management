import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGame } from './gameService';

const { mockCreateGame } = vi.hoisted(() => ({
  mockCreateGame: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    mutations: {
      createGameSafe: mockCreateGame,
    },
  })),
}));

const validGame = {
  id: 'game-1',
  teamId: 'team-1',
  opponent: 'Lions',
  isHome: true,
  status: 'scheduled',
  currentHalf: 1,
  elapsedSeconds: 0,
  ourScore: 0,
  opponentScore: 0,
  coaches: ['coach-1'],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateGame.mockResolvedValue({ data: validGame, errors: undefined });
});

describe('createGame', () => {
  it('calls the createGame mutation with the given input and returns result.data', async () => {
    const result = await createGame({ teamId: 'team-1', opponent: 'Lions', isHome: true });
    expect(mockCreateGame).toHaveBeenCalledWith({ teamId: 'team-1', opponent: 'Lions', isHome: true });
    expect(result).toEqual(validGame);
  });

  it('throws with the server error message when result.errors is present', async () => {
    mockCreateGame.mockResolvedValueOnce({
      data: null,
      errors: [{ message: 'Access denied: caller is not a coach on this team' }],
    });

    await expect(createGame({ teamId: 'team-1', opponent: 'Lions', isHome: true })).rejects.toThrow(
      /access denied: caller is not a coach on this team/i,
    );
  });

  it('throws the fallback message when result.data is falsy with no errors', async () => {
    mockCreateGame.mockResolvedValueOnce({ data: null, errors: undefined });

    await expect(createGame({ teamId: 'team-1', opponent: 'Lions', isHome: true })).rejects.toThrow(
      /failed to create game/i,
    );
  });
});
