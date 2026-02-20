import type { Schema } from '../../data/resource';
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));
const ISSUE_TABLE = process.env.ISSUE_TABLE_NAME!;
const AGENT_API_SECRET = process.env.AGENT_API_SECRET;

const VALID_STATUSES = ['OPEN', 'IN_PROGRESS', 'FIXED', 'DEPLOYED', 'CLOSED'] as const;

export function validateStatus(status: string): boolean {
  return (VALID_STATUSES as readonly string[]).includes(status);
}

export const handler: Schema['updateIssueStatus']['functionHandler'] = async (event) => {
  const { issueNumber, status, resolution } = event.arguments;

  // Authorize: either authenticated user or valid agent secret
  const identity = event.identity as AppSyncIdentityCognito | undefined;
  const isAuthenticated = !!identity?.sub;

  if (!isAuthenticated) {
    // API key caller — require agent secret in the resolution field prefix
    // Agent must send "SECRET:<token>|<actual resolution>" or just "SECRET:<token>" if no resolution
    if (!AGENT_API_SECRET) {
      throw new Error('Unauthorized: agent access is not configured');
    }
    const secretPrefix = `SECRET:${AGENT_API_SECRET}`;
    if (!resolution?.startsWith(secretPrefix)) {
      throw new Error('Unauthorized: invalid agent credentials');
    }
  }

  if (!validateStatus(status)) {
    throw new Error(`Invalid status: ${status}. Must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  // Query issue by issueNumber GSI
  const queryResult = await ddb.send(new QueryCommand({
    TableName: ISSUE_TABLE,
    IndexName: 'issueNumberIndex',
    KeyConditionExpression: 'issueNumber = :num',
    ExpressionAttributeValues: { ':num': issueNumber },
  }));

  const issue = queryResult.Items?.[0];
  if (!issue) {
    throw new Error(`Issue #${issueNumber} not found`);
  }

  // Update only status, resolution, and updatedAt
  const updateExprParts = ['#status = :status', '#updatedAt = :now'];
  const exprNames: Record<string, string> = { '#status': 'status', '#updatedAt': 'updatedAt' };
  const exprValues: Record<string, string | null> = {
    ':status': status,
    ':now': new Date().toISOString(),
  };

  // Strip secret prefix from resolution if present (agent auth sends it embedded)
  let cleanResolution = resolution;
  if (cleanResolution && AGENT_API_SECRET) {
    const secretPrefix = `SECRET:${AGENT_API_SECRET}`;
    if (cleanResolution.startsWith(secretPrefix)) {
      const rest = cleanResolution.slice(secretPrefix.length);
      cleanResolution = rest.startsWith('|') ? rest.slice(1) : null;
    }
  }

  if (cleanResolution !== undefined && cleanResolution !== null && cleanResolution !== '') {
    updateExprParts.push('#resolution = :resolution');
    exprNames['#resolution'] = 'resolution';
    exprValues[':resolution'] = cleanResolution;
  }

  if (status === 'CLOSED' || status === 'FIXED' || status === 'DEPLOYED') {
    updateExprParts.push('#closedAt = :closedAt');
    exprNames['#closedAt'] = 'closedAt';
    exprValues[':closedAt'] = new Date().toISOString();
  }

  await ddb.send(new UpdateCommand({
    TableName: ISSUE_TABLE,
    Key: { id: issue.id },
    UpdateExpression: `SET ${updateExprParts.join(', ')}`,
    ExpressionAttributeNames: exprNames,
    ExpressionAttributeValues: exprValues,
  }));

  return JSON.stringify({
    issueNumber,
    status,
    resolution: cleanResolution || issue.resolution || null,
  });
};
