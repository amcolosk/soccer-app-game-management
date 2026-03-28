import type { Schema } from "../../data/resource";
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

type CoachScopedRecord = {
  id: string;
  coaches?: string[];
};

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

function normalizeEmail(value: string | undefined | null): string {
  if (!value) {
    return '';
  }

  return value.trim().toLowerCase();
}

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

function isConditionalCheckFailed(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeName = (error as { name?: unknown }).name;
  return maybeName === 'ConditionalCheckFailedException';
}

async function updateRecordCoachesIfNeeded(
  tableName: string,
  record: CoachScopedRecord,
  teamCoaches: string[],
  updatedAtIso: string,
): Promise<boolean> {
  let latestRecord = record;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!shouldBackfillCoaches(latestRecord.coaches, teamCoaches)) {
      return false;
    }

    const mergedCoaches = mergeCoachLists(latestRecord.coaches, teamCoaches);

    try {
      if (latestRecord.coaches === undefined) {
        await docClient.send(new UpdateCommand({
          TableName: tableName,
          Key: { id: latestRecord.id },
          UpdateExpression: 'SET coaches = :coaches, updatedAt = :updatedAt',
          ConditionExpression: 'attribute_not_exists(coaches)',
          ExpressionAttributeValues: {
            ':coaches': mergedCoaches,
            ':updatedAt': updatedAtIso,
          },
        }));
      } else {
        await docClient.send(new UpdateCommand({
          TableName: tableName,
          Key: { id: latestRecord.id },
          UpdateExpression: 'SET coaches = :coaches, updatedAt = :updatedAt',
          ConditionExpression: 'coaches = :expectedCoaches',
          ExpressionAttributeValues: {
            ':coaches': mergedCoaches,
            ':expectedCoaches': latestRecord.coaches,
            ':updatedAt': updatedAtIso,
          },
        }));
      }

      return true;
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }

      const refreshed = await getRecordById<CoachScopedRecord>(tableName, latestRecord.id, ['id', 'coaches']);
      if (!refreshed) {
        return false;
      }

      latestRecord = refreshed;
    }
  }

  throw new Error(`Failed to backfill coaches for record ${latestRecord.id} in ${tableName} after concurrent update retries`);
}

async function scanByField<T extends Record<string, unknown>>(
  tableName: string,
  fieldName: string,
  fieldValue: string,
  projectionFields: string[],
): Promise<T[]> {
  const results: T[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const scanResult = await docClient.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: '#field = :fieldValue',
      ExpressionAttributeNames: { '#field': fieldName },
      ExpressionAttributeValues: { ':fieldValue': fieldValue },
      ProjectionExpression: projectionFields.join(', '),
      ExclusiveStartKey: exclusiveStartKey,
    }));

    results.push(...((scanResult.Items as T[] | undefined) ?? []));
    exclusiveStartKey = scanResult.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return results;
}

async function getRecordById<T extends Record<string, unknown>>(
  tableName: string,
  id: string,
  projectionFields: string[],
): Promise<T | null> {
  const response = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: { id },
    ProjectionExpression: projectionFields.join(', '),
  }));

  return (response.Item as T | undefined) ?? null;
}

export const handler: Schema['acceptInvitation']['functionHandler'] = async (event) => {
  const { invitationId } = event.arguments;
  
  // Get user ID from Cognito identity
  const identity = event.identity as AppSyncIdentityCognito;
  const userId = identity?.sub;
  const authenticatedEmail = normalizeEmail(identity?.claims?.email);

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

  if (
    !teamInvitationTable ||
    !teamTable ||
    !teamRosterTable ||
    !playerTable ||
    !formationTable ||
    !formationPositionTable
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

    try {
      await docClient.send(new UpdateCommand({
        TableName: teamInvitationTable,
        Key: { id: invitationId },
        UpdateExpression: 'SET #status = :acceptedStatus, acceptedAt = :acceptedAt, acceptedBy = :acceptedBy, updatedAt = :updatedAt',
        ConditionExpression: '#status = :pendingStatus',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':acceptedStatus': 'ACCEPTED',
          ':pendingStatus': 'PENDING',
          ':acceptedAt': new Date().toISOString(),
          ':acceptedBy': userId,
          ':updatedAt': new Date().toISOString(),
        }
      }));

      invitation = {
        ...invitation,
        status: 'ACCEPTED',
        acceptedBy: userId,
      };
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }

      const latestInvitation = await getRecordById<InvitationRecord>(
        teamInvitationTable,
        invitationId,
        ['id', 'teamId', 'email', 'status', 'acceptedBy', 'expiresAt'],
      );

      if (!latestInvitation) {
        throw new Error('Invitation not found');
      }

      invitation = {
        ...latestInvitation,
        status: latestInvitation.status,
      };

      if (normalizeEmail(invitation.email) !== authenticatedEmail) {
        throw new Error('Invitation recipient mismatch');
      }

      if (!(invitation.status === 'ACCEPTED' && invitation.acceptedBy === userId)) {
        throw toInvitationStateError(invitation.status);
      }
    }
  } else if (!(invitation.status === 'ACCEPTED' && invitation.acceptedBy === userId)) {
    throw toInvitationStateError(invitation.status);
  }

  // 3. Concurrency-safe team coach merge. Append the accepting coach atomically if needed.
  const updatedAtIso = new Date().toISOString();
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
        ':updatedAt': updatedAtIso,
      },
    }));
  } catch (error) {
    if (!isConditionalCheckFailed(error)) {
      throw error;
    }
    // Another concurrent acceptance may have already appended this user. Continue idempotently.
  }

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
    rosterPlayerIds.map((playerId) => getRecordById<CoachScopedRecord>(playerTable, playerId, ['id', 'coaches']))
  );

  await Promise.all(
    rosterPlayers
      .filter((player): player is CoachScopedRecord => player !== null)
      .map((player) => updateRecordCoachesIfNeeded(playerTable, player, mergedTeamCoaches, updatedAtIso))
  );

  // Backfill Team's formation and formation positions to keep lineup workflows visible.
  const formationId = typeof team.formationId === 'string' ? team.formationId : null;
  if (formationId) {
    const formation = await getRecordById<CoachScopedRecord>(formationTable, formationId, ['id', 'coaches']);
    if (formation) {
      await updateRecordCoachesIfNeeded(formationTable, formation, mergedTeamCoaches, updatedAtIso);
    }

    const formationPositions = await scanByField<CoachScopedRecord>(
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

  // 4. Return the updated team
  const teamResponse = await docClient.send(new GetCommand({
    TableName: teamTable,
    Key: { id: invitation.teamId }
  }));
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return teamResponse.Item as any;
};
