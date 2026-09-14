import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(function () { return {}; }),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockSend })) },
  GetCommand: vi.fn(function (input) { return { __type: 'GetCommand', input }; }),
  PutCommand: vi.fn(function (input) { return { __type: 'PutCommand', input }; }),
  QueryCommand: vi.fn(function (input) { return { __type: 'QueryCommand', input }; }),
  UpdateCommand: vi.fn(function (input) { return { __type: 'UpdateCommand', input }; }),
}));

import { handler } from './handler';

type HandlerEvent = Parameters<typeof handler>[0];
type HandlerContext = Parameters<typeof handler>[1];
type HandlerCallback = Parameters<typeof handler>[2];

const invoke = (event: HandlerEvent) => handler(event, {} as HandlerContext, (() => {}) as HandlerCallback);

function createEvent(overrides: Partial<HandlerEvent['arguments']> = {}): HandlerEvent {
  return {
    arguments: { teamId: 'team-1', type: 'FAN', ...overrides },
    identity: { sub: 'coach-1' },
  } as HandlerEvent;
}

describe('generate-share-link handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHARE_LINK_TABLE = 'ShareLinkTable';
    process.env.TEAM_TABLE = 'TeamTable';

    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return { Item: { id: 'team-1', coaches: ['coach-1'], status: 'active' } };
      }
      if (command.__type === 'QueryCommand') {
        return { Items: [] };
      }
      return {};
    });
  });

  it('rejects an unauthenticated caller', async () => {
    await expect(handler({ arguments: { teamId: 'team-1', type: 'FAN' }, identity: undefined } as unknown as HandlerEvent, {} as HandlerContext, (() => {}) as HandlerCallback))
      .rejects.toThrow(/not authenticated/i);
  });

  it("rejects a type argument that isn't FAN or STAT_TRACKER", async () => {
    await expect(invoke(createEvent({ type: 'BOGUS' }))).rejects.toThrow(/type must be/i);
  });

  it('rejects when caller is not a coach on the team', async () => {
    mockSend.mockImplementation(async (command: { __type: string }) => {
      if (command.__type === 'GetCommand') {
        return { Item: { id: 'team-1', coaches: ['someone-else'], status: 'active' } };
      }
      return {};
    });

    await expect(invoke(createEvent())).rejects.toThrow(/access denied/i);
  });

  it('rejects generating a link for an archived team', async () => {
    mockSend.mockImplementation(async (command: { __type: string }) => {
      if (command.__type === 'GetCommand') {
        return { Item: { id: 'team-1', coaches: ['coach-1'], status: 'archived' } };
      }
      return {};
    });

    await expect(invoke(createEvent())).rejects.toThrow(/archived/i);
  });

  it('creates the new link before revoking any existing active link of the same type', async () => {
    const callOrder: string[] = [];
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      callOrder.push(command.__type);
      if (command.__type === 'GetCommand') {
        return { Item: { id: 'team-1', coaches: ['coach-1'], status: 'active' } };
      }
      if (command.__type === 'QueryCommand') {
        return { Items: [{ token: 'old-token', type: 'FAN', revokedAt: null }] };
      }
      return {};
    });

    const result = await invoke(createEvent());

    expect(result).toEqual(expect.objectContaining({ type: 'FAN', revokedAt: null }));
    expect(typeof (result as { token: string }).token).toBe('string');
    expect((result as { token: string }).token.length).toBeGreaterThan(0);

    const putIndex = callOrder.indexOf('PutCommand');
    const updateIndex = callOrder.indexOf('UpdateCommand');
    expect(putIndex).toBeGreaterThanOrEqual(0);
    expect(updateIndex).toBeGreaterThan(putIndex);
  });

  it('does not revoke an existing link of a different type', async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return { Item: { id: 'team-1', coaches: ['coach-1'], status: 'active' } };
      }
      if (command.__type === 'QueryCommand') {
        return { Items: [{ token: 'other-token', type: 'STAT_TRACKER', revokedAt: null }] };
      }
      if (command.__type === 'UpdateCommand') {
        updateCalls.push(command.input);
      }
      return {};
    });

    await invoke(createEvent());
    expect(updateCalls).toHaveLength(0);
  });

  it('does not re-revoke an already-revoked link', async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return { Item: { id: 'team-1', coaches: ['coach-1'], status: 'active' } };
      }
      if (command.__type === 'QueryCommand') {
        return { Items: [{ token: 'old-token', type: 'FAN', revokedAt: '2026-01-01T00:00:00.000Z' }] };
      }
      if (command.__type === 'UpdateCommand') {
        updateCalls.push(command.input);
      }
      return {};
    });

    await invoke(createEvent());
    expect(updateCalls).toHaveLength(0);
  });
});
