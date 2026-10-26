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

const event = (overrides: Partial<HandlerEvent> = {}): HandlerEvent =>
  ({ arguments: { id: 'note-1' }, identity: { sub: 'coach-2' }, ...overrides }) as HandlerEvent;

function mockTables(note: Record<string, unknown> | undefined, coaches = ['coach-1', 'coach-2']) {
  mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
    if (command.__type === 'GetCommand') {
      if (command.input.TableName === 'GameNoteTable') return { Item: note };
      if (command.input.TableName === 'GameTable') return { Item: { id: 'game-1', teamId: 'team-1' } };
      if (command.input.TableName === 'TeamTable') return { Item: { id: 'team-1', coaches } };
    }
    if (command.__type === 'UpdateCommand') return { Attributes: { id: 'note-1', noteType: 'red-card', gameId: 'game-1', coaches } };
    return {};
  });
}

describe('rescind-send-off handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GAME_NOTE_TABLE = 'GameNoteTable';
    process.env.GAME_TABLE = 'GameTable';
    process.env.TEAM_TABLE = 'TeamTable';
    mockTables({ id: 'note-1', gameId: 'game-1', noteType: 'red-card' });
  });

  it('lets any team coach (not only the author) rescind and stamps the caller as rescindedById', async () => {
    const result = await invoke(event());
    const update = mockSend.mock.calls.find(([c]) => c.__type === 'UpdateCommand')?.[0];
    expect(update.input.ExpressionAttributeValues[':rescindedById']).toBe('coach-2');
    expect(result).toMatchObject({ id: 'note-1', rescindedById: 'coach-2' });
  });

  it('only updates rescinded fields (never noteType/notes/authorId)', async () => {
    await invoke(event());
    const update = mockSend.mock.calls.find(([c]) => c.__type === 'UpdateCommand')?.[0];
    expect(Object.values(update.input.ExpressionAttributeNames).sort()).toEqual(['rescindedAt', 'rescindedById', 'updatedAt']);
  });

  it('rejects an unauthenticated caller', async () => {
    await expect(invoke(event({ identity: {} as never }))).rejects.toThrow('AUTH_UNAUTHENTICATED');
  });

  it('rejects a caller who is not a team coach', async () => {
    await expect(invoke(event({ identity: { sub: 'outsider' } as never }))).rejects.toThrow('AUTH_COACH_REQUIRED');
  });

  it('rejects a note that is not a red card', async () => {
    mockTables({ id: 'note-1', gameId: 'game-1', noteType: 'yellow-card' });
    await expect(invoke(event())).rejects.toThrow('RULE_RESCIND_NOT_RED_CARD');
  });

  it('rejects a note that is already rescinded', async () => {
    mockTables({ id: 'note-1', gameId: 'game-1', noteType: 'red-card', rescindedAt: '2026-10-26T00:00:00Z' });
    await expect(invoke(event())).rejects.toThrow('RULE_ALREADY_RESCINDED');
  });

  it('rejects when the note does not exist', async () => {
    mockTables(undefined);
    await expect(invoke(event())).rejects.toThrow('NOT_FOUND_GAME_NOTE');
  });
});
