import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(function () { return {}; }),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockSend })) },
  GetCommand: vi.fn(function (input) { return { __type: 'GetCommand', input }; }),
  QueryCommand: vi.fn(function (input) { return { __type: 'QueryCommand', input }; }),
  UpdateCommand: vi.fn(function (input) { return { __type: 'UpdateCommand', input }; }),
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

function buildEvent(teamId: string, userId: string, callerSub: string): HandlerEvent {
  return {
    arguments: { teamId, userId },
    identity: { sub: callerSub },
  } as unknown as HandlerEvent;
}

// ---------------------------------------------------------------------------
// In-memory fake DynamoDB, shared shape across tests. Generic enough to
// interpret every ConditionExpression this handler and the shared
// coachArraySync helpers actually send, without re-implementing DynamoDB
// itself. Mirrors the "GetCommand/ScanCommand/UpdateCommand mocked via
// hoisted mockSend" pattern already used by
// accept-invitation/handler.test.ts and sync-team-calendar/handler.test.ts.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown> & { id: string; teamId?: string; coaches?: string[] };

interface Store {
  TeamTable: Record<string, Row>;
  TeamRosterTable: Record<string, Row>;
  FieldPositionTable: Record<string, Row>;
  GameTable: Record<string, Row>;
  TeamInvitationTable: Record<string, Row>;
}

function conditionalCheckFailedError(): Error {
  const error = new Error('ConditionalCheckFailedException') as Error & { name: string };
  error.name = 'ConditionalCheckFailedException';
  return error;
}

function makeStore(): Store {
  return {
    TeamTable: {},
    TeamRosterTable: {},
    FieldPositionTable: {},
    GameTable: {},
    TeamInvitationTable: {},
  };
}

// `onUpdateAttempt` lets individual tests inject a side effect (simulating a
// concurrent write landing between a read and this write) the first time a
// given record's UpdateCommand is attempted.
function createMockSend(
  store: Store,
  options: {
    onUpdateAttempt?: (tableName: keyof Store, id: string, attemptCount: number) => void;
    callLog?: string[];
  } = {},
) {
  const updateAttemptCounts = new Map<string, number>();

  return vi.fn(async (command: { __type: string; input: Record<string, unknown> }) => {
    const { __type: type, input } = command;
    const tableName = input.TableName as keyof Store;

    if (type === 'GetCommand') {
      const key = input.Key as { id: string };
      const record = store[tableName]?.[key.id];
      options.callLog?.push(`GET ${tableName} ${key.id}`);
      return { Item: record ? { ...record } : undefined };
    }

    if (type === 'QueryCommand') {
      const values = input.ExpressionAttributeValues as Record<string, unknown>;
      const teamId = values[':fieldValue'] as string;
      const table = store[tableName] ?? {};
      const items = Object.values(table).filter((row) => row.teamId === teamId);
      return { Items: items.map((row) => ({ ...row })) };
    }

    if (type === 'UpdateCommand') {
      const key = input.Key as { id: string };
      const attemptKey = `${tableName}:${key.id}`;
      const attemptCount = (updateAttemptCounts.get(attemptKey) ?? 0) + 1;
      updateAttemptCounts.set(attemptKey, attemptCount);

      options.onUpdateAttempt?.(tableName, key.id, attemptCount);

      const record = store[tableName]?.[key.id];
      if (!record) {
        throw conditionalCheckFailedError();
      }

      const condition = input.ConditionExpression as string;
      const values = input.ExpressionAttributeValues as Record<string, unknown>;

      if (condition === 'attribute_not_exists(coaches)') {
        if (record.coaches !== undefined) {
          throw conditionalCheckFailedError();
        }
        record.coaches = values[':coaches'] as string[] | undefined;
        record.updatedAt = values[':updatedAt'];
        options.callLog?.push(`UPDATE ${tableName} ${key.id} coaches=${JSON.stringify(record.coaches)}`);
        return { Attributes: { ...record } };
      }

      if (condition === 'coaches = :expectedCoaches') {
        const expected = values[':expectedCoaches'];
        if (JSON.stringify(record.coaches) !== JSON.stringify(expected)) {
          throw conditionalCheckFailedError();
        }
        record.coaches = values[':coaches'] as string[] | undefined;
        record.updatedAt = values[':updatedAt'];
        options.callLog?.push(`UPDATE ${tableName} ${key.id} coaches=${JSON.stringify(record.coaches)}`);
        return { Attributes: { ...record } };
      }

      if (condition === '#status = :fromStatus') {
        const fromStatus = values[':fromStatus'];
        if (record.status !== fromStatus) {
          throw conditionalCheckFailedError();
        }
        record.status = values[':expiredStatus'];
        record.updatedAt = values[':updatedAt'];
        options.callLog?.push(`UPDATE ${tableName} ${key.id} status=${record.status}`);
        return {};
      }

      throw new Error(`Unhandled ConditionExpression in test mock: ${condition}`);
    }

    throw new Error(`Unhandled command type in test mock: ${type}`);
  });
}

describe('revoke-coach-access handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TEAM_TABLE = 'TeamTable';
    process.env.TEAM_ROSTER_TABLE = 'TeamRosterTable';
    process.env.FIELD_POSITION_TABLE = 'FieldPositionTable';
    process.env.GAME_TABLE = 'GameTable';
    process.env.TEAM_INVITATION_TABLE = 'TeamInvitationTable';
  });

  it('happy path: sweeps TeamRoster, FieldPosition, Game, TeamInvitation.coaches, and returns the updated Team', async () => {
    const store = makeStore();
    store.TeamTable['team-1'] = { id: 'team-1', name: 'Team A', coaches: ['coach-a', 'coach-b'], status: 'active' };
    store.TeamRosterTable['roster-1'] = { id: 'roster-1', teamId: 'team-1', coaches: ['coach-a', 'coach-b'] };
    store.FieldPositionTable['pos-1'] = { id: 'pos-1', teamId: 'team-1', coaches: ['coach-a', 'coach-b'] };
    store.GameTable['game-1'] = { id: 'game-1', teamId: 'team-1', coaches: ['coach-a', 'coach-b'] };
    store.TeamInvitationTable['inv-1'] = {
      id: 'inv-1', teamId: 'team-1', coaches: ['coach-a', 'coach-b'],
      status: 'ACCEPTED', acceptedBy: 'coach-b', email: 'coach-b@example.com',
    };

    mockSend.mockImplementation(createMockSend(store));

    const result = await invokeHandler(buildEvent('team-1', 'coach-b', 'coach-a'));

    expect((result as { coaches: string[] }).coaches).toEqual(['coach-a']);
    expect(store.TeamRosterTable['roster-1'].coaches).toEqual(['coach-a']);
    expect(store.FieldPositionTable['pos-1'].coaches).toEqual(['coach-a']);
    expect(store.GameTable['game-1'].coaches).toEqual(['coach-a']);
    expect(store.TeamInvitationTable['inv-1'].coaches).toEqual(['coach-a']);
    expect(store.TeamInvitationTable['inv-1'].status).toBe('EXPIRED');
  });

  it('rejects a caller who is not a coach on the team (caller-membership check)', async () => {
    const store = makeStore();
    store.TeamTable['team-1'] = { id: 'team-1', name: 'Team A', coaches: ['coach-a', 'coach-b'], status: 'active' };
    mockSend.mockImplementation(createMockSend(store));

    await expect(invokeHandler(buildEvent('team-1', 'coach-b', 'not-a-coach'))).rejects.toThrow(
      'Access denied: caller is not a coach on this team'
    );
  });

  it('treats a target already absent from team.coaches as an idempotent no-op, and still runs the child sweep', async () => {
    const store = makeStore();
    store.TeamTable['team-1'] = { id: 'team-1', name: 'Team A', coaches: ['coach-a'], status: 'active' };
    store.TeamRosterTable['roster-1'] = { id: 'roster-1', teamId: 'team-1', coaches: ['coach-a', 'coach-b'] };
    mockSend.mockImplementation(createMockSend(store));

    const result = await invokeHandler(buildEvent('team-1', 'coach-b', 'coach-a'));

    expect((result as { coaches: string[] }).coaches).toEqual(['coach-a']);
    // Child sweep still ran and removed the (already Team-absent) target.
    expect(store.TeamRosterTable['roster-1'].coaches).toEqual(['coach-a']);
  });

  it('rejects revoking the team\'s last remaining coach (zero-coaches guard) but has already committed the invitation status transitions', async () => {
    const store = makeStore();
    store.TeamTable['team-1'] = { id: 'team-1', name: 'Team A', coaches: ['coach-a'], status: 'active' };
    store.TeamRosterTable['roster-1'] = { id: 'roster-1', teamId: 'team-1', coaches: ['coach-a'] };
    store.TeamInvitationTable['inv-1'] = {
      id: 'inv-1', teamId: 'team-1', coaches: ['coach-a'],
      status: 'ACCEPTED', acceptedBy: 'coach-a', email: 'coach-a@example.com',
    };
    mockSend.mockImplementation(createMockSend(store));

    await expect(invokeHandler(buildEvent('team-1', 'coach-a', 'coach-a'))).rejects.toThrow(
      "Cannot revoke the team's last coach. Invite another coach first."
    );

    // Team itself was never written.
    expect(store.TeamTable['team-1'].coaches).toEqual(['coach-a']);
    // No child-coaches writes were attempted (steps 7-10 never ran).
    expect(store.TeamRosterTable['roster-1'].coaches).toEqual(['coach-a']);
    // But the invitation status transition (steps 4-5) already committed —
    // accepted tradeoff, Major 2.
    expect(store.TeamInvitationTable['inv-1'].status).toBe('EXPIRED');
  });

  it('rejects revoking coach access for an archived team', async () => {
    const store = makeStore();
    store.TeamTable['team-1'] = { id: 'team-1', name: 'Team A', coaches: ['coach-a', 'coach-b'], status: 'archived' };
    mockSend.mockImplementation(createMockSend(store));

    await expect(invokeHandler(buildEvent('team-1', 'coach-b', 'coach-a'))).rejects.toThrow(
      'Cannot revoke coach access for an archived team. Restore the team first.'
    );
  });

  it('Team not found throws', async () => {
    const store = makeStore();
    mockSend.mockImplementation(createMockSend(store));

    await expect(invokeHandler(buildEvent('missing-team', 'coach-b', 'coach-a'))).rejects.toThrow('Team not found');
  });

  // Critical 2: the direct concurrent-revoke-abort test. Two coaches on a
  // team revoke each other "concurrently" -- simulated by mutating the
  // store out from under the first UpdateCommand attempt so it hits
  // ConditionalCheckFailedException, forcing a retry re-read that must
  // re-evaluate every invariant (not just the removal) against the fresh
  // record.
  it('aborts with the caller-membership error when the caller is concurrently revoked mid-retry, instead of writing an empty coaches array', async () => {
    const store = makeStore();
    store.TeamTable['team-1'] = { id: 'team-1', name: 'Team A', coaches: ['coach-a', 'coach-b'], status: 'active' };

    let mutatedOnce = false;
    mockSend.mockImplementation(createMockSend(store, {
      onUpdateAttempt: (tableName, id, attemptCount) => {
        if (tableName === 'TeamTable' && id === 'team-1' && attemptCount === 1 && !mutatedOnce) {
          mutatedOnce = true;
          // Simulate coach-a's concurrent revoke of coach-b landing first.
          store.TeamTable['team-1'].coaches = ['coach-a'];
        }
      },
    }));

    // coach-b (the caller) attempts to revoke coach-a (the target) — but by
    // the time its write executes, coach-b has already been removed by the
    // concurrent operation above.
    await expect(invokeHandler(buildEvent('team-1', 'coach-a', 'coach-b'))).rejects.toThrow(
      'Access denied: caller is not a coach on this team'
    );

    // The team was left in the state the concurrent write produced — not
    // wiped to [].
    expect(store.TeamTable['team-1'].coaches).toEqual(['coach-a']);
  });

  it('throws the exhausted-retries error when the Team write keeps conflicting', async () => {
    const store = makeStore();
    store.TeamTable['team-1'] = { id: 'team-1', name: 'Team A', coaches: ['coach-a', 'coach-b', 'coach-c'], status: 'active' };

    // Every UpdateCommand attempt against TeamTable conflicts (simulating
    // persistent contention); every GetCommand retry re-read returns the
    // unchanged, still-conflicting record; QueryCommand (child sweeps) are
    // never reached because the Team-level write never succeeds.
    let attempts = 0;
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      const { __type: type, input } = command;
      if (type === 'GetCommand') {
        return { Item: { ...store.TeamTable['team-1'] } };
      }
      if (type === 'UpdateCommand' && input.TableName === 'TeamTable') {
        attempts += 1;
        throw conditionalCheckFailedError();
      }
      return { Items: [] };
    });

    await expect(invokeHandler(buildEvent('team-1', 'coach-c', 'coach-a'))).rejects.toThrow(
      'Failed to update coaches for record team-1 in TeamTable after concurrent update retries'
    );
    expect(attempts).toBe(3);
  });

  // Critical 1: ACCEPTED -> EXPIRED transition, and ordering relative to the
  // Team.coaches write.
  it('expires the target\'s own ACCEPTED invitation before writing Team.coaches (ordering), and leaves already-terminal rows alone', async () => {
    const store = makeStore();
    store.TeamTable['team-1'] = { id: 'team-1', name: 'Team A', coaches: ['coach-a', 'coach-b'], status: 'active' };
    store.TeamInvitationTable['inv-accepted'] = {
      id: 'inv-accepted', teamId: 'team-1', coaches: ['coach-a', 'coach-b'],
      status: 'ACCEPTED', acceptedBy: 'coach-b', email: 'coach-b@example.com',
    };
    store.TeamInvitationTable['inv-expired'] = {
      id: 'inv-expired', teamId: 'team-1', coaches: ['coach-a', 'coach-b'],
      status: 'EXPIRED', acceptedBy: undefined, email: 'someone-else@example.com',
    };
    store.TeamInvitationTable['inv-declined'] = {
      id: 'inv-declined', teamId: 'team-1', coaches: ['coach-a', 'coach-b'],
      status: 'DECLINED', acceptedBy: undefined, email: 'declined@example.com',
    };

    const callLog: string[] = [];
    mockSend.mockImplementation(createMockSend(store, { callLog }));

    await invokeHandler(buildEvent('team-1', 'coach-b', 'coach-a'));

    expect(store.TeamInvitationTable['inv-accepted'].status).toBe('EXPIRED');
    expect(store.TeamInvitationTable['inv-expired'].status).toBe('EXPIRED'); // unchanged, still EXPIRED
    expect(store.TeamInvitationTable['inv-declined'].status).toBe('DECLINED'); // untouched

    const invitationExpiryIndex = callLog.findIndex((entry) => entry.includes('TeamInvitationTable inv-accepted status=EXPIRED'));
    const teamWriteIndex = callLog.findIndex((entry) => entry.startsWith('UPDATE TeamTable team-1'));
    expect(invitationExpiryIndex).toBeGreaterThanOrEqual(0);
    expect(teamWriteIndex).toBeGreaterThan(invitationExpiryIndex);
  });

  // Major 1: PENDING-by-email close.
  it('also expires a still-PENDING duplicate invitation to the same email as the ACCEPTED row, but not a PENDING invitation to a different email', async () => {
    const store = makeStore();
    store.TeamTable['team-1'] = { id: 'team-1', name: 'Team A', coaches: ['coach-a', 'coach-b'], status: 'active' };
    store.TeamInvitationTable['inv-accepted'] = {
      id: 'inv-accepted', teamId: 'team-1', coaches: ['coach-a', 'coach-b'],
      status: 'ACCEPTED', acceptedBy: 'coach-b', email: 'coach-b@example.com',
    };
    store.TeamInvitationTable['inv-pending-same-email'] = {
      id: 'inv-pending-same-email', teamId: 'team-1', coaches: ['coach-a', 'coach-b'],
      status: 'PENDING', acceptedBy: undefined, email: 'Coach-B@Example.com',
    };
    store.TeamInvitationTable['inv-pending-other-email'] = {
      id: 'inv-pending-other-email', teamId: 'team-1', coaches: ['coach-a', 'coach-b'],
      status: 'PENDING', acceptedBy: undefined, email: 'someone-else@example.com',
    };

    mockSend.mockImplementation(createMockSend(store));

    await invokeHandler(buildEvent('team-1', 'coach-b', 'coach-a'));

    expect(store.TeamInvitationTable['inv-pending-same-email'].status).toBe('EXPIRED');
    expect(store.TeamInvitationTable['inv-pending-other-email'].status).toBe('PENDING');
  });

  // F3: accepted residual risk, documented as a known gap, not a "closed"
  // assertion.
  it('F3 (accepted residual risk): a PENDING invitation to the target\'s own email survives revocation when the target has no ACCEPTED row on this team', async () => {
    const store = makeStore();
    store.TeamTable['team-1'] = { id: 'team-1', name: 'Team A', coaches: ['coach-a', 'coach-b'], status: 'active' };
    // coach-b has no ACCEPTED TeamInvitation row on this team (e.g. was the
    // team's creator) -- but a stray PENDING invitation to their own email
    // exists (sendTeamInvitation has no already-a-coach guard).
    store.TeamInvitationTable['inv-stray-pending'] = {
      id: 'inv-stray-pending', teamId: 'team-1', coaches: ['coach-a', 'coach-b'],
      status: 'PENDING', acceptedBy: undefined, email: 'coach-b@example.com',
    };

    mockSend.mockImplementation(createMockSend(store));

    await invokeHandler(buildEvent('team-1', 'coach-b', 'coach-a'));

    // Not expired -- remains a working self-restore path (F3).
    expect(store.TeamInvitationTable['inv-stray-pending'].status).toBe('PENDING');
  });

  // F4: accepted residual risk, documented as a known gap, not a "closed"
  // assertion.
  it('F4 (accepted residual risk): a true concurrent accept-vs-revoke race leaves the PENDING-duplicate invitation ACCEPTED, not retroactively expired, while the Team-level removal still succeeds', async () => {
    const store = makeStore();
    store.TeamTable['team-1'] = { id: 'team-1', name: 'Team A', coaches: ['coach-a', 'coach-b'], status: 'active' };
    // An ACCEPTED row for the target, so step 4 derives targetEmail and
    // step 5's PENDING-by-email sweep actually runs.
    store.TeamInvitationTable['inv-accepted-anchor'] = {
      id: 'inv-accepted-anchor', teamId: 'team-1', coaches: ['coach-a', 'coach-b'],
      status: 'ACCEPTED', acceptedBy: 'coach-b', email: 'coach-b@example.com',
    };
    // Step 3's scan reads this second invitation (same email) as still
    // PENDING...
    store.TeamInvitationTable['inv-race'] = {
      id: 'inv-race', teamId: 'team-1', coaches: ['coach-a', 'coach-b'],
      status: 'PENDING', acceptedBy: undefined, email: 'coach-b@example.com',
    };

    mockSend.mockImplementation(createMockSend(store, {
      onUpdateAttempt: (tableName, id) => {
        // ...but by the time step 5's own conditional expiry write executes
        // against it, a concurrent acceptInvitation call has already landed
        // out of band, moving it to ACCEPTED first.
        if (tableName === 'TeamInvitationTable' && id === 'inv-race') {
          store.TeamInvitationTable['inv-race'].status = 'ACCEPTED';
          store.TeamInvitationTable['inv-race'].acceptedBy = 'coach-b';
        }
      },
    }));

    const result = await invokeHandler(buildEvent('team-1', 'coach-b', 'coach-a'));

    // Team-level removal still succeeds...
    expect((result as { coaches: string[] }).coaches).toEqual(['coach-a']);
    // ...and step 5's conditional expiry write on inv-race failed harmlessly
    // (ConditionalCheckFailedException swallowed as "already transitioned"),
    // leaving it ACCEPTED rather than forcibly re-expiring it — the
    // freshly-accepted membership is not retroactively cut off (F4).
    expect(store.TeamInvitationTable['inv-race'].status).toBe('ACCEPTED');
  });

  // Minor 9: defensive empty-coaches guard on child records.
  it('skips (does not write coaches: []) a child record whose only coach is the target, and logs a warning instead of throwing', async () => {
    const store = makeStore();
    store.TeamTable['team-1'] = { id: 'team-1', name: 'Team A', coaches: ['coach-a', 'coach-b'], status: 'active' };
    store.TeamRosterTable['roster-solo'] = { id: 'roster-solo', teamId: 'team-1', coaches: ['coach-b'] };

    mockSend.mockImplementation(createMockSend(store));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await invokeHandler(buildEvent('team-1', 'coach-b', 'coach-a'));

    // Coaches left untouched, not wiped to [].
    expect(store.TeamRosterTable['roster-solo'].coaches).toEqual(['coach-b']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('roster-solo'));

    warnSpy.mockRestore();
  });
});
