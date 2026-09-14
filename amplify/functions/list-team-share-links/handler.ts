import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../../data/resource';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

type Handler = Schema['listTeamShareLinks']['functionHandler'];

// Coach-authenticated: verify caller membership on the team, then return
// every ShareLink (active and revoked) for InvitationManagement.tsx's Share
// Links display, curated down to ShareLinkSummary — never a.ref('ShareLink')
// directly (ShareLink has zero client grants; see resource.ts comment).
export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito;
  const callerSub = identity?.sub;
  if (typeof callerSub !== 'string' || callerSub.length === 0) {
    throw new Error('User not authenticated');
  }

  const { teamId } = event.arguments;

  const shareLinkTable = process.env.SHARE_LINK_TABLE;
  const teamTable = process.env.TEAM_TABLE;
  if (!shareLinkTable || !teamTable) {
    throw new Error('Required environment variables are not set');
  }

  const teamResponse = await docClient.send(new GetCommand({
    TableName: teamTable,
    Key: { id: teamId },
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

  const links: Array<{ token: string; type?: string; issuedAt: string; revokedAt?: string | null }> = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const response = await docClient.send(new QueryCommand({
      TableName: shareLinkTable,
      IndexName: 'shareLinksByTeamId',
      KeyConditionExpression: 'teamId = :teamId',
      ExpressionAttributeValues: { ':teamId': teamId },
      ExclusiveStartKey: exclusiveStartKey,
    }));

    if (response.Items) {
      links.push(...(response.Items as typeof links));
    }
    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return links.map((link) => ({
    token: link.token,
    type: link.type ?? null,
    issuedAt: link.issuedAt,
    revokedAt: link.revokedAt ?? null,
  }));
};
