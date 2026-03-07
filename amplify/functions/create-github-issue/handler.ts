import type { Schema } from '../../data/resource';
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';


const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));

const RATE_LIMIT_TABLE = process.env.RATE_LIMIT_TABLE_NAME ?? '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? '';
const GITHUB_REPO = process.env.GITHUB_REPO ?? '';

// Input validation limits
export const MAX_DESCRIPTION_LENGTH = 5000;
export const MAX_STEPS_LENGTH = 10000;

// Rate limiting
const MAX_REPORTS_PER_HOUR = 5;

const VALID_SEVERITIES = ['low', 'medium', 'high', 'feature-request'] as const;
type ValidSeverity = (typeof VALID_SEVERITIES)[number];

export interface CreateGitHubIssueArgs {
  type: string;
  severity: string;
  description: string;
  steps?: string;
  systemInfo?: string;
}

export interface SystemInfo {
  userAgent?: string;
  screenSize?: string;
  viewport?: string;
  timestamp?: string;
  url?: string;
  version?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

export function sanitizeSeverity(severity: string): ValidSeverity {
  return (VALID_SEVERITIES as readonly string[]).includes(severity)
    ? (severity as ValidSeverity)
    : 'medium';
}

export function buildIssueTitle(description: string): string {
  return description.replace(/[\r\n]+/g, ' ').slice(0, 80);
}

export function buildIssueBody(
  description: string,
  steps: string | undefined,
  systemInfo: SystemInfo,
  reporterEmail: string,
): string {
  const systemRows = [
    ['App Version', systemInfo.version ?? 'unknown'],
    ['Browser', systemInfo.userAgent ?? 'unknown'],
    ['Screen', systemInfo.screenSize ?? 'unknown'],
    ['Viewport', systemInfo.viewport ?? 'unknown'],
    ['URL', systemInfo.url ?? 'unknown'],
    ['Reported', systemInfo.timestamp ?? new Date().toISOString()],
    ['Reporter', reporterEmail],
  ]
    .map(([k, v]) => `| ${k} | ${v} |`)
    .join('\n');

  return [
    '## Description',
    description,
    '',
    '## Steps to Reproduce',
    steps || '_Not provided_',
    '',
    '## System Info',
    '| Field | Value |',
    '|-------|-------|',
    systemRows,
    '',
    '---',
    '_Filed automatically by TeamTrack in-app bug reporter_',
  ].join('\n');
}

export function resolveLabels(type: string, severity: string): string[] {
  const sanitized = sanitizeSeverity(severity);
  const typeLabel = type === 'FEATURE_REQUEST' ? 'enhancement' : 'bug';
  // feature-request severity → just the type label (no separate severity label)
  if (sanitized === 'feature-request') return [typeLabel];
  return [typeLabel, `severity:${sanitized}`];
}

export function validateInputLengths(description: string, steps?: string): void {
  if (!description?.trim()) {
    throw new Error('Description is required');
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(`Description must be under ${MAX_DESCRIPTION_LENGTH} characters`);
  }
  if (steps && steps.length > MAX_STEPS_LENGTH) {
    throw new Error(`Steps must be under ${MAX_STEPS_LENGTH} characters`);
  }
}

export function parseSystemInfo(raw: string | undefined): SystemInfo {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as SystemInfo;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

export async function checkRateLimit(userId: string): Promise<void> {
  if (!RATE_LIMIT_TABLE) {
    console.warn('RATE_LIMIT_TABLE_NAME not set — skipping rate limit check');
    return;
  }
  const hourBucket = new Date().toISOString().slice(0, 13); // "2026-03-07T14"
  const ttl = Math.floor(Date.now() / 1000) + 2 * 60 * 60; // TTL: 2 hours from now

  const result = await ddb.send(
    new UpdateCommand({
      TableName: RATE_LIMIT_TABLE,
      Key: { userId, hourBucket },
      UpdateExpression: 'ADD #count :one SET #ttl = if_not_exists(#ttl, :ttl)',
      ExpressionAttributeNames: { '#count': 'count', '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':one': 1, ':ttl': ttl },
      ReturnValues: 'ALL_NEW',
    }),
  );

  const count = (result.Attributes?.['count'] as number) ?? 0;
  if (count > MAX_REPORTS_PER_HOUR) {
    throw new Error('Rate limit exceeded. Try again later.');
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler: Schema['createGitHubIssue']['functionHandler'] = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito | undefined;
  const userId = identity?.sub ?? 'anonymous';
  const userEmail = (identity?.claims?.['email'] as string | undefined) ?? 'unknown';

  const args = event.arguments as unknown as CreateGitHubIssueArgs;
  const { type, severity, description, steps, systemInfo: rawSystemInfo } = args;

  // Log minimal context
  console.log(JSON.stringify({ action: 'createGitHubIssue', type, severity, userId }));

  // Validate input
  validateInputLengths(description, steps);

  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.error('GITHUB_TOKEN or GITHUB_REPO not configured');
    throw new Error('Failed to file report. Please try again.');
  }

  // Rate limit
  await checkRateLimit(userId);

  const systemInfo = parseSystemInfo(rawSystemInfo);
  const title = buildIssueTitle(description);
  const body = buildIssueBody(description, steps, systemInfo, userEmail);
  const labels = resolveLabels(type ?? 'BUG', sanitizeSeverity(severity));

  // Create GitHub Issue
  const [owner, repo] = GITHUB_REPO.split('/');
  const issueResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ title, body, labels }),
  });

  if (!issueResponse.ok) {
    console.error('GitHub Issues API error:', issueResponse.status);
    throw new Error('Failed to file report. Please try again.');
  }

  const issue = (await issueResponse.json()) as { number: number; html_url: string };
  return JSON.stringify({ issueNumber: issue.number, issueUrl: issue.html_url });
};
