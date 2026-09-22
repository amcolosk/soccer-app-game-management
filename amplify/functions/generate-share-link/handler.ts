import type { AppSyncIdentityCognito } from 'aws-lambda';
import { randomBytes } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../../data/resource';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const VALID_TYPES = ['FAN', 'STAT_TRACKER'] as const;
type ShareLinkType = (typeof VALID_TYPES)[number];

function isValidType(value: unknown): value is ShareLinkType {
  return typeof value === 'string' && (VALID_TYPES as readonly string[]).includes(value);
}

type Handler = Schema['generateShareLink']['functionHandler'];

// Coach-authenticated custom mutation, mirroring createGameSafe's in-handler
// authorization-check pattern: caller must be in the team's own coaches
// array (checked server-side, not trusted from the client), and archived
// teams reject new link creation (same archived-team guard shape as
// createGameSafe).
export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito;
  const callerSub = identity?.sub;
  if (typeof callerSub !== 'string' || callerSub.length === 0) {
    throw new Error('User not authenticated');
  }

  const { teamId, type } = event.arguments;

  if (!isValidType(type)) {
    throw new Error("type must be 'FAN' or 'STAT_TRACKER'");
  }

  const shareLinkTable = process.env.SHARE_LINK_TABLE;
  const teamTable = process.env.TEAM_TABLE;
  if (!shareLinkTable || !teamTable) {
    throw new Error('Required environment variables are not set');
  }

  const teamResponse = await docClient.send(new GetCommand({
    TableName: teamTable,
    Key: { id: teamId },
    ProjectionExpression: 'id, coaches, #status',
    ExpressionAttributeNames: { '#status': 'status' },
    ConsistentRead: true,
  }));

  const team = teamResponse.Item as { id: string; coaches?: string[]; status?: string } | undefined;
  if (!team) {
    throw new Error('Team not found');
  }

  const coaches = team.coaches ?? [];
  if (!coaches.includes(callerSub)) {
    throw new Error('Access denied: caller is not a coach on this team');
  }

  if (team.status === 'archived') {
    throw new Error('Cannot generate a share link for an archived team. Restore the team first.');
  }

  const now = new Date().toISOString();
  const token = randomBytes(18).toString('base64url');

  const newLink = {
    token,
    __typename: 'ShareLink',
    teamId,
    type,
    createdBy: callerSub,
    issuedAt: now,
    revokedAt: null,
  };

  // Create the new link BEFORE revoking the old one, not after — if this
  // process dies between the two steps, the team is left with two active
  // links (a coach can manually clean up) rather than zero (a fan/helper
  // silently locked out, with no coach action able to fix it faster than
  // generating a replacement anyway).
  await docClient.send(new PutCommand({
    TableName: shareLinkTable,
    Item: newLink,
  }));

  // Revoke any other existing active link of this same type for the team.
  const existingLinksResponse = await docClient.send(new QueryCommand({
    TableName: shareLinkTable,
    IndexName: 'shareLinksByTeamId',
    KeyConditionExpression: 'teamId = :teamId',
    ExpressionAttributeValues: { ':teamId': teamId },
  }));

  const existingLinks = (existingLinksResponse.Items as Array<{ token: string; type?: string; revokedAt?: string | null }> | undefined) ?? [];
  const linksToRevoke = existingLinks.filter((link) => link.type === type && link.token !== token && !link.revokedAt);

  await Promise.all(linksToRevoke.map((link) =>
    docClient.send(new UpdateCommand({
      TableName: shareLinkTable,
      Key: { token: link.token },
      UpdateExpression: 'SET revokedAt = :revokedAt',
      ConditionExpression: 'attribute_not_exists(revokedAt) OR revokedAt = :null',
      ExpressionAttributeValues: { ':revokedAt': now, ':null': null },
    })).catch(() => {
      // Best-effort: a concurrent revoke/regenerate already handled it.
    }),
  ));

  return {
    token: newLink.token,
    type: newLink.type,
    issuedAt: newLink.issuedAt,
    revokedAt: null,
  };
};
