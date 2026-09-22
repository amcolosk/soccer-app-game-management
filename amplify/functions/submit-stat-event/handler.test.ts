import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.hoisted(() => vi.fn());
// Typed as the realistic union (data can be null with errors present on an
// AppSync-level failure) so mockResolvedValueOnce can express the
// failed-write test case below without a type error.
type CreateResult = { data: { id: string } | null; errors: { message: string }[] | undefined };
const mockGoalCreate = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<CreateResult>>(async () => ({ data: { id: 'goal-1' }, errors: undefined })));
const mockShotCreate = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<CreateResult>>(async () => ({ data: { id: 'shot-1' }, errors: undefined })));
const mockSaveCreate = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<CreateResult>>(async () => ({ data: { id: 'save-1' }, errors: undefined })));
const mockAmplifyConfigure = vi.hoisted(() => vi.fn());
const mockGenerateClient = vi.hoisted(() => vi.fn(() => ({
  models: {
    Goal: { create: mockGoalCreate },
    Shot: { create: mockShotCreate },
    Save: { create: mockSaveCreate },
  },
})));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(function () { return {}; }),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockSend })) },
  GetCommand: vi.fn(function (input) { return { __type: 'GetCommand', input }; }),
  QueryCommand: vi.fn(function (input) { return { __type: 'QueryCommand', input }; }),
  UpdateCommand: vi.fn(function (input) { return { __type: 'UpdateCommand', input }; }),
  PutCommand: vi.fn(function (input) { return { __type: 'PutCommand', input }; }),
  DeleteCommand: vi.fn(function (input) { return { __type: 'DeleteCommand', input }; }),
}));

vi.mock('aws-amplify', () => ({
  Amplify: { configure: mockAmplifyConfigure },
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: mockGenerateClient,
}));

vi.mock('@aws-amplify/backend/function/runtime', () => ({
  getAmplifyDataClientConfig: vi.fn(async () => ({ resourceConfig: {}, libraryOptions: {} })),
}));

import { handler } from './handler';

type HandlerEvent = Parameters<typeof handler>[0];
type HandlerContext = Parameters<typeof handler>[1];
type HandlerCallback = Parameters<typeof handler>[2];

const invoke = (event: HandlerEvent) => handler(event, {} as HandlerContext, (() => {}) as HandlerCallback);

function createEvent(args: Record<string, unknown>, identityId: string | undefined = 'us-east-2:guest-1'): HandlerEvent {
  return {
    arguments: { token: 'tok-1', forUs: true, ...args },
    identity: identityId ? { cognitoIdentityId: identityId } : undefined,
  } as unknown as HandlerEvent;
}

function setEnv() {
  process.env.SHARE_LINK_TABLE = 'ShareLinkTable';
  process.env.TEAM_TABLE = 'TeamTable';
  process.env.GAME_TABLE = 'GameTable';
  process.env.FAN_VIEW_RATE_LIMIT_TABLE = 'FanViewRateLimitTable';
  process.env.TEAM_ROSTER_TABLE = 'TeamRosterTable';
}

const LIVE_GAME_ROW = {
  id: 'game-1', teamId: 'team-1', status: 'in-progress', currentHalf: 1,
  elapsedSeconds: 600, lastStartTime: '2026-09-13T16:50:00.000Z',
};

function conditionalCheckFailedError(): Error {
  const error = new Error('ConditionalCheckFailedException') as Error & { name: string };
  error.name = 'ConditionalCheckFailedException';
  return error;
}

// Minimal stateful emulation of checkAndIncrementRateLimit's conditional-put
// semantics — real enough to exercise the write-dimension rate limit
// counters (a second UpdateCommand against the same Key, with the same
// ceiling, must fail the conditional check) without reimplementing DynamoDB.
let updateHitCounts: Map<string, number>;

// Separate stateful emulation of the clientEventId dedup row (Put with
// attribute_not_exists / Get / Update-to-succeeded / Delete against
// FanViewRateLimitTable) — real enough to exercise claimDedupRow's full
// claimed/already-succeeded/concurrent-duplicate branching without
// reimplementing DynamoDB.
let dedupStore: Map<string, { status: string }>;

function mockHappyPathSend(overrides: Partial<{
  shareLink: Record<string, unknown>;
  team: Record<string, unknown>;
  games: Array<Record<string, unknown>>;
  roster: Array<{ playerId: string; isActive?: boolean | null }>;
}> = {}) {
  mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
    const table = command.input.TableName as string;
    if (command.__type === 'GetCommand' && table === 'ShareLinkTable') {
      return { Item: overrides.shareLink ?? { token: 'tok-1', teamId: 'team-1', type: 'STAT_TRACKER' } };
    }
    if (command.__type === 'GetCommand' && table === 'TeamTable') {
      return { Item: overrides.team ?? { id: 'team-1', name: 'Eagles', coaches: ['coach-1', 'coach-2'] } };
    }
    if (command.__type === 'GetCommand' && table === 'FanViewRateLimitTable') {
      // claimDedupRow's post-conflict read of the dedup row.
      const key = JSON.stringify((command.input as { Key: unknown }).Key);
      const existing = dedupStore.get(key);
      return existing ? { Item: existing } : {};
    }
    if (command.__type === 'QueryCommand' && table === 'GameTable') {
      return { Items: overrides.games ?? [LIVE_GAME_ROW] };
    }
    if (command.__type === 'QueryCommand' && table === 'TeamRosterTable') {
      return { Items: overrides.roster ?? [{ playerId: 'p1' }, { playerId: 'p2' }] };
    }
    if (command.__type === 'PutCommand' && table === 'FanViewRateLimitTable') {
      // claimDedupRow's atomic conditional insert.
      const item = (command.input as { Item: { limiterKey: string; minuteBucket: string } }).Item;
      const key = JSON.stringify({ limiterKey: item.limiterKey, minuteBucket: item.minuteBucket });
      if (dedupStore.has(key)) {
        throw conditionalCheckFailedError();
      }
      dedupStore.set(key, { status: 'pending' });
      return {};
    }
    if (command.__type === 'DeleteCommand' && table === 'FanViewRateLimitTable') {
      const key = JSON.stringify((command.input as { Key: unknown }).Key);
      dedupStore.delete(key);
      return {};
    }
    if (command.__type === 'UpdateCommand') {
      const values = (command.input as { ExpressionAttributeValues?: Record<string, unknown> }).ExpressionAttributeValues ?? {};
      if (':succeeded' in values) {
        // markDedupSucceeded.
        const key = JSON.stringify((command.input as { Key: unknown }).Key);
        dedupStore.set(key, { status: 'succeeded' });
        return {};
      }
      const key = JSON.stringify((command.input as { Key: unknown }).Key);
      const ceiling = (values as Record<string, number>)[':ceiling'];
      const priorCount = updateHitCounts.get(key) ?? 0;
      if (priorCount >= ceiling) {
        throw conditionalCheckFailedError();
      }
      updateHitCounts.set(key, priorCount + 1);
      return {};
    }
    return {};
  });
}

describe('submit-stat-event handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEnv();
    updateHitCounts = new Map();
    dedupStore = new Map();
    mockGoalCreate.mockResolvedValue({ data: { id: 'goal-1' }, errors: undefined });
    mockShotCreate.mockResolvedValue({ data: { id: 'shot-1' }, errors: undefined });
    mockSaveCreate.mockResolvedValue({ data: { id: 'save-1' }, errors: undefined });
  });

  it('rejects an eventType outside the allowlist', async () => {
    mockHappyPathSend();
    const result = await invoke(createEvent({ eventType: 'ASSIST', forUs: true }));
    expect(result).toEqual({ ok: false, reason: 'VALIDATION_FAILED' });
    expect(mockGenerateClient).not.toHaveBeenCalled();
  });

  it('rejects INVALID_LINK for a token that does not resolve', async () => {
    mockHappyPathSend({ shareLink: undefined as unknown as Record<string, unknown> });
    mockSend.mockImplementation(async () => ({}));
    const result = await invoke(createEvent({ eventType: 'GOAL' }));
    expect(result).toEqual({ ok: false, reason: 'INVALID_LINK' });
  });

  it('rejects RATE_LIMITED (write dimension) when over the write ceiling', async () => {
    mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
      const table = command.input.TableName as string;
      if (command.__type === 'GetCommand' && table === 'ShareLinkTable') {
        return { Item: { token: 'tok-1', teamId: 'team-1', type: 'STAT_TRACKER' } };
      }
      if (command.__type === 'GetCommand' && table === 'TeamTable') {
        return { Item: { id: 'team-1', name: 'Eagles' } };
      }
      if (command.__type === 'UpdateCommand') {
        const error = new Error('ConditionalCheckFailedException') as Error & { name: string };
        error.name = 'ConditionalCheckFailedException';
        throw error;
      }
      return {};
    });
    const result = await invoke(createEvent({ eventType: 'GOAL' }));
    expect(result).toEqual({ ok: false, reason: 'RATE_LIMITED' });
  });

  it('rejects GAME_NOT_LIVE when the resolved game is not in-progress (e.g. halftime)', async () => {
    mockHappyPathSend({ games: [{ ...LIVE_GAME_ROW, status: 'halftime' }] });
    const result = await invoke(createEvent({ eventType: 'GOAL' }));
    expect(result).toEqual({ ok: false, reason: 'GAME_NOT_LIVE' });
  });

  it('rejects GAME_NOT_LIVE when there is no live game at all', async () => {
    mockHappyPathSend({ games: [] });
    const result = await invoke(createEvent({ eventType: 'GOAL' }));
    expect(result).toEqual({ ok: false, reason: 'GAME_NOT_LIVE' });
  });

  it('rejects GAME_CHANGED when expectedGameId does not match the server-resolved game (the wrong-game-race guard)', async () => {
    mockHappyPathSend();
    const result = await invoke(createEvent({ eventType: 'GOAL', expectedGameId: 'some-other-game' }));
    expect(result).toEqual({ ok: false, reason: 'GAME_CHANGED' });
    expect(mockGenerateClient).not.toHaveBeenCalled();
  });

  it('accepts a matching expectedGameId', async () => {
    mockHappyPathSend();
    const result = await invoke(createEvent({ eventType: 'GOAL', expectedGameId: 'game-1' }));
    expect(result).toEqual({ ok: true, reason: null });
  });

  it('does not require expectedGameId (first-ever poll has none to echo)', async () => {
    mockHappyPathSend();
    const result = await invoke(createEvent({ eventType: 'GOAL' }));
    expect(result?.ok).toBe(true);
  });

  it('rejects VALIDATION_FAILED when forUs is false but a playerId is supplied', async () => {
    mockHappyPathSend();
    const result = await invoke(createEvent({ eventType: 'GOAL', forUs: false, playerId: 'p1' }));
    expect(result).toEqual({ ok: false, reason: 'VALIDATION_FAILED' });
  });

  it('rejects VALIDATION_FAILED when forUs is false but an assistPlayerId is supplied', async () => {
    mockHappyPathSend();
    const result = await invoke(createEvent({ eventType: 'GOAL', forUs: false, assistPlayerId: 'p1' }));
    expect(result).toEqual({ ok: false, reason: 'VALIDATION_FAILED' });
  });

  it('rejects VALIDATION_FAILED for a SHOT missing onTarget, both Us and Opponent paths', async () => {
    mockHappyPathSend();
    const usResult = await invoke(createEvent({ eventType: 'SHOT', forUs: true, playerId: 'p1' }));
    expect(usResult).toEqual({ ok: false, reason: 'VALIDATION_FAILED' });
    const oppResult = await invoke(createEvent({ eventType: 'SHOT', forUs: false }));
    expect(oppResult).toEqual({ ok: false, reason: 'VALIDATION_FAILED' });
  });

  it('allows an "Us" SHOT with no playerId, deliberately (skip affordance)', async () => {
    mockHappyPathSend();
    const result = await invoke(createEvent({ eventType: 'SHOT', forUs: true, onTarget: true }));
    expect(result).toEqual({ ok: true, reason: null });
    expect(mockShotCreate).toHaveBeenCalledWith(expect.objectContaining({ playerId: undefined, onTarget: true, takenByUs: true }));
  });

  it('rejects VALIDATION_FAILED when playerId does not belong to the token\'s team roster', async () => {
    mockHappyPathSend();
    const result = await invoke(createEvent({ eventType: 'GOAL', forUs: true, playerId: 'not-on-roster' }));
    expect(result).toEqual({ ok: false, reason: 'VALIDATION_FAILED' });
    expect(mockGoalCreate).not.toHaveBeenCalled();
  });

  it('rejects VALIDATION_FAILED when assistPlayerId does not belong to the roster', async () => {
    mockHappyPathSend();
    const result = await invoke(createEvent({ eventType: 'GOAL', forUs: true, playerId: 'p1', assistPlayerId: 'not-on-roster' }));
    expect(result).toEqual({ ok: false, reason: 'VALIDATION_FAILED' });
  });

  it('rejects VALIDATION_FAILED when assistPlayerId equals playerId', async () => {
    mockHappyPathSend();
    const result = await invoke(createEvent({ eventType: 'GOAL', forUs: true, playerId: 'p1', assistPlayerId: 'p1' }));
    expect(result).toEqual({ ok: false, reason: 'VALIDATION_FAILED' });
  });

  it('rejects VALIDATION_FAILED when assistPlayerId is supplied on a non-GOAL event', async () => {
    mockHappyPathSend();
    const result = await invoke(createEvent({ eventType: 'SHOT', forUs: true, onTarget: true, playerId: 'p1', assistPlayerId: 'p2' }));
    expect(result).toEqual({ ok: false, reason: 'VALIDATION_FAILED' });
  });

  it('populates coaches[] from the team\'s CURRENT array for an "Us" event', async () => {
    mockHappyPathSend();
    await invoke(createEvent({ eventType: 'GOAL', forUs: true, playerId: 'p1' }));
    expect(mockGoalCreate).toHaveBeenCalledWith(expect.objectContaining({ coaches: ['coach-1', 'coach-2'] }));
  });

  it('populates coaches[] for an opponent-side event too (still belongs to the team\'s coaches)', async () => {
    mockHappyPathSend();
    await invoke(createEvent({ eventType: 'GOAL', forUs: false }));
    expect(mockGoalCreate).toHaveBeenCalledWith(expect.objectContaining({ coaches: ['coach-1', 'coach-2'], scoredByUs: false }));
  });

  it('derives gameSeconds/half server-side via the Lambda gameClock mirror, ignoring any client-supplied value', async () => {
    mockHappyPathSend({ games: [{
      id: 'game-1', teamId: 'team-1', status: 'in-progress', currentHalf: 2,
      elapsedSeconds: 1800, lastStartTime: '2026-09-13T17:00:00.000Z',
    }] });
    await invoke(createEvent({ eventType: 'GOAL', forUs: true, playerId: 'p1' }));
    expect(mockGoalCreate).toHaveBeenCalledWith(expect.objectContaining({ half: 2 }));
    const call = mockGoalCreate.mock.calls[0]?.[0] as unknown as { gameSeconds: number };
    expect(call.gameSeconds).toBeGreaterThanOrEqual(1800);
  });

  it('sets loggedVia HELPER on every write', async () => {
    mockHappyPathSend();
    await invoke(createEvent({ eventType: 'GOAL', forUs: true, playerId: 'p1' }));
    expect(mockGoalCreate).toHaveBeenCalledWith(expect.objectContaining({ loggedVia: 'HELPER' }));
  });

  it('writes a Shot via the Shot model with onTarget/takenByUs set', async () => {
    mockHappyPathSend();
    await invoke(createEvent({ eventType: 'SHOT', forUs: true, playerId: 'p1', onTarget: false }));
    expect(mockShotCreate).toHaveBeenCalledWith(expect.objectContaining({ takenByUs: true, onTarget: false, playerId: 'p1' }));
  });

  it('writes a Save via the Save model with byUs set, playerId optional', async () => {
    mockHappyPathSend();
    await invoke(createEvent({ eventType: 'SAVE', forUs: true }));
    expect(mockSaveCreate).toHaveBeenCalledWith(expect.objectContaining({ byUs: true, playerId: undefined }));
  });

  it('rejects VALIDATION_FAILED for a clientEventId longer than 128 characters, without touching the database', async () => {
    const tooLong = 'x'.repeat(129);
    const result = await invoke(createEvent({ eventType: 'GOAL', forUs: true, playerId: 'p1', clientEventId: tooLong }));
    expect(result).toEqual({ ok: false, reason: 'VALIDATION_FAILED' });
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockGenerateClient).not.toHaveBeenCalled();
  });

  it('accepts a clientEventId at exactly the 128-character bound', async () => {
    mockHappyPathSend();
    const exactly128 = 'x'.repeat(128);
    const result = await invoke(createEvent({ eventType: 'GOAL', forUs: true, playerId: 'p1', clientEventId: exactly128 }));
    expect(result).toEqual({ ok: true, reason: null });
  });

  it('rejects VALIDATION_FAILED when playerId belongs to a roster row the coach has marked isActive: false', async () => {
    mockHappyPathSend({ roster: [{ playerId: 'p1', isActive: false }, { playerId: 'p2' }] });
    const result = await invoke(createEvent({ eventType: 'GOAL', forUs: true, playerId: 'p1' }));
    expect(result).toEqual({ ok: false, reason: 'VALIDATION_FAILED' });
    expect(mockGoalCreate).not.toHaveBeenCalled();
  });

  describe('idempotency (clientEventId dedup)', () => {
    it('a retried submission with the same clientEventId does not write twice, and only one dedup row is created', async () => {
      mockHappyPathSend();
      const first = await invoke(createEvent({ eventType: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));
      const second = await invoke(createEvent({ eventType: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));
      expect(first).toEqual({ ok: true, reason: null });
      expect(second).toEqual({ ok: true, reason: null });
      expect(mockGoalCreate).toHaveBeenCalledTimes(1);
      expect(dedupStore.size).toBe(1);
    });

    it('a different clientEventId is treated as a distinct submission', async () => {
      mockHappyPathSend();
      await invoke(createEvent({ eventType: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));
      await invoke(createEvent({ eventType: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-2' }));
      expect(mockGoalCreate).toHaveBeenCalledTimes(2);
    });

    it('a retry after a FAILED first write is NOT told ok:true, then gets a clean second attempt that succeeds, creating exactly one row', async () => {
      mockHappyPathSend();
      mockGoalCreate.mockResolvedValueOnce({ data: null, errors: [{ message: 'AppSync error' }] });

      await expect(
        invoke(createEvent({ eventType: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' })),
      ).rejects.toThrow('AppSync error');

      // The claim must have been released on failure -- the dedup table has
      // no lingering row after the failed attempt.
      expect(dedupStore.size).toBe(0);

      const retry = await invoke(createEvent({ eventType: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));
      expect(retry).toEqual({ ok: true, reason: null });
      expect(mockGoalCreate).toHaveBeenCalledTimes(2);
      expect(dedupStore.size).toBe(1);
    });

    it('a retry landing in the next wall-clock minute from the original attempt is still recognized as a duplicate', async () => {
      mockHappyPathSend();
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-09-13T16:59:50.000Z'));
        const first = await invoke(createEvent({ eventType: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));
        expect(first).toEqual({ ok: true, reason: null });

        // Cross a wall-clock minute boundary before the retry.
        vi.setSystemTime(new Date('2026-09-13T17:00:15.000Z'));
        const retry = await invoke(createEvent({ eventType: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));
        expect(retry).toEqual({ ok: true, reason: null });
      } finally {
        vi.useRealTimers();
      }
      expect(mockGoalCreate).toHaveBeenCalledTimes(1);
    });

    it('rejects RATE_LIMITED (transient) for a same-instant concurrent duplicate still marked pending', async () => {
      mockHappyPathSend();
      // Simulate a concurrent in-flight duplicate: seed the dedup row as
      // 'pending' before this invocation, as if another invocation claimed
      // it moments ago and hasn't finished yet.
      dedupStore.set(JSON.stringify({ limiterKey: 'dedup#evt-1', minuteBucket: 'dedup' }), { status: 'pending' });

      const result = await invoke(createEvent({ eventType: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));
      expect(result).toEqual({ ok: false, reason: 'RATE_LIMITED' });
      expect(mockGoalCreate).not.toHaveBeenCalled();
      // The pending row is left untouched -- it belongs to the other
      // in-flight invocation, this one must not finalize or release it.
      expect(dedupStore.get(JSON.stringify({ limiterKey: 'dedup#evt-1', minuteBucket: 'dedup' }))).toEqual({ status: 'pending' });
    });
  });
});
