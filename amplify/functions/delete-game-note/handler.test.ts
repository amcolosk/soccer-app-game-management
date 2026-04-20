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
  DeleteCommand: vi.fn(function (input) { return { __type: 'DeleteCommand', input }; }),
}));

import { handler } from './handler';

type HandlerEvent = Parameters<typeof handler>[0];
type HandlerContext = Parameters<typeof handler>[1];
type HandlerCallback = Parameters<typeof handler>[2];
const invoke = (event: HandlerEvent) => handler(event, {} as HandlerContext, (() => {}) as HandlerCallback);

function createEvent(overrides: Partial<HandlerEvent> = {}): HandlerEvent {
  return {
    arguments: { id: 'note-1' },
    identity: { sub: 'coach-1' },
    ...overrides,
  } as HandlerEvent;
}

describe('delete-game-note handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GAME_NOTE_TABLE = 'GameNoteTable';
    process.env.GAME_TABLE = 'GameTable';
    process.env.TEAM_TABLE = 'TeamTable';

    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        if (command.input.TableName === 'GameNoteTable') {
          return {
            Item: {
              id: 'note-1',
              gameId: 'game-1',
              noteType: 'gold-star',
              authorId: 'coach-1',
            },
          };
        }

        if (command.input.TableName === 'GameTable') {
          return { Item: { id: 'game-1', teamId: 'team-1' } };
        }

        if (command.input.TableName === 'TeamTable') {
          return { Item: { id: 'team-1', coaches: ['coach-1', 'coach-2'] } };
        }
      }

      if (command.__type === 'DeleteCommand') {
        return {};
      }

      return {};
    });
  });

  it('deletes a deletable note when caller is author coach', async () => {
    await expect(invoke(createEvent())).resolves.toMatchObject({ success: true });
    const deleteCall = mockSend.mock.calls.find(([command]) => command.__type === 'DeleteCommand');
    expect(deleteCall).toBeDefined();
  });

  it('returns AUTH_COACH_REQUIRED when caller is not a team coach', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand' && command.input.TableName === 'GameNoteTable') {
        return { Item: { id: 'note-1', gameId: 'game-1', noteType: 'gold-star', authorId: 'coach-1' } };
      }
      if (command.__type === 'GetCommand' && command.input.TableName === 'GameTable') {
        return { Item: { id: 'game-1', teamId: 'team-1' } };
      }
      if (command.__type === 'GetCommand' && command.input.TableName === 'TeamTable') {
        return { Item: { id: 'team-1', coaches: ['coach-9'] } };
      }
      return {};
    });

    await expect(invoke(createEvent())).rejects.toThrow('AUTH_COACH_REQUIRED');
  });

  it('returns AUTH_DELETE_AUTHOR_REQUIRED when caller is non-author coach', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand' && command.input.TableName === 'GameNoteTable') {
        return { Item: { id: 'note-1', gameId: 'game-1', noteType: 'gold-star', authorId: 'coach-2' } };
      }
      if (command.__type === 'GetCommand' && command.input.TableName === 'GameTable') {
        return { Item: { id: 'game-1', teamId: 'team-1' } };
      }
      if (command.__type === 'GetCommand' && command.input.TableName === 'TeamTable') {
        return { Item: { id: 'team-1', coaches: ['coach-1', 'coach-2'] } };
      }
      return {};
    });

    await expect(invoke(createEvent())).rejects.toThrow('AUTH_DELETE_AUTHOR_REQUIRED');
  });

  it('returns RULE_DELETE_DISALLOWED_NOTE_TYPE for yellow/red notes', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand' && command.input.TableName === 'GameNoteTable') {
        return { Item: { id: 'note-1', gameId: 'game-1', noteType: 'yellow-card', authorId: 'coach-1' } };
      }
      if (command.__type === 'GetCommand' && command.input.TableName === 'GameTable') {
        return { Item: { id: 'game-1', teamId: 'team-1' } };
      }
      if (command.__type === 'GetCommand' && command.input.TableName === 'TeamTable') {
        return { Item: { id: 'team-1', coaches: ['coach-1', 'coach-2'] } };
      }
      return {};
    });

    await expect(invoke(createEvent())).rejects.toThrow('RULE_DELETE_DISALLOWED_NOTE_TYPE');
  });

  it('returns NOT_FOUND_GAME_NOTE when note does not exist', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand' && command.input.TableName === 'GameNoteTable') {
        return { Item: undefined };
      }
      return {};
    });

    await expect(invoke(createEvent())).rejects.toThrow('NOT_FOUND_GAME_NOTE');
  });
});
