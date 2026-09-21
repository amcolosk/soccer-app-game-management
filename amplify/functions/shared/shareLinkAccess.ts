import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { isConditionalCheckFailed } from './coachArraySync';

/**
 * Shared token → team → validity → rate-limit → current-game-selection
 * pipeline for every guest-exposed "share link" query (Milestone B1's
 * getFanGameView now; Milestone B2's getStatTrackerView composes this same
 * module later rather than copy-pasting it — see the plan's "Decision:
 * getFanGameView stays FAN-only" section). Parameterized by link `type` so
 * both consumers get an identically-enforced security boundary.
 *
 * Same in-repo shape as coachArraySync.ts: generic, reusable primitives, no
 * handler-specific business logic beyond the 4-branch game-selection
 * algorithm itself (which IS the one piece of real business logic here, per
 * the plan — kept here, not duplicated per-handler).
 */

export type ShareLinkType = 'FAN' | 'STAT_TRACKER';

export interface ShareLinkRecord {
  token: string;
  teamId: string;
  type?: ShareLinkType | string | null;
  createdBy: string;
  issuedAt: string;
  revokedAt?: string | null;
}

export interface TeamRecord {
  id: string;
  name?: string;
  status?: string;
  coaches?: string[];
}

export interface GameRecord {
  id: string;
  teamId: string;
  opponent?: string | null;
  isHome?: boolean | null;
  gameDate?: string | null;
  status?: string | null;
  currentHalf?: number | null;
  elapsedSeconds?: number | null;
  lastStartTime?: string | null;
  halfLengthMinutes?: number | null;
  ourScore?: number | null;
  opponentScore?: number | null;
  locationName?: string | null;
  // Added for Milestone B2's corrected live-game tiebreak (see
  // selectGameForFan below) — not read by B1's own payload shaping.
  updatedAt?: string | null;
}

// A same-day-recent completed/live game is preferred over a future one, and
// a future-only game renders as "next game" rather than "no game yet" — see
// the plan's corrected 4-branch algorithm. 12 hours is generous enough to
// cover a late-running game or a same-day doubleheader.
export const RECENCY_WINDOW_MS = 12 * 60 * 60 * 1000;

// Per-identity ceiling: generous for one viewer's own 10-15s polling cadence.
export const PER_IDENTITY_RATE_LIMIT = 30;
// Per-token ceiling: a billing circuit-breaker, not a UX throttle — sized so
// a popular game with dozens of simultaneous viewers never approaches it.
export const PER_TOKEN_RATE_LIMIT = 600;

// Milestone B2 write-path ceilings — a helper's rapid tapping and their own
// passive polling get separate budgets from every read-only fan watching the
// same team (see `dimension` below), tighter than the read ceilings above
// since a helper's actual tapping rate is much lower than a fan's polling
// rate.
export const PER_IDENTITY_WRITE_RATE_LIMIT = 20;
export const PER_TOKEN_WRITE_RATE_LIMIT = 400;

export type RateLimitDimension = 'read' | 'write';

export type GameSelectionBranch =
  | 'LIVE'
  | 'FINISHED'
  | 'NEXT_GAME'
  | 'NO_GAMES_YET'
  | 'NO_GAME_RIGHT_NOW';

export interface GameSelectionResult {
  branch: GameSelectionBranch;
  game: GameRecord | null;
}

export type AccessRejectionReason = 'INVALID_LINK' | 'RATE_LIMITED';

export type ShareLinkAccessOutcome =
  | { ok: false; reason: AccessRejectionReason }
  | {
      ok: true;
      shareLink: ShareLinkRecord;
      team: TeamRecord;
      selection: GameSelectionResult;
      // The full per-team game list `selectGameForFan` chose from --
      // exposed so a consumer (getStatTrackerView's upcoming-games list) can
      // derive its own view of the games the selection algorithm didn't
      // pick, without re-querying gamesByTeamId itself. get-fan-game-view
      // ignores this field, same additive-and-optional shape as every other
      // consumer-specific payload this module deliberately stays agnostic
      // to (see the module doc comment above).
      games: GameRecord[];
      // The exact `now` this outcome's selection was computed against --
      // exposed so a consumer deriving anything else time-sensitive from
      // `games` (e.g. getStatTrackerView's selectUpcomingGames call) uses
      // the same instant rather than a second, independently-read `Date`
      // that could disagree with `selection` at a millisecond boundary.
      now: Date;
    };

/** Token lookup — a missing row is indistinguishable from a garbage/never-existed token. */
export async function getShareLinkByToken(
  docClient: DynamoDBDocumentClient,
  shareLinkTable: string,
  token: string,
): Promise<ShareLinkRecord | null> {
  const response = await docClient.send(new GetCommand({
    TableName: shareLinkTable,
    Key: { token },
  }));
  return (response.Item as ShareLinkRecord | undefined) ?? null;
}

/**
 * Token → team validation. Revoked and wrong-`type` tokens are rejected
 * with the same generic INVALID_LINK reason as a missing/garbage token — a
 * fan can't act differently on the distinction either way (plan's explicit
 * frontend-state decision), so the backend doesn't leak the distinction.
 */
export async function validateShareLinkAndTeam(
  docClient: DynamoDBDocumentClient,
  shareLinkTable: string,
  teamTable: string,
  token: string,
  expectedType: ShareLinkType,
): Promise<{ ok: false; reason: 'INVALID_LINK' } | { ok: true; shareLink: ShareLinkRecord; team: TeamRecord }> {
  if (typeof token !== 'string' || token.trim().length === 0) {
    return { ok: false, reason: 'INVALID_LINK' };
  }

  const shareLink = await getShareLinkByToken(docClient, shareLinkTable, token);
  if (!shareLink) {
    return { ok: false, reason: 'INVALID_LINK' };
  }
  if (shareLink.revokedAt) {
    return { ok: false, reason: 'INVALID_LINK' };
  }
  if (shareLink.type !== expectedType) {
    return { ok: false, reason: 'INVALID_LINK' };
  }

  const teamResponse = await docClient.send(new GetCommand({
    TableName: teamTable,
    Key: { id: shareLink.teamId },
  }));
  const team = teamResponse.Item as TeamRecord | undefined;
  if (!team) {
    return { ok: false, reason: 'INVALID_LINK' };
  }
  // Defense-in-depth, not the primary control: archive-team's sweep already
  // revokes active ShareLinks when a team is archived. This catches the
  // window where that sweep hasn't run yet (or failed partway) rather than
  // leaving a link for an archived team serving data indefinitely.
  if (team.status === 'archived') {
    return { ok: false, reason: 'INVALID_LINK' };
  }

  return { ok: true, shareLink, team };
}

/**
 * Atomic check-and-increment against a single (limiterKey, minuteBucket)
 * row. Returns false (over ceiling) on a conditional-check failure rather
 * than throwing, so callers can distinguish "rate limited" from a real
 * infrastructure error.
 */
export async function checkAndIncrementRateLimit(
  docClient: DynamoDBDocumentClient,
  rateLimitTable: string,
  limiterKey: string,
  ceiling: number,
  now: Date,
): Promise<boolean> {
  // "YYYY-MM-DDTHH:MM" — one bucket per minute.
  const minuteBucket = now.toISOString().slice(0, 16);
  const ttl = Math.floor(now.getTime() / 1000) + 600; // ~10 min DynamoDB TTL

  try {
    await docClient.send(new UpdateCommand({
      TableName: rateLimitTable,
      Key: { limiterKey, minuteBucket },
      UpdateExpression: 'SET #count = if_not_exists(#count, :zero) + :one, #ttl = :ttl',
      ConditionExpression: 'attribute_not_exists(#count) OR #count < :ceiling',
      ExpressionAttributeNames: { '#count': 'count', '#ttl': 'ttl' },
      ExpressionAttributeValues: {
        ':zero': 0,
        ':one': 1,
        ':ttl': ttl,
        ':ceiling': ceiling,
      },
    }));
    return true;
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      return false;
    }
    throw error;
  }
}

/**
 * Both rate-limit dimensions, checked independently (per plan — "an actual
 * attacker can mint fresh guest identities trivially, so the per-token
 * number is the real abuse control, not the per-viewer one"). `identityId`
 * is required, not optional — an IAM-authorized AppSync resolver always
 * supplies `event.identity.cognitoIdentityId` for both the guest and
 * authenticated(identityPool) roles; a caller missing it entirely is
 * treated as failing the per-identity dimension rather than silently
 * skipped.
 *
 * `dimension` (Milestone B2) keeps a helper's write-tapping and their own
 * passive read-polling from cannibalizing the same budget as every other
 * fan watching the same team. Deliberately asymmetric key-prefixing, not
 * `${dimension}#identity#...`/`${dimension}#token#...` for both dimensions:
 * `'read'` (the default, B1's original and only dimension) keeps its
 * original unprefixed `identity#...`/`token#...` keys so get-fan-game-view's
 * existing call site AND its existing tests below need zero changes;
 * `'write'` (new, B2-only) gets its own `write#`-prefixed keys and tighter
 * ceilings so it never shares a bucket with the read dimension.
 */
export async function checkRateLimits(
  docClient: DynamoDBDocumentClient,
  rateLimitTable: string,
  identityId: string | undefined,
  token: string,
  now: Date,
  dimension: RateLimitDimension = 'read',
): Promise<boolean> {
  if (!identityId) {
    return false;
  }

  const isWrite = dimension === 'write';
  const identityKey = isWrite ? `write#identity#${identityId}` : `identity#${identityId}`;
  const tokenKey = isWrite ? `write#token#${token}` : `token#${token}`;
  const identityCeiling = isWrite ? PER_IDENTITY_WRITE_RATE_LIMIT : PER_IDENTITY_RATE_LIMIT;
  const tokenCeiling = isWrite ? PER_TOKEN_WRITE_RATE_LIMIT : PER_TOKEN_RATE_LIMIT;

  // Sequential, not Promise.all: the per-token counter is a billing
  // circuit-breaker shared by every viewer of one link, so it must not keep
  // incrementing once a single caller has already failed the per-identity
  // check — otherwise a caller who knows they're over their own limit can
  // keep hammering the shared token counter and exhaust the whole team's
  // budget for every legitimate fan, for free.
  const perIdentityOk = await checkAndIncrementRateLimit(docClient, rateLimitTable, identityKey, identityCeiling, now);
  if (!perIdentityOk) {
    return false;
  }

  return checkAndIncrementRateLimit(docClient, rateLimitTable, tokenKey, tokenCeiling, now);
}

// Query-by-physical-index-name variant for Game.teamId, following the exact
// same pattern (and physical-name derivation) documented in
// delete-game-safe/handler.ts for Goal/Shot/Save's gameId indexes:
// `${pluralize(modelName)}By${Upper(fieldName)}` — Game -> "gamesByTeamId".
// Paginated (nextToken looping) — a team's full game history shouldn't
// silently truncate.
export async function queryAllGamesByTeamId(
  docClient: DynamoDBDocumentClient,
  gameTable: string,
  teamId: string,
): Promise<GameRecord[]> {
  const results: GameRecord[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const response = await docClient.send(new QueryCommand({
      TableName: gameTable,
      IndexName: 'gamesByTeamId',
      KeyConditionExpression: 'teamId = :teamId',
      ExpressionAttributeValues: { ':teamId': teamId },
      ExclusiveStartKey: exclusiveStartKey,
    }));

    if (response.Items) {
      results.push(...(response.Items as GameRecord[]));
    }
    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return results;
}

// Default cap on how many upcoming games getStatTrackerView (and any future
// consumer) surfaces at once -- a helper opening the link days before a
// tournament weekend shouldn't be handed the team's entire remaining
// schedule.
export const UPCOMING_GAMES_LIMIT = 5;

/**
 * Every future-dated game for the team, soonest first, capped at `limit`.
 * `selectGameForFan`'s own NEXT_GAME branch below is defined as this same
 * list's head (`selectUpcomingGames(games, now, 1)[0]`) -- kept as one
 * filter/sort, not two copies that could silently drift apart on a future
 * edit to either.
 *
 * This is computed independently of which branch `selectGameForFan` picks
 * for the same `games`/`now`, so a non-empty result can coincide with LIVE,
 * NEXT_GAME, *or* FINISHED: FINISHED is chosen by branch 2's recency window,
 * which runs before branch 3's future-game filter is ever consulted, so a
 * just-finished game and a later scheduled one can both be true at once (a
 * tournament day is the common case). A caller wanting "what's coming up"
 * alongside a FINISHED result (the actually useful non-LIVE case -- "the
 * game just ended, what's next") gets it for free from this independence.
 * NO_GAME_RIGHT_NOW requires branch 3 (this same future filter) to have
 * been empty, and NO_GAMES_YET requires `games` itself to be empty, so both
 * will always get `[]`, correctly, because there genuinely is nothing
 * upcoming to show in either.
 */
export function selectUpcomingGames(games: GameRecord[], now: Date, limit: number = UPCOMING_GAMES_LIMIT): GameRecord[] {
  const nowMs = now.getTime();
  return games
    .filter((g) => {
      if (!g.gameDate) return false;
      const gameMs = new Date(g.gameDate).getTime();
      return !Number.isNaN(gameMs) && gameMs > nowMs;
    })
    .sort((a, b) => new Date(a.gameDate as string).getTime() - new Date(b.gameDate as string).getTime())
    .slice(0, limit);
}

/**
 * The corrected 4-branch game-selection algorithm (plan's own words):
 * 1. Any game `in-progress`/`halftime` (live now).
 * 2. Else, among games with `gameDate <= now`, the most recent one — ONLY
 *    within RECENCY_WINDOW_MS of `now` ("just finished").
 * 3. Else, among games with `gameDate > now`, the soonest one ("next game").
 * 4. Else — two distinct sub-states, not one shared string: `NO_GAMES_YET`
 *    (team has never had a game at all) vs. `NO_GAME_RIGHT_NOW` (games
 *    exist, but none upcoming or recent enough for branch 2 — e.g. a bye
 *    week). Branch on whether any game exists for the team at all, not just
 *    on reaching this fallback.
 *
 * A `max(gameDate)` fallback (the original, wrong draft) is rejected
 * deliberately: for any team using Calendar Feed Import, that would pick a
 * future scheduled game over today's just-finished one.
 */
export function selectGameForFan(games: GameRecord[], now: Date): GameSelectionResult {
  if (games.length === 0) {
    return { branch: 'NO_GAMES_YET', game: null };
  }

  // Milestone B2 correction: nothing in this app auto-completes a game, so a
  // team with one long-abandoned/never-completed game AND today's actual
  // live game can have TWO `in-progress`/`halftime` matches here. The
  // original `.find()` picked an arbitrary one of them per invocation — a
  // cosmetic wrong-scoreboard risk for B1's read-only Fan Mode, but a silent
  // data-corruption risk for B2's stat-tracker writes (a helper's taps could
  // land on last month's abandoned game with no way for anyone to notice).
  //
  // Rank on `updatedAt` alone, descending — NOT `gameDate`, and NOT
  // `lastStartTime` either (two prior attempts at this fix, both wrong, both
  // caught by review). `gameDate` is optional and routinely absent on
  // exactly the abandoned/quickly-created games this needs to disambiguate
  // (create-game-safe writes it as `null` when left blank). `lastStartTime`
  // is explicitly nulled by both a pause (`handlePauseTimer`) and the
  // halftime transition, while `status` stays a live candidate (`in-progress`
  // paused, or `halftime`) — so ranking "has a lastStartTime" above "doesn't"
  // puts a stale-but-non-null `lastStartTime` from an old abandoned game
  // ahead of today's real game the instant it's paused or at halftime, which
  // is a large fraction of real game time, not an edge case. `updatedAt` is
  // bumped by ANY write to the game record (start, pause, resume, halftime,
  // manual edit, periodic elapsedSeconds persistence), so it's the one
  // signal reliably recent on a game someone is actually interacting with
  // right now regardless of which live sub-state it's in, and reliably stale
  // on one nobody's touched in weeks. No secondary tiebreak field — resist
  // adding one back in "just in case," that's exactly how the previous two
  // attempts went wrong.
  const liveCandidates = games.filter((g) => g.status === 'in-progress' || g.status === 'halftime');
  if (liveCandidates.length > 0) {
    const rankValue = (iso: string | null | undefined): number | null => {
      if (!iso) return null;
      const ms = new Date(iso).getTime();
      return Number.isNaN(ms) ? null : ms;
    };
    const compareDescending = (a: number | null, b: number | null): number => {
      if (a !== null && b !== null) return b - a;
      if (a !== null) return -1; // a has a value, b doesn't -- a ranks first
      if (b !== null) return 1; // b has a value, a doesn't -- b ranks first
      return 0;
    };
    const sorted = [...liveCandidates].sort((a, b) => compareDescending(rankValue(a.updatedAt), rankValue(b.updatedAt)));
    return { branch: 'LIVE', game: sorted[0] };
  }

  const nowMs = now.getTime();

  const recentPast = games
    .filter((g) => {
      if (!g.gameDate) return false;
      const gameMs = new Date(g.gameDate).getTime();
      if (Number.isNaN(gameMs)) return false;
      return gameMs <= nowMs && nowMs - gameMs <= RECENCY_WINDOW_MS;
    })
    .sort((a, b) => new Date(b.gameDate as string).getTime() - new Date(a.gameDate as string).getTime());

  if (recentPast.length > 0) {
    return { branch: 'FINISHED', game: recentPast[0] };
  }

  // Same filter+sort as selectUpcomingGames above -- reused (not
  // reimplemented) so the two can't silently drift apart; NEXT_GAME's own
  // pick is just that list's soonest entry.
  const soonestUpcoming = selectUpcomingGames(games, now, 1)[0];

  if (soonestUpcoming) {
    return { branch: 'NEXT_GAME', game: soonestUpcoming };
  }

  return { branch: 'NO_GAME_RIGHT_NOW', game: null };
}

export interface ShareLinkAccessTables {
  shareLink: string;
  team: string;
  game: string;
  rateLimit: string;
}

/**
 * The full pipeline: token → team → validity → rate-limit → game-selection.
 * Returns a discriminated outcome the caller (get-fan-game-view now,
 * getStatTrackerView later) uses to build its own curated response payload
 * — this module deliberately stops at team+selection and does not shape any
 * consumer-specific view, since Fan Mode and the Stat Tracker need
 * meaningfully different payloads (see the plan's query-split decision).
 */
export async function resolveShareLinkAccess(
  docClient: DynamoDBDocumentClient,
  tables: ShareLinkAccessTables,
  token: string,
  type: ShareLinkType,
  identityId: string | undefined,
  now: Date = new Date(),
  dimension: RateLimitDimension = 'read',
): Promise<ShareLinkAccessOutcome> {
  const validated = await validateShareLinkAndTeam(docClient, tables.shareLink, tables.team, token, type);
  if (!validated.ok) {
    return validated;
  }

  const withinLimits = await checkRateLimits(docClient, tables.rateLimit, identityId, token, now, dimension);
  if (!withinLimits) {
    return { ok: false, reason: 'RATE_LIMITED' };
  }

  const games = await queryAllGamesByTeamId(docClient, tables.game, validated.team.id);
  const selection = selectGameForFan(games, now);

  return { ok: true, shareLink: validated.shareLink, team: validated.team, selection, games, now };
}
