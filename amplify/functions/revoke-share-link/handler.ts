import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../../data/resource';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

type Handler = Schema['revokeShareLink']['functionHandler'];

// Coach-authenticated: look up the ShareLink by token, resolve its team,
// verify caller membership, then set revokedAt. Idempotent — revoking an
// already-revoked link is a no-op success, not an error.
export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito;
  const callerSub = identity?.sub;
  if (typeof callerSub !== 'string' || callerSub.length === 0) {
    throw new Error('User not authenticated');
  }

  const { token } = event.arguments;

  const shareLinkTable = process.env.SHARE_LINK_TABLE;
  const teamTable = process.env.TEAM_TABLE;
  if (!shareLinkTable || !teamTable) {
    throw new Error('Required environment variables are not set');
  }

  const linkResponse = await docClient.send(new GetCommand({
    TableName: shareLinkTable,
    Key: { token },
  }));

  const link = linkResponse.Item as { token: string; teamId: string; revokedAt?: string | null } | undefined;
  if (!link) {
    throw new Error('Share link not found');
  }

  const teamResponse = await docClient.send(new GetCommand({
    TableName: teamTable,
    Key: { id: link.teamId },
    ProjectionExpression: 'id, coaches',
    ConsistentRead: true,
  }));
  const team = teamResponse.Item as { id: string; coaches?: string[] } | undefined;
  if (!team) {
    throw new Error('Team not found');
  }

  const coaches = team.coaches ?? [];
  if (!coaches.includes(callerSub)) {
    throw new Error('Access denied: caller is not a coach on this team');
  }

  if (link.revokedAt) {
    return true;
  }

  await docClient.send(new UpdateCommand({
    TableName: shareLinkTable,
    Key: { token },
    UpdateExpression: 'SET revokedAt = :revokedAt',
    ExpressionAttributeValues: { ':revokedAt': new Date().toISOString() },
  }));

  return true;
};
