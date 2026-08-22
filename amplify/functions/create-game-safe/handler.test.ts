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
  PutCommand: vi.fn(function (input) { return { __type: 'PutCommand', input }; }),
}));

import { handler } from './handler';

type HandlerEvent = Parameters<typeof handler>[0];
type HandlerContext = Parameters<typeof handler>[1];
type HandlerCallback = Parameters<typeof handler>[2];
const invoke = (event: HandlerEvent) => handler(event, {} as HandlerContext, (() => {}) as HandlerCallback);

function createEvent(overrides: Partial<HandlerEvent['arguments']> = {}, identity: unknown = { sub: 'coach-1' }): HandlerEvent {
  return {
    arguments: {
      teamId: 'team-1',
      opponent: 'Lions',
      isHome: true,
      gameDate: undefined,
      ...overrides,
    },
    identity,
  } as HandlerEvent;
}

describe('create-game-safe handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GAME_TABLE = 'GameTable';
    process.env.TEAM_TABLE = 'TeamTable';

    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return {
          Item: {
            id: 'team-1',
            coaches: ['coach-1', 'coach-2'],
          },
        };
      }

      if (command.__type === 'PutCommand') {
        return {};
      }

      return {};
    });
  });

  it('creates a game with all default fields set correctly when the caller is a coach on the team', async () => {
    const result = await invoke(createEvent());

    const putCall = mockSend.mock.calls.find(([command]) => command.__type === 'PutCommand');
    const item = putCall?.[0].input.Item as Record<string, unknown>;

    expect(item).toMatchObject({
      teamId: 'team-1',
      opponent: 'Lions',
      isHome: true,
      status: 'scheduled',
      currentHalf: 1,
      elapsedSeconds: 0,
      lastStartTime: null,
      halfLengthMinutes: null,
      ourScore: 0,
      opponentScore: 0,
      gameDate: null,
    });
    expect(typeof item.id).toBe('string');
    expect(typeof item.createdAt).toBe('string');
    expect(typeof item.updatedAt).toBe('string');
    expect(result).toEqual(item);
  });

  it('derives coaches from the team record — there is no coaches argument to influence this', async () => {
    await invoke(createEvent());

    const putCall = mockSend.mock.calls.find(([command]) => command.__type === 'PutCommand');
    const item = putCall?.[0].input.Item as { coaches?: string[] };
    expect(item.coaches).toEqual(['coach-1', 'coach-2']);
  });

  it('uses a strongly consistent read for the Team GetCommand', async () => {
    await invoke(createEvent());

    const getCall = mockSend.mock.calls.find(([command]) => command.__type === 'GetCommand');
    expect(getCall?.[0].input.ConsistentRead).toBe(true);
  });

  it('rejects when the caller is not authenticated', async () => {
    await expect(invoke(createEvent({}, {}))).rejects.toThrow('User not authenticated');
  });

  it('rejects when teamId does not resolve to an existing team', async () => {
    mockSend.mockImplementation(async (command: { __type: string }) => {
      if (command.__type === 'GetCommand') {
        return { Item: undefined };
      }
      return {};
    });

    await expect(invoke(createEvent({ teamId: 'missing-team' }))).rejects.toThrow('Team not found');
  });

  it('rejects when the caller is not in team.coaches', async () => {
    mockSend.mockImplementation(async (command: { __type: string }) => {
      if (command.__type === 'GetCommand') {
        return {
          Item: {
            id: 'team-1',
            coaches: ['someone-else'],
          },
        };
      }
      return {};
    });

    await expect(invoke(createEvent())).rejects.toThrow('Access denied: caller is not a coach on this team');
  });

  it('rejects when opponent is empty/whitespace-only', async () => {
    await expect(invoke(createEvent({ opponent: '   ' }))).rejects.toThrow('opponent is required');
  });

  it('omits gameDate correctly when not supplied (null, not undefined)', async () => {
    await invoke(createEvent({ gameDate: undefined }));

    const putCall = mockSend.mock.calls.find(([command]) => command.__type === 'PutCommand');
    const item = putCall?.[0].input.Item as Record<string, unknown>;
    expect(item.gameDate).toBeNull();
  });
});
