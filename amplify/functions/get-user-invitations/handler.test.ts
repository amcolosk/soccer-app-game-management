import { beforeEach, describe, expect, it, vi } from 'vitest';

declare const process: {
  env: Record<string, string | undefined>;
};

const mockSend = vi.hoisted(() => vi.fn());
const mockCognitoSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mockSend })),
  },
  ScanCommand: vi.fn(function (input) { return { __type: 'ScanCommand', input }; }),
}));

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: vi.fn(function () {
    return { send: mockCognitoSend };
  }),
  AdminGetUserCommand: vi.fn(function (input) { return { __type: 'AdminGetUserCommand', input }; }),
}));

import { handler } from './handler';

type HandlerEvent = Parameters<typeof handler>[0];
type HandlerContext = Parameters<typeof handler>[1];
type HandlerCallback = Parameters<typeof handler>[2];

type InvitationsResult = {
  teamInvitations: Array<Record<string, unknown>>;
};

const isInvitationsResult = (value: unknown): value is InvitationsResult => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as { teamInvitations?: unknown };
  return Array.isArray(candidate.teamInvitations);
};

const invoke = (event: HandlerEvent) => handler(event, {} as HandlerContext, (() => {}) as HandlerCallback);

describe('get-user-invitations handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TEAMINVITATION_TABLE_NAME = 'TeamInvitationTable';
    process.env.USER_POOL_ID = 'pool-123';
  });

  it('scans all pages and returns pending invitations found after the first page', async () => {
    mockCognitoSend.mockResolvedValue({
      UserAttributes: [{ Name: 'email', Value: 'coach@example.com' }],
    });

    mockSend
      .mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: { id: 'page-1' },
      })
      .mockResolvedValueOnce({
        Items: [{ id: 'invite-2', email: 'coach@example.com', status: 'PENDING' }],
      });

    const event = {
      arguments: {},
      identity: {
        username: 'e10bf580-d061-70af-b880-6d3121479a85',
        sub: 'e10bf580-d061-70af-b880-6d3121479a85',
        claims: {},
      },
    } as HandlerEvent;

    const result = await invoke(event);

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(isInvitationsResult(result)).toBe(true);
    if (!isInvitationsResult(result)) {
      throw new Error('Expected handler to return an invitations payload');
    }
    expect(result.teamInvitations).toHaveLength(1);
    expect(result.teamInvitations[0]).toEqual(
      expect.objectContaining({ id: 'invite-2', status: 'PENDING' })
    );
  });
});
