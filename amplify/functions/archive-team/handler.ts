import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../../data/resource';

type DbItem = Record<string, unknown> & { id: string };

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

function isConditionalCheckFailed(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  return (error as { name?: unknown }).name === 'ConditionalCheckFailedException';
}

async function scanAll(tableName: string, filterExpression: string, expressionAttributeValues: Record<string, unknown>, expressionAttributeNames?: Record<string, string>): Promise<DbItem[]> {
  const results: DbItem[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const response = await docClient.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: expressionAttributeNames,
      ExclusiveStartKey: exclusiveStartKey,
    }));

    if (response.Items) {
      results.push(...(response.Items as DbItem[]));
    }

    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return results;
}

type Handler = Schema['archiveTeam']['functionHandler'];

// Owner-authorized archive: sets lifecycle/audit fields and expires pending
// invitations. Reuses delete-team-safe's fetch-check-write conventions, but
// requires strict owner equality (team.ownerId === callerSub) rather than
// any-coach membership. Deterministic when called repeatedly (idempotent no-op
// if already archived).
export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito;
  const callerSub = identity?.sub;

  if (!callerSub) {
    throw new Error('User not authenticated');
  }

  const teamId = event.arguments.teamId;
  const teamTable = process.env.TEAM_TABLE;
  const teamInvitationTable = process.env.TEAM_INVITATION_TABLE;

  if (!teamTable || !teamInvitationTable) {
    throw new Error('Required environment variables are not set');
  }

  const teamResponse = await docClient.send(new GetCommand({
    TableName: teamTable,
    Key: { id: teamId },
  }));

  const team = teamResponse.Item as DbItem | undefined;
  if (!team) {
    throw new Error('Team not found');
  }

  if (!team.ownerId) {
    throw new Error('Team has no assigned owner. Assign an owner before archiving.');
  }

  if (team.ownerId !== callerSub) {
    throw new Error('Access denied: only the team owner can archive this team');
  }

  const nowIso = new Date().toISOString();

  if (team.status !== 'archived') {
    try {
      await docClient.send(new UpdateCommand({
        TableName: teamTable,
        Key: { id: teamId },
        UpdateExpression: 'SET #status = :archivedStatus, archivedAt = :archivedAt, archivedBy = :archivedBy, updatedAt = :updatedAt',
        ConditionExpression: 'ownerId = :callerSub',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':archivedStatus': 'archived',
          ':archivedAt': nowIso,
          ':archivedBy': callerSub,
          ':updatedAt': nowIso,
          ':callerSub': callerSub,
        },
      }));
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        throw new Error('Access denied: only the team owner can archive this team');
      }
      throw error;
    }

    // Expire pending invitations. Best-effort per-item conditional updates;
    // a race with accept-invitation is resolved by that Lambda's own
    // transactional condition against Team.status.
    const pendingInvitations = await scanAll(
      teamInvitationTable,
      'teamId = :teamId AND #status = :pendingStatus',
      { ':teamId': teamId, ':pendingStatus': 'PENDING' },
      { '#status': 'status' },
    );

    await Promise.all(pendingInvitations.map(async (invitation) => {
      try {
        await docClient.send(new UpdateCommand({
          TableName: teamInvitationTable,
          Key: { id: invitation.id },
          UpdateExpression: 'SET #status = :expiredStatus, updatedAt = :updatedAt',
          ConditionExpression: '#status = :pendingStatus',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':expiredStatus': 'EXPIRED',
            ':pendingStatus': 'PENDING',
            ':updatedAt': nowIso,
          },
        }));
      } catch (error) {
        if (!isConditionalCheckFailed(error)) {
          throw error;
        }
        // Already transitioned out of PENDING (e.g. concurrent acceptance) — ignore.
      }
    }));
  }

  const updatedTeamResponse = await docClient.send(new GetCommand({
    TableName: teamTable,
    Key: { id: teamId },
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return updatedTeamResponse.Item as any;
};
