import type { AppSyncIdentityIAM } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import type { Schema } from '../../data/resource';
import {
  resolveShareLinkAccess,
  type GameRecord,
  type ShareLinkAccessTables,
} from '../shared/shareLinkAccess';
import { isConditionalCheckFailed } from '../shared/coachArraySync';
import { computeCurrentGameSeconds } from '../shared/gameClock';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

type Handler = Schema['submitStatEvent']['functionHandler'];
type DataClient = ReturnType<typeof generateClient<Schema>>;

const VALID_EVENT_TYPES = ['GOAL', 'SHOT', 'SAVE'] as const;
type EventType = (typeof VALID_EVENT_TYPES)[number];

function isValidEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (VALID_EVENT_TYPES as readonly string[]).includes(value);
}

// Amplify Gen2 auto-creates a `teamId`-hash-key relationship GSI on
// TeamRoster named `gsi-Team.roster` -- same confirmed-physical-name
// pattern coachArraySync.ts documents and get-stat-tracker-view/handler.ts
// already uses for this same table.
const TEAM_ROSTER_INDEX = 'gsi-Team.roster';

// "Active roster" is pinned to TeamRoster.isActive (the roster-membership
// flag, not Player.isActive, a different concern) -- mirrors
// get-stat-tracker-view/handler.ts's queryActiveRosterByTeamId read-path
// filter, so a player the coach has removed from the active roster can't be
// attributed events on the write path either.
async function queryRosterPlayerIdsByTeamId(teamRosterTable: string, teamId: string): Promise<Set<string>> {
  const playerIds = new Set<string>();
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const response = await docClient.send(new QueryCommand({
      TableName: teamRosterTable,
      IndexName: TEAM_ROSTER_INDEX,
      KeyConditionExpression: 'teamId = :teamId',
      ExpressionAttributeValues: { ':teamId': teamId },
      ProjectionExpression: 'playerId, isActive',
      ExclusiveStartKey: exclusiveStartKey,
    }));
    (response.Items as Array<{ playerId: string; isActive?: boolean | null }> | undefined ?? [])
      .filter((row) => row.isActive !== false)
      .forEach((row) => playerIds.add(row.playerId));
    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);
  return playerIds;
}

// ── The AppSync-write mechanism (Milestone B2's validation spike, completed
// and live-verified against a real deployed sandbox — see the plan's
// "Validation spike — completed and conclusive" section). Every other
// Lambda in this repo writes via the raw DynamoDB SDK, which is correct for
// those since none of them need a live subscriber to see the write
// instantly. This one does: the coach's GameManagement.tsx screen is
// subscribed to Goal/Shot/Save via observeQuery, and a raw DynamoDB write
// will NOT fire that subscription (the same hazard already documented at
// src/components/Home.tsx:135-145). Configuring Amplify with the IAM
// resourceConfig/libraryOptions from getAmplifyDataClientConfig and calling
// generateClient({ authMode: 'iam' }) routes the write through AppSync's
// real resolver pipeline instead, which does fire the subscription.
//
// Cached across warm invocations (module-level singleton), configured once.
let dataClientPromise: Promise<DataClient> | null = null;
async function getDataClient(): Promise<DataClient> {
  if (!dataClientPromise) {
    dataClientPromise = (async () => {
      const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(
        process.env as unknown as Parameters<typeof getAmplifyDataClientConfig>[0],
      );
      Amplify.configure(resourceConfig, libraryOptions);
      return generateClient<Schema>({ authMode: 'iam' });
    })();
  }
  return dataClientPromise;
}

interface SubmitStatEventResult {
  ok: boolean;
  reason: string | null;
}

function rejected(reason: string): SubmitStatEventResult {
  return { ok: false, reason };
}

// `clientEventId` is unvalidated free-form client input that becomes part of
// a DynamoDB key below -- bound its length so a malformed value surfaces as
// a clean VALIDATION_FAILED rejection rather than an opaque DynamoDB error.
const MAX_CLIENT_EVENT_ID_LENGTH = 128;

// ── Idempotency for a retried submit ──────────────────────────────────────
// Reuses FanViewRateLimit's row shape (limiterKey/minuteBucket identifier),
// but NOT its minute-bucketed sort key -- a retry can legitimately land in
// the wall-clock minute AFTER the original attempt (a lost response plus a
// few seconds of user hesitation easily crosses a minute boundary), and a
// per-minute key would make that retry look like a brand-new event. Use a
// fixed, non-time-derived sort-key value instead, so every retry within the
// row's TTL hits the exact same item regardless of which minute it arrives.
const DEDUP_SORT_KEY = 'dedup';
const DEDUP_TTL_SECONDS = 600; // ~10 min, matching FanViewRateLimit's existing TTL convention.

type DedupClaimOutcome = 'claimed' | 'already-succeeded' | 'concurrent-duplicate';

function dedupKey(clientEventId: string): { limiterKey: string; minuteBucket: string } {
  return { limiterKey: `dedup#${clientEventId}`, minuteBucket: DEDUP_SORT_KEY };
}

// Claims the dedup row via an atomic conditional put (attribute_not_exists)
// tagged status: 'pending' BEFORE the real write is attempted -- claiming
// only after a successful write (the previous, buggy sequencing) meant a
// write that threw left the marker set forever, so a legitimate retry was
// told "already done" for an event that was never actually written. A claim
// failure means the row already exists: read it to distinguish a genuine
// successful-retry-replay (status 'succeeded' -- short-circuit, no re-write
// or re-check of rate limits) from a same-instant concurrent duplicate
// (status still 'pending' -- a transient rejection the client's existing
// retry UI already handles).
async function claimDedupRow(
  rateLimitTable: string,
  clientEventId: string,
  now: Date,
): Promise<DedupClaimOutcome> {
  const key = dedupKey(clientEventId);
  const ttl = Math.floor(now.getTime() / 1000) + DEDUP_TTL_SECONDS;

  try {
    await docClient.send(new PutCommand({
      TableName: rateLimitTable,
      Item: { ...key, status: 'pending', ttl },
      ConditionExpression: 'attribute_not_exists(limiterKey)',
    }));
    return 'claimed';
  } catch (error) {
    if (!isConditionalCheckFailed(error)) {
      throw error;
    }
    const existing = await docClient.send(new GetCommand({ TableName: rateLimitTable, Key: key }));
    const status = (existing.Item as { status?: string } | undefined)?.status;
    return status === 'succeeded' ? 'already-succeeded' : 'concurrent-duplicate';
  }
}

// Only called on a row this same invocation claimed -- marks it done after
// the real write genuinely succeeded, so a later retry recognizes it as an
// already-completed duplicate.
async function markDedupSucceeded(rateLimitTable: string, clientEventId: string): Promise<void> {
  const key = dedupKey(clientEventId);
  await docClient.send(new UpdateCommand({
    TableName: rateLimitTable,
    Key: key,
    UpdateExpression: 'SET #status = :succeeded',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':succeeded': 'succeeded' },
  }));
}

// Only called on a row this same invocation claimed -- releases the claim
// on ANY non-success outcome (a rejected(...) validation/link/rate-limit
// result, or a thrown write failure) so the next retry with the same
// clientEventId gets a clean attempt instead of being stuck behind a
// 'pending' row until its TTL expires.
async function releaseDedupRow(rateLimitTable: string, clientEventId: string): Promise<void> {
  const key = dedupKey(clientEventId);
  await docClient.send(new DeleteCommand({ TableName: rateLimitTable, Key: key }));
}

interface CoreArgs {
  token: string;
  eventType: EventType;
  playerId: string | null | undefined;
  assistPlayerId: string | null | undefined;
  forUs: boolean;
  onTarget: boolean | null | undefined;
  expectedGameId: string | null | undefined;
  identityId: string | undefined;
  tables: ShareLinkAccessTables;
  teamRosterTable: string;
}

// The full validate -> select-game -> validate-players -> write pipeline,
// run only once a fresh dedup claim has been established (or no
// clientEventId was supplied at all). Returns a rejected(...) result for
// every expected failure mode; THROWS only for a genuine write failure
// (AppSync error), same as before -- the caller below is what decides what
// to do with the dedup row in either case.
async function runCore(args: CoreArgs): Promise<SubmitStatEventResult> {
  const {
    token, eventType, playerId, assistPlayerId, forUs, onTarget, expectedGameId,
    identityId, tables, teamRosterTable,
  } = args;

  const outcome = await resolveShareLinkAccess(docClient, tables, token, 'STAT_TRACKER', identityId, undefined, 'write');
  if (!outcome.ok) {
    return rejected(outcome.reason);
  }

  const { team, selection } = outcome;
  const game = selection.game as GameRecord | null;

  // GAME_NOT_LIVE is checked against the SPECIFIC tiebroken game, not just
  // "any live candidate exists" -- by construction, every live candidate
  // passes a bare status check, which is exactly why it's inert against the
  // wrong-game race on its own (see the shared-module tiebreak fix). The
  // expectedGameId echo below is the real guard against that race.
  if (selection.branch !== 'LIVE' || !game || game.status !== 'in-progress') {
    return rejected('GAME_NOT_LIVE');
  }

  if (expectedGameId && expectedGameId !== game.id) {
    return rejected('GAME_CHANGED');
  }

  // ── Validation rules ────────────────────────────────────────────────
  if (forUs === false) {
    // Opponent path: never carries a player attribution -- this app has no
    // opposing roster to validate against.
    if (playerId || assistPlayerId) {
      return rejected('VALIDATION_FAILED');
    }
  }

  if (eventType === 'SHOT' && typeof onTarget !== 'boolean') {
    // Required for SHOT regardless of forUs -- both "Us" and "Opponent"
    // paths need it.
    return rejected('VALIDATION_FAILED');
  }

  if (eventType !== 'GOAL' && assistPlayerId) {
    // assistPlayerId only makes sense on a Goal.
    return rejected('VALIDATION_FAILED');
  }

  if (forUs === true && (playerId || assistPlayerId)) {
    // "Us" SHOT with no playerId is allowed, deliberately (see plan) -- but
    // whenever a playerId/assistPlayerId IS supplied, it must genuinely
    // belong to this token's team roster, and assist must not equal scorer.
    if (playerId && assistPlayerId && playerId === assistPlayerId) {
      return rejected('VALIDATION_FAILED');
    }
    const rosterPlayerIds = await queryRosterPlayerIdsByTeamId(teamRosterTable, team.id);
    if (playerId && !rosterPlayerIds.has(playerId)) {
      return rejected('VALIDATION_FAILED');
    }
    if (assistPlayerId && !rosterPlayerIds.has(assistPlayerId)) {
      return rejected('VALIDATION_FAILED');
    }
  }

  // ── Server-derived game-clock (never trusted from the untrusted public
  // client) ───────────────────────────────────────────────────────────
  const gameSeconds = computeCurrentGameSeconds(game);
  const half = game.currentHalf ?? 1;
  const timestamp = new Date().toISOString();
  // Read fresh from the team record resolved just above (not cached from
  // ShareLink) -- omitting this would silently lock out every coach on the
  // team, including the one who generated the link (CLAUDE.md).
  const coaches = team.coaches ?? [];

  const dataClient = await getDataClient();

  const commonWriteFields = {
    gameId: game.id,
    gameSeconds,
    half,
    timestamp,
    loggedVia: 'HELPER' as const,
    coaches,
  };

  let writeErrors: ReadonlyArray<{ message: string }> | undefined;

  if (eventType === 'GOAL') {
    const response = await dataClient.models.Goal.create({
      ...commonWriteFields,
      scoredByUs: forUs,
      scorerId: forUs && playerId ? playerId : undefined,
      assistId: forUs && assistPlayerId ? assistPlayerId : undefined,
    });
    writeErrors = response.errors;
  } else if (eventType === 'SHOT') {
    const response = await dataClient.models.Shot.create({
      ...commonWriteFields,
      takenByUs: forUs,
      onTarget: onTarget as boolean,
      playerId: forUs && playerId ? playerId : undefined,
    });
    writeErrors = response.errors;
  } else {
    const response = await dataClient.models.Save.create({
      ...commonWriteFields,
      byUs: forUs,
      playerId: forUs && playerId ? playerId : undefined,
    });
    writeErrors = response.errors;
  }

  if (writeErrors && writeErrors.length > 0) {
    throw new Error(writeErrors[0]?.message ?? 'Failed to record stat event');
  }

  return { ok: true, reason: null };
}

// Guest + authenticated(identityPool) -- same rationale as
// getFanGameView/getStatTrackerView. Composes the shared shareLinkAccess.ts
// pipeline (token -> team -> validity -> rate-limit -> game-selection) with
// the 'write' rate-limit dimension (a helper's tapping gets its own,
// tighter budget than a fan's passive polling of the same team), then
// layers on B2-specific validation and the AppSync write itself.
export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityIAM | undefined;
  const identityId = identity?.cognitoIdentityId;

  const {
    token, eventType, playerId, assistPlayerId, forUs, onTarget, clientEventId, expectedGameId,
  } = event.arguments;

  if (!isValidEventType(eventType)) {
    return rejected('VALIDATION_FAILED');
  }

  if (typeof clientEventId === 'string' && clientEventId.length > MAX_CLIENT_EVENT_ID_LENGTH) {
    return rejected('VALIDATION_FAILED');
  }

  const shareLinkTable = process.env.SHARE_LINK_TABLE;
  const teamTable = process.env.TEAM_TABLE;
  const gameTable = process.env.GAME_TABLE;
  const rateLimitTable = process.env.FAN_VIEW_RATE_LIMIT_TABLE;
  const teamRosterTable = process.env.TEAM_ROSTER_TABLE;

  if (!shareLinkTable || !teamTable || !gameTable || !rateLimitTable || !teamRosterTable) {
    throw new Error('Required environment variables are not set');
  }

  const tables: ShareLinkAccessTables = {
    shareLink: shareLinkTable,
    team: teamTable,
    game: gameTable,
    rateLimit: rateLimitTable,
  };

  // ── Idempotency claim (before rate-limiting/validation/write) ─────────
  // A duplicate-tap guard on the client stops a double TAP; it doesn't cover
  // a write that actually succeeded but whose response was lost on a bad
  // connection, which the client's own inline-error-plus-manual-retry path
  // can turn into a genuine duplicate on resubmission. Claiming up front
  // (rather than right before the write, the previous buggy sequencing)
  // means a genuine successful-retry-replay short-circuits before ever
  // touching rate limits or validation again.
  let dedupClaimed = false;
  if (clientEventId) {
    const claimOutcome = await claimDedupRow(rateLimitTable, clientEventId, new Date());
    if (claimOutcome === 'already-succeeded') {
      return { ok: true, reason: null };
    }
    if (claimOutcome === 'concurrent-duplicate') {
      return rejected('RATE_LIMITED');
    }
    dedupClaimed = true;
  }

  let result: SubmitStatEventResult;
  try {
    result = await runCore({
      token, eventType, playerId, assistPlayerId, forUs, onTarget, expectedGameId,
      identityId, tables, teamRosterTable,
    });
  } catch (error) {
    // A real write failure (AppSync error/timeout) -- release the claim so
    // the next retry with the same clientEventId gets a clean attempt
    // instead of being told "already done" for an event that was never
    // actually written.
    if (dedupClaimed) {
      await releaseDedupRow(rateLimitTable, clientEventId as string);
    }
    throw error;
  }

  if (dedupClaimed) {
    if (result.ok) {
      await markDedupSucceeded(rateLimitTable, clientEventId as string);
    } else {
      // Any non-success outcome (INVALID_LINK/RATE_LIMITED/GAME_NOT_LIVE/
      // GAME_CHANGED/VALIDATION_FAILED) also releases the claim -- none of
      // these represent a completed write, so a retry after fixing whatever
      // caused the rejection must not be stuck behind a stale 'pending' row.
      await releaseDedupRow(rateLimitTable, clientEventId as string);
    }
  }

  return result;
};
