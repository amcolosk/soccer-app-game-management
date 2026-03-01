import type { Schema } from '../../data/resource';
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));
const s3 = new S3Client({ region: process.env.AWS_REGION });
const ISSUE_TABLE = process.env.ISSUE_TABLE_NAME!;
const AGENT_API_SECRET = process.env.AGENT_API_SECRET;
const DEVELOPER_EMAILS = process.env.DEVELOPER_EMAILS;
const STORAGE_BUCKET_NAME = process.env.STORAGE_BUCKET_NAME;
// Matches: bug-screenshots/{identityId}/{uuid}.{ext}
// identityId format: region:cognito-id (e.g. us-east-1:f81d4fae-...)
const SCREENSHOT_KEY_PATTERN = /^bug-screenshots\/[a-zA-Z0-9:_-]+\/[a-f0-9-]+\.(png|jpg)$/;

const VALID_STATUSES = ['OPEN', 'IN_PROGRESS', 'FIXED', 'DEPLOYED', 'CLOSED'] as const;
const AGENT_ALLOWED_STATUSES: readonly string[] = ['IN_PROGRESS', 'FIXED'];
const SHA_PATTERN = /\b[0-9a-f]{7,40}\b/i;

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

  if (isAuthenticated) {
    // Fail-closed: if DEVELOPER_EMAILS is not configured, deny all authenticated callers.
    // This prevents a misconfigured deployment from silently granting all users write access.
    if (!DEVELOPER_EMAILS) {
      throw new Error('Unauthorized: developer access is not configured');
    }
    const allowlist = DEVELOPER_EMAILS.split(',').map(e => e.trim().toLowerCase());
    const cognitoIdentity = event.identity as AppSyncIdentityCognito;
    // Amplify v6 sends the access token to AppSync; access tokens don't include
    // the email claim by default, so fall back to username (which equals the
    // email for email-based Cognito auth configured with loginWith: { email: true }).
    const callerEmail = ((cognitoIdentity.claims?.email as string) || cognitoIdentity.username || '').toLowerCase();
    if (!allowlist.includes(callerEmail)) {
      throw new Error('Unauthorized: developer access required');
    }
  }

  // Strip secret prefix from resolution if present (agent auth sends it embedded)
  let cleanResolution = resolution;
  if (cleanResolution && AGENT_API_SECRET) {
    const secretPrefix = `SECRET:${AGENT_API_SECRET}`;
    if (cleanResolution.startsWith(secretPrefix)) {
      const rest = cleanResolution.slice(secretPrefix.length);
      cleanResolution = rest.startsWith('|') ? rest.slice(1) : null;
    }
  }

  if (!isAuthenticated && !AGENT_ALLOWED_STATUSES.includes(status)) {
    throw new Error(
      `Unauthorized: agents may only set IN_PROGRESS or FIXED. ` +
      `Use the developer dashboard to set ${status}.`
    );
  }

  if (!isAuthenticated && status === 'FIXED') {
    if (!cleanResolution || !SHA_PATTERN.test(cleanResolution)) {
      throw new Error(
        'Resolution must include a git commit SHA when marking an issue as FIXED. ' +
        'Example: "Fixed in abc1234: corrected halftime timer calculation"'
      );
    }
  }

  if (!validateStatus(status)) {
    throw new Error(`Invalid status: ${status}. Must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  // Query issue by issueNumber GSI
  const queryResult = await ddb.send(new QueryCommand({
    TableName: ISSUE_TABLE,
    IndexName: 'issuesByIssueNumber',
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

  if (cleanResolution !== undefined && cleanResolution !== null && cleanResolution !== '') {
    updateExprParts.push('#resolution = :resolution');
    exprNames['#resolution'] = 'resolution';
    exprValues[':resolution'] = cleanResolution;
  }

  if (status === 'CLOSED') {
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

  // Delete screenshot from S3 on issue close (best-effort — does not fail the status update)
  if (status === 'CLOSED' && issue.screenshotKey && STORAGE_BUCKET_NAME) {
    const key = issue.screenshotKey as string;
    if (SCREENSHOT_KEY_PATTERN.test(key)) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: STORAGE_BUCKET_NAME, Key: key }));
        console.log(`Deleted screenshot: ${key}`);
      } catch (deleteErr) {
        console.error('Failed to delete screenshot (best-effort, not failing update):', deleteErr);
      }
    } else {
      console.warn(`Skipping screenshot delete — unexpected key format: ${key}`);
    }
  }

  // Fail-safe: never return the SECRET prefix to callers even if stripping logic was bypassed
  if (cleanResolution && cleanResolution.startsWith('SECRET:')) {
    cleanResolution = null;
  }

  return JSON.stringify({
    issueNumber,
    status,
    resolution: cleanResolution || issue.resolution || null,
  });
};
