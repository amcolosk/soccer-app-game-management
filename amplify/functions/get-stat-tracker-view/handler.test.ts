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
  BatchGetCommand: vi.fn(function (input) { return { __type: 'BatchGetCommand', input }; }),
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
  process.env.TEAM_ROSTER_TABLE = 'TeamRosterTable';
  process.env.PLAYER_TABLE = 'PlayerTable';
  process.env.PLAY_TIME_RECORD_TABLE = 'PlayTimeRecordTable';
  process.env.FORMATION_POSITION_TABLE = 'FormationPositionTable';
}

describe('get-stat-tracker-view handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEnv();
  });

  it('returns INVALID_LINK for a token that does not resolve', async () => {
    mockSend.mockImplementation(async () => ({}));
    const result = await invoke(createEvent('missing-token'));
    expect(result).toEqual(expect.objectContaining({ state: 'INVALID_LINK', teamName: null, roster: [] }));
  });

  it('rejects (INVALID_LINK) a token generated for the FAN type', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand' && command.input.TableName === 'ShareLinkTable') {
        return { Item: { token: 'tok-1', teamId: 'team-1', type: 'FAN' } };
      }
      return {};
    });
    const result = await invoke(createEvent());
    expect(result).toEqual(expect.objectContaining({ state: 'INVALID_LINK' }));
  });

  it('returns RATE_LIMITED without leaking roster data when over the write... er, read ceiling', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand' && command.input.TableName === 'ShareLinkTable') {
        return { Item: { token: 'tok-1', teamId: 'team-1', type: 'STAT_TRACKER' } };
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
    expect(result).toEqual(expect.objectContaining({ state: 'RATE_LIMITED', roster: [] }));
  });

  it('returns the active roster (with playerIds) and current game info for a LIVE game', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      const table = command.input.TableName as string;
      if (command.__type === 'GetCommand' && table === 'ShareLinkTable') {
        return { Item: { token: 'tok-1', teamId: 'team-1', type: 'STAT_TRACKER' } };
      }
      if (command.__type === 'GetCommand' && table === 'TeamTable') {
        return { Item: { id: 'team-1', name: 'Eagles', coaches: ['coach-1'] } };
      }
      if (command.__type === 'QueryCommand' && table === 'GameTable') {
        return {
          Items: [{
            id: 'game-1', teamId: 'team-1', opponent: 'Lakeside FC', status: 'in-progress', currentHalf: 1,
          }],
        };
      }
      if (command.__type === 'QueryCommand' && table === 'TeamRosterTable') {
        return {
          Items: [
            { teamId: 'team-1', playerId: 'p1', isActive: true },
            { teamId: 'team-1', playerId: 'p2', isActive: false }, // filtered out
          ],
        };
      }
      if (command.__type === 'BatchGetCommand' && (command.input as { RequestItems: Record<string, unknown> }).RequestItems?.PlayerTable) {
        return { Responses: { PlayerTable: [{ id: 'p1', firstName: 'Sam', lastName: 'Jones' }] } };
      }
      return {};
    });

    const result = await invoke(createEvent()) as {
      state: string;
      gameId: string | null;
      opponentName: string | null;
      roster: Array<{ id: string; firstName: string; lastName: string }>;
    };

    expect(result.state).toBe('LIVE');
    expect(result.gameId).toBe('game-1');
    expect(result.opponentName).toBe('Lakeside FC');
    expect(result.roster).toEqual([{ id: 'p1', firstName: 'Sam', lastName: 'Jones', positionName: null }]);
  });

  it('excludes players whose TeamRoster row is inactive (isActive: false)', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      const table = command.input.TableName as string;
      if (command.__type === 'GetCommand' && table === 'ShareLinkTable') {
        return { Item: { token: 'tok-1', teamId: 'team-1', type: 'STAT_TRACKER' } };
      }
      if (command.__type === 'GetCommand' && table === 'TeamTable') {
        return { Item: { id: 'team-1', name: 'Eagles' } };
      }
      if (command.__type === 'QueryCommand' && table === 'GameTable') {
        return { Items: [] };
      }
      if (command.__type === 'QueryCommand' && table === 'TeamRosterTable') {
        return { Items: [{ teamId: 'team-1', playerId: 'p1', isActive: false }] };
      }
      return {};
    });

    const result = await invoke(createEvent()) as { roster: unknown[] };
    expect(result.roster).toEqual([]);
  });

  it('returns roster even when there is no current game (NO_GAMES_YET)', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      const table = command.input.TableName as string;
      if (command.__type === 'GetCommand' && table === 'ShareLinkTable') {
        return { Item: { token: 'tok-1', teamId: 'team-1', type: 'STAT_TRACKER' } };
      }
      if (command.__type === 'GetCommand' && table === 'TeamTable') {
        return { Item: { id: 'team-1', name: 'Eagles' } };
      }
      if (command.__type === 'QueryCommand' && table === 'GameTable') {
        return { Items: [] };
      }
      if (command.__type === 'QueryCommand' && table === 'TeamRosterTable') {
        return { Items: [{ teamId: 'team-1', playerId: 'p1', isActive: true }] };
      }
      if (command.__type === 'BatchGetCommand') {
        return { Responses: { PlayerTable: [{ id: 'p1', firstName: 'Sam', lastName: 'Jones' }] } };
      }
      return {};
    });

    const result = await invoke(createEvent()) as { state: string; gameId: string | null; roster: unknown[] };
    expect(result.state).toBe('NO_GAMES_YET');
    expect(result.gameId).toBeNull();
    expect(result.roster.length).toBe(1);
  });

  describe('activeGoalkeeperId (Save Auto-Goalkeeper Attribution)', () => {
    function baseMockSend(overrides: {
      gameItems: Array<Record<string, unknown>>;
      playTimeRecordItems?: Array<Record<string, unknown>>;
      formationPositionItems?: Array<Record<string, unknown>>;
    }) {
      mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
        const table = command.input.TableName as string;
        if (command.__type === 'GetCommand' && table === 'ShareLinkTable') {
          return { Item: { token: 'tok-1', teamId: 'team-1', type: 'STAT_TRACKER' } };
        }
        if (command.__type === 'GetCommand' && table === 'TeamTable') {
          return { Item: { id: 'team-1', name: 'Eagles' } };
        }
        if (command.__type === 'QueryCommand' && table === 'GameTable') {
          return { Items: overrides.gameItems };
        }
        if (command.__type === 'QueryCommand' && table === 'TeamRosterTable') {
          return { Items: [{ teamId: 'team-1', playerId: 'p1', isActive: true }] };
        }
        if (command.__type === 'QueryCommand' && table === 'PlayTimeRecordTable') {
          return { Items: overrides.playTimeRecordItems ?? [] };
        }
        if (command.__type === 'BatchGetCommand' && (command.input as { RequestItems: Record<string, unknown> }).RequestItems?.PlayerTable) {
          return { Responses: { PlayerTable: [{ id: 'p1', firstName: 'Sam', lastName: 'Jones' }] } };
        }
        if (command.__type === 'BatchGetCommand' && (command.input as { RequestItems: Record<string, unknown> }).RequestItems?.FormationPositionTable) {
          return { Responses: { FormationPositionTable: overrides.formationPositionItems ?? [] } };
        }
        return {};
      });
    }

    it('LIVE (in-progress) game, one open PlayTimeRecord at a GOALKEEPER-role FormationPosition -> activeGoalkeeperId equals that playerId', async () => {
      baseMockSend({
        gameItems: [{ id: 'game-1', teamId: 'team-1', opponent: 'Lakeside FC', status: 'in-progress', currentHalf: 1 }],
        playTimeRecordItems: [{ playerId: 'p1', positionId: 'gk-pos', endGameSeconds: null }],
        formationPositionItems: [{ id: 'gk-pos', role: 'GOALKEEPER' }],
      });
      const result = await invoke(createEvent()) as { activeGoalkeeperId: string | null };
      expect(result.activeGoalkeeperId).toBe('p1');
    });

    it('LIVE game, no FormationPosition has role: GOALKEEPER -> activeGoalkeeperId: null', async () => {
      baseMockSend({
        gameItems: [{ id: 'game-1', teamId: 'team-1', opponent: 'Lakeside FC', status: 'in-progress', currentHalf: 1 }],
        playTimeRecordItems: [{ playerId: 'p1', positionId: 'def-pos', endGameSeconds: null }],
        formationPositionItems: [{ id: 'def-pos', role: 'DEFENDER' }],
      });
      const result = await invoke(createEvent()) as { activeGoalkeeperId: string | null };
      expect(result.activeGoalkeeperId).toBeNull();
    });

    it('LIVE game, two open records at two different GOALKEEPER-role positions with two different players -> activeGoalkeeperId: null (ambiguous)', async () => {
      baseMockSend({
        gameItems: [{ id: 'game-1', teamId: 'team-1', opponent: 'Lakeside FC', status: 'in-progress', currentHalf: 1 }],
        playTimeRecordItems: [
          { playerId: 'p1', positionId: 'gk-pos-1', endGameSeconds: null },
          { playerId: 'p2', positionId: 'gk-pos-2', endGameSeconds: null },
        ],
        formationPositionItems: [
          { id: 'gk-pos-1', role: 'GOALKEEPER' },
          { id: 'gk-pos-2', role: 'GOALKEEPER' },
        ],
      });
      const result = await invoke(createEvent()) as { activeGoalkeeperId: string | null };
      expect(result.activeGoalkeeperId).toBeNull();
    });

    it('LIVE game, a closed record (endGameSeconds set) at a GOALKEEPER-role position is excluded -- only open records count', async () => {
      baseMockSend({
        gameItems: [{ id: 'game-1', teamId: 'team-1', opponent: 'Lakeside FC', status: 'in-progress', currentHalf: 1 }],
        playTimeRecordItems: [
          { playerId: 'p1', positionId: 'gk-pos', endGameSeconds: 1200 },
          { playerId: 'p2', positionId: 'gk-pos', endGameSeconds: null },
        ],
        formationPositionItems: [{ id: 'gk-pos', role: 'GOALKEEPER' }],
      });
      const result = await invoke(createEvent()) as { activeGoalkeeperId: string | null };
      expect(result.activeGoalkeeperId).toBe('p2');
    });

    it("status: 'halftime' (still branch LIVE) -> activeGoalkeeperId: null and no PlayTimeRecord/FormationPosition query is issued", async () => {
      baseMockSend({
        gameItems: [{ id: 'game-1', teamId: 'team-1', opponent: 'Lakeside FC', status: 'halftime', currentHalf: 1 }],
      });
      const result = await invoke(createEvent()) as { state: string; activeGoalkeeperId: string | null };
      expect(result.state).toBe('LIVE');
      expect(result.activeGoalkeeperId).toBeNull();
      const queriedTables = mockSend.mock.calls.map((call) => (call[0] as { input: Record<string, unknown> }).input.TableName);
      expect(queriedTables).not.toContain('PlayTimeRecordTable');
      expect(queriedTables).not.toContain('FormationPositionTable');
    });

    it('NEXT_GAME branch -> activeGoalkeeperId: null and no PlayTimeRecord/FormationPosition query is issued', async () => {
      const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
      baseMockSend({
        gameItems: [{ id: 'game-1', teamId: 'team-1', opponent: 'Lakeside FC', status: 'scheduled', currentHalf: null, gameDate: future }],
      });
      const result = await invoke(createEvent()) as { state: string; activeGoalkeeperId: string | null };
      expect(result.state).toBe('NEXT_GAME');
      expect(result.activeGoalkeeperId).toBeNull();
      const queriedTables = mockSend.mock.calls.map((call) => (call[0] as { input: Record<string, unknown> }).input.TableName);
      expect(queriedTables).not.toContain('PlayTimeRecordTable');
      expect(queriedTables).not.toContain('FormationPositionTable');
    });

    it('FINISHED branch -> activeGoalkeeperId: null and no PlayTimeRecord/FormationPosition query is issued', async () => {
      const recentPast = new Date(Date.now() - 1000 * 60 * 30).toISOString(); // 30 min ago
      baseMockSend({
        gameItems: [{ id: 'game-1', teamId: 'team-1', opponent: 'Lakeside FC', status: 'completed', currentHalf: 2, gameDate: recentPast }],
      });
      const result = await invoke(createEvent()) as { state: string; activeGoalkeeperId: string | null };
      expect(result.state).toBe('FINISHED');
      expect(result.activeGoalkeeperId).toBeNull();
      const queriedTables = mockSend.mock.calls.map((call) => (call[0] as { input: Record<string, unknown> }).input.TableName);
      expect(queriedTables).not.toContain('PlayTimeRecordTable');
      expect(queriedTables).not.toContain('FormationPositionTable');
    });

    it('NO_GAMES_YET / NO_GAME_RIGHT_NOW branches -> activeGoalkeeperId: null and no PlayTimeRecord/FormationPosition query is issued', async () => {
      baseMockSend({ gameItems: [] });
      const result = await invoke(createEvent()) as { state: string; activeGoalkeeperId: string | null };
      expect(result.state).toBe('NO_GAMES_YET');
      expect(result.activeGoalkeeperId).toBeNull();
      const queriedTables = mockSend.mock.calls.map((call) => (call[0] as { input: Record<string, unknown> }).input.TableName);
      expect(queriedTables).not.toContain('PlayTimeRecordTable');
      expect(queriedTables).not.toContain('FormationPositionTable');
    });

    it('RATE_LIMITED / INVALID_LINK -> unchanged (activeGoalkeeperId: null implicitly via emptyResult())', async () => {
      mockSend.mockImplementation(async () => ({}));
      const result = await invoke(createEvent('missing-token')) as { state: string; activeGoalkeeperId: string | null };
      expect(result.state).toBe('INVALID_LINK');
      expect(result.activeGoalkeeperId).toBeNull();
    });
  });
});
