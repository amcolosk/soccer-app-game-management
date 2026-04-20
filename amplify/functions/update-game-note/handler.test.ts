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
  UpdateCommand: vi.fn(function (input) { return { __type: 'UpdateCommand', input }; }),
}));

import { handler } from './handler';

type HandlerEvent = Parameters<typeof handler>[0];
type HandlerContext = Parameters<typeof handler>[1];
type HandlerCallback = Parameters<typeof handler>[2];
const invoke = (event: HandlerEvent) => handler(event, {} as HandlerContext, (() => {}) as HandlerCallback);

function createEvent(overrides: Partial<HandlerEvent['arguments']> = {}): HandlerEvent {
  return {
    arguments: {
      id: 'note-1',
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
    process.env.TEAM_TABLE = 'TeamTable';

    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        if (command.input.TableName === 'GameNoteTable') {
          return {
            Item: {
              id: 'note-1',
              gameId: 'game-1',
              noteType: 'other',
              authorId: 'coach-1',
              notes: 'Original note',
              timestamp: '2026-03-29T12:00:00.000Z',
              createdAt: '2026-03-29T12:00:00.000Z',
              gameSeconds: 600,
              half: 2,
            },
          };
        }
        if (command.input.TableName === 'GameTable') {
          return {
            Item: {
              id: 'game-1',
              teamId: 'team-1',
            },
          };
        }
        if (command.input.TableName === 'TeamTable') {
          return {
            Item: {
              id: 'team-1',
              coaches: ['coach-1', 'coach-2'],
            },
          };
        }
      }

      if (command.__type === 'UpdateCommand') {
        return {
          Attributes: {
            id: 'note-1',
            gameId: 'game-1',
            noteType: 'other',
            authorId: 'coach-1',
            notes: 'Updated note',
            timestamp: '2026-03-29T12:00:00.000Z',
            createdAt: '2026-03-29T12:00:00.000Z',
            gameSeconds: 600,
            half: 2,
            editedAt: '2026-03-29T13:00:00.000Z',
            editedById: 'coach-1',
          },
        };
      }

      return {};
    });
  });

  it('updates notes text and sets edited attribution when notes changes', async () => {
    const result = await invoke(createEvent({ notes: 'Updated note' }));
    expect(result).toMatchObject({
      id: 'note-1',
      notes: 'Updated note',
      editedById: 'coach-1',
    });
  });

  it('rejects non-notes fields with canonical validation code', async () => {
    await expect(invoke(createEvent({ noteType: 'gold-star' as never }))).rejects.toThrow('VALIDATION_NOTES_ONLY_EDIT');
    await expect(invoke(createEvent({ playerId: 'p1' as never }))).rejects.toThrow('VALIDATION_NOTES_ONLY_EDIT');
    await expect(invoke(createEvent({ authorId: 'spoofed' as never }))).rejects.toThrow('VALIDATION_NOTES_ONLY_EDIT');
  });

  it('rejects oversized notes with canonical validation code', async () => {
    await expect(invoke(createEvent({ notes: 'a'.repeat(501) }))).rejects.toThrow('VALIDATION_NOTES_TOO_LONG');
  });

  it('rejects non-coaches with AUTH_COACH_REQUIRED', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand' && command.input.TableName === 'GameNoteTable') {
        return {
          Item: {
            id: 'note-1', gameId: 'game-1', noteType: 'other', authorId: 'coach-1', notes: 'Original note',
          },
        };
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