import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGame, emailGameSummary } from './gameService';

const { mockCreateGame, mockEmailGameSummary } = vi.hoisted(() => ({
  mockCreateGame: vi.fn(),
  mockEmailGameSummary: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    mutations: {
      createGameSafe: mockCreateGame,
      emailGameSummary: mockEmailGameSummary,
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

describe('emailGameSummary', () => {
  it('calls the emailGameSummary mutation with the given gameId and returns result.data', async () => {
    mockEmailGameSummary.mockResolvedValueOnce({
      data: { success: true, sentTo: 'coach@example.com' },
      errors: undefined,
    });

    const result = await emailGameSummary('game-1');
    expect(mockEmailGameSummary).toHaveBeenCalledWith({ gameId: 'game-1' });
    expect(result).toEqual({ success: true, sentTo: 'coach@example.com' });
  });

  it('throws with the server error message when result.errors is present', async () => {
    mockEmailGameSummary.mockResolvedValueOnce({
      data: null,
      errors: [{ message: 'Access denied: caller is not a coach on this game' }],
    });

    await expect(emailGameSummary('game-1')).rejects.toThrow(
      /access denied: caller is not a coach on this game/i,
    );
  });

  it('throws the fallback message when result.data is falsy with no errors', async () => {
    mockEmailGameSummary.mockResolvedValueOnce({ data: null, errors: undefined });

    await expect(emailGameSummary('game-1')).rejects.toThrow(
      /failed to send game summary email/i,
    );
  });
});
