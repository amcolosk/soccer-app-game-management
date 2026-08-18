import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
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

type Handler = Schema['restoreTeam']['functionHandler'];

// Owner-authorized restore: reactivates the team and clears current archive
// audit metadata. Does NOT revive invitations expired during archiving —
// that is explicitly out of scope per the plan. Deterministic/idempotent
// when called repeatedly.
export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito;
  const callerSub = identity?.sub;

  if (!callerSub) {
    throw new Error('User not authenticated');
  }

  const teamId = event.arguments.teamId;
  const teamTable = process.env.TEAM_TABLE;

  if (!teamTable) {
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
    throw new Error('Team has no assigned owner. Assign an owner before restoring.');
  }

  if (team.ownerId !== callerSub) {
    throw new Error('Access denied: only the team owner can restore this team');
  }

  if (team.status === 'archived') {
    const nowIso = new Date().toISOString();
    try {
      await docClient.send(new UpdateCommand({
        TableName: teamTable,
        Key: { id: teamId },
        UpdateExpression: 'SET #status = :activeStatus, updatedAt = :updatedAt REMOVE archivedAt, archivedBy',
        ConditionExpression: 'ownerId = :callerSub',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':activeStatus': 'active',
          ':updatedAt': nowIso,
          ':callerSub': callerSub,
        },
      }));
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        throw new Error('Access denied: only the team owner can restore this team');
      }
      throw error;
    }
  }

  const updatedTeamResponse = await docClient.send(new GetCommand({
    TableName: teamTable,
    Key: { id: teamId },
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return updatedTeamResponse.Item as any;
};
