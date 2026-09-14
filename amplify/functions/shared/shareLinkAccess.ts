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
  | { ok: true; shareLink: ShareLinkRecord; team: TeamRecord; selection: GameSelectionResult };

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
 */
export async function checkRateLimits(
  docClient: DynamoDBDocumentClient,
  rateLimitTable: string,
  identityId: string | undefined,
  token: string,
  now: Date,
): Promise<boolean> {
  if (!identityId) {
    return false;
  }

  // Sequential, not Promise.all: the per-token counter is a billing
  // circuit-breaker shared by every viewer of one link, so it must not keep
  // incrementing once a single caller has already failed the per-identity
  // check — otherwise a caller who knows they're over their own limit can
  // keep hammering the shared token counter and exhaust the whole team's
  // budget for every legitimate fan, for free.
  const perIdentityOk = await checkAndIncrementRateLimit(
    docClient, rateLimitTable, `identity#${identityId}`, PER_IDENTITY_RATE_LIMIT, now,
  );
  if (!perIdentityOk) {
    return false;
  }

  return checkAndIncrementRateLimit(docClient, rateLimitTable, `token#${token}`, PER_TOKEN_RATE_LIMIT, now);
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

  const live = games.find((g) => g.status === 'in-progress' || g.status === 'halftime');
  if (live) {
    return { branch: 'LIVE', game: live };
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

  const future = games
    .filter((g) => {
      if (!g.gameDate) return false;
      const gameMs = new Date(g.gameDate).getTime();
      return !Number.isNaN(gameMs) && gameMs > nowMs;
    })
    .sort((a, b) => new Date(a.gameDate as string).getTime() - new Date(b.gameDate as string).getTime());

  if (future.length > 0) {
    return { branch: 'NEXT_GAME', game: future[0] };
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
): Promise<ShareLinkAccessOutcome> {
  const validated = await validateShareLinkAndTeam(docClient, tables.shareLink, tables.team, token, type);
  if (!validated.ok) {
    return validated;
  }

  const withinLimits = await checkRateLimits(docClient, tables.rateLimit, identityId, token, now);
  if (!withinLimits) {
    return { ok: false, reason: 'RATE_LIMITED' };
  }

  const games = await queryAllGamesByTeamId(docClient, tables.game, validated.team.id);
  const selection = selectGameForFan(games, now);

  return { ok: true, shareLink: validated.shareLink, team: validated.team, selection };
}
