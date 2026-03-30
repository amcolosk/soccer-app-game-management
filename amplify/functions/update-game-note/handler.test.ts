import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mockSend })),
  },
  GetCommand: vi.fn(function (input) { return { __type: 'GetCommand', input }; }),
  ScanCommand: vi.fn(function (input) { return { __type: 'ScanCommand', input }; }),
  UpdateCommand: vi.fn(function (input) { return { __type: 'UpdateCommand', input }; }),
}));

import { handler } from './handler';

type HandlerEvent = Parameters<typeof handler>[0];

function createEvent(overrides: Partial<HandlerEvent['arguments']> = {}): HandlerEvent {
  return {
    arguments: {
      id: 'note-1',
      noteType: 'coaching-point',
      playerId: null,
      notes: 'Updated note',
      ...overrides,
    },
    identity: { sub: 'coach-1' },
  } as HandlerEvent;
}

describe('update-game-note handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GAME_NOTE_TABLE = 'GameNoteTable';
    process.env.GAME_TABLE = 'GameTable';
    process.env.TEAM_ROSTER_TABLE = 'TeamRosterTable';

    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        if (command.input.TableName === 'GameTable') {
          return {
            Item: {
              id: 'game-1',
              teamId: 'team-1',
            },
          };
        }

        return {
          Item: {
            id: 'note-1',
            authorId: 'coach-1',
            coaches: ['coach-1'],
            gameId: 'game-1',
            noteType: 'coaching-point',
            playerId: null,
            gameSeconds: null,
            half: null,
            notes: 'Original note',
            timestamp: '2026-03-29T12:00:00.000Z',
            createdAt: '2026-03-29T12:00:00.000Z',
          },
        };
      }

      if (command.__type === 'ScanCommand') {
        return { Items: [{ id: 'roster-1' }] };
      }

      if (command.__type === 'UpdateCommand') {
        return {
          Attributes: {
            id: 'note-1',
            authorId: 'coach-1',
            coaches: ['coach-1'],
            gameId: 'game-1',
            noteType: 'coaching-point',
            playerId: null,
            gameSeconds: null,
            half: null,
            notes: 'Updated note',
            timestamp: '2026-03-29T12:00:00.000Z',
            createdAt: '2026-03-29T12:00:00.000Z',
          },
        };
      }

      return {};
    });
  });

  it('rejects spoofed authorId updates', async () => {
    await expect(handler(createEvent({ authorId: 'attacker-id' }))).rejects.toThrow('authorId cannot be updated');
  });

  it('rejects changing a timed note into a coaching-point note', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return {
          Item: {
            id: 'note-1',
            authorId: 'coach-1',
            coaches: ['coach-1'],
            gameId: 'game-1',
            noteType: 'gold-star',
            playerId: 'player-1',
            gameSeconds: 45,
            half: 1,
            notes: 'Original note',
            timestamp: '2026-03-29T12:00:00.000Z',
            createdAt: '2026-03-29T12:00:00.000Z',
          },
        };
      }

      return {};
    });

    await expect(handler(createEvent({ noteType: 'coaching-point' }))).rejects.toThrow(
      'coaching-point notes must retain null gameSeconds and half'
    );
  });

  it('rejects updates to non-coaching notes when persisted timing is malformed', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return {
          Item: {
            id: 'note-1',
            authorId: 'coach-1',
            coaches: ['coach-1'],
            gameId: 'game-1',
            noteType: 'gold-star',
            playerId: 'player-1',
            gameSeconds: null,
            half: null,
            notes: 'Original note',
            timestamp: '2026-03-29T12:00:00.000Z',
            createdAt: '2026-03-29T12:00:00.000Z',
          },
        };
      }

      return {};
    });

    await expect(handler(createEvent({ noteType: 'gold-star' }))).rejects.toThrow(
      'non-coaching notes must retain both gameSeconds and half'
    );
  });

  it('rejects arbitrary playerId updates that are not on the game team roster', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        if (command.input.TableName === 'GameTable') {
          return {
            Item: {
              id: 'game-1',
              teamId: 'team-1',
            },
          };
        }

        return {
          Item: {
            id: 'note-1',
            authorId: 'coach-1',
            coaches: ['coach-1'],
            gameId: 'game-1',
            noteType: 'gold-star',
            playerId: 'player-1',
            gameSeconds: 45,
            half: 1,
            notes: 'Original note',
            timestamp: '2026-03-29T12:00:00.000Z',
            createdAt: '2026-03-29T12:00:00.000Z',
          },
        };
      }

      if (command.__type === 'ScanCommand') {
        return { Items: [] };
      }

      return {};
    });

    await expect(handler(createEvent({ noteType: 'gold-star', playerId: 'player-404' }))).rejects.toThrow(
      'playerId must belong to the game team roster'
    );
  });

  it('rejects cross-team playerId updates', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        if (command.input.TableName === 'GameTable') {
          return {
            Item: {
              id: 'game-1',
              teamId: 'team-1',
            },
          };
        }

        return {
          Item: {
            id: 'note-1',
            authorId: 'coach-1',
            coaches: ['coach-1'],
            gameId: 'game-1',
            noteType: 'gold-star',
            playerId: 'player-1',
            gameSeconds: 45,
            half: 1,
            notes: 'Original note',
            timestamp: '2026-03-29T12:00:00.000Z',
            createdAt: '2026-03-29T12:00:00.000Z',
          },
        };
      }

      if (command.__type === 'ScanCommand') {
        expect(command.input.ExpressionAttributeValues).toEqual({
          ':teamId': 'team-1',
          ':playerId': 'player-cross-team',
        });
        return { Items: [] };
      }

      return {};
    });

    await expect(handler(createEvent({ noteType: 'gold-star', playerId: 'player-cross-team' }))).rejects.toThrow(
      'playerId must belong to the game team roster'
    );
  });
});