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
// attribute_not_exists / Get / conditional status transitions / Delete
// against FanViewRateLimitTable) — real enough to exercise claimDedupRow's
// full claimed/resume/already-succeeded/concurrent-duplicate branching
// without reimplementing DynamoDB.
let dedupStore: Map<string, { status: string; writeContext?: unknown }>;
// Separate stateful emulation of TeamTable rows so the A4 resume-time fresh
// re-read (a plain GetCommand, distinct from the ShareLinkAccess pipeline's
// own team lookup) can be seeded/mutated per test.
let teamStore: Map<string, { id: string; coaches?: string[] }>;

function mockHappyPathSend(overrides: Partial<{
  shareLink: Record<string, unknown>;
  team: Record<string, unknown>;
  games: Array<Record<string, unknown>>;
  roster: Array<{ playerId: string; isActive?: boolean | null }>;
}> = {}) {
  const team = overrides.team ?? { id: 'team-1', name: 'Eagles', coaches: ['coach-1', 'coach-2'] };
  teamStore.set(team.id as string, team as { id: string; coaches?: string[] });

  mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
    const table = command.input.TableName as string;
    if (command.__type === 'GetCommand' && table === 'ShareLinkTable') {
      return { Item: overrides.shareLink ?? { token: 'tok-1', teamId: 'team-1', type: 'STAT_TRACKER' } };
    }
    if (command.__type === 'GetCommand' && table === 'TeamTable') {
      const key = (command.input as { Key: { id: string } }).Key;
      return { Item: teamStore.get(key.id) };
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
      return { Items: overrides.roster ?? [{ playerId: 'p1' }, { playerId: 'p2' }, { playerId: 'gk1' }] };
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
    if (command.__type === 'UpdateCommand' && table === 'FanViewRateLimitTable') {
      const key = JSON.stringify((command.input as { Key: unknown }).Key);
      const input = command.input as {
        UpdateExpression?: string;
        ConditionExpression?: string;
        ExpressionAttributeValues?: Record<string, unknown>;
      };
      const values = input.ExpressionAttributeValues ?? {};

      if (input.UpdateExpression === 'SET writeContext = :writeContext') {
        const existing = dedupStore.get(key) ?? { status: 'pending' };
        dedupStore.set(key, { ...existing, writeContext: values[':writeContext'] });
        return {};
      }

      if (input.ConditionExpression === '#status = :shotWritten') {
        // Atomic re-claim on resume (A2).
        const existing = dedupStore.get(key);
        if (!existing || existing.status !== 'shot-written') {
          throw conditionalCheckFailedError();
        }
        dedupStore.set(key, { ...existing, status: 'resuming' });
        return {};
      }

      if (input.ConditionExpression === '#status = :resuming') {
        // revertToShotWritten.
        const existing = dedupStore.get(key);
        if (!existing || existing.status !== 'resuming') {
          throw conditionalCheckFailedError();
        }
        dedupStore.set(key, { ...existing, status: 'shot-written' });
        return {};
      }

      if (typeof values[':status'] === 'string') {
        const existing = dedupStore.get(key) ?? { status: 'pending' };
        dedupStore.set(key, { ...existing, status: values[':status'] as string });
        return {};
      }

      // Rate-limit counter UpdateCommand (checkAndIncrementRateLimit).
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
    teamStore = new Map();
    mockGoalCreate.mockResolvedValue({ data: { id: 'goal-1' }, errors: undefined });
    mockShotCreate.mockResolvedValue({ data: { id: 'shot-1' }, errors: undefined });
    mockSaveCreate.mockResolvedValue({ data: { id: 'save-1' }, errors: undefined });
  });

  it('rejects an outcome outside the allowlist', async () => {
    mockHappyPathSend();
    const result = await invoke(createEvent({ outcome: 'ASSIST', forUs: true }));
    expect(result).toEqual({ ok: false, reason: 'VALIDATION_FAILED' });
    expect(mockGenerateClient).not.toHaveBeenCalled();
  });

  it('rejects INVALID_LINK for a token that does not resolve', async () => {
    mockHappyPathSend({ shareLink: undefined as unknown as Record<string, unknown> });
    mockSend.mockImplementation(async () => ({}));
    const result = await invoke(createEvent({ outcome: 'GOAL' }));
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
        throw conditionalCheckFailedError();
      }
      return {};
    });
    const result = await invoke(createEvent({ outcome: 'GOAL' }));
    expect(result).toEqual({ ok: false, reason: 'RATE_LIMITED' });
  });

  it('rejects GAME_NOT_LIVE when the resolved game is not in-progress (e.g. halftime)', async () => {
    mockHappyPathSend({ games: [{ ...LIVE_GAME_ROW, status: 'halftime' }] });
    const result = await invoke(createEvent({ outcome: 'GOAL' }));
    expect(result).toEqual({ ok: false, reason: 'GAME_NOT_LIVE' });
  });

  it('rejects GAME_NOT_LIVE when there is no live game at all', async () => {
    mockHappyPathSend({ games: [] });
    const result = await invoke(createEvent({ outcome: 'GOAL' }));
    expect(result).toEqual({ ok: false, reason: 'GAME_NOT_LIVE' });
  });

  it('rejects GAME_CHANGED when expectedGameId does not match the server-resolved game (the wrong-game-race guard)', async () => {
    mockHappyPathSend();
    const result = await invoke(createEvent({ outcome: 'GOAL', expectedGameId: 'some-other-game' }));
    expect(result).toEqual({ ok: false, reason: 'GAME_CHANGED' });
    expect(mockGenerateClient).not.toHaveBeenCalled();
  });

  it('accepts a matching expectedGameId', async () => {
    mockHappyPathSend();
    const result = await invoke(createEvent({ outcome: 'GOAL', expectedGameId: 'game-1' }));
    expect(result).toEqual({ ok: true, reason: null });
  });

  it('does not require expectedGameId (first-ever poll has none to echo)', async () => {
    mockHappyPathSend();
    const result = await invoke(createEvent({ outcome: 'GOAL' }));
    expect(result?.ok).toBe(true);
  });

  it('rejects VALIDATION_FAILED when forUs is false but a playerId is supplied', async () => {
    mockHappyPathSend();
    const result = await invoke(createEvent({ outcome: 'GOAL', forUs: false, playerId: 'p1' }));
    expect(result).toEqual({ ok: false, reason: 'VALIDATION_FAILED' });
  });

  it('rejects VALIDATION_FAILED when forUs is false but an assistPlayerId is supplied', async () => {
    mockHappyPathSend();
    const result = await invoke(createEvent({ outcome: 'GOAL', forUs: false, assistPlayerId: 'p1' }));
    expect(result).toEqual({ ok: false, reason: 'VALIDATION_FAILED' });
  });

  it('allows an "Us" shot with no playerId, deliberately (skip affordance), for every outcome', async () => {
    mockHappyPathSend();
    for (const outcome of ['GOAL', 'SAVED', 'BLOCKED', 'WIDE']) {
      mockShotCreate.mockClear();
      const result = await invoke(createEvent({ outcome, forUs: true, clientEventId: `evt-${outcome}` }));
      expect(result).toEqual({ ok: true, reason: null });
      expect(mockShotCreate).toHaveBeenCalledWith(expect.objectContaining({ playerId: null, takenByUs: true, outcome }));
    }
  });

  it('rejects VALIDATION_FAILED when playerId does not belong to the token\'s team roster', async () => {
    mockHappyPathSend();
    const result = await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'not-on-roster' }));
    expect(result).toEqual({ ok: false, reason: 'VALIDATION_FAILED' });
    expect(mockGoalCreate).not.toHaveBeenCalled();
    expect(mockShotCreate).not.toHaveBeenCalled();
  });

  it('rejects VALIDATION_FAILED when assistPlayerId does not belong to the roster', async () => {
    mockHappyPathSend();
    const result = await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', assistPlayerId: 'not-on-roster' }));
    expect(result).toEqual({ ok: false, reason: 'VALIDATION_FAILED' });
  });

  it('rejects VALIDATION_FAILED when assistPlayerId equals playerId', async () => {
    mockHappyPathSend();
    const result = await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', assistPlayerId: 'p1' }));
    expect(result).toEqual({ ok: false, reason: 'VALIDATION_FAILED' });
  });

  it('rejects VALIDATION_FAILED when assistPlayerId is supplied on a non-GOAL outcome', async () => {
    mockHappyPathSend();
    const result = await invoke(createEvent({ outcome: 'BLOCKED', forUs: true, playerId: 'p1', assistPlayerId: 'p2' }));
    expect(result).toEqual({ ok: false, reason: 'VALIDATION_FAILED' });
  });

  describe('keeperPlayerId validation (m8)', () => {
    it('rejects VALIDATION_FAILED when keeperPlayerId is supplied on the "Us" side', async () => {
      mockHappyPathSend();
      const result = await invoke(createEvent({ outcome: 'SAVED', forUs: true, keeperPlayerId: 'gk1' }));
      expect(result).toEqual({ ok: false, reason: 'VALIDATION_FAILED' });
    });

    it('rejects VALIDATION_FAILED when keeperPlayerId is supplied on "Them" with a non-SAVED outcome', async () => {
      mockHappyPathSend();
      const result = await invoke(createEvent({ outcome: 'WIDE', forUs: false, keeperPlayerId: 'gk1' }));
      expect(result).toEqual({ ok: false, reason: 'VALIDATION_FAILED' });
    });

    it('rejects VALIDATION_FAILED when "Them" + SAVED keeperPlayerId is not on the roster (m8 parallel check)', async () => {
      mockHappyPathSend();
      const result = await invoke(createEvent({ outcome: 'SAVED', forUs: false, keeperPlayerId: 'not-on-roster' }));
      expect(result).toEqual({ ok: false, reason: 'VALIDATION_FAILED' });
      expect(mockSaveCreate).not.toHaveBeenCalled();
    });

    it('accepts "Them" + SAVED with a valid roster keeperPlayerId', async () => {
      mockHappyPathSend();
      const result = await invoke(createEvent({ outcome: 'SAVED', forUs: false, keeperPlayerId: 'gk1' }));
      expect(result).toEqual({ ok: true, reason: null });
      expect(mockSaveCreate).toHaveBeenCalledWith(expect.objectContaining({ byUs: true, playerId: 'gk1' }));
    });
  });

  it('populates coaches[] from the team\'s CURRENT array for an "Us" event', async () => {
    mockHappyPathSend();
    await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1' }));
    expect(mockGoalCreate).toHaveBeenCalledWith(expect.objectContaining({ coaches: ['coach-1', 'coach-2'] }));
    expect(mockShotCreate).toHaveBeenCalledWith(expect.objectContaining({ coaches: ['coach-1', 'coach-2'] }));
  });

  it('populates coaches[] for an opponent-side event too (still belongs to the team\'s coaches)', async () => {
    mockHappyPathSend();
    await invoke(createEvent({ outcome: 'GOAL', forUs: false }));
    expect(mockGoalCreate).toHaveBeenCalledWith(expect.objectContaining({ coaches: ['coach-1', 'coach-2'], scoredByUs: false }));
  });

  it('derives gameSeconds/half server-side via the Lambda gameClock mirror, ignoring any client-supplied value', async () => {
    mockHappyPathSend({ games: [{
      id: 'game-1', teamId: 'team-1', status: 'in-progress', currentHalf: 2,
      elapsedSeconds: 1800, lastStartTime: '2026-09-13T17:00:00.000Z',
    }] });
    await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1' }));
    expect(mockGoalCreate).toHaveBeenCalledWith(expect.objectContaining({ half: 2 }));
    const call = mockGoalCreate.mock.calls[0]?.[0] as unknown as { gameSeconds: number };
    expect(call.gameSeconds).toBeGreaterThanOrEqual(1800);
  });

  it('sets loggedVia HELPER on every write', async () => {
    mockHappyPathSend();
    await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1' }));
    expect(mockGoalCreate).toHaveBeenCalledWith(expect.objectContaining({ loggedVia: 'HELPER' }));
    expect(mockShotCreate).toHaveBeenCalledWith(expect.objectContaining({ loggedVia: 'HELPER' }));
  });

  it('rejects VALIDATION_FAILED for a clientEventId longer than 128 characters, without touching the database', async () => {
    const tooLong = 'x'.repeat(129);
    const result = await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: tooLong }));
    expect(result).toEqual({ ok: false, reason: 'VALIDATION_FAILED' });
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockGenerateClient).not.toHaveBeenCalled();
  });

  it('accepts a clientEventId at exactly the 128-character bound', async () => {
    mockHappyPathSend();
    const exactly128 = 'x'.repeat(128);
    const result = await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: exactly128 }));
    expect(result).toEqual({ ok: true, reason: null });
  });

  it('rejects VALIDATION_FAILED when playerId belongs to a roster row the coach has marked isActive: false', async () => {
    mockHappyPathSend({ roster: [{ playerId: 'p1', isActive: false }, { playerId: 'p2' }] });
    const result = await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1' }));
    expect(result).toEqual({ ok: false, reason: 'VALIDATION_FAILED' });
    expect(mockGoalCreate).not.toHaveBeenCalled();
  });

  describe('unified outcome -> records mapping (i4: shared gameId/timestamp/gameSeconds)', () => {
    it('BLOCKED/WIDE write only a Shot, no Goal/Save', async () => {
      mockHappyPathSend();
      await invoke(createEvent({ outcome: 'BLOCKED', forUs: true, playerId: 'p1' }));
      expect(mockShotCreate).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'BLOCKED', takenByUs: true, playerId: 'p1' }));
      expect(mockGoalCreate).not.toHaveBeenCalled();
      expect(mockSaveCreate).not.toHaveBeenCalled();
    });

    it('GOAL writes both a Shot(outcome:GOAL) and a Goal, sharing gameId/timestamp/gameSeconds', async () => {
      mockHappyPathSend();
      await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', assistPlayerId: 'p2' }));
      const shotCall = mockShotCreate.mock.calls[0]?.[0] as { gameId: string; timestamp: string; gameSeconds: number; outcome: string; takenByUs: boolean; playerId: string | null };
      const goalCall = mockGoalCreate.mock.calls[0]?.[0] as { gameId: string; timestamp: string; gameSeconds: number; scoredByUs: boolean; scorerId: string | null; assistId: string | null };
      expect(shotCall.outcome).toBe('GOAL');
      expect(shotCall.takenByUs).toBe(true);
      expect(shotCall.playerId).toBe('p1');
      expect(goalCall.scoredByUs).toBe(true);
      expect(goalCall.scorerId).toBe('p1');
      expect(goalCall.assistId).toBe('p2');
      expect(goalCall.gameId).toBe(shotCall.gameId);
      expect(goalCall.timestamp).toBe(shotCall.timestamp);
      expect(goalCall.gameSeconds).toBe(shotCall.gameSeconds);
    });

    it('SAVED on "Us" writes a Shot(outcome:SAVED) and a Save with byUs:false (opponent keeper), no attribution', async () => {
      mockHappyPathSend();
      await invoke(createEvent({ outcome: 'SAVED', forUs: true, playerId: 'p1' }));
      expect(mockShotCreate).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'SAVED', takenByUs: true, playerId: 'p1' }));
      expect(mockSaveCreate).toHaveBeenCalledWith(expect.objectContaining({ byUs: false, playerId: null }));
      expect(mockGoalCreate).not.toHaveBeenCalled();
    });

    it('SAVED on "Them" writes a Shot(outcome:SAVED, takenByUs:false) and a Save with byUs:true and our keeper attributed', async () => {
      mockHappyPathSend();
      await invoke(createEvent({ outcome: 'SAVED', forUs: false, keeperPlayerId: 'gk1' }));
      expect(mockShotCreate).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'SAVED', takenByUs: false, playerId: null }));
      expect(mockSaveCreate).toHaveBeenCalledWith(expect.objectContaining({ byUs: true, playerId: 'gk1' }));
    });

    it('GOAL on "Them" (opponent goal) writes a Shot and a Goal with no scorer attribution', async () => {
      mockHappyPathSend();
      await invoke(createEvent({ outcome: 'GOAL', forUs: false }));
      expect(mockShotCreate).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'GOAL', takenByUs: false, playerId: null }));
      expect(mockGoalCreate).toHaveBeenCalledWith(expect.objectContaining({ scoredByUs: false, scorerId: null, assistId: null }));
    });
  });

  describe('idempotency (clientEventId dedup)', () => {
    it('a retried submission with the same clientEventId does not write twice, and only one dedup row is created', async () => {
      mockHappyPathSend();
      const first = await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));
      const second = await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));
      expect(first).toEqual({ ok: true, reason: null });
      expect(second).toEqual({ ok: true, reason: null });
      expect(mockGoalCreate).toHaveBeenCalledTimes(1);
      expect(mockShotCreate).toHaveBeenCalledTimes(1);
      expect(dedupStore.size).toBe(1);
    });

    it('a different clientEventId is treated as a distinct submission', async () => {
      mockHappyPathSend();
      await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));
      await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-2' }));
      expect(mockGoalCreate).toHaveBeenCalledTimes(2);
    });

    it('a retry after a FAILED first (Shot) write is NOT told ok:true, then gets a clean second attempt that succeeds, creating exactly one row', async () => {
      mockHappyPathSend();
      mockShotCreate.mockResolvedValueOnce({ data: null, errors: [{ message: 'AppSync error' }] });

      await expect(
        invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' })),
      ).rejects.toThrow('AppSync error');

      // The claim must have been released on failure -- no progress was made
      // (the Shot write itself failed), so the dedup table has no lingering
      // row after the failed attempt.
      expect(dedupStore.size).toBe(0);

      const retry = await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));
      expect(retry).toEqual({ ok: true, reason: null });
      expect(mockGoalCreate).toHaveBeenCalledTimes(1);
      expect(mockShotCreate).toHaveBeenCalledTimes(2);
      expect(dedupStore.size).toBe(1);
    });

    it('a retry landing in the next wall-clock minute from the original attempt is still recognized as a duplicate', async () => {
      mockHappyPathSend();
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-09-13T16:59:50.000Z'));
        const first = await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));
        expect(first).toEqual({ ok: true, reason: null });

        // Cross a wall-clock minute boundary before the retry.
        vi.setSystemTime(new Date('2026-09-13T17:00:15.000Z'));
        const retry = await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));
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

      const result = await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));
      expect(result).toEqual({ ok: false, reason: 'RATE_LIMITED' });
      expect(mockGoalCreate).not.toHaveBeenCalled();
      // The pending row is left untouched -- it belongs to the other
      // in-flight invocation, this one must not finalize or release it.
      expect(dedupStore.get(JSON.stringify({ limiterKey: 'dedup#evt-1', minuteBucket: 'dedup' }))).toEqual({ status: 'pending' });
    });
  });

  describe('resumable dedup state (partial-write / resume scenarios)', () => {
    it('a Goal write failing after a successful Shot write returns PARTIAL_WRITE, not a throw, and does not duplicate the Shot', async () => {
      mockHappyPathSend();
      mockGoalCreate.mockRejectedValueOnce(new Error('AppSync error'));

      const result = await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));
      expect(result).toEqual({ ok: false, reason: 'PARTIAL_WRITE' });
      expect(mockShotCreate).toHaveBeenCalledTimes(1);

      const key = JSON.stringify({ limiterKey: 'dedup#evt-1', minuteBucket: 'dedup' });
      expect(dedupStore.get(key)?.status).toBe('shot-written');
    });

    it('a retry with the same clientEventId after a partial write RESUMES: completes only the missing Goal write, without re-creating Shot', async () => {
      mockHappyPathSend();
      mockGoalCreate.mockRejectedValueOnce(new Error('AppSync error'));

      const first = await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', assistPlayerId: 'p2', clientEventId: 'evt-1' }));
      expect(first).toEqual({ ok: false, reason: 'PARTIAL_WRITE' });
      expect(mockShotCreate).toHaveBeenCalledTimes(1);
      expect(mockGoalCreate).toHaveBeenCalledTimes(1);

      const retry = await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', assistPlayerId: 'p2', clientEventId: 'evt-1' }));
      expect(retry).toEqual({ ok: true, reason: null });
      // Shot was never re-created on the resume.
      expect(mockShotCreate).toHaveBeenCalledTimes(1);
      expect(mockGoalCreate).toHaveBeenCalledTimes(2);

      const key = JSON.stringify({ limiterKey: 'dedup#evt-1', minuteBucket: 'dedup' });
      expect(dedupStore.get(key)?.status).toBe('succeeded');
    });

    it('a resumed Save write also succeeds without re-creating the Shot', async () => {
      mockHappyPathSend();
      mockSaveCreate.mockRejectedValueOnce(new Error('AppSync error'));

      const first = await invoke(createEvent({ outcome: 'SAVED', forUs: false, keeperPlayerId: 'gk1', clientEventId: 'evt-1' }));
      expect(first).toEqual({ ok: false, reason: 'PARTIAL_WRITE' });

      const retry = await invoke(createEvent({ outcome: 'SAVED', forUs: false, keeperPlayerId: 'gk1', clientEventId: 'evt-1' }));
      expect(retry).toEqual({ ok: true, reason: null });
      expect(mockShotCreate).toHaveBeenCalledTimes(1);
      expect(mockSaveCreate).toHaveBeenCalledTimes(2);
    });

    it('i4: the resumed write reuses the ORIGINAL gameId/timestamp/gameSeconds, not freshly-derived ones', async () => {
      mockHappyPathSend();
      mockGoalCreate.mockRejectedValueOnce(new Error('AppSync error'));

      await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));
      const originalShotCall = mockShotCreate.mock.calls[0]?.[0] as { gameId: string; timestamp: string; gameSeconds: number };

      // Advance real time a little so a freshly-derived timestamp would
      // differ from the original if the resume path re-derived it.
      await new Promise((resolve) => setTimeout(resolve, 5));

      await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));
      const resumedGoalCall = mockGoalCreate.mock.calls[1]?.[0] as { gameId: string; timestamp: string; gameSeconds: number };

      expect(resumedGoalCall.gameId).toBe(originalShotCall.gameId);
      expect(resumedGoalCall.timestamp).toBe(originalShotCall.timestamp);
      expect(resumedGoalCall.gameSeconds).toBe(originalShotCall.gameSeconds);
    });

    it('A1: if the post-Shot "shot-written" status update itself throws, the row is still not released', async () => {
      mockHappyPathSend();
      const key = JSON.stringify({ limiterKey: 'dedup#evt-1', minuteBucket: 'dedup' });

      mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
        const table = command.input.TableName as string;
        if (command.__type === 'GetCommand' && table === 'ShareLinkTable') {
          return { Item: { token: 'tok-1', teamId: 'team-1', type: 'STAT_TRACKER' } };
        }
        if (command.__type === 'GetCommand' && table === 'TeamTable') {
          return { Item: teamStore.get('team-1') };
        }
        if (command.__type === 'GetCommand' && table === 'FanViewRateLimitTable') {
          const k = JSON.stringify((command.input as { Key: unknown }).Key);
          const existing = dedupStore.get(k);
          return existing ? { Item: existing } : {};
        }
        if (command.__type === 'QueryCommand' && table === 'GameTable') {
          return { Items: [LIVE_GAME_ROW] };
        }
        if (command.__type === 'QueryCommand' && table === 'TeamRosterTable') {
          return { Items: [{ playerId: 'p1' }] };
        }
        if (command.__type === 'PutCommand' && table === 'FanViewRateLimitTable') {
          const item = (command.input as { Item: { limiterKey: string; minuteBucket: string } }).Item;
          const k = JSON.stringify({ limiterKey: item.limiterKey, minuteBucket: item.minuteBucket });
          if (dedupStore.has(k)) throw conditionalCheckFailedError();
          dedupStore.set(k, { status: 'pending' });
          return {};
        }
        if (command.__type === 'UpdateCommand' && table === 'FanViewRateLimitTable') {
          const input = command.input as { UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
          const values = input.ExpressionAttributeValues ?? {};
          if (input.UpdateExpression === 'SET writeContext = :writeContext') {
            const existing = dedupStore.get(key) ?? { status: 'pending' };
            dedupStore.set(key, { ...existing, writeContext: values[':writeContext'] });
            return {};
          }
          if (values[':status'] === 'shot-written') {
            throw new Error('DynamoDB unavailable');
          }
          return {};
        }
        return {};
      });

      await expect(
        invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' })),
      ).rejects.toThrow('DynamoDB unavailable');

      // The row must still exist (never released) even though the
      // status-transition update itself threw -- the Shot write already
      // succeeded, so A1's invariant forbids releasing it.
      expect(dedupStore.has(key)).toBe(true);
      expect(mockShotCreate).toHaveBeenCalledTimes(1);
    });

    it('performFirstAttemptWrite: if persistWriteContext itself throws before any write, the dedup row is released rather than left stuck at pending', async () => {
      mockHappyPathSend();
      const baseImpl = mockSend.getMockImplementation()!;
      mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
        const table = command.input.TableName as string;
        if (command.__type === 'UpdateCommand' && table === 'FanViewRateLimitTable') {
          const input = command.input as { UpdateExpression?: string };
          if (input.UpdateExpression === 'SET writeContext = :writeContext') {
            throw new Error('DynamoDB unavailable');
          }
        }
        return baseImpl(command);
      });

      await expect(
        invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' })),
      ).rejects.toThrow('DynamoDB unavailable');

      // No progress was made at all (not even the Shot write) -- the row
      // must be released, not left stranded at 'pending' until TTL.
      expect(dedupStore.size).toBe(0);
      expect(mockShotCreate).not.toHaveBeenCalled();
    });

    it('performResumeWrite: if the fresh TeamTable re-read (A4) throws, the row reverts to shot-written rather than being stranded at resuming', async () => {
      mockHappyPathSend();
      mockGoalCreate.mockRejectedValueOnce(new Error('first failure'));
      await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));

      const key = JSON.stringify({ limiterKey: 'dedup#evt-1', minuteBucket: 'dedup' });
      expect(dedupStore.get(key)?.status).toBe('shot-written');

      // Make the resume path's fresh TeamTable re-read fail. The resume
      // path (claim.kind === 'resume') never re-runs validateAndDerive, so
      // this is the ONLY TeamTable GetCommand this second invocation issues.
      const baseImpl = mockSend.getMockImplementation()!;
      mockSend.mockImplementation(async (command: { __type: string; input: Record<string, unknown> }) => {
        const table = command.input.TableName as string;
        if (command.__type === 'GetCommand' && table === 'TeamTable') {
          throw new Error('DynamoDB unavailable');
        }
        return baseImpl(command);
      });

      const result = await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));
      expect(result).toEqual({ ok: false, reason: 'PARTIAL_WRITE' });

      // Reverted to 'shot-written', not stranded at 'resuming' forever --
      // a later resume can still retry it.
      expect(dedupStore.get(key)?.status).toBe('shot-written');
      expect(mockGoalCreate).toHaveBeenCalledTimes(1);
    });

    it('A2: a resume attempt against a row already mid-resume (status "resuming") gets concurrent-duplicate, never a duplicate write', async () => {
      mockHappyPathSend();
      mockGoalCreate.mockRejectedValueOnce(new Error('AppSync error'));
      await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));

      const key = JSON.stringify({ limiterKey: 'dedup#evt-1', minuteBucket: 'dedup' });
      const shotWrittenRow = dedupStore.get(key)!;
      expect(shotWrittenRow.status).toBe('shot-written');

      // Simulate another invocation's resume having already atomically
      // re-claimed the row (shot-written -> resuming, A2's conditional
      // UpdateCommand) moments ago and still being in flight.
      dedupStore.set(key, { ...shotWrittenRow, status: 'resuming' });

      const result = await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));
      expect(result).toEqual({ ok: false, reason: 'RATE_LIMITED' });
      // Only the original (failed) attempt ever called Goal.create -- this
      // invocation backed off before attempting anything.
      expect(mockGoalCreate).toHaveBeenCalledTimes(1);
      expect(mockShotCreate).toHaveBeenCalledTimes(1);
    });

    it('A3: a resume whose request arguments differ from the original writes the PERSISTED writeContext values, not the new request\'s', async () => {
      mockHappyPathSend();
      mockGoalCreate.mockRejectedValueOnce(new Error('AppSync error'));

      await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', assistPlayerId: 'p2', clientEventId: 'evt-1' }));
      expect(mockGoalCreate).toHaveBeenCalledTimes(1);

      // The "retry" arrives with completely different arguments -- these
      // must be ignored entirely; only clientEventId is used to locate the
      // row, and the persisted p1/p2 attribution must be what gets written.
      const retry = await invoke(createEvent({
        outcome: 'BLOCKED', forUs: false, playerId: undefined, assistPlayerId: undefined, keeperPlayerId: 'gk1',
        clientEventId: 'evt-1',
      }));
      expect(retry).toEqual({ ok: true, reason: null });
      expect(mockGoalCreate).toHaveBeenCalledTimes(2);
      const resumedCall = mockGoalCreate.mock.calls[1]?.[0] as { scoredByUs: boolean; scorerId: string; assistId: string };
      expect(resumedCall.scoredByUs).toBe(true);
      expect(resumedCall.scorerId).toBe('p1');
      expect(resumedCall.assistId).toBe('p2');
    });

    it('A4: a resume re-reads coaches fresh -- a coach added to the team between the original attempt and the resume ends up in the resumed write', async () => {
      mockHappyPathSend();
      mockGoalCreate.mockRejectedValueOnce(new Error('AppSync error'));

      await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));
      expect(mockGoalCreate).toHaveBeenCalledWith(expect.objectContaining({ coaches: ['coach-1', 'coach-2'] }));

      // A co-coach accepts an invitation between the partial failure and the resume.
      teamStore.set('team-1', { id: 'team-1', coaches: ['coach-1', 'coach-2', 'coach-3'] });

      const retry = await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));
      expect(retry).toEqual({ ok: true, reason: null });
      expect(mockGoalCreate).toHaveBeenLastCalledWith(expect.objectContaining({ coaches: ['coach-1', 'coach-2', 'coach-3'] }));
    });

    it('a resumed write that fails again reverts to shot-written (still resumable), not stranded at resuming', async () => {
      mockHappyPathSend();
      mockGoalCreate.mockRejectedValueOnce(new Error('first failure'));
      await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));

      mockGoalCreate.mockRejectedValueOnce(new Error('second failure'));
      const secondAttempt = await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));
      expect(secondAttempt).toEqual({ ok: false, reason: 'PARTIAL_WRITE' });

      const key = JSON.stringify({ limiterKey: 'dedup#evt-1', minuteBucket: 'dedup' });
      expect(dedupStore.get(key)?.status).toBe('shot-written');

      const thirdAttempt = await invoke(createEvent({ outcome: 'GOAL', forUs: true, playerId: 'p1', clientEventId: 'evt-1' }));
      expect(thirdAttempt).toEqual({ ok: true, reason: null });
      expect(mockShotCreate).toHaveBeenCalledTimes(1);
    });
  });
});
