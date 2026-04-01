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
      formationId: 'formation-1',
      ...overrides,
    },
    identity: { sub: 'coach-1' },
  } as HandlerEvent;
}

describe('delete-formation-safe handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FORMATION_TABLE = 'FormationTable';
    process.env.FORMATION_POSITION_TABLE = 'FormationPositionTable';
    process.env.TEAM_TABLE = 'TeamTable';

    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return {
          Item: {
            id: 'formation-1',
            coaches: ['coach-1'],
          },
        };
      }

      if (command.__type === 'ScanCommand') {
        const table = command.input.TableName as string;
        if (table === 'TeamTable') {
          return { Items: [] };
        }

        if (table === 'FormationPositionTable') {
          return { Items: [{ id: 'pos-1' }, { id: 'pos-2' }] };
        }
      }

      return {};
    });
  });

  it('blocks deletion when any team references the formation', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return {
          Item: {
            id: 'formation-1',
            coaches: ['coach-1'],
          },
        };
      }

      if (command.__type === 'ScanCommand') {
        const table = command.input.TableName as string;
        if (table === 'TeamTable') {
          return { Items: [{ id: 'team-1', name: 'Shared Team' }] };
        }

        return { Items: [] };
      }

      return {};
    });

    await expect(invoke(createEvent())).rejects.toThrow(/referenced by 1 team/i);

    const deleteCalls = mockSend.mock.calls.filter(([cmd]) => cmd.__type === 'DeleteCommand');
    expect(deleteCalls).toHaveLength(0);
  });

  it('deletes positions then formation when there are no referencing teams', async () => {
    const result = await invoke(createEvent());

    expect(result).toEqual({ success: true, deletedPositions: 2 });

    const deleteCalls = mockSend.mock.calls.filter(([cmd]) => cmd.__type === 'DeleteCommand');
    expect(deleteCalls).toHaveLength(3);

    const firstDelete = deleteCalls[0][0].input as { TableName: string; Key: { id: string } };
    const secondDelete = deleteCalls[1][0].input as { TableName: string; Key: { id: string } };
    const thirdDelete = deleteCalls[2][0].input as { TableName: string; Key: { id: string } };

    expect(firstDelete.TableName).toBe('FormationPositionTable');
    expect(secondDelete.TableName).toBe('FormationPositionTable');
    expect(thirdDelete.TableName).toBe('FormationTable');
    expect(thirdDelete.Key.id).toBe('formation-1');
  });

  it('rejects when caller is not a coach on the formation', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return {
          Item: {
            id: 'formation-1',
            coaches: ['coach-2'],
          },
        };
      }

      return {};
    });

    await expect(invoke(createEvent())).rejects.toThrow(/access denied/i);
  });

  it('rolls back deleted positions when a later delete fails', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return {
          Item: {
            id: 'formation-1',
            coaches: ['coach-1'],
            name: '4-4-2',
          },
        };
      }

      if (command.__type === 'ScanCommand') {
        const table = command.input.TableName as string;
        if (table === 'TeamTable') {
          return { Items: [] };
        }

        if (table === 'FormationPositionTable') {
          return {
            Items: [
              { id: 'pos-1', formationId: 'formation-1', name: 'GK' },
              { id: 'pos-2', formationId: 'formation-1', name: 'CB' },
            ],
          };
        }
      }

      if (command.__type === 'DeleteCommand') {
        const table = command.input.TableName as string;
        const id = (command.input.Key as { id: string }).id;

        if (table === 'FormationPositionTable' && id === 'pos-2') {
          throw new Error('failed to delete pos-2');
        }

        return {};
      }

      if (command.__type === 'PutCommand') {
        return {};
      }

      return {};
    });

    await expect(invoke(createEvent())).rejects.toThrow(/all prior deletes were rolled back/i);

    const putCalls = mockSend.mock.calls.filter(([cmd]) => cmd.__type === 'PutCommand');
    expect(putCalls).toHaveLength(1);

    const restoreInput = putCalls[0][0].input as { TableName: string; Item: { id: string; name: string } };
    expect(restoreInput.TableName).toBe('FormationPositionTable');
    expect(restoreInput.Item.id).toBe('pos-1');
    expect(restoreInput.Item.name).toBe('GK');
  });
});
