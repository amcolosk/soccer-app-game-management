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
      playerId: 'player-1',
      ...overrides,
    },
    identity: { sub: 'coach-1' },
  } as HandlerEvent;
}

describe('delete-player-safe handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PLAYER_TABLE = 'PlayerTable';
    process.env.TEAM_ROSTER_TABLE = 'TeamRosterTable';
    process.env.PLAY_TIME_RECORD_TABLE = 'PlayTimeRecordTable';
    process.env.GOAL_TABLE = 'GoalTable';
    process.env.GAME_NOTE_TABLE = 'GameNoteTable';
    process.env.PLAYER_AVAILABILITY_TABLE = 'PlayerAvailabilityTable';

    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return { Item: { id: 'player-1', coaches: ['coach-1'] } };
      }

      if (command.__type === 'ScanCommand') {
        const filterExpression = command.input.FilterExpression as string;
        if (filterExpression.includes('assistId')) {
          return { Items: [{ id: 'goal-assist-1', assistId: 'player-1' }] };
        }
        if (filterExpression.includes('scorerId')) {
          return { Items: [{ id: 'goal-score-1', scorerId: 'player-1' }] };
        }
        return { Items: [] };
      }

      return {};
    });
  });

  it('rejects when caller is not a coach on the player', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return { Item: { id: 'player-1', coaches: ['coach-2'] } };
      }
      return { Items: [] };
    });

    await expect(invoke(createEvent())).rejects.toThrow(/access denied/i);
  });

  it('clears assist links and deletes player', async () => {
    const result = await invoke(createEvent());

    expect(result).toEqual(expect.objectContaining({ success: true }));

    const updateCalls = mockSend.mock.calls.filter(([cmd]) => cmd.__type === 'UpdateCommand');
    expect(updateCalls).toHaveLength(1);

    const deleteCalls = mockSend.mock.calls.filter(([cmd]) => cmd.__type === 'DeleteCommand');
    const lastDeleteTable = (deleteCalls[deleteCalls.length - 1][0].input as { TableName: string }).TableName;
    expect(lastDeleteTable).toBe('PlayerTable');
  });

  it('rolls back prior deletes when a later delete fails', async () => {
    let deleteCount = 0;
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return { Item: { id: 'player-1', coaches: ['coach-1'] } };
      }

      if (command.__type === 'ScanCommand') {
        const filterExpression = command.input.FilterExpression as string;
        if (filterExpression.includes('playerId')) {
          return { Items: [{ id: 'roster-1', playerId: 'player-1' }] };
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
