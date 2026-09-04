import type { Schema } from "../../data/resource";
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient, type AttributeValue } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import {
  isConditionalCheckFailed,
  normalizeEmail,
  getRecordById,
  scanByField,
  withBoundedConcurrency,
  updateRecordCoachesWithRetry,
  type CoachScopedRecord,
  type CoachesStrategy,
} from "../shared/coachArraySync";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const cognitoClient = new CognitoIdentityProviderClient({});

type TeamRosterBackfillRecord = CoachScopedRecord & {
  playerId?: string;
};

type TeamRecord = {
  id: string;
  coaches?: string[];
  formationId?: string | null;
};

type InvitationRecord = {
  id: string;
  teamId: string;
  email?: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | string;
  acceptedBy?: string;
  expiresAt?: string;
};

function toInvitationStateError(status: string): Error {
  if (status === 'EXPIRED') {
    return new Error('Invitation has expired');
  }

  return new Error(`Invitation is ${status}`);
}

export function mergeCoachLists(existing: string[] | undefined, incoming: string[]): string[] {
  return Array.from(new Set([...(existing ?? []), ...incoming]));
}

export function shouldBackfillCoaches(existing: string[] | undefined, incoming: string[]): boolean {
  const merged = mergeCoachLists(existing, incoming);
  if (!existing) return merged.length > 0;
  return merged.length !== existing.length || merged.some((coachId) => !existing.includes(coachId));
}

// Add/merge strategy for the shared retry helper — always 'write' or 'skip',
// never 'abort' (the add side has no invariant that can regress mid-retry).
function backfillStrategy(teamCoaches: string[]): CoachesStrategy {
  return (current) => {
    if (!shouldBackfillCoaches(current, teamCoaches)) {
      return { action: 'skip' };
    }
    return { action: 'write', next: mergeCoachLists(current, teamCoaches) };
  };
}

async function updateRecordCoachesIfNeeded(
  tableName: string,
  record: CoachScopedRecord,
  teamCoaches: string[],
  updatedAtIso: string,
): Promise<boolean> {
  const result = await updateRecordCoachesWithRetry(
    docClient,
    tableName,
    record,
    backfillStrategy(teamCoaches),
    updatedAtIso,
    ['id', 'coaches'],
  );

  return result.action === 'write';
}

function isTransactionCanceledException(
  error: unknown,
): error is Error & { CancellationReasons?: Array<{ Code?: string; Message?: string; Item?: Record<string, AttributeValue> }> } {
  if (!error || typeof error !== 'object') {
    return false;
  }
  return (error as { name?: unknown }).name === 'TransactionCanceledException';
}

// TransactItems order below is fixed — CancellationReasons is returned in
// the same order as the TransactItems request.
const INVITATION_TRANSACT_INDEX = 0;
const TEAM_TRANSACT_INDEX = 1;

// Shared UpdateExpression/ConditionExpression shape for the PENDING ->
// ACCEPTED invitation transition — used both as a TransactItems[].Update
// entry (happy path) and as the standalone repair UpdateCommand (the
// duplicate-invitation-link sub-case, Decision 8). Handler-local, not a new
// shared module (Decision 5's "not this slice" call applies here too).
function buildInvitationAcceptUpdate(nowIso: string, userId: string) {
  return {
    UpdateExpression: 'SET #status = :acceptedStatus, acceptedAt = :acceptedAt, acceptedBy = :acceptedBy, updatedAt = :updatedAt',
    ConditionExpression: '#status = :pendingStatus',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':acceptedStatus': 'ACCEPTED',
      ':pendingStatus': 'PENDING',
      ':acceptedAt': nowIso,
      ':acceptedBy': userId,
      ':updatedAt': nowIso,
    },
  };
}

// Re-reads the invitation, verifies email match, and classifies the result
// as an idempotent retry by the same user (returns the resolved invitation)
// or a genuine conflict (throws via toInvitationStateError / a mismatch
// error). Shared by the invitation-item-failed branch and the standalone
// repair UpdateCommand's own conditional-failure catch — both do exactly
// this re-read-and-classify sequence today.
async function classifyInvitationConflict(
  teamInvitationTable: string,
  invitationId: string,
  userId: string,
  authenticatedEmail: string,
): Promise<InvitationRecord> {
  const latestInvitation = await getRecordById<InvitationRecord>(
    docClient,
    teamInvitationTable,
    invitationId,
    ['id', 'teamId', 'email', 'status', 'acceptedBy', 'expiresAt'],
  );

  if (!latestInvitation) {
    throw new Error('Invitation not found');
  }

  if (normalizeEmail(latestInvitation.email) !== authenticatedEmail) {
    throw new Error('Invitation recipient mismatch');
  }

  if (!(latestInvitation.status === 'ACCEPTED' && latestInvitation.acceptedBy === userId)) {
    throw toInvitationStateError(latestInvitation.status);
  }

  return latestInvitation;
}

export const handler: Schema['acceptInvitation']['functionHandler'] = async (event) => {
  const { invitationId } = event.arguments;
  
  // Get user ID from Cognito identity
  const identity = event.identity as AppSyncIdentityCognito;
  const userId = identity?.sub;

  // Resolve caller email using multi-step fallback (access tokens don't include email claim)
  let authenticatedEmail = normalizeEmail(identity?.claims?.email);

  // Fallback: if username looks like an email, use it
  if (!authenticatedEmail && identity?.username && identity.username.includes('@')) {
    authenticatedEmail = normalizeEmail(identity.username);
  }

  // Fallback 2: check claims.username
  if (!authenticatedEmail && identity?.claims?.username) {
    authenticatedEmail = normalizeEmail(identity.claims.username as string);
  }

  // Fallback 3: check claims['cognito:username']
  if (!authenticatedEmail && identity?.claims && identity.claims['cognito:username']) {
    authenticatedEmail = normalizeEmail(identity.claims['cognito:username'] as string);
  }

  // Fallback 4: Fetch from Cognito User Pool
  if ((!authenticatedEmail || !authenticatedEmail.includes('@')) && process.env.USER_POOL_ID && (identity?.username || identity?.sub)) {
    try {
      const cognitoCommand = new AdminGetUserCommand({
        UserPoolId: process.env.USER_POOL_ID,
        Username: identity.username || identity.sub,
      });
      const cognitoResponse = await cognitoClient.send(cognitoCommand);
      const emailAttr = cognitoResponse.UserAttributes?.find(attr => attr.Name === 'email');
      if (emailAttr?.Value) {
        authenticatedEmail = normalizeEmail(emailAttr.Value);
      }
    } catch (error) {
      console.error('Error fetching user from Cognito:', error);
    }
  }

  if (!userId) {
    throw new Error('User not authenticated');
  }

  if (!authenticatedEmail) {
    throw new Error('Authenticated email claim missing');
  }

  // Get table names from environment
  const teamInvitationTable = process.env.TEAM_INVITATION_TABLE;
  const teamTable = process.env.TEAM_TABLE;
  const teamRosterTable = process.env.TEAM_ROSTER_TABLE;
  const playerTable = process.env.PLAYER_TABLE;
  const formationTable = process.env.FORMATION_TABLE;
  const formationPositionTable = process.env.FORMATION_POSITION_TABLE;
  const gameTable = process.env.GAME_TABLE;

  if (
    !teamInvitationTable ||
    !teamTable ||
    !teamRosterTable ||
    !playerTable ||
    !formationTable ||
    !formationPositionTable ||
    !gameTable
  ) {
    throw new Error('Required environment variables not set');
  }

  // 1. Get the invitation
  const invitationResponse = await docClient.send(new GetCommand({
    TableName: teamInvitationTable,
    Key: { id: invitationId }
  }));

  let invitation = invitationResponse.Item as InvitationRecord | undefined;

  if (!invitation) {
    throw new Error('Invitation not found');
  }

  const invitationEmail = normalizeEmail(invitation.email);
  if (!invitationEmail || invitationEmail !== authenticatedEmail) {
    throw new Error('Invitation recipient mismatch');
  }

  // 2. Claim invitation with conditional semantics to avoid cross-user races.
  //    If another request already claimed it for this same user, treat as idempotent retry.
  if (invitation.status === 'PENDING') {
    if (!invitation.expiresAt || new Date(invitation.expiresAt) < new Date()) {
      try {
        await docClient.send(new UpdateCommand({
          TableName: teamInvitationTable,
          Key: { id: invitationId },
          UpdateExpression: 'SET #status = :status',
          ConditionExpression: '#status = :pendingStatus',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':status': 'EXPIRED',
            ':pendingStatus': 'PENDING',
          }
        }));
      } catch (error) {
        if (!isConditionalCheckFailed(error)) {
          throw error;
        }

        const latestInvitation = await getRecordById<InvitationRecord>(
          docClient,
          teamInvitationTable,
          invitationId,
          ['id', 'teamId', 'email', 'status', 'acceptedBy', 'expiresAt'],
        );

        if (!latestInvitation) {
          throw new Error('Invitation not found');
        }

        if (normalizeEmail(latestInvitation.email) !== authenticatedEmail) {
          throw new Error('Invitation recipient mismatch');
        }

        throw toInvitationStateError(latestInvitation.status);
      }

      throw new Error('Invitation has expired');
    }

    const nowIso = new Date().toISOString();
    const invitationAcceptUpdate = buildInvitationAcceptUpdate(nowIso, userId);

    try {
      await docClient.send(new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: teamInvitationTable,
              Key: { id: invitationId },
              ...invitationAcceptUpdate,
              ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
            },
          },
          {
            Update: {
              TableName: teamTable,
              Key: { id: invitation.teamId },
              UpdateExpression: 'SET coaches = list_append(if_not_exists(coaches, :emptyCoaches), :coachToAdd), updatedAt = :updatedAt',
              // Correction 2: null-safe — legacy teams predate `status`
              // entirely; a bare `#status <> :archived` is false against an
              // absent attribute and would wrongly reject acceptance for
              // every pre-archive-feature team.
              ConditionExpression:
                '(attribute_not_exists(#status) OR #status <> :archived) AND (attribute_not_exists(coaches) OR NOT contains(coaches, :coachId))',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':emptyCoaches': [],
                ':coachToAdd': [userId],
                ':coachId': userId,
                ':archived': 'archived',
                ':updatedAt': nowIso,
              },
              ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
            },
          },
        ],
      }));

      invitation = { ...invitation, status: 'ACCEPTED', acceptedBy: userId };
    } catch (error) {
      if (!isTransactionCanceledException(error)) {
        throw error;
      }

      const reasons = error.CancellationReasons ?? [];
      const invitationFailed = reasons[INVITATION_TRANSACT_INDEX]?.Code === 'ConditionalCheckFailed';
      const teamFailed = reasons[TEAM_TRANSACT_INDEX]?.Code === 'ConditionalCheckFailed';

      if (invitationFailed) {
        // Same classification the pre-transaction single-item catch used:
        // re-read and determine idempotent-retry-by-same-user vs. a genuine
        // conflict (claimed by someone else, expired, declined, ...).
        invitation = await classifyInvitationConflict(teamInvitationTable, invitationId, userId, authenticatedEmail);
        // Idempotent retry by the same user — the coach-append half of the
        // original successful transaction is guaranteed to have applied too
        // (both items commit or neither does), verified at the
        // post-transaction Team read below. No repair needed here.
      } else if (teamFailed) {
        // The invitation half of the condition passed (this is a genuine,
        // first-time PENDING -> ACCEPTED transition for this caller) but the
        // coaches-append half was rejected. DynamoDB reports this as a
        // *distinct* per-item failure (unlike the old single-exception
        // shape), so "team archived" and "already a coach" are both
        // determinable from the same atomic response — no second round trip.
        const rawItem = reasons[TEAM_TRANSACT_INDEX]?.Item;
        const currentTeam = rawItem
          ? (unmarshall(rawItem) as { status?: string; coaches?: string[] })
          : undefined;

        if (currentTeam?.status === 'archived') {
          throw new Error('Cannot accept invitation: this team has been archived');
        }

        if (!currentTeam?.coaches?.includes(userId)) {
          // Neither branch of the null-safe OR explains the failure from
          // what DynamoDB returned — surface an honest, generic error
          // rather than guessing.
          throw new Error('Failed to join team');
        }

        // NOT contains(coaches, :coachId) is what failed — this user is
        // already a coach on the team. The ordinary way this happens: a
        // second, still-PENDING invitation to the same email/team is
        // accepted after the first one already succeeded (sendTeamInvitation
        // has no duplicate-invite guard, so this is routine, not an edge
        // case). The whole transaction above rolled back together, so this
        // invitation's own status write never actually applied even though
        // its condition passed — re-issue it alone now that we've confirmed
        // no team-side write is needed, matching today's pre-transaction
        // behavior for the same case.
        try {
          await docClient.send(new UpdateCommand({
            TableName: teamInvitationTable,
            Key: { id: invitationId },
            ...invitationAcceptUpdate,
          }));
          invitation = { ...invitation, status: 'ACCEPTED', acceptedBy: userId };
        } catch (retryError) {
          if (!isConditionalCheckFailed(retryError)) {
            throw retryError;
          }
          invitation = await classifyInvitationConflict(teamInvitationTable, invitationId, userId, authenticatedEmail);
        }
      } else {
        // Cancelled for a reason unrelated to either condition (e.g. a
        // throughput/validation error on one item) — surface as-is rather
        // than mis-classify it as an archived-team or conflict error.
        throw error;
      }
    }
  } else {
    if (!(invitation.status === 'ACCEPTED' && invitation.acceptedBy === userId)) {
      throw toInvitationStateError(invitation.status);
    }

    // Idempotent path: this call never attempts an invitation-status
    // transition (some prior call already fully committed it). Best-effort
    // repair for pre-migration partial-failure drift where the invitation
    // was marked ACCEPTED but the coaches append never happened.
    // Deliberately NOT archived-gated (Decision 6): this repairs an
    // already-granted membership, it does not grant a new one, so an
    // archived team must not block it. This branch IS reachable by a
    // non-Lambda path (any coach can write ACCEPTED/acceptedBy directly on
    // TeamInvitation via allow.ownersDefinedIn('coaches')), but that's a
    // policy bypass by a party who already holds coach-level access to the
    // team, not a privilege escalation for an untrusted party — so leaving
    // it archived-unaware is safe, not just convenient.
    try {
      await docClient.send(new UpdateCommand({
        TableName: teamTable,
        Key: { id: invitation.teamId },
        UpdateExpression: 'SET coaches = list_append(if_not_exists(coaches, :emptyCoaches), :coachToAdd), updatedAt = :updatedAt',
        ConditionExpression: 'attribute_not_exists(coaches) OR NOT contains(coaches, :coachId)',
        ExpressionAttributeValues: {
          ':emptyCoaches': [],
          ':coachToAdd': [userId],
          ':coachId': userId,
          ':updatedAt': new Date().toISOString(),
        },
      }));
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }
      // Already a coach — nothing to repair.
    }
  }

  // Fresh timestamp for the child-record coaches backfill below — both
  // branches above (transactional accept, idempotent repair) have already
  // committed whatever team/invitation state they needed to by this point.
  const updatedAtIso = new Date().toISOString();

  const teamResponseBeforeBackfill = await docClient.send(new GetCommand({
    TableName: teamTable,
    Key: { id: invitation.teamId },
  }));

  const team = teamResponseBeforeBackfill.Item as TeamRecord | undefined;
  if (!team) {
    throw new Error('Team not found');
  }

  if (!Array.isArray(team.coaches) || !team.coaches.includes(userId)) {
    throw new Error('Team coach update failed');
  }

  const mergedTeamCoaches = team.coaches;

  // Backfill TeamRoster coaches for this team.
  const rosterRecords = await scanByField<TeamRosterBackfillRecord>(
    docClient,
    teamRosterTable,
    'teamId',
    invitation.teamId,
    ['id', 'coaches', 'playerId'],
  );

  await Promise.all(rosterRecords.map((record) =>
    updateRecordCoachesIfNeeded(teamRosterTable, record, mergedTeamCoaches, updatedAtIso)
  ));

  // Backfill Player coaches for players assigned to this team's roster.
  const rosterPlayerIds = Array.from(new Set(
    rosterRecords
      .map((record) => record.playerId)
      .filter((playerId): playerId is string => typeof playerId === 'string' && playerId.length > 0)
  ));

  const rosterPlayers = await Promise.all(
    rosterPlayerIds.map((playerId) => getRecordById<CoachScopedRecord>(docClient, playerTable, playerId, ['id', 'coaches']))
  );

  await Promise.all(
    rosterPlayers
      .filter((player): player is CoachScopedRecord => player !== null)
      .map((player) => updateRecordCoachesIfNeeded(playerTable, player, mergedTeamCoaches, updatedAtIso))
  );

  // Backfill Team's formation and formation positions to keep lineup workflows visible.
  const formationId = typeof team.formationId === 'string' ? team.formationId : null;
  if (formationId) {
    const formation = await getRecordById<CoachScopedRecord>(docClient, formationTable, formationId, ['id', 'coaches']);
    if (formation) {
      await updateRecordCoachesIfNeeded(formationTable, formation, mergedTeamCoaches, updatedAtIso);
    }

    const formationPositions = await scanByField<CoachScopedRecord>(
      docClient,
      formationPositionTable,
      'formationId',
      formationId,
      ['id', 'coaches'],
    );

    await Promise.all(
      formationPositions.map((position) =>
        updateRecordCoachesIfNeeded(formationPositionTable, position, mergedTeamCoaches, updatedAtIso)
      )
    );
  }

  // Backfill Game coaches for this team so shared users can see games.
  const gameRecords = await scanByField<CoachScopedRecord>(
    docClient,
    gameTable,
    'teamId',
    invitation.teamId,
    ['id', 'coaches'],
  );

  await withBoundedConcurrency(gameRecords, 10, (record) =>
    updateRecordCoachesIfNeeded(gameTable, record, mergedTeamCoaches, updatedAtIso)
  );

  // 4. Return the updated team
  const teamResponse = await docClient.send(new GetCommand({
    TableName: teamTable,
    Key: { id: invitation.teamId }
  }));
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return teamResponse.Item as any;
};
