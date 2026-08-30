import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(function () { return {}; }),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockSend })) },
  GetCommand: vi.fn(function (input) { return { __type: 'GetCommand', input }; }),
  DeleteCommand: vi.fn(function (input) { return { __type: 'DeleteCommand', input }; }),
  UpdateCommand: vi.fn(function (input) { return { __type: 'UpdateCommand', input }; }),
}));

import { handler } from './handler';

type HandlerEvent = Parameters<typeof handler>[0];
type HandlerContext = Parameters<typeof handler>[1];
type HandlerCallback = Parameters<typeof handler>[2];
const invoke = (event: HandlerEvent) => handler(event, {} as HandlerContext, (() => {}) as HandlerCallback);

function createEvent(overrides: Partial<HandlerEvent['arguments']> = {}, identity: unknown = { sub: 'coach-1' }): HandlerEvent {
  return {
    arguments: { teamId: 'team-1', ...overrides },
    identity,
  } as HandlerEvent;
}

const activeTeam = { id: 'team-1', coaches: ['coach-1', 'coach-2'], status: 'active' };

describe('unlink-team-calendar handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TEAM_TABLE = 'TeamTable';
    process.env.CALENDAR_FEED_TABLE = 'CalendarFeedTable';

    mockSend.mockImplementation(async (command: { __type: string }) => {
      if (command.__type === 'GetCommand') return { Item: activeTeam };
      return {};
    });
  });

  it('rejects an unauthenticated caller', async () => {
    await expect(invoke(createEvent({}, {}))).rejects.toThrow('User not authenticated');
  });

  it('rejects a caller who is not a coach on the team', async () => {
    mockSend.mockImplementation(async (command: { __type: string }) => {
      if (command.__type === 'GetCommand') return { Item: { id: 'team-1', coaches: ['someone-else'], status: 'active' } };
      return {};
    });
    await expect(invoke(createEvent())).rejects.toThrow('Access denied');
  });

  it('rejects unlinking an archived team', async () => {
    mockSend.mockImplementation(async (command: { __type: string }) => {
      if (command.__type === 'GetCommand') return { Item: { ...activeTeam, status: 'archived' } };
      return {};
    });
    await expect(invoke(createEvent())).rejects.toThrow(/archived/i);
  });

  it('deletes the CalendarFeed row keyed by teamId', async () => {
    await invoke(createEvent());
    const deleteCall = mockSend.mock.calls.find(([c]) => c.__type === 'DeleteCommand');
    expect(deleteCall).toBeDefined();
    expect(deleteCall![0].input.TableName).toBe('CalendarFeedTable');
    expect(deleteCall![0].input.Key).toEqual({ teamId: 'team-1' });
  });

  it('clears the five Team calendarFeed* status fields', async () => {
    await invoke(createEvent());
    const updateCall = mockSend.mock.calls.find(([c]) => c.__type === 'UpdateCommand');
    expect(updateCall).toBeDefined();
    expect(updateCall![0].input.TableName).toBe('TeamTable');
    expect(updateCall![0].input.UpdateExpression).toContain('REMOVE calendarFeedProvider, calendarFeedTeamAlias, calendarFeedHost, calendarFeedLastSyncedAt, calendarFeedLastError');
  });

  it('returns true on success', async () => {
    const result = await invoke(createEvent());
    expect(result).toBe(true);
  });

  it('does not touch the Game table at all (Game.external* fields survive unlink)', async () => {
    await invoke(createEvent());
    const gameTableCalls = mockSend.mock.calls.filter(([c]) => c.input?.TableName === 'GameTable');
    expect(gameTableCalls).toHaveLength(0);
  });

  it('is idempotent when there is no CalendarFeed row to delete', async () => {
    // DeleteCommand has no attribute_exists condition -- deleting a
    // nonexistent row is a no-op, not an error.
    await expect(invoke(createEvent())).resolves.toBe(true);
  });
});
