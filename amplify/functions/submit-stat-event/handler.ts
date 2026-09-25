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
import { isValidOutcome, deriveShotOutcomeWrites, type ShotOutcome } from '../shared/shotOutcome';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

type Handler = Schema['submitStatEvent']['functionHandler'];
type DataClient = ReturnType<typeof generateClient<Schema>>;

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

// ── Idempotency for a retried submit, with resumable dedup state ──────────
// Reuses FanViewRateLimit's row shape (limiterKey/minuteBucket identifier),
// but NOT its minute-bucketed sort key -- a retry can legitimately land in
// the wall-clock minute AFTER the original attempt (a lost response plus a
// few seconds of user hesitation easily crosses a minute boundary), and a
// per-minute key would make that retry look like a brand-new event. Use a
// fixed, non-time-derived sort-key value instead, so every retry within the
// row's TTL hits the exact same item regardless of which minute it arrives.
//
// `submitStatEvent` writes UP TO TWO records per invocation (Shot always,
// plus Goal/Save conditionally) through two independent AppSync mutations --
// there is no multi-table transaction available. `status` is a 3-state
// machine (was 2 before this plan): 'pending' -> 'shot-written' -> 'succeeded'
// ('resuming' is also used, transiently, only while a resume attempt is
// atomically re-claiming a 'shot-written' row -- see claimDedupRow). The
// governing invariant (architecture review's A1): once ANY model write has
// returned success THIS invocation, the row is never deleted on any
// subsequent error -- only TTL expiry may ever clear it past that point.
// This is why `writeContext` is persisted immediately after
// validation/derivation, before the Shot write is even attempted: it must
// exist before the earliest point past which the row becomes
// non-releasable, so a resume from that point is always reconstructible.
const DEDUP_SORT_KEY = 'dedup';
const DEDUP_TTL_SECONDS = 600; // ~10 min, matching FanViewRateLimit's existing TTL convention.

// Everything needed to reconstruct the (already-derived, already-validated)
// Goal/Save write on a resume, without re-deriving or re-trusting anything
// from the resumed request (A3) -- `teamId`, not a copy of `coaches`, so
// `coaches` can always be re-read fresh at resume time (A4). Also carries
// the shared `gameId`/`timestamp`/`gameSeconds` triple so the resumed
// second write correlates with the already-committed Shot exactly (i4) --
// the resumed write must reuse the ORIGINAL timestamp, never a freshly
// generated one.
interface WriteContext {
  teamId: string;
  gameId: string;
  gameSeconds: number;
  half: number;
  timestamp: string;
  outcome: ShotOutcome;
  forUs: boolean;
  playerId: string | null;
  assistPlayerId: string | null;
  keeperPlayerId: string | null;
}

type DedupRow = { status?: string; writeContext?: WriteContext };

type ClaimOutcome =
  | { kind: 'claimed' }
  | { kind: 'resume'; writeContext: WriteContext }
  | { kind: 'already-succeeded' }
  | { kind: 'concurrent-duplicate' };

function dedupKey(clientEventId: string): { limiterKey: string; minuteBucket: string } {
  return { limiterKey: `dedup#${clientEventId}`, minuteBucket: DEDUP_SORT_KEY };
}

// Claims the dedup row via an atomic conditional put (attribute_not_exists)
// tagged status: 'pending' BEFORE the real write is attempted -- claiming
// only after a successful write (the previous, buggy sequencing) meant a
// write that threw left the marker set forever, so a legitimate retry was
// told "already done" for an event that was never actually written.
//
// A claim failure means the row already exists: read it to distinguish
// - a genuine successful-retry-replay ('succeeded' -- short-circuit),
// - a resumable partial failure ('shot-written' -- atomically re-claim via a
//   conditional UpdateCommand, A2: `ConditionExpression` requires
//   `status = 'shot-written'`, transitioning it to 'resuming'; if that
//   condition fails, another invocation already moved the row, so this one
//   backs off as a concurrent duplicate rather than racing it),
// - or a same-instant concurrent duplicate ('pending'/'resuming' still in
//   flight, or a 'shot-written' row with no persisted writeContext, which
//   should be unreachable but is treated as non-resumable defensively).
async function claimDedupRow(
  rateLimitTable: string,
  clientEventId: string,
  now: Date,
): Promise<ClaimOutcome> {
  const key = dedupKey(clientEventId);
  const ttl = Math.floor(now.getTime() / 1000) + DEDUP_TTL_SECONDS;

  try {
    await docClient.send(new PutCommand({
      TableName: rateLimitTable,
      Item: { ...key, status: 'pending', ttl },
      ConditionExpression: 'attribute_not_exists(limiterKey)',
    }));
    return { kind: 'claimed' };
  } catch (error) {
    if (!isConditionalCheckFailed(error)) {
      throw error;
    }
    const existing = await docClient.send(new GetCommand({ TableName: rateLimitTable, Key: key }));
    const row = existing.Item as DedupRow | undefined;

    if (row?.status === 'succeeded') {
      return { kind: 'already-succeeded' };
    }

    if (row?.status === 'shot-written' && row.writeContext) {
      try {
        await docClient.send(new UpdateCommand({
          TableName: rateLimitTable,
          Key: key,
          UpdateExpression: 'SET #status = :resuming',
          ConditionExpression: '#status = :shotWritten',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':resuming': 'resuming', ':shotWritten': 'shot-written' },
        }));
        return { kind: 'resume', writeContext: row.writeContext };
      } catch (raceError) {
        if (!isConditionalCheckFailed(raceError)) {
          throw raceError;
        }
        return { kind: 'concurrent-duplicate' };
      }
    }

    return { kind: 'concurrent-duplicate' };
  }
}

async function persistWriteContext(
  rateLimitTable: string,
  clientEventId: string,
  writeContext: WriteContext,
): Promise<void> {
  await docClient.send(new UpdateCommand({
    TableName: rateLimitTable,
    Key: dedupKey(clientEventId),
    UpdateExpression: 'SET writeContext = :writeContext',
    ExpressionAttributeValues: { ':writeContext': writeContext },
  }));
}

async function setDedupStatus(
  rateLimitTable: string,
  clientEventId: string,
  status: 'shot-written' | 'succeeded',
): Promise<void> {
  await docClient.send(new UpdateCommand({
    TableName: rateLimitTable,
    Key: dedupKey(clientEventId),
    UpdateExpression: 'SET #status = :status',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':status': status },
  }));
}

// A2: after a failed resumed write, conditionally hand the row back to
// 'shot-written' (only if it's still 'resuming' -- i.e. nothing else raced
// it in the meantime) so a FUTURE retry can still resume, rather than
// stranding it at 'resuming' forever (until TTL).
async function revertToShotWritten(rateLimitTable: string, clientEventId: string): Promise<void> {
  try {
    await docClient.send(new UpdateCommand({
      TableName: rateLimitTable,
      Key: dedupKey(clientEventId),
      UpdateExpression: 'SET #status = :shotWritten',
      ConditionExpression: '#status = :resuming',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':shotWritten': 'shot-written', ':resuming': 'resuming' },
    }));
  } catch (error) {
    if (!isConditionalCheckFailed(error)) {
      throw error;
    }
    // Someone else already moved the row on (e.g. it somehow reached
    // 'succeeded' concurrently) -- nothing to revert.
  }
}

// Only called on a row THIS invocation still owns and where NO model write
// has succeeded yet this invocation (A1) -- releases the claim so the next
// retry with the same clientEventId gets a clean attempt instead of being
// stuck behind a stale row until its TTL expires.
async function releaseDedupRow(rateLimitTable: string, clientEventId: string): Promise<void> {
  const key = dedupKey(clientEventId);
  await docClient.send(new DeleteCommand({ TableName: rateLimitTable, Key: key }));
}

interface CoreArgs {
  token: string;
  outcome: ShotOutcome;
  playerId: string | null | undefined;
  assistPlayerId: string | null | undefined;
  forUs: boolean;
  keeperPlayerId: string | null | undefined;
  expectedGameId: string | null | undefined;
  identityId: string | undefined;
  tables: ShareLinkAccessTables;
  teamRosterTable: string;
}

type ValidationOutcome =
  | { ok: false; result: SubmitStatEventResult }
  | { ok: true; writeContext: WriteContext; coaches: string[] };

// The validate -> select-game -> validate-players -> derive pipeline, run
// only once a fresh dedup claim has been established (or no clientEventId
// was supplied at all). Returns a rejected(...) result for every expected
// failure mode. Does NOT write anything -- the caller persists
// `writeContext` and performs the actual Shot/Goal/Save writes, since the
// order (persist-before-write, Shot-before-Goal/Save) is exactly what makes
// the resumable dedup design safe (see the module doc comment above).
async function validateAndDerive(args: CoreArgs): Promise<ValidationOutcome> {
  const {
    token, outcome, playerId, assistPlayerId, forUs, keeperPlayerId, expectedGameId,
    identityId, tables, teamRosterTable,
  } = args;

  const outcomeResult = await resolveShareLinkAccess(docClient, tables, token, 'STAT_TRACKER', identityId, undefined, 'write');
  if (!outcomeResult.ok) {
    return { ok: false, result: rejected(outcomeResult.reason) };
  }

  const { team, selection } = outcomeResult;
  const game = selection.game as GameRecord | null;

  // GAME_NOT_LIVE is checked against the SPECIFIC tiebroken game, not just
  // "any live candidate exists" -- by construction, every live candidate
  // passes a bare status check, which is exactly why it's inert against the
  // wrong-game race on its own (see the shared-module tiebreak fix). The
  // expectedGameId echo below is the real guard against that race.
  if (selection.branch !== 'LIVE' || !game || game.status !== 'in-progress') {
    return { ok: false, result: rejected('GAME_NOT_LIVE') };
  }

  if (expectedGameId && expectedGameId !== game.id) {
    return { ok: false, result: rejected('GAME_CHANGED') };
  }

  // ── Validation rules ────────────────────────────────────────────────
  // keeperPlayerId misuse must be rejected, not silently dropped (m8) --
  // matches the existing reject-don't-drop stance for a misplaced
  // playerId/assistPlayerId below.
  if (keeperPlayerId && !(forUs === false && outcome === 'SAVED')) {
    return { ok: false, result: rejected('VALIDATION_FAILED') };
  }

  if (forUs === false) {
    // Opponent path: never carries a shooter/scorer/assist attribution --
    // this app has no opposing roster to validate against.
    if (playerId || assistPlayerId) {
      return { ok: false, result: rejected('VALIDATION_FAILED') };
    }
    // m8 (second half): parallel roster-membership check for a supplied
    // keeperPlayerId on the "Them" branch -- no equivalent existed
    // pre-unification, since there was no keeper attribution possible on
    // an opponent shot before this plan.
    if (keeperPlayerId) {
      const rosterPlayerIds = await queryRosterPlayerIdsByTeamId(teamRosterTable, team.id);
      if (!rosterPlayerIds.has(keeperPlayerId)) {
        return { ok: false, result: rejected('VALIDATION_FAILED') };
      }
    }
  }

  if (outcome !== 'GOAL' && assistPlayerId) {
    // assistPlayerId only makes sense on a Goal.
    return { ok: false, result: rejected('VALIDATION_FAILED') };
  }

  if (forUs === true && (playerId || assistPlayerId)) {
    // "Us" shot with no playerId is allowed, deliberately (see plan, m7:
    // shooter stays skippable regardless of outcome) -- but whenever a
    // playerId/assistPlayerId IS supplied, it must genuinely belong to this
    // token's team roster, and assist must not equal scorer.
    if (playerId && assistPlayerId && playerId === assistPlayerId) {
      return { ok: false, result: rejected('VALIDATION_FAILED') };
    }
    const rosterPlayerIds = await queryRosterPlayerIdsByTeamId(teamRosterTable, team.id);
    if (playerId && !rosterPlayerIds.has(playerId)) {
      return { ok: false, result: rejected('VALIDATION_FAILED') };
    }
    if (assistPlayerId && !rosterPlayerIds.has(assistPlayerId)) {
      return { ok: false, result: rejected('VALIDATION_FAILED') };
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

  const writeContext: WriteContext = {
    teamId: team.id,
    gameId: game.id,
    gameSeconds,
    half,
    timestamp,
    outcome,
    forUs,
    playerId: playerId ?? null,
    assistPlayerId: assistPlayerId ?? null,
    keeperPlayerId: keeperPlayerId ?? null,
  };

  return { ok: true, writeContext, coaches };
}

function buildCommonWriteFields(writeContext: WriteContext, coaches: string[]) {
  return {
    gameId: writeContext.gameId,
    gameSeconds: writeContext.gameSeconds,
    half: writeContext.half,
    timestamp: writeContext.timestamp,
    loggedVia: 'HELPER' as const,
    coaches,
  };
}

function assertNoWriteErrors(response: { errors?: ReadonlyArray<{ message: string }> }, fallbackMessage: string): void {
  if (response.errors && response.errors.length > 0) {
    throw new Error(response.errors[0]?.message ?? fallbackMessage);
  }
}

// The first-attempt write path: persist writeContext, write Shot (always),
// then conditionally write Goal/Save. Owns the dedup row's entire lifecycle
// for this invocation -- release-on-no-progress before the Shot write,
// never-release once the Shot write has succeeded (A1).
async function performFirstAttemptWrite(
  writeContext: WriteContext,
  coaches: string[],
  rateLimitTable: string | undefined,
  clientEventId: string | undefined,
): Promise<SubmitStatEventResult> {
  if (clientEventId && rateLimitTable) {
    await persistWriteContext(rateLimitTable, clientEventId, writeContext);
  }

  const derived = deriveShotOutcomeWrites(writeContext);
  const dataClient = await getDataClient();
  const commonWriteFields = buildCommonWriteFields(writeContext, coaches);

  // A1: progress is tracked locally and drives the ONLY release decision
  // left in this invocation -- once the Shot write below succeeds, nothing
  // in this function (or its caller) may ever delete the dedup row again,
  // regardless of what happens next.
  try {
    const shotResponse = await dataClient.models.Shot.create({
      ...commonWriteFields,
      ...derived.shot,
    });
    assertNoWriteErrors(shotResponse, 'Failed to record shot');
  } catch (error) {
    // No progress made yet -- safe to release so a retry gets a clean slate.
    if (clientEventId && rateLimitTable) {
      await releaseDedupRow(rateLimitTable, clientEventId);
    }
    throw error;
  }

  if (!derived.goal && !derived.save) {
    // BLOCKED/WIDE -- nothing more to write, identical shape to a
    // single-write submission.
    if (clientEventId && rateLimitTable) {
      await setDedupStatus(rateLimitTable, clientEventId, 'succeeded');
    }
    return { ok: true, reason: null };
  }

  // GOAL/SAVED -- the Shot succeeded; from this point on the row must never
  // be released on any subsequent error, only ever advanced or left as
  // 'shot-written' for a later resume.
  if (clientEventId && rateLimitTable) {
    // A1(a): if THIS update itself throws, the row is still not released --
    // it stays at 'pending' with `writeContext` already persisted, which a
    // resume attempt cannot pick up (resume requires 'shot-written'), so it
    // simply expires via TTL. This is a narrow, accepted gap (an
    // unresumable orphaned Shot) rather than a duplicate-write risk -- the
    // invariant that matters (never release once Shot has succeeded) still
    // holds, since this throw is deliberately NOT caught into a releasing
    // catch anywhere in this call chain.
    await setDedupStatus(rateLimitTable, clientEventId, 'shot-written');
  }

  try {
    const secondResponse = derived.goal
      ? await dataClient.models.Goal.create({ ...commonWriteFields, ...derived.goal })
      : await dataClient.models.Save.create({ ...commonWriteFields, ...derived.save! });
    assertNoWriteErrors(secondResponse, 'Failed to record goal/save');
  } catch {
    // m4: return a rejected(...)-shaped result, not a thrown error -- this
    // is retry-steerable (PARTIAL_WRITE), unlike a genuine unrecoverable
    // failure. Never release the row here (A1) -- it stays at
    // 'shot-written', resumable until TTL.
    return { ok: false, reason: 'PARTIAL_WRITE' };
  }

  if (clientEventId && rateLimitTable) {
    await setDedupStatus(rateLimitTable, clientEventId, 'succeeded');
  }
  return { ok: true, reason: null };
}

// The resume path (A2/A3/A4): reconstructs the Goal/Save write from ONLY
// the persisted `writeContext` and `clientEventId` -- every other request
// argument is ignored, and no validation/game-liveness re-check is
// performed (those were already satisfied by the original attempt; the
// Shot this resume's Goal/Save must correlate with already exists).
async function performResumeWrite(
  writeContext: WriteContext,
  teamTable: string,
  rateLimitTable: string,
  clientEventId: string,
): Promise<SubmitStatEventResult> {
  // A4: never reuse a cached `coaches` array -- re-read the team fresh via
  // `teamId` so a coach who accepted an invitation between the original
  // partial failure and this resume ends up in the resumed write's
  // `coaches`, exactly as CLAUDE.md's standing rule requires.
  const teamResponse = await docClient.send(new GetCommand({ TableName: teamTable, Key: { id: writeContext.teamId } }));
  const team = teamResponse.Item as { coaches?: string[] } | undefined;
  const coaches = team?.coaches ?? [];

  const derived = deriveShotOutcomeWrites(writeContext);
  const dataClient = await getDataClient();
  const commonWriteFields = buildCommonWriteFields(writeContext, coaches);

  try {
    const response = derived.goal
      ? await dataClient.models.Goal.create({ ...commonWriteFields, ...derived.goal })
      : await dataClient.models.Save.create({ ...commonWriteFields, ...derived.save! });
    assertNoWriteErrors(response, 'Failed to record goal/save');
  } catch {
    // Never release (A1) -- hand the row back to 'shot-written' so a LATER
    // resume can still try again, rather than stranding it at 'resuming'.
    await revertToShotWritten(rateLimitTable, clientEventId);
    return { ok: false, reason: 'PARTIAL_WRITE' };
  }

  await setDedupStatus(rateLimitTable, clientEventId, 'succeeded');
  return { ok: true, reason: null };
}

// Guest + authenticated(identityPool) -- same rationale as
// getFanGameView/getStatTrackerView. Composes the shared shareLinkAccess.ts
// pipeline (token -> team -> validity -> rate-limit -> game-selection) with
// the 'write' rate-limit dimension (a helper's tapping gets its own,
// tighter budget than a fan's passive polling of the same team), then
// layers on unified shot-outcome validation and the AppSync write(s)
// themselves, wrapped in the resumable dedup-state machine documented above
// the WriteContext type.
export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityIAM | undefined;
  const identityId = identity?.cognitoIdentityId;

  const {
    token, outcome, playerId, assistPlayerId, forUs, keeperPlayerId, clientEventId, expectedGameId,
  } = event.arguments;

  if (!isValidOutcome(outcome)) {
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
  let claim: ClaimOutcome | null = null;
  if (clientEventId) {
    claim = await claimDedupRow(rateLimitTable, clientEventId, new Date());
    if (claim.kind === 'already-succeeded') {
      return { ok: true, reason: null };
    }
    if (claim.kind === 'concurrent-duplicate') {
      return rejected('RATE_LIMITED');
    }
  }

  // ── Resume path (A2/A3/A4) — skips validation/selection/Shot-write
  // entirely; they already happened on the original attempt. ───────────
  if (claim?.kind === 'resume') {
    return performResumeWrite(claim.writeContext, teamTable, rateLimitTable, clientEventId as string);
  }

  // ── First attempt (or no clientEventId at all) ────────────────────────
  const validated = await validateAndDerive({
    token, outcome, playerId, assistPlayerId, forUs, keeperPlayerId, expectedGameId,
    identityId, tables, teamRosterTable,
  });

  if (!validated.ok) {
    // Nothing was ever written -- always safe to release.
    if (clientEventId) {
      await releaseDedupRow(rateLimitTable, clientEventId);
    }
    return validated.result;
  }

  return performFirstAttemptWrite(
    validated.writeContext,
    validated.coaches,
    rateLimitTable,
    clientEventId ?? undefined,
  );
};
