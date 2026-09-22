import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(function () { return {}; }),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockSend })) },
  GetCommand: vi.fn(function (input) { return { __type: 'GetCommand', input }; }),
  QueryCommand: vi.fn(function (input) { return { __type: 'QueryCommand', input }; }),
  UpdateCommand: vi.fn(function (input) { return { __type: 'UpdateCommand', input }; }),
}));

import { handler } from './handler';

type HandlerEvent = Parameters<typeof handler>[0];
type HandlerContext = Parameters<typeof handler>[1];
type HandlerCallback = Parameters<typeof handler>[2];

const invoke = (event: HandlerEvent) => handler(event, {} as HandlerContext, (() => {}) as HandlerCallback);

function createEvent(token = 'tok-1', identityId: string | undefined = 'us-east-2:guest-1'): HandlerEvent {
  return {
    arguments: { token },
    identity: identityId ? { cognitoIdentityId: identityId } : undefined,
  } as unknown as HandlerEvent;
}

function setEnv() {
  process.env.SHARE_LINK_TABLE = 'ShareLinkTable';
  process.env.TEAM_TABLE = 'TeamTable';
  process.env.GAME_TABLE = 'GameTable';
  process.env.FAN_VIEW_RATE_LIMIT_TABLE = 'FanViewRateLimitTable';
  process.env.PLAY_TIME_RECORD_TABLE = 'PlayTimeRecordTable';
  process.env.PLAYER_TABLE = 'PlayerTable';
  process.env.FIELD_POSITION_TABLE = 'FieldPositionTable';
  process.env.GOAL_TABLE = 'GoalTable';
  process.env.SUBSTITUTION_TABLE = 'SubstitutionTable';
}

describe('get-fan-game-view handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEnv();
  });

  it('returns an INVALID_LINK state for a token that does not resolve', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand' && command.input.TableName === 'ShareLinkTable') {
        return {};
      }
      return {};
    });

    const result = await invoke(createEvent('missing-token'));
    expect(result).toEqual(expect.objectContaining({ state: 'INVALID_LINK', teamName: null }));
  });

  it('returns a RATE_LIMITED state without leaking game data when over the ceiling', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand' && command.input.TableName === 'ShareLinkTable') {
        return { Item: { token: 'tok-1', teamId: 'team-1', type: 'FAN' } };
      }
      if (command.__type === 'GetCommand' && command.input.TableName === 'TeamTable') {
        return { Item: { id: 'team-1', name: 'Eagles' } };
      }
      if (command.__type === 'UpdateCommand') {
        const error = new Error('ConditionalCheckFailedException') as Error & { name: string };
        error.name = 'ConditionalCheckFailedException';
        throw error;
      }
      return {};
    });

    const result = await invoke(createEvent());
    expect(result).toEqual(expect.objectContaining({ state: 'RATE_LIMITED' }));
  });

  it('returns NO_GAMES_YET with the team name populated when the team has never had a game', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand' && command.input.TableName === 'ShareLinkTable') {
        return { Item: { token: 'tok-1', teamId: 'team-1', type: 'FAN' } };
      }
      if (command.__type === 'GetCommand' && command.input.TableName === 'TeamTable') {
        return { Item: { id: 'team-1', name: 'Eagles' } };
      }
      if (command.__type === 'QueryCommand' && command.input.TableName === 'GameTable') {
        return { Items: [] };
      }
      return {};
    });

    const result = await invoke(createEvent());
    expect(result).toEqual(expect.objectContaining({ state: 'NO_GAMES_YET', teamName: 'Eagles' }));
  });

  it('returns a LIVE game with on-field players and recent events', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      const table = command.input.TableName as string;
      if (command.__type === 'GetCommand' && table === 'ShareLinkTable') {
        return { Item: { token: 'tok-1', teamId: 'team-1', type: 'FAN' } };
      }
      if (command.__type === 'GetCommand' && table === 'TeamTable') {
        return { Item: { id: 'team-1', name: 'Eagles' } };
      }
      if (command.__type === 'QueryCommand' && table === 'GameTable') {
        return {
          Items: [{
            id: 'game-1', teamId: 'team-1', opponent: 'Lakeside FC', status: 'in-progress',
            currentHalf: 1, elapsedSeconds: 600, lastStartTime: '2026-09-13T16:50:00.000Z',
            halfLengthMinutes: 30, ourScore: 1, opponentScore: 0, gameDate: '2026-09-13T16:30:00.000Z',
          }],
        };
      }
      if (command.__type === 'QueryCommand' && table === 'PlayTimeRecordTable') {
        return { Items: [{ playerId: 'p1', positionId: 'pos1', endGameSeconds: null }] };
      }
      if (command.__type === 'QueryCommand' && table === 'GoalTable') {
        return { Items: [{ scoredByUs: true, scorerId: 'p1', gameSeconds: 300, half: 1 }] };
      }
      if (command.__type === 'QueryCommand' && table === 'SubstitutionTable') {
        return { Items: [] };
      }
      if (command.__type === 'GetCommand' && table === 'PlayerTable') {
        return { Item: { id: 'p1', firstName: 'Sam', lastName: 'Jones' } };
      }
      if (command.__type === 'GetCommand' && table === 'FieldPositionTable') {
        return { Item: { id: 'pos1', positionName: 'Forward' } };
      }
      return {};
    });

    const result = await invoke(createEvent()) as {
      state: string;
      opponentName: string;
      onFieldPlayers: Array<{ firstName: string; lastInitial: string; positionName: string | null }>;
      recentEvents: Array<{ type: string; playerName: string | null }>;
    };

    expect(result.state).toBe('LIVE');
    expect(result.opponentName).toBe('Lakeside FC');
    expect(result.onFieldPlayers).toEqual([{ firstName: 'Sam', lastInitial: 'J.', positionName: 'Forward' }]);
    expect(result.recentEvents).toEqual([{ type: 'GOAL', playerName: 'Sam J.', minute: 5, half: 1 }]);
  });

  it('does not include playerId in the on-field payload (privacy design)', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      const table = command.input.TableName as string;
      if (command.__type === 'GetCommand' && table === 'ShareLinkTable') {
        return { Item: { token: 'tok-1', teamId: 'team-1', type: 'FAN' } };
      }
      if (command.__type === 'GetCommand' && table === 'TeamTable') {
        return { Item: { id: 'team-1', name: 'Eagles' } };
      }
      if (command.__type === 'QueryCommand' && table === 'GameTable') {
        return {
          Items: [{
            id: 'game-1', teamId: 'team-1', opponent: 'Lakeside FC', status: 'in-progress',
            currentHalf: 1, elapsedSeconds: 600, lastStartTime: null, halfLengthMinutes: 30,
            ourScore: 0, opponentScore: 0, gameDate: '2026-09-13T16:30:00.000Z',
          }],
        };
      }
      if (command.__type === 'QueryCommand' && table === 'PlayTimeRecordTable') {
        return { Items: [{ playerId: 'p1', positionId: 'pos1', endGameSeconds: null }] };
      }
      if (command.__type === 'GetCommand' && table === 'PlayerTable') {
        return { Item: { id: 'p1', firstName: 'Sam', lastName: 'Jones' } };
      }
      if (command.__type === 'GetCommand' && table === 'FieldPositionTable') {
        return { Item: { id: 'pos1', positionName: 'Forward' } };
      }
      return { Items: [] };
    });

    const result = await invoke(createEvent()) as { onFieldPlayers: Array<Record<string, unknown>> };
    expect(result.onFieldPlayers[0]).not.toHaveProperty('playerId');
  });

  it('rejects (INVALID_LINK) a token generated for the STAT_TRACKER type', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand' && command.input.TableName === 'ShareLinkTable') {
        return { Item: { token: 'tok-1', teamId: 'team-1', type: 'STAT_TRACKER' } };
      }
      return {};
    });

    const result = await invoke(createEvent());
    expect(result).toEqual(expect.objectContaining({ state: 'INVALID_LINK' }));
  });
});
