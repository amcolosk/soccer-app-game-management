import type { Schema } from '../../data/resource';
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { assertTeamAccess } from '../shared/teamAccess';
import {
  isConditionalCheckFailed,
  normalizeEmail,
  queryByIndex,
  withBoundedConcurrency,
  updateRecordCoachesWithRetry,
  type CoachesStrategy,
} from '../shared/coachArraySync';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// GSI names, confirmed against the deployed CDK synth output
// (.amplify/artifacts/cdk.out/*.nested.template.json) before this handler
// was written (ISSUE-162-REVOKE-COACH-ACCESS-CASCADE.md, "Data Model / API
// Impact", Minor 8): Amplify Gen2 auto-creates a `teamId`-hash-key,
// ALL-projection relationship GSI on each of these four child tables, named
// `gsi-<Team field name>` off the corresponding Team.<hasMany field> —
// `roster`, `positions`, `games`, `invitations`. Query (not Scan) is used
// for all four sweep lookups below as a result. accept-invitation's own
// Scans against TeamRoster/Game are NOT converted — this repo's
// established precedent there predates this verification and is out of
// scope for this behavior-preserving-refactor-only change (file #3).
const TEAM_ROSTER_INDEX = 'gsi-Team.roster';
const FIELD_POSITION_INDEX = 'gsi-Team.positions';
const GAME_INDEX = 'gsi-Team.games';
const TEAM_INVITATION_INDEX = 'gsi-Team.invitations';

type ChildRecord = {
  id: string;
  coaches?: string[];
};

type InvitationRow = ChildRecord & {
  status: string;
  acceptedBy?: string;
  email?: string;
};

// Team-level remove strategy (Critical 2): re-evaluated fresh on every
// retry attempt against the freshly re-read record, not just once before
// the first write. All three invariants below are re-checked every time.
function buildTeamStrategy(callerSub: string, targetUserId: string): CoachesStrategy {
  return (current) => {
    if (!current?.includes(callerSub)) {
      return { action: 'abort', reason: 'Access denied: caller is not a coach on this team' };
    }

    if (!current.includes(targetUserId)) {
      // Idempotent no-op: a retried call after a partial prior failure, or
      // a benign double-click/race, still finishes the child sweep below
      // without erroring.
      return { action: 'skip' };
    }

    const next = current.filter((id) => id !== targetUserId);
    if (next.length === 0) {
      return { action: 'abort', reason: "Cannot revoke the team's last coach. Invite another coach first." };
    }

    return { action: 'write', next };
  };
}

// Child-record remove strategy (unconditional sweep, Minor 9 empty-array
// guard). Never 'abort's — an aborted child-record write would incorrectly
// fail the whole revoke for a condition that isn't actually about this
// operation's own authorization.
function buildChildRemoveStrategy(targetUserId: string, recordId: string, tableLabel: string): CoachesStrategy {
  return (current) => {
    if (!current?.includes(targetUserId)) {
      return { action: 'skip' };
    }

    const next = current.filter((id) => id !== targetUserId);
    if (next.length === 0) {
      // Minor 9: writing coaches: [] would make this record invisible/
      // inaccessible to everyone with no recovery path (allow.ownersDefinedIn
      // gates read as well as write) — skip and log instead.
      console.warn(
        `revokeCoachAccess: skipping ${tableLabel} record ${recordId} — removing target would leave coaches empty`
      );
      return { action: 'skip' };
    }

    return { action: 'write', next };
  };
}

// Shared conditional-expiry write, mirroring archive-team/handler.ts's
// pending-invitation-expiry pattern exactly, just parameterized on the
// starting status. ConditionalCheckFailedException is swallowed as "already
// transitioned" (e.g. a concurrent accept or a second revoke call).
async function expireInvitationIfStatus(
  teamInvitationTable: string,
  invitationId: string,
  fromStatus: string,
  nowIso: string,
): Promise<void> {
  try {
    await docClient.send(new UpdateCommand({
      TableName: teamInvitationTable,
      Key: { id: invitationId },
      UpdateExpression: 'SET #status = :expiredStatus, updatedAt = :updatedAt',
      ConditionExpression: '#status = :fromStatus',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':expiredStatus': 'EXPIRED',
        ':fromStatus': fromStatus,
        ':updatedAt': nowIso,
      },
    }));
  } catch (error) {
    if (!isConditionalCheckFailed(error)) {
      throw error;
    }
    // Already transitioned out of fromStatus — ignore (F4's accepted
    // residual risk: a true concurrent accept-vs-revoke race can land here
    // for the PENDING-by-email case specifically).
  }
}

type Handler = Schema['revokeCoachAccess']['functionHandler'];

// Lambda-backed cascade for revokeCoachAccess (issue #162). Removes the
// target user from Team.coaches and unconditionally sweeps that removal
// onto every team-scoped record for that team (TeamRoster, FieldPosition,
// Game, TeamInvitation.coaches), plus a targeted TeamInvitation status
// transition that closes the ordinary re-accept-via-old-invitation
// reversibility hole. Player/Formation/FormationPosition are deliberately
// NOT swept — see ISSUE-162-REVOKE-COACH-ACCESS-CASCADE.md's "Central
// design finding" §1 (no createdBy/provenance field makes correct removal
// undecidable for those three).
//
// Known, accepted, documented residual risks (NOT closed by this handler,
// see docs/SHARING-PERMISSIONS.md and the plan doc's "Risks and edge
// cases"): F3 (a target with no ACCEPTED TeamInvitation row on this team
// has no derivable email, so a stray PENDING invitation to their address
// survives revocation) and F4 (a true sub-second concurrent
// accept-vs-revoke race on the same still-PENDING invitation is not
// closed by the step-3-5 reorder below, which only closes the
// crash/timeout/partial-failure version of the same window).
//
// Also out of scope, tracked separately (TEAM-ARCHIVE-STEP1-BACKEND-WIRING.md
// Required Follow-Up #7): no guard here against revoking a team's current
// owner (Team.ownerId can be left pointing at a non-coach). This handler is
// the natural future home for that guard (it already does the
// caller/target membership checks it would build on) but does not
// implement it now.
export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito;
  const callerSub = identity?.sub;

  if (!callerSub) {
    throw new Error('User not authenticated');
  }

  const { teamId, userId: targetUserId } = event.arguments;

  const teamTable = process.env.TEAM_TABLE;
  const teamRosterTable = process.env.TEAM_ROSTER_TABLE;
  const fieldPositionTable = process.env.FIELD_POSITION_TABLE;
  const gameTable = process.env.GAME_TABLE;
  const teamInvitationTable = process.env.TEAM_INVITATION_TABLE;

  if (!teamTable || !teamRosterTable || !fieldPositionTable || !gameTable || !teamInvitationTable) {
    throw new Error('Required environment variables not set');
  }

  // Step 2: read + caller-membership + archived-team gate. Moving off
  // AppSync's model-level allow.ownersDefinedIn('coaches') grant onto this
  // Lambda's elevated IAM removes that check for free — assertTeamAccess is
  // what re-creates it (Architecture Decision, rationale 3).
  const { team } = await assertTeamAccess(docClient, teamTable, teamId, callerSub, {
    requireActive: true,
    archivedMessage: 'Cannot revoke coach access for an archived team. Restore the team first.',
  });

  // Step 3: scan TeamInvitation for this team ONCE — reused by both the
  // status-transition steps below (4-5) and the coaches-field sweep (step
  // 10), no second query needed. #status alias required — status is a
  // DynamoDB reserved word (F1).
  const invitationRows = await queryByIndex<InvitationRow & Record<string, unknown>>(
    docClient,
    teamInvitationTable,
    TEAM_INVITATION_INDEX,
    'teamId',
    teamId,
    ['id', 'coaches', '#status', 'acceptedBy', 'email'],
    { '#status': 'status' },
  );

  const preSweepNowIso = new Date().toISOString();

  // Step 4: TeamInvitation reversibility close, ACCEPTED case (Critical 1).
  // Runs BEFORE the Team.coaches write (Major 2) — see the plan's "Central
  // design finding" §3 for the crash/timeout/partial-failure window this
  // ordering closes.
  const acceptedRowsForTarget = invitationRows.filter(
    (row) => row.status === 'ACCEPTED' && row.acceptedBy === targetUserId
  );

  await Promise.all(
    acceptedRowsForTarget.map((row) => expireInvitationIfStatus(teamInvitationTable, row.id, 'ACCEPTED', preSweepNowIso))
  );

  // Derive the target's email directly from the matched ACCEPTED row(s) —
  // no Cognito/AdminGetUser lookup needed (Major 1).
  const targetEmail = acceptedRowsForTarget.length > 0
    ? normalizeEmail(acceptedRowsForTarget[0].email)
    : undefined;

  // Step 5: TeamInvitation reversibility close, PENDING-by-email case
  // (Major 1). F5: filters the already-team-scoped scan from step 3 in
  // application code — never queries the non-team-scoped
  // listInvitationsByEmail GSI for this, which would blast-radius across
  // every team that email is invited to.
  //
  // F3 (accepted residual risk): if no ACCEPTED row was found for the
  // target, targetEmail is undefined and this step is skipped entirely —
  // there is no non-Cognito source for their email in that case, so a
  // stray PENDING invitation to their own address is not expired here.
  if (targetEmail) {
    const pendingRowsForEmail = invitationRows.filter(
      (row) => row.status === 'PENDING' && normalizeEmail(row.email) === targetEmail
    );

    await Promise.all(
      pendingRowsForEmail.map((row) => expireInvitationIfStatus(teamInvitationTable, row.id, 'PENDING', preSweepNowIso))
    );
  }

  // Step 6: the Team-level write itself — the authoritative, immediately-
  // consistent cutoff. No retryReadProjection (F2): a concurrent-conflict
  // retry re-read must return the FULL Team record, since `record` is
  // returned to the client as-is as the mutation's a.ref('Team') response
  // and Team.name is .required().
  const updatedAtIso = new Date().toISOString();
  const teamResult = await updateRecordCoachesWithRetry(
    docClient,
    teamTable,
    team,
    buildTeamStrategy(callerSub, targetUserId),
    updatedAtIso,
  );

  // Step 7: unconditional sweep — TeamRoster.
  const rosterRecords = await queryByIndex<ChildRecord & Record<string, unknown>>(
    docClient,
    teamRosterTable,
    TEAM_ROSTER_INDEX,
    'teamId',
    teamId,
    ['id', 'coaches'],
  );

  await Promise.all(rosterRecords.map((record) =>
    updateRecordCoachesWithRetry(
      docClient,
      teamRosterTable,
      record,
      buildChildRemoveStrategy(targetUserId, record.id, 'TeamRoster'),
      updatedAtIso,
      ['id', 'coaches'],
    )
  ));

  // Step 8: unconditional sweep — FieldPosition.
  const fieldPositionRecords = await queryByIndex<ChildRecord & Record<string, unknown>>(
    docClient,
    fieldPositionTable,
    FIELD_POSITION_INDEX,
    'teamId',
    teamId,
    ['id', 'coaches'],
  );

  await Promise.all(fieldPositionRecords.map((record) =>
    updateRecordCoachesWithRetry(
      docClient,
      fieldPositionTable,
      record,
      buildChildRemoveStrategy(targetUserId, record.id, 'FieldPosition'),
      updatedAtIso,
      ['id', 'coaches'],
    )
  ));

  // Step 9: unconditional sweep — Game, bounded concurrency (matches
  // accept-invitation's own Game backfill concurrency of 10).
  const gameRecords = await queryByIndex<ChildRecord & Record<string, unknown>>(
    docClient,
    gameTable,
    GAME_INDEX,
    'teamId',
    teamId,
    ['id', 'coaches'],
  );

  await withBoundedConcurrency(gameRecords, 10, (record) =>
    updateRecordCoachesWithRetry(
      docClient,
      gameTable,
      record,
      buildChildRemoveStrategy(targetUserId, record.id, 'Game'),
      updatedAtIso,
      ['id', 'coaches'],
    )
  );

  // Step 10: unconditional sweep — TeamInvitation.coaches. Reuses the rows
  // already fetched in step 3 — no second query. Position unchanged from
  // round 1 of the plan's revisions — only the status transitions (steps
  // 4-5) moved earlier; this coaches-field sweep stays grouped with the
  // other unconditional child-record sweeps.
  await Promise.all(invitationRows.map((row) =>
    updateRecordCoachesWithRetry(
      docClient,
      teamInvitationTable,
      row,
      buildChildRemoveStrategy(targetUserId, row.id, 'TeamInvitation'),
      updatedAtIso,
      ['id', 'coaches'],
    )
  ));

  // Step 11: return the Team record captured at step 6.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return teamResult.record as any;
};
