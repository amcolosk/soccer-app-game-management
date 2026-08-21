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

// Identity pass-through, matching accept-invitation/handler.test.ts's convention: lets
// tests hand plain-JS objects as the ConditionalCheckFailedException's `Item` directly.
vi.mock('@aws-sdk/util-dynamodb', () => ({
  unmarshall: vi.fn((item) => item),
}));

import { handler } from './handler';

type HandlerEvent = Parameters<typeof handler>[0];
type HandlerContext = Parameters<typeof handler>[1];
type HandlerCallback = Parameters<typeof handler>[2];

function invokeHandler(event: HandlerEvent) {
  const context = {} as HandlerContext;
  const callback: HandlerCallback = () => undefined;
  return handler(event, context, callback);
}

function callerEvent(teamId: string, callerSub: string): HandlerEvent {
  return {
    arguments: { teamId },
    identity: { sub: callerSub },
  } as HandlerEvent;
}

function conditionalCheckFailure(item: Record<string, unknown>) {
  const error = new Error('ConditionalCheckFailedException') as Error & { name: string; Item: unknown };
  error.name = 'ConditionalCheckFailedException';
  error.Item = item; // mocked unmarshall() above is an identity pass-through
  return error;
}

describe('assign-team-owner handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TEAM_TABLE = 'TeamTable';
  });

  it('claims a never-owned team for a coach on it (attribute_not_exists(ownerId) branch)', async () => {
    mockSend.mockImplementation((command) => {
      if (command.__type === 'GetCommand') {
        return Promise.resolve({ Item: { id: 'team-1', coaches: ['caller-sub'] } }); // no ownerId at all
      }
      if (command.__type === 'UpdateCommand') {
        return Promise.resolve({ Attributes: { id: 'team-1', ownerId: 'caller-sub', coaches: ['caller-sub'] } });
      }
      throw new Error(`unexpected command: ${command.__type}`);
    });

    const result = await invokeHandler(callerEvent('team-1', 'caller-sub'));
    expect(result).toMatchObject({ ownerId: 'caller-sub' });

    // Pin the actual write-time ConditionExpression sent to DynamoDB — without this,
    // a refactor that silently dropped the `AND contains(coaches, :callerSub)` clause
    // (the TOCTOU guard) would leave every test in this file still green.
    const updateCall = mockSend.mock.calls.find(([command]) => command.__type === 'UpdateCommand');
    expect(updateCall).toBeDefined();
    const updateInput = updateCall![0].input;
    expect(updateInput.ConditionExpression).toBe(
      '(attribute_not_exists(ownerId) OR NOT contains(coaches, ownerId)) AND contains(coaches, :callerSub)',
    );
    expect(updateInput.ExpressionAttributeValues[':callerSub']).toBe('caller-sub');
  });

  it('claims an orphaned-owner team — ownerId set but that owner is no longer in coaches (the archived+orphaned combination the E2E spec structurally cannot reach)', async () => {
    mockSend.mockImplementation((command) => {
      if (command.__type === 'GetCommand') {
        return Promise.resolve({ Item: { id: 'team-1', ownerId: 'revoked-owner', coaches: ['caller-sub'] } });
      }
      if (command.__type === 'UpdateCommand') {
        return Promise.resolve({ Attributes: { id: 'team-1', ownerId: 'caller-sub', coaches: ['caller-sub'] } });
      }
      throw new Error(`unexpected command: ${command.__type}`);
    });

    const result = await invokeHandler(callerEvent('team-1', 'caller-sub'));
    expect(result).toMatchObject({ ownerId: 'caller-sub' });
  });

  it('rejects when a valid owner is already present and still in coaches', async () => {
    mockSend.mockImplementation((command) => {
      if (command.__type === 'GetCommand') {
        return Promise.resolve({ Item: { id: 'team-1', ownerId: 'existing-owner', coaches: ['existing-owner', 'caller-sub'] } });
      }
      if (command.__type === 'UpdateCommand') {
        return Promise.reject(conditionalCheckFailure({ id: 'team-1', ownerId: 'existing-owner', coaches: ['existing-owner', 'caller-sub'] }));
      }
      throw new Error(`unexpected command: ${command.__type}`);
    });

    await expect(invokeHandler(callerEvent('team-1', 'caller-sub'))).rejects.toThrow('Team already has an owner');
  });

  it('rejects a caller who is not in coaches, before ever attempting the write', async () => {
    mockSend.mockImplementation((command) => {
      if (command.__type === 'GetCommand') {
        return Promise.resolve({ Item: { id: 'team-1', coaches: ['someone-else'] } });
      }
      throw new Error('UpdateCommand should not be attempted when the JS pre-check fails');
    });

    await expect(invokeHandler(callerEvent('team-1', 'caller-sub')))
      .rejects.toThrow('Access denied: caller is not a coach on this team');
  });

  it('rejects the loser of a concurrent claim race even though it passed the JS pre-check', async () => {
    // Caller IS in `coaches` at GetCommand time (passes the pre-check), but a second,
    // concurrent caller's UpdateCommand won the DynamoDB conditional write first —
    // simulated via the ReturnValuesOnConditionCheckFailure payload already showing a
    // valid owner. This lands on the same "Team already has an owner" branch as the
    // "valid owner present" test above; it does NOT exercise the write-time
    // `contains(coaches, :callerSub)` TOCTOU-closing clause itself — see the dedicated
    // "caller removed from coaches" test below for that.
    mockSend.mockImplementation((command) => {
      if (command.__type === 'GetCommand') {
        return Promise.resolve({ Item: { id: 'team-1', coaches: ['caller-sub', 'winner-sub'] } });
      }
      if (command.__type === 'UpdateCommand') {
        return Promise.reject(conditionalCheckFailure({ id: 'team-1', ownerId: 'winner-sub', coaches: ['caller-sub', 'winner-sub'] }));
      }
      throw new Error(`unexpected command: ${command.__type}`);
    });

    await expect(invokeHandler(callerEvent('team-1', 'caller-sub'))).rejects.toThrow('Team already has an owner');
  });

  it('rejects when the caller is removed from coaches between the read and the write (the genuine TOCTOU window the contains(coaches, :callerSub) clause closes)', async () => {
    // Caller IS in `coaches` at GetCommand time (passes the JS pre-check), but by the
    // time the conditional UpdateCommand runs, a concurrent revokeCoachAccess call has
    // removed the caller from `coaches` and no owner has been assigned. The re-read
    // payload reflects that: caller absent from coaches, no ownerId. This must fall
    // through to the access-denied branch, not "Team already has an owner".
    mockSend.mockImplementation((command) => {
      if (command.__type === 'GetCommand') {
        return Promise.resolve({ Item: { id: 'team-1', coaches: ['caller-sub'] } });
      }
      if (command.__type === 'UpdateCommand') {
        return Promise.reject(conditionalCheckFailure({ id: 'team-1', coaches: ['someone-else'] }));
      }
      throw new Error(`unexpected command: ${command.__type}`);
    });

    await expect(invokeHandler(callerEvent('team-1', 'caller-sub')))
      .rejects.toThrow('Access denied: caller is not a coach on this team');
  });
});
