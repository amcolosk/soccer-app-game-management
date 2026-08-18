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

type Handler = Schema['assignTeamOwner']['functionHandler'];

// First-come-first-served-by-any-existing-coach owner assignment for legacy
// (ownerless) teams. A conditional attribute_not_exists(ownerId) write ensures
// only one concurrent caller can win the race.
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

  const coaches = team.coaches as string[] | undefined;
  if (!coaches?.includes(callerSub)) {
    throw new Error('Access denied: caller is not a coach on this team');
  }

  try {
    await docClient.send(new UpdateCommand({
      TableName: teamTable,
      Key: { id: teamId },
      UpdateExpression: 'SET ownerId = :ownerId, updatedAt = :updatedAt',
      ConditionExpression: 'attribute_not_exists(ownerId)',
      ExpressionAttributeValues: {
        ':ownerId': callerSub,
        ':updatedAt': new Date().toISOString(),
      },
    }));
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      throw new Error('Team already has an owner');
    }
    throw error;
  }

  const updatedTeamResponse = await docClient.send(new GetCommand({
    TableName: teamTable,
    Key: { id: teamId },
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return updatedTeamResponse.Item as any;
};
