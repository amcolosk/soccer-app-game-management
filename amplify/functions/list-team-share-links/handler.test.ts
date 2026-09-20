import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(function () { return {}; }),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockSend })) },
  GetCommand: vi.fn(function (input) { return { __type: 'GetCommand', input }; }),
  QueryCommand: vi.fn(function (input) { return { __type: 'QueryCommand', input }; }),
}));

import { handler } from './handler';

type HandlerEvent = Parameters<typeof handler>[0];
type HandlerContext = Parameters<typeof handler>[1];
type HandlerCallback = Parameters<typeof handler>[2];

const invoke = (event: HandlerEvent) => handler(event, {} as HandlerContext, (() => {}) as HandlerCallback);

function createEvent(overrides: Partial<HandlerEvent['arguments']> = {}): HandlerEvent {
  return {
    arguments: { teamId: 'team-1', ...overrides },
    identity: { sub: 'coach-1' },
  } as HandlerEvent;
}

describe('list-team-share-links handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHARE_LINK_TABLE = 'ShareLinkTable';
    process.env.TEAM_TABLE = 'TeamTable';

    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      if (command.__type === 'GetCommand') {
        return { Item: { id: 'team-1', coaches: ['coach-1'] } };
      }
      if (command.__type === 'QueryCommand') {
        return {
          Items: [
            { token: 'tok-1', type: 'FAN', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null },
            { token: 'tok-2', type: 'STAT_TRACKER', issuedAt: '2026-01-02T00:00:00.000Z', revokedAt: '2026-01-03T00:00:00.000Z' },
          ],
        };
      }
      return {};
    });
  });

  it('rejects an unauthenticated caller', async () => {
    await expect(handler({ arguments: { teamId: 'team-1' }, identity: undefined } as unknown as HandlerEvent, {} as HandlerContext, (() => {}) as HandlerCallback))
      .rejects.toThrow(/not authenticated/i);
  });

  it('rejects when caller is not a coach on the team', async () => {
    mockSend.mockImplementation(async (command: { __type: string }) => {
      if (command.__type === 'GetCommand') {
        return { Item: { id: 'team-1', coaches: ['someone-else'] } };
      }
      return {};
    });

    await expect(invoke(createEvent())).rejects.toThrow(/access denied/i);
  });

  it('returns curated ShareLinkSummary entries for the team', async () => {
    const result = await invoke(createEvent());
    expect(result).toEqual([
      { token: 'tok-1', type: 'FAN', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null },
      { token: 'tok-2', type: 'STAT_TRACKER', issuedAt: '2026-01-02T00:00:00.000Z', revokedAt: '2026-01-03T00:00:00.000Z' },
    ]);
  });
});
