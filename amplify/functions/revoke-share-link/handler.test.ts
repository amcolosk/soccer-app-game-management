import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(function () { return {}; }),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockSend })) },
  GetCommand: vi.fn(function (input) { return { __type: 'GetCommand', input }; }),
  UpdateCommand: vi.fn(function (input) { return { __type: 'UpdateCommand', input }; }),
}));

import { handler } from './handler';

type HandlerEvent = Parameters<typeof handler>[0];
type HandlerContext = Parameters<typeof handler>[1];
type HandlerCallback = Parameters<typeof handler>[2];

const invoke = (event: HandlerEvent) => handler(event, {} as HandlerContext, (() => {}) as HandlerCallback);

function createEvent(overrides: Partial<HandlerEvent['arguments']> = {}): HandlerEvent {
  return {
    arguments: { token: 'tok-1', ...overrides },
    identity: { sub: 'coach-1' },
  } as HandlerEvent;
}

describe('revoke-share-link handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHARE_LINK_TABLE = 'ShareLinkTable';
    process.env.TEAM_TABLE = 'TeamTable';

    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand' && command.input.TableName === 'ShareLinkTable') {
        return { Item: { token: 'tok-1', teamId: 'team-1', revokedAt: null } };
      }
      if (command.__type === 'GetCommand' && command.input.TableName === 'TeamTable') {
        return { Item: { id: 'team-1', coaches: ['coach-1'] } };
      }
      return {};
    });
  });

  it('rejects an unauthenticated caller', async () => {
    await expect(handler({ arguments: { token: 'tok-1' }, identity: undefined } as unknown as HandlerEvent, {} as HandlerContext, (() => {}) as HandlerCallback))
      .rejects.toThrow(/not authenticated/i);
  });

  it('throws when the token does not exist', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand' && command.input.TableName === 'ShareLinkTable') {
        return {};
      }
      return {};
    });

    await expect(invoke(createEvent())).rejects.toThrow(/not found/i);
  });

  it('rejects when caller is not a coach on the linked team', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand' && command.input.TableName === 'ShareLinkTable') {
        return { Item: { token: 'tok-1', teamId: 'team-1', revokedAt: null } };
      }
      if (command.__type === 'GetCommand' && command.input.TableName === 'TeamTable') {
        return { Item: { id: 'team-1', coaches: ['someone-else'] } };
      }
      return {};
    });

    await expect(invoke(createEvent())).rejects.toThrow(/access denied/i);
  });

  it('sets revokedAt for an active link', async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand' && command.input.TableName === 'ShareLinkTable') {
        return { Item: { token: 'tok-1', teamId: 'team-1', revokedAt: null } };
      }
      if (command.__type === 'GetCommand' && command.input.TableName === 'TeamTable') {
        return { Item: { id: 'team-1', coaches: ['coach-1'] } };
      }
      if (command.__type === 'UpdateCommand') {
        updateCalls.push(command.input);
      }
      return {};
    });

    const result = await invoke(createEvent());
    expect(result).toBe(true);
    expect(updateCalls).toHaveLength(1);
  });

  it('is idempotent for an already-revoked link (no-op success)', async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand' && command.input.TableName === 'ShareLinkTable') {
        return { Item: { token: 'tok-1', teamId: 'team-1', revokedAt: '2026-01-01T00:00:00.000Z' } };
      }
      if (command.__type === 'GetCommand' && command.input.TableName === 'TeamTable') {
        return { Item: { id: 'team-1', coaches: ['coach-1'] } };
      }
      if (command.__type === 'UpdateCommand') {
        updateCalls.push(command.input);
      }
      return {};
    });

    const result = await invoke(createEvent());
    expect(result).toBe(true);
    expect(updateCalls).toHaveLength(0);
  });
});
