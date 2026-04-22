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
      gameId: 'game-1',
      ...overrides,
    },
    identity: { sub: 'coach-1' },
  } as HandlerEvent;
}

describe('delete-game-safe handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GAME_TABLE = 'GameTable';
    process.env.PLAY_TIME_RECORD_TABLE = 'PlayTimeRecordTable';
    process.env.GOAL_TABLE = 'GoalTable';
    process.env.GAME_NOTE_TABLE = 'GameNoteTable';
    process.env.SUBSTITUTION_TABLE = 'SubstitutionTable';
    process.env.LINEUP_ASSIGNMENT_TABLE = 'LineupAssignmentTable';
    process.env.PLAYER_AVAILABILITY_TABLE = 'PlayerAvailabilityTable';
    process.env.GAME_PLAN_TABLE = 'GamePlanTable';
    process.env.PLANNED_ROTATION_TABLE = 'PlannedRotationTable';
  process.env.QUEUED_SUBSTITUTION_TABLE = 'QueuedSubstitutionTable';

    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return { Item: { id: 'game-1', coaches: ['coach-1'] } };
      }

      if (command.__type === 'ScanCommand') {
        const table = command.input.TableName as string;
        if (table === 'GamePlanTable') {
          return { Items: [{ id: 'plan-1', gameId: 'game-1' }] };
        }
        if (table === 'PlannedRotationTable') {
          return { Items: [{ id: 'rotation-1', gamePlanId: 'plan-1' }] };
        }
        if (table === 'PlayTimeRecordTable') {
          return { Items: [{ id: 'ptr-1', gameId: 'game-1' }] };
        }
        return { Items: [] };
      }

      return {};
    });
  });

  it('rejects when caller is not a coach on the game', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return { Item: { id: 'game-1', coaches: ['coach-2'] } };
      }
      return { Items: [] };
    });

    await expect(invoke(createEvent())).rejects.toThrow(/access denied/i);
  });

  it('deletes game after children', async () => {
    const result = await invoke(createEvent());

    expect(result).toEqual(expect.objectContaining({ success: true }));

    const deleteCalls = mockSend.mock.calls.filter(([cmd]) => cmd.__type === 'DeleteCommand');
    const deleteTables = deleteCalls.map(([cmd]) => (cmd.input as { TableName: string }).TableName);

    expect(deleteTables[0]).toBe('PlannedRotationTable');
    expect(deleteTables[deleteTables.length - 1]).toBe('GameTable');
  });

  it('rolls back deleted children when a later delete fails', async () => {
    let deleteCount = 0;
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return { Item: { id: 'game-1', coaches: ['coach-1'] } };
      }

      if (command.__type === 'ScanCommand') {
        const table = command.input.TableName as string;
        if (table === 'PlayTimeRecordTable') {
          return { Items: [{ id: 'ptr-1', gameId: 'game-1' }] };
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
