import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(function () { return {}; }),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockSend })) },
  GetCommand: vi.fn(function (input) { return { __type: 'GetCommand', input }; }),
  QueryCommand: vi.fn(function (input) { return { __type: 'QueryCommand', input }; }),
  ScanCommand: vi.fn(function (input) { return { __type: 'ScanCommand', input }; }),
  UpdateCommand: vi.fn(function (input) { return { __type: 'UpdateCommand', input }; }),
}));

import { handler } from './handler';

type HandlerEvent = Parameters<typeof handler>[0];
type HandlerContext = Parameters<typeof handler>[1];
type HandlerCallback = Parameters<typeof handler>[2];

const invoke = (event: HandlerEvent) => handler(event, {} as HandlerContext, (() => {}) as HandlerCallback);

function createEvent(teamId = 'team-1'): HandlerEvent {
  return {
    arguments: { teamId },
    identity: { sub: 'owner-1' },
  } as HandlerEvent;
}

function defaultTeam(overrides: Record<string, unknown> = {}) {
  return { id: 'team-1', ownerId: 'owner-1', coaches: ['owner-1'], status: 'active', ...overrides };
}

describe('archive-team handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TEAM_TABLE = 'TeamTable';
    process.env.TEAM_INVITATION_TABLE = 'TeamInvitationTable';
    process.env.SHARE_LINK_TABLE = 'ShareLinkTable';

    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return { Item: defaultTeam() };
      }
      if (command.__type === 'ScanCommand') {
        return { Items: [] };
      }
      if (command.__type === 'QueryCommand') {
        return { Items: [] };
      }
      if (command.__type === 'UpdateCommand' && command.input.TableName === 'TeamTable') {
        return { Attributes: defaultTeam({ status: 'archived' }) };
      }
      return {};
    });
  });

  it('rejects an unauthenticated caller', async () => {
    await expect(handler({ arguments: { teamId: 'team-1' }, identity: undefined } as unknown as HandlerEvent, {} as HandlerContext, (() => {}) as HandlerCallback))
      .rejects.toThrow(/not authenticated/i);
  });

  it('rejects a non-owner caller', async () => {
    mockSend.mockImplementation(async (command: { __type: string }) => {
      if (command.__type === 'GetCommand') {
        return { Item: defaultTeam({ ownerId: 'someone-else' }) };
      }
      return { Items: [] };
    });

    await expect(invoke(createEvent())).rejects.toThrow(/access denied/i);
  });

  it('archives the team and returns the updated record', async () => {
    const result = await invoke(createEvent());
    expect(result).toEqual(expect.objectContaining({ status: 'archived' }));
  });

  it('revokes every active ShareLink for the team when archiving', async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return { Item: defaultTeam() };
      }
      if (command.__type === 'ScanCommand') {
        return { Items: [] };
      }
      if (command.__type === 'QueryCommand' && command.input.TableName === 'ShareLinkTable') {
        return {
          Items: [
            { token: 'active-fan', teamId: 'team-1', type: 'FAN', revokedAt: null },
            { token: 'already-revoked', teamId: 'team-1', type: 'FAN', revokedAt: '2026-01-01T00:00:00.000Z' },
          ],
        };
      }
      if (command.__type === 'UpdateCommand') {
        updateCalls.push(command.input);
        if (command.input.TableName === 'TeamTable') {
          return { Attributes: defaultTeam({ status: 'archived' }) };
        }
      }
      return {};
    });

    await invoke(createEvent());

    const shareLinkUpdates = updateCalls.filter((c) => c.TableName === 'ShareLinkTable');
    expect(shareLinkUpdates).toHaveLength(1);
    expect((shareLinkUpdates[0].Key as { token: string }).token).toBe('active-fan');
  });

  it('is a no-op sweep when there are no active ShareLinks', async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return { Item: defaultTeam() };
      }
      if (command.__type === 'ScanCommand') {
        return { Items: [] };
      }
      if (command.__type === 'QueryCommand' && command.input.TableName === 'ShareLinkTable') {
        return { Items: [] };
      }
      if (command.__type === 'UpdateCommand') {
        updateCalls.push(command.input);
        if (command.input.TableName === 'TeamTable') {
          return { Attributes: defaultTeam({ status: 'archived' }) };
        }
      }
      return {};
    });

    await invoke(createEvent());
    expect(updateCalls.filter((c) => c.TableName === 'ShareLinkTable')).toHaveLength(0);
  });

  it('still sweeps ShareLinks on a repeat call against an already-archived team (idempotent)', async () => {
    const updateCalls: Array<Record<string, unknown>> = [];
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return { Item: defaultTeam({ status: 'archived' }) };
      }
      if (command.__type === 'ScanCommand') {
        return { Items: [] };
      }
      if (command.__type === 'QueryCommand' && command.input.TableName === 'ShareLinkTable') {
        return { Items: [{ token: 'still-active', teamId: 'team-1', type: 'FAN', revokedAt: null }] };
      }
      if (command.__type === 'UpdateCommand') {
        updateCalls.push(command.input);
      }
      return {};
    });

    await invoke(createEvent());

    const shareLinkUpdates = updateCalls.filter((c) => c.TableName === 'ShareLinkTable');
    expect(shareLinkUpdates).toHaveLength(1);
  });
});
