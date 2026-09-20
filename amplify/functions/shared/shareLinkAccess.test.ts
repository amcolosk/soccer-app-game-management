import { describe, expect, it, vi } from 'vitest';
import {
  checkAndIncrementRateLimit,
  checkRateLimits,
  getShareLinkByToken,
  PER_IDENTITY_WRITE_RATE_LIMIT,
  PER_TOKEN_WRITE_RATE_LIMIT,
  queryAllGamesByTeamId,
  resolveShareLinkAccess,
  selectGameForFan,
  validateShareLinkAndTeam,
  type GameRecord,
  type ShareLinkAccessTables,
} from './shareLinkAccess';

type FakeDocClient = Parameters<typeof getShareLinkByToken>[0];

function conditionalCheckFailedError(): Error {
  const error = new Error('ConditionalCheckFailedException') as Error & { name: string };
  error.name = 'ConditionalCheckFailedException';
  return error;
}

function makeDocClient(impl: (command: { __type?: string; input?: Record<string, unknown> }) => unknown): FakeDocClient {
  return { send: vi.fn(async (command: unknown) => impl(command as { __type?: string; input?: Record<string, unknown> })) } as unknown as FakeDocClient;
}

describe('getShareLinkByToken', () => {
  it('returns the item when found', async () => {
    const docClient = makeDocClient(() => ({ Item: { token: 't1', teamId: 'team-1' } }));
    const result = await getShareLinkByToken(docClient, 'ShareLinkTable', 't1');
    expect(result).toEqual({ token: 't1', teamId: 'team-1' });
  });

  it('returns null when not found', async () => {
    const docClient = makeDocClient(() => ({}));
    const result = await getShareLinkByToken(docClient, 'ShareLinkTable', 'missing');
    expect(result).toBeNull();
  });
});

describe('validateShareLinkAndTeam', () => {
  it('rejects an empty/garbage token without hitting the table', async () => {
    const send = vi.fn();
    const docClient = { send } as unknown as FakeDocClient;
    const result = await validateShareLinkAndTeam(docClient, 'ShareLinkTable', 'TeamTable', '', 'FAN');
    expect(result).toEqual({ ok: false, reason: 'INVALID_LINK' });
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects a token that does not resolve to any row', async () => {
    const docClient = makeDocClient(() => ({}));
    const result = await validateShareLinkAndTeam(docClient, 'ShareLinkTable', 'TeamTable', 'missing', 'FAN');
    expect(result).toEqual({ ok: false, reason: 'INVALID_LINK' });
  });

  it('rejects a revoked token', async () => {
    const docClient = makeDocClient((cmd) => {
      if (cmd.input?.TableName === 'ShareLinkTable') {
        return { Item: { token: 't1', teamId: 'team-1', type: 'FAN', revokedAt: '2026-01-01T00:00:00.000Z' } };
      }
      return { Item: { id: 'team-1' } };
    });
    const result = await validateShareLinkAndTeam(docClient, 'ShareLinkTable', 'TeamTable', 't1', 'FAN');
    expect(result).toEqual({ ok: false, reason: 'INVALID_LINK' });
  });

  it('rejects a token whose type does not match the expected link type', async () => {
    const docClient = makeDocClient((cmd) => {
      if (cmd.input?.TableName === 'ShareLinkTable') {
        return { Item: { token: 't1', teamId: 'team-1', type: 'STAT_TRACKER' } };
      }
      return { Item: { id: 'team-1' } };
    });
    const result = await validateShareLinkAndTeam(docClient, 'ShareLinkTable', 'TeamTable', 't1', 'FAN');
    expect(result).toEqual({ ok: false, reason: 'INVALID_LINK' });
  });

  it('rejects when the token resolves but the team no longer exists', async () => {
    const docClient = makeDocClient((cmd) => {
      if (cmd.input?.TableName === 'ShareLinkTable') {
        return { Item: { token: 't1', teamId: 'team-1', type: 'FAN' } };
      }
      return {};
    });
    const result = await validateShareLinkAndTeam(docClient, 'ShareLinkTable', 'TeamTable', 't1', 'FAN');
    expect(result).toEqual({ ok: false, reason: 'INVALID_LINK' });
  });

  it('resolves a valid, active, correctly-typed token to its team', async () => {
    const docClient = makeDocClient((cmd) => {
      if (cmd.input?.TableName === 'ShareLinkTable') {
        return { Item: { token: 't1', teamId: 'team-1', type: 'FAN', createdBy: 'coach-1', issuedAt: '2026-01-01T00:00:00.000Z' } };
      }
      return { Item: { id: 'team-1', name: 'Eagles', coaches: ['coach-1'] } };
    });
    const result = await validateShareLinkAndTeam(docClient, 'ShareLinkTable', 'TeamTable', 't1', 'FAN');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.team).toEqual({ id: 'team-1', name: 'Eagles', coaches: ['coach-1'] });
    }
  });

  it('rejects a token belonging to an archived team (defense-in-depth alongside archive-team\'s revoke sweep)', async () => {
    const docClient = makeDocClient((cmd) => {
      if (cmd.input?.TableName === 'ShareLinkTable') {
        return { Item: { token: 't1', teamId: 'team-1', type: 'FAN' } };
      }
      return { Item: { id: 'team-1', name: 'Eagles', status: 'archived', coaches: ['coach-1'] } };
    });
    const result = await validateShareLinkAndTeam(docClient, 'ShareLinkTable', 'TeamTable', 't1', 'FAN');
    expect(result).toEqual({ ok: false, reason: 'INVALID_LINK' });
  });
});

describe('checkAndIncrementRateLimit', () => {
  it('allows the request and increments the counter under the ceiling', async () => {
    const docClient = makeDocClient(() => ({}));
    const now = new Date('2026-09-06T18:32:10.000Z');
    const allowed = await checkAndIncrementRateLimit(docClient, 'RateLimitTable', 'identity#abc', 30, now);
    expect(allowed).toBe(true);
  });

  it('rejects the request when the conditional check fails (over ceiling)', async () => {
    const docClient = makeDocClient(() => {
      throw conditionalCheckFailedError();
    });
    const now = new Date('2026-09-06T18:32:10.000Z');
    const allowed = await checkAndIncrementRateLimit(docClient, 'RateLimitTable', 'token#t1', 600, now);
    expect(allowed).toBe(false);
  });

  it('rethrows non-conditional-check errors', async () => {
    const docClient = makeDocClient(() => {
      throw new Error('network blip');
    });
    await expect(
      checkAndIncrementRateLimit(docClient, 'RateLimitTable', 'token#t1', 600, new Date()),
    ).rejects.toThrow('network blip');
  });
});

describe('checkRateLimits', () => {
  it('checks both dimensions independently and passes when both are under ceiling', async () => {
    const keysHit: string[] = [];
    const docClient = makeDocClient((cmd) => {
      keysHit.push((cmd.input?.Key as { limiterKey: string })?.limiterKey);
      return {};
    });
    const ok = await checkRateLimits(docClient, 'RateLimitTable', 'guest-identity-1', 'token-1', new Date());
    expect(ok).toBe(true);
    expect(keysHit).toEqual(expect.arrayContaining(['identity#guest-identity-1', 'token#token-1']));
  });

  it('fails when the per-identity dimension is over its (lower) ceiling even if per-token is fine', async () => {
    const docClient = makeDocClient((cmd) => {
      const key = (cmd.input?.Key as { limiterKey: string })?.limiterKey;
      if (key === 'identity#guest-identity-1') {
        throw conditionalCheckFailedError();
      }
      return {};
    });
    const ok = await checkRateLimits(docClient, 'RateLimitTable', 'guest-identity-1', 'token-1', new Date());
    expect(ok).toBe(false);
  });

  it('fails when identityId is missing entirely, without hitting the table', async () => {
    const send = vi.fn();
    const docClient = { send } as unknown as FakeDocClient;
    const ok = await checkRateLimits(docClient, 'RateLimitTable', undefined, 'token-1', new Date());
    expect(ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('never increments the per-token counter once the per-identity check has already failed', async () => {
    // Regression guard: the per-token ceiling is a shared billing
    // circuit-breaker, not a per-caller limit — if it kept incrementing
    // after an over-limit caller was already rejected, that caller could
    // cheaply exhaust the whole team's budget for every legitimate fan.
    const keysHit: string[] = [];
    const docClient = makeDocClient((cmd) => {
      const key = (cmd.input?.Key as { limiterKey: string })?.limiterKey;
      keysHit.push(key);
      if (key === 'identity#guest-identity-1') {
        throw conditionalCheckFailedError();
      }
      return {};
    });
    const ok = await checkRateLimits(docClient, 'RateLimitTable', 'guest-identity-1', 'token-1', new Date());
    expect(ok).toBe(false);
    expect(keysHit).toEqual(['identity#guest-identity-1']);
  });
});

describe('checkRateLimits — dimension parameter (Milestone B2)', () => {
  it('defaults to the read dimension, preserving the original unprefixed keys', async () => {
    const keysHit: string[] = [];
    const docClient = makeDocClient((cmd) => {
      keysHit.push((cmd.input?.Key as { limiterKey: string })?.limiterKey);
      return {};
    });
    const ok = await checkRateLimits(docClient, 'RateLimitTable', 'guest-identity-1', 'token-1', new Date());
    expect(ok).toBe(true);
    expect(keysHit).toEqual(['identity#guest-identity-1', 'token#token-1']);
  });

  it('write dimension uses write#-prefixed keys, distinct from the read dimension', async () => {
    const keysHit: string[] = [];
    const docClient = makeDocClient((cmd) => {
      keysHit.push((cmd.input?.Key as { limiterKey: string })?.limiterKey);
      return {};
    });
    const ok = await checkRateLimits(docClient, 'RateLimitTable', 'guest-identity-1', 'token-1', new Date(), 'write');
    expect(ok).toBe(true);
    expect(keysHit).toEqual(['write#identity#guest-identity-1', 'write#token#token-1']);
  });

  it('write dimension uses its own (tighter) ceilings, independent of the read ceilings', async () => {
    const ceilingsSeen: number[] = [];
    const docClient = makeDocClient((cmd) => {
      ceilingsSeen.push((cmd.input?.ExpressionAttributeValues as { ':ceiling': number })?.[':ceiling']);
      return {};
    });
    await checkRateLimits(docClient, 'RateLimitTable', 'guest-identity-1', 'token-1', new Date(), 'write');
    expect(ceilingsSeen).toEqual([PER_IDENTITY_WRITE_RATE_LIMIT, PER_TOKEN_WRITE_RATE_LIMIT]);
  });

  it("a helper's write taps and a fan's read polling never share a rate-limit bucket", async () => {
    const keysHit = new Set<string>();
    const docClient = makeDocClient((cmd) => {
      keysHit.add((cmd.input?.Key as { limiterKey: string })?.limiterKey);
      return {};
    });
    await checkRateLimits(docClient, 'RateLimitTable', 'shared-identity', 'shared-token', new Date(), 'read');
    await checkRateLimits(docClient, 'RateLimitTable', 'shared-identity', 'shared-token', new Date(), 'write');
    expect(keysHit).toEqual(new Set([
      'identity#shared-identity', 'token#shared-token',
      'write#identity#shared-identity', 'write#token#shared-token',
    ]));
  });
});

describe('queryAllGamesByTeamId', () => {
  it('queries the physical gamesByTeamId index and paginates', async () => {
    let call = 0;
    const docClient = makeDocClient(() => {
      call += 1;
      if (call === 1) {
        return { Items: [{ id: 'g1', teamId: 'team-1' }], LastEvaluatedKey: { id: 'g1' } };
      }
      return { Items: [{ id: 'g2', teamId: 'team-1' }] };
    });
    const games = await queryAllGamesByTeamId(docClient, 'GameTable', 'team-1');
    expect(games.map((g) => g.id)).toEqual(['g1', 'g2']);
  });
});

describe('selectGameForFan', () => {
  const now = new Date('2026-09-13T17:00:00.000Z');

  function game(overrides: Partial<GameRecord>): GameRecord {
    return { id: 'g', teamId: 'team-1', ...overrides };
  }

  it('branch 4a: NO_GAMES_YET when the team has never had a game', () => {
    expect(selectGameForFan([], now)).toEqual({ branch: 'NO_GAMES_YET', game: null });
  });

  it('branch 1: prefers a live (in-progress) game over anything else', () => {
    const live = game({ id: 'live', status: 'in-progress', gameDate: '2026-09-13T16:00:00.000Z' });
    const future = game({ id: 'future', status: 'scheduled', gameDate: '2026-09-20T16:00:00.000Z' });
    const result = selectGameForFan([future, live], now);
    expect(result.branch).toBe('LIVE');
    expect(result.game?.id).toBe('live');
  });

  it('branch 1: also treats halftime as live', () => {
    const halftime = game({ id: 'ht', status: 'halftime', gameDate: '2026-09-13T16:00:00.000Z' });
    const result = selectGameForFan([halftime], now);
    expect(result.branch).toBe('LIVE');
  });

  it('branch 2: a same-day-recent completed game is preferred over a future one (Calendar Feed Import regression)', () => {
    const justFinished = game({ id: 'finished', status: 'completed', gameDate: '2026-09-13T16:30:00.000Z' });
    const nextSaturday = game({ id: 'next', status: 'scheduled', gameDate: '2026-09-20T16:00:00.000Z' });
    const result = selectGameForFan([nextSaturday, justFinished], now);
    expect(result.branch).toBe('FINISHED');
    expect(result.game?.id).toBe('finished');
  });

  it('branch 2: picks the most recent within the recency window when multiple qualify', () => {
    const older = game({ id: 'older', status: 'completed', gameDate: '2026-09-13T10:00:00.000Z' });
    const newer = game({ id: 'newer', status: 'completed', gameDate: '2026-09-13T15:00:00.000Z' });
    const result = selectGameForFan([older, newer], now);
    expect(result.game?.id).toBe('newer');
  });

  it('branch 2: excludes a completed game outside the 12-hour recency window', () => {
    const staleFinished = game({ id: 'stale', status: 'completed', gameDate: '2026-09-12T12:00:00.000Z' }); // 29h ago
    const future = game({ id: 'future', status: 'scheduled', gameDate: '2026-09-20T16:00:00.000Z' });
    const result = selectGameForFan([staleFinished, future], now);
    expect(result.branch).toBe('NEXT_GAME');
    expect(result.game?.id).toBe('future');
  });

  it('branch 3: a future-only game renders as NEXT_GAME, not a "no game" state', () => {
    const future = game({ id: 'future', status: 'scheduled', gameDate: '2026-09-20T16:00:00.000Z' });
    const result = selectGameForFan([future], now);
    expect(result.branch).toBe('NEXT_GAME');
  });

  it('branch 3: picks the soonest of multiple future games', () => {
    const soon = game({ id: 'soon', status: 'scheduled', gameDate: '2026-09-15T16:00:00.000Z' });
    const later = game({ id: 'later', status: 'scheduled', gameDate: '2026-09-20T16:00:00.000Z' });
    const result = selectGameForFan([later, soon], now);
    expect(result.game?.id).toBe('soon');
  });

  it('branch 4b: NO_GAME_RIGHT_NOW when games exist but none is recent/live/upcoming (bye week)', () => {
    const staleFinished = game({ id: 'stale', status: 'completed', gameDate: '2026-08-01T16:00:00.000Z' });
    const result = selectGameForFan([staleFinished], now);
    expect(result.branch).toBe('NO_GAME_RIGHT_NOW');
    expect(result.game).toBeNull();
  });

  it('treats a dateless in-progress game as live rather than invisible', () => {
    const dateless = game({ id: 'dateless', status: 'in-progress', gameDate: null });
    const result = selectGameForFan([dateless], now);
    expect(result.branch).toBe('LIVE');
  });

  describe('Milestone B2: corrected multi-live-candidate tiebreak (rank on updatedAt alone)', () => {
    it('ranks on updatedAt alone: a candidate with a newer updatedAt wins even with an older/absent lastStartTime', () => {
      const abandoned = game({
        id: 'abandoned',
        status: 'in-progress',
        gameDate: '2026-08-01T16:00:00.000Z', // has a date -- an old, never-completed game
        lastStartTime: '2026-08-01T16:05:00.000Z', // stale but non-null
        updatedAt: '2026-08-01T16:05:00.000Z',
      });
      const actuallyLive = game({
        id: 'actually-live',
        status: 'in-progress',
        gameDate: null, // no date -- exactly the case B1's own index design accommodates
        lastStartTime: '2026-09-13T16:45:00.000Z',
        updatedAt: '2026-09-13T16:59:00.000Z',
      });
      const result = selectGameForFan([abandoned, actuallyLive], now);
      expect(result.branch).toBe('LIVE');
      expect(result.game?.id).toBe('actually-live');
    });

    it('an abandoned in-progress game with a stale updatedAt loses to today\'s real game while it is actively running (lastStartTime set on both)', () => {
      const abandoned = game({
        id: 'abandoned',
        status: 'in-progress',
        lastStartTime: '2026-08-01T16:00:00.000Z', // old but non-null -- would have won the
        updatedAt: '2026-08-01T16:00:00.000Z',      // rejected lastStartTime-ranking attempt
      });
      const todaysRunningGame = game({
        id: 'todays-game',
        status: 'in-progress',
        lastStartTime: '2026-09-13T16:45:00.000Z',
        updatedAt: '2026-09-13T16:59:00.000Z',
      });
      const result = selectGameForFan([abandoned, todaysRunningGame], now);
      expect(result.branch).toBe('LIVE');
      expect(result.game?.id).toBe('todays-game');
    });

    it('an abandoned in-progress game with a stale updatedAt loses to today\'s real game while it is PAUSED (lastStartTime null on the real game)', () => {
      const abandoned = game({
        id: 'abandoned',
        status: 'in-progress',
        lastStartTime: '2026-08-01T16:00:00.000Z', // stale non-null -- exactly what the
        updatedAt: '2026-08-01T16:00:00.000Z',      // rejected lastStartTime-ranking attempt got backwards
      });
      const todaysPausedGame = game({
        id: 'todays-game',
        status: 'in-progress',
        lastStartTime: null, // paused -- handlePauseTimer nulls this while status stays in-progress
        updatedAt: '2026-09-13T16:59:00.000Z',
      });
      const result = selectGameForFan([abandoned, todaysPausedGame], now);
      expect(result.branch).toBe('LIVE');
      expect(result.game?.id).toBe('todays-game');
    });

    it('an abandoned in-progress game with a stale updatedAt loses to today\'s real game while it is at HALFTIME (lastStartTime null, status halftime)', () => {
      const abandoned = game({
        id: 'abandoned',
        status: 'in-progress',
        lastStartTime: '2026-08-01T16:00:00.000Z',
        updatedAt: '2026-08-01T16:00:00.000Z',
      });
      const todaysHalftimeGame = game({
        id: 'todays-game',
        status: 'halftime',
        lastStartTime: null,
        updatedAt: '2026-09-13T16:59:00.000Z',
      });
      const result = selectGameForFan([abandoned, todaysHalftimeGame], now);
      expect(result.branch).toBe('LIVE');
      expect(result.game?.id).toBe('todays-game');
    });

    it('never lets gameDate or lastStartTime alone decide between two live candidates with equal/absent updatedAt', () => {
      // Same updatedAt (both absent) on both candidates -- there is no real
      // signal left to rank on, so the sort is stable (input-order-
      // preserving) rather than picking by gameDate or lastStartTime. Proven
      // by holding array position fixed and swapping ONLY which one has a
      // gameDate/lastStartTime: the winner (first position) must not change.
      const withDate = game({ id: 'first', status: 'in-progress', gameDate: '2026-09-13T16:00:00.000Z', lastStartTime: '2026-09-13T16:00:00.000Z', updatedAt: null });
      const withoutDate = game({ id: 'second', status: 'in-progress', gameDate: null, lastStartTime: null, updatedAt: null });
      const result = selectGameForFan([withDate, withoutDate], now);
      expect(result.branch).toBe('LIVE');
      expect(result.game?.id).toBe('first');

      // Swap which candidate has the gameDate/lastStartTime, keep array
      // position fixed -- a gameDate- or lastStartTime-based tiebreak would
      // flip the winner to 'second' here; the corrected fix still picks
      // 'first' (position-stable, blind to both).
      const firstNowBare = game({ id: 'first', status: 'in-progress', gameDate: null, lastStartTime: null, updatedAt: null });
      const secondNowRich = game({ id: 'second', status: 'in-progress', gameDate: '2026-09-13T16:00:00.000Z', lastStartTime: '2026-09-13T16:00:00.000Z', updatedAt: null });
      const result2 = selectGameForFan([firstNowBare, secondNowRich], now);
      expect(result2.game?.id).toBe('first');
    });
  });
});

describe('resolveShareLinkAccess', () => {
  const tables: ShareLinkAccessTables = {
    shareLink: 'ShareLinkTable',
    team: 'TeamTable',
    game: 'GameTable',
    rateLimit: 'FanViewRateLimitTable',
  };
  const now = new Date('2026-09-13T17:00:00.000Z');

  it('rejects INVALID_LINK before ever checking rate limits or querying games', async () => {
    const send = vi.fn(async (command: unknown) => {
      const cmd = command as { input?: Record<string, unknown> };
      if (cmd.input?.TableName === 'ShareLinkTable') return {};
      throw new Error('should not be called');
    });
    const docClient = { send } as unknown as FakeDocClient;

    const result = await resolveShareLinkAccess(docClient, tables, 'bad-token', 'FAN', 'identity-1', now);
    expect(result).toEqual({ ok: false, reason: 'INVALID_LINK' });
  });

  it('rejects RATE_LIMITED after a valid token but before querying games', async () => {
    let queriedGames = false;
    const docClient = makeDocClient((cmd) => {
      if (cmd.input?.TableName === 'ShareLinkTable') {
        return { Item: { token: 't1', teamId: 'team-1', type: 'FAN' } };
      }
      if (cmd.input?.TableName === 'TeamTable') {
        return { Item: { id: 'team-1', name: 'Eagles' } };
      }
      if (cmd.input?.TableName === 'FanViewRateLimitTable') {
        throw conditionalCheckFailedError();
      }
      if (cmd.input?.TableName === 'GameTable') {
        queriedGames = true;
        return { Items: [] };
      }
      return {};
    });

    const result = await resolveShareLinkAccess(docClient, tables, 't1', 'FAN', 'identity-1', now);
    expect(result).toEqual({ ok: false, reason: 'RATE_LIMITED' });
    expect(queriedGames).toBe(false);
  });

  it('returns the resolved team and game selection on success', async () => {
    const docClient = makeDocClient((cmd) => {
      if (cmd.input?.TableName === 'ShareLinkTable') {
        return { Item: { token: 't1', teamId: 'team-1', type: 'FAN' } };
      }
      if (cmd.input?.TableName === 'TeamTable') {
        return { Item: { id: 'team-1', name: 'Eagles' } };
      }
      if (cmd.input?.TableName === 'FanViewRateLimitTable') {
        return {};
      }
      if (cmd.input?.TableName === 'GameTable') {
        return { Items: [{ id: 'g1', teamId: 'team-1', status: 'in-progress', gameDate: '2026-09-13T16:00:00.000Z' }] };
      }
      return {};
    });

    const result = await resolveShareLinkAccess(docClient, tables, 't1', 'FAN', 'identity-1', now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.team.id).toBe('team-1');
      expect(result.selection.branch).toBe('LIVE');
      expect(result.selection.game?.id).toBe('g1');
    }
  });
});
