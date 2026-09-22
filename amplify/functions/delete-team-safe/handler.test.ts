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
  DeleteCommand: vi.fn(function (input) { return { __type: 'DeleteCommand', input }; }),
  PutCommand: vi.fn(function (input) { return { __type: 'PutCommand', input }; }),
}));

import { handler } from './handler';

type HandlerEvent = Parameters<typeof handler>[0];
type HandlerContext = Parameters<typeof handler>[1];
type HandlerCallback = Parameters<typeof handler>[2];

const invoke = (event: HandlerEvent) => handler(event, {} as HandlerContext, (() => {}) as HandlerCallback);

function createEvent(overrides: Partial<HandlerEvent['arguments']> = {}): HandlerEvent {
  return {
    arguments: {
      teamId: 'team-1',
      ...overrides,
    },
    identity: { sub: 'coach-1' },
  } as HandlerEvent;
}

describe('delete-team-safe handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TEAM_TABLE = 'TeamTable';
    process.env.GAME_TABLE = 'GameTable';
    process.env.TEAM_ROSTER_TABLE = 'TeamRosterTable';
    process.env.TEAM_INVITATION_TABLE = 'TeamInvitationTable';
    process.env.PLAY_TIME_RECORD_TABLE = 'PlayTimeRecordTable';
    process.env.GOAL_TABLE = 'GoalTable';
    process.env.SHOT_TABLE = 'ShotTable';
    process.env.SAVE_TABLE = 'SaveTable';
    process.env.GAME_NOTE_TABLE = 'GameNoteTable';
    process.env.SUBSTITUTION_TABLE = 'SubstitutionTable';
    process.env.LINEUP_ASSIGNMENT_TABLE = 'LineupAssignmentTable';
    process.env.PLAYER_AVAILABILITY_TABLE = 'PlayerAvailabilityTable';
    process.env.GAME_PLAN_TABLE = 'GamePlanTable';
    process.env.PLANNED_ROTATION_TABLE = 'PlannedRotationTable';
    process.env.SHARE_LINK_TABLE = 'ShareLinkTable';

    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return { Item: { id: 'team-1', coaches: ['coach-1'] } };
      }

      if (command.__type === 'ScanCommand') {
        const table = command.input.TableName as string;
        if (table === 'GameTable') {
          return { Items: [{ id: 'game-1', teamId: 'team-1' }] };
        }
        if (table === 'TeamRosterTable') {
          return { Items: [{ id: 'roster-1', teamId: 'team-1' }] };
        }
        if (table === 'TeamInvitationTable') {
          return { Items: [{ id: 'invite-1', teamId: 'team-1' }] };
        }
        if (table === 'ShotTable') {
          return { Items: [{ id: 'shot-1', gameId: 'game-1' }] };
        }
        if (table === 'SaveTable') {
          return { Items: [{ id: 'save-1', gameId: 'game-1' }] };
        }
        if (table === 'ShareLinkTable') {
          return { Items: [{ token: 'tok-1', teamId: 'team-1' }] };
        }
        return { Items: [] };
      }

      return {};
    });
  });

  it('rejects when caller is not a coach on the team', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return { Item: { id: 'team-1', coaches: ['coach-2'] } };
      }
      return { Items: [] };
    });

    await expect(invoke(createEvent())).rejects.toThrow(/access denied/i);
  });

  it('deletes team after games and direct children', async () => {
    const result = await invoke(createEvent());

    expect(result).toEqual(expect.objectContaining({ success: true }));

    const deleteCalls = mockSend.mock.calls.filter(([cmd]) => cmd.__type === 'DeleteCommand');
    const deleteTables = deleteCalls.map(([cmd]) => (cmd.input as { TableName: string }).TableName);
    expect(deleteTables[deleteTables.length - 1]).toBe('TeamTable');
  });

  it('cascades ShareLink deletion by teamId, keyed on token not id', async () => {
    const result = await invoke(createEvent());

    expect(result).toEqual(expect.objectContaining({ success: true, deletedCounts: expect.objectContaining({ shareLinks: 1 }) }));

    const deleteCalls = mockSend.mock.calls.filter(([cmd]) => cmd.__type === 'DeleteCommand');
    const shareLinkDelete = deleteCalls.find(([cmd]) => (cmd.input as { TableName: string }).TableName === 'ShareLinkTable');
    expect(shareLinkDelete).toBeDefined();
    expect((shareLinkDelete![0].input as { Key: Record<string, unknown> }).Key).toEqual({ token: 'tok-1' });
  });

  it('cascades shot and save deletion for each team game', async () => {
    const result = await invoke(createEvent());

    expect(result).toEqual(expect.objectContaining({ success: true }));

    const deleteCalls = mockSend.mock.calls.filter(([cmd]) => cmd.__type === 'DeleteCommand');
    const deleteTables = deleteCalls.map(([cmd]) => (cmd.input as { TableName: string }).TableName);
    expect(deleteTables).toEqual(expect.arrayContaining(['ShotTable', 'SaveTable']));
  });

  it('rolls back prior deletes when a later delete fails', async () => {
    let deleteCount = 0;
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return { Item: { id: 'team-1', coaches: ['coach-1'] } };
      }

      if (command.__type === 'ScanCommand') {
        const table = command.input.TableName as string;
        if (table === 'GameTable') {
          return { Items: [] };
        }
        if (table === 'TeamRosterTable') {
          return { Items: [{ id: 'roster-1', teamId: 'team-1' }] };
        }
        return { Items: [] };
      }

      if (command.__type === 'DeleteCommand') {
        deleteCount += 1;
        if (deleteCount === 2) {
          throw new Error('boom');
        }
      }

      return {};
    });

    await expect(invoke(createEvent())).rejects.toThrow(/rolled back|rollback was incomplete/i);

    const putCalls = mockSend.mock.calls.filter(([cmd]) => cmd.__type === 'PutCommand');
    expect(putCalls.length).toBeGreaterThan(0);
  });
});
