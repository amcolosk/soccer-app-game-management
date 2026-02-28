import type { Schema } from '../../data/resource';
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { S3Client, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const ses = new SESClient({ region: process.env.AWS_REGION });
const s3 = new S3Client({ region: process.env.AWS_REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));
const FROM_EMAIL = process.env.FROM_EMAIL || 'admin@coachteamtrack.com';
const TO_EMAIL = process.env.TO_EMAIL || 'admin@coachteamtrack.com';
const ISSUE_TABLE = process.env.ISSUE_TABLE_NAME;
const ISSUE_COUNTER_TABLE = process.env.ISSUE_COUNTER_TABLE_NAME;
const STORAGE_BUCKET_NAME = process.env.STORAGE_BUCKET_NAME;
// Matches: bug-screenshots/{identityId}/{uuid}.{ext}
// identityId format: region:cognito-id (e.g. us-east-1:f81d4fae-...)
const SCREENSHOT_KEY_PATTERN = /^bug-screenshots\/[a-zA-Z0-9:_-]+\/[a-f0-9-]+\.(png|jpg)$/;
const MAX_SCREENSHOT_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// Input validation limits
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_STEPS_LENGTH = 3000;

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REPORTS_PER_WINDOW = 5;

export interface BugReportInput {
  description: string;
  steps?: string;
  severity: string;
  systemInfo: Record<string, string>;
  userEmail: string;
  userId: string;
}

const VALID_SEVERITIES = ['low', 'medium', 'high', 'feature-request'] as const;

const SEVERITY_EMOJI: Record<string, string> = {
  low: '🟢',
  medium: '🟡',
  high: '🔴',
  'feature-request': '💡',
};

/**
 * Validates the screenshotKey format to prevent path traversal attacks.
 * Throws if the key is present but doesn't match the expected pattern.
 */
export function validateScreenshotKey(key: string | undefined | null): void {
  if (key && !SCREENSHOT_KEY_PATTERN.test(key)) {
    throw new Error('Invalid screenshotKey format');
  }
}

export function sanitizeSeverity(severity: string): string {
  return (VALID_SEVERITIES as readonly string[]).includes(severity) ? severity : 'medium';
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildSubject(input: BugReportInput): string {
  const emoji = SEVERITY_EMOJI[input.severity] || '🟡';
  const label = input.severity === 'feature-request' ? 'Feature Request' : 'Bug';
  const desc = input.description.replace(/[\r\n]+/g, ' ').slice(0, 80);
  return `${emoji} TeamTrack ${label}: ${desc}`;
}

export function buildTextBody(input: BugReportInput, screenshotUrl?: string | null): string {
  return [
    input.severity === 'feature-request' ? 'Feature Request' : `Bug Report — ${input.severity.toUpperCase()}`,
    '',
    `Description: ${input.description}`,
    input.steps ? `Steps: ${input.steps}` : '',
    `Reporter: ${input.userEmail} (${input.userId})`,
    '',
    'System Info:',
    ...Object.entries(input.systemInfo).map(([k, v]) => `  ${k}: ${v}`),
    screenshotUrl ? `\nScreenshot: ${screenshotUrl}` : '',
  ].filter(Boolean).join('\n');
}

export function buildHtmlBody(input: BugReportInput, screenshotUrl?: string | null): string {
  const severity = input.severity || 'medium';
  const emoji = SEVERITY_EMOJI[severity] || '🟡';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 700px; margin: 0 auto; padding: 20px; }
        .header { background: #d32f2f; color: white; padding: 20px 30px; border-radius: 8px 8px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
        .field { margin-bottom: 16px; }
        .field-label { font-weight: bold; color: #555; font-size: 0.9em; text-transform: uppercase; letter-spacing: 0.5px; }
        .field-value { margin-top: 4px; padding: 10px; background: white; border-radius: 4px; border-left: 3px solid #d32f2f; }
        .severity-badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-weight: 600; color: white; }
        .severity-low { background: #4caf50; }
        .severity-medium { background: #ff9800; }
        .severity-high { background: #d32f2f; }
        .system-info { font-size: 0.85em; color: #666; }
        .system-info td { padding: 3px 10px 3px 0; }
        .system-info td:first-child { font-weight: bold; white-space: nowrap; }
      </style>
    </head>
    <body>
      <div class="header">
        <h2 style="margin:0">${emoji} ${severity === 'feature-request' ? 'Feature Request' : `Bug Report — ${severity.toUpperCase()}`}</h2>
      </div>
      <div class="content">
        <div class="field">
          <div class="field-label">Severity</div>
          <div class="field-value">
            <span class="severity-badge severity-${severity}">${severity.toUpperCase()}</span>
          </div>
        </div>

        <div class="field">
          <div class="field-label">Description</div>
          <div class="field-value">${escapeHtml(input.description)}</div>
        </div>

        ${input.steps ? `
        <div class="field">
          <div class="field-label">Steps to Reproduce</div>
          <div class="field-value" style="white-space: pre-wrap;">${escapeHtml(input.steps)}</div>
        </div>
        ` : ''}

        <div class="field">
          <div class="field-label">Reporter</div>
          <div class="field-value">${escapeHtml(input.userEmail)} (${input.userId})</div>
        </div>

        <div class="field">
          <div class="field-label">System Information</div>
          <div class="field-value">
            <table class="system-info">
              ${Object.entries(input.systemInfo).map(([key, val]) =>
                `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(String(val))}</td></tr>`
              ).join('')}
            </table>
          </div>
        </div>

        ${screenshotUrl ? `
        <div class="field">
          <div class="field-label">Screenshot</div>
          <div class="field-value">
            <a href="${screenshotUrl}"
               style="display:inline-block;padding:8px 16px;background:#1976d2;color:white;text-decoration:none;border-radius:4px;font-weight:600;">
              View Screenshot ↗
            </a>
            <span style="font-size:0.8em;color:#888;margin-left:8px;">Link expires in 7 days</span>
          </div>
        </div>
        ` : ''}
      </div>
    </body>
    </html>
  `;
}

export function resolveUserEmail(identity: AppSyncIdentityCognito | undefined | null): string {
  if (!identity) return 'unknown';
  return (identity.claims?.email
    || identity.claims?.username
    || identity.claims?.['cognito:username']
    || 'unknown') as string;
}

export function parseSystemInfo(raw: string | undefined | null): Record<string, string> {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return { raw: raw || '' };
  }
}

export async function getNextIssueNumber(): Promise<number> {
  const result = await ddb.send(new UpdateCommand({
    TableName: ISSUE_COUNTER_TABLE!,
    Key: { id: 'issue-counter' },
    UpdateExpression: 'ADD currentValue :inc',
    ExpressionAttributeValues: { ':inc': 1 },
    ReturnValues: 'UPDATED_NEW',
  }));
  return result.Attributes!.currentValue as number;
}

/**
 * Validates input lengths to prevent storage abuse and DoS attacks
 */
export function validateInputLengths(description: string, steps?: string): void {
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(`Description exceeds maximum length of ${MAX_DESCRIPTION_LENGTH} characters`);
  }
  if (steps && steps.length > MAX_STEPS_LENGTH) {
    throw new Error(`Steps exceed maximum length of ${MAX_STEPS_LENGTH} characters`);
  }
}

/**
 * Checks rate limiting to prevent spam/abuse
 * Allows MAX_REPORTS_PER_WINDOW reports per user within RATE_LIMIT_WINDOW_MS
 */
export async function checkRateLimit(userId: string): Promise<void> {
  const now = Date.now();
  const windowStart = new Date(now - RATE_LIMIT_WINDOW_MS).toISOString();

  try {
    // Query all issues created by this user in the time window
    const result = await ddb.send(new QueryCommand({
      TableName: ISSUE_TABLE!,
      IndexName: 'byReporterUserId',
      KeyConditionExpression: 'reporterUserId = :userId',
      FilterExpression: 'createdAt > :windowStart',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':windowStart': windowStart,
      },
      Select: 'COUNT',
    }));

    const recentReports = result.Count || 0;

    if (recentReports >= MAX_REPORTS_PER_WINDOW) {
      throw new Error(
        `Rate limit exceeded. You can submit up to ${MAX_REPORTS_PER_WINDOW} reports per hour. Please try again later.`
      );
    }

    console.log(`Rate limit check passed: ${recentReports}/${MAX_REPORTS_PER_WINDOW} reports in last hour`);
  } catch (error) {
    // If the query fails (e.g., GSI doesn't exist yet), log but allow the request
    // This prevents breaking existing functionality if the GSI isn't deployed yet
    if ((error as Error).message.includes('Rate limit exceeded')) {
      throw error; // Re-throw rate limit errors
    }
    console.warn('Rate limit check failed (allowing request):', error);
  }
}

export const handler: Schema['submitBugReport']['functionHandler'] = async (event) => {
  console.log('Bug report submission received');

  const identity = event.identity as AppSyncIdentityCognito;
  const { description, steps, severity, systemInfo, screenshotKey } = event.arguments;

  // Validate input lengths to prevent storage abuse
  validateInputLengths(description, steps || undefined);

  // Validate screenshotKey format to prevent path traversal
  validateScreenshotKey(screenshotKey);

  // Server-side size enforcement — client-side limit can be bypassed
  let validatedScreenshotKey = screenshotKey || undefined;
  if (validatedScreenshotKey && STORAGE_BUCKET_NAME) {
    try {
      const head = await s3.send(new HeadObjectCommand({
        Bucket: STORAGE_BUCKET_NAME,
        Key: validatedScreenshotKey,
      }));
      if ((head.ContentLength ?? 0) > MAX_SCREENSHOT_SIZE_BYTES) {
        console.warn(`Screenshot exceeds 5 MB (${head.ContentLength} bytes), rejecting`);
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: STORAGE_BUCKET_NAME, Key: validatedScreenshotKey }));
        } catch (delErr) {
          console.error('Failed to delete oversized screenshot:', delErr);
        }
        validatedScreenshotKey = undefined;
      }
    } catch (headErr) {
      console.error('Failed to verify screenshot size, proceeding without screenshot:', headErr);
      validatedScreenshotKey = undefined;
    }
  }

  const userId = identity?.sub || 'unknown';

  // Check rate limiting to prevent spam/abuse
  await checkRateLimit(userId);

  const input: BugReportInput = {
    description,
    steps: steps || undefined,
    severity: sanitizeSeverity(severity || 'medium'),
    systemInfo: parseSystemInfo(systemInfo),
    userEmail: resolveUserEmail(identity),
    userId,
  };

  // Generate 7-day presigned URL for the screenshot (before writing DDB, so email can include it)
  let screenshotUrl: string | null = null;
  if (validatedScreenshotKey && STORAGE_BUCKET_NAME) {
    try {
      screenshotUrl = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: STORAGE_BUCKET_NAME, Key: validatedScreenshotKey }),
        { expiresIn: 7 * 24 * 60 * 60 }
      );
    } catch (urlErr) {
      console.error('Failed to generate screenshot presigned URL (email will not include link):', urlErr);
    }
  }

  // Get sequential issue number
  const issueNumber = await getNextIssueNumber();

  try {
    // Write Issue record to DynamoDB first to ensure it exists before email references it
    const now = new Date().toISOString();
    await ddb.send(new PutCommand({
      TableName: ISSUE_TABLE!,
      Item: {
        id: randomUUID(),
        __typename: 'Issue',
        issueNumber,
        type: input.severity === 'feature-request' ? 'FEATURE_REQUEST' : 'BUG',
        severity: input.severity,
        status: 'OPEN',
        description: input.description,
        steps: input.steps || null,
        systemInfo: JSON.stringify(input.systemInfo),
        screenshotKey: validatedScreenshotKey || null,
        reporterEmail: input.userEmail,
        reporterUserId: input.userId,
        createdAt: now,
        updatedAt: now,
      },
    }));
    console.log(`Issue #${issueNumber} created in DynamoDB`);

    // Send email with issue number in subject (best-effort — don't fail the mutation if email fails)
    try {
      const subject = `${buildSubject(input)} [Issue #${issueNumber}]`;
      await ses.send(new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [TO_EMAIL] },
        Message: {
          Subject: { Data: subject },
          Body: {
            Html: { Data: buildHtmlBody(input, screenshotUrl) },
            Text: { Data: buildTextBody(input, screenshotUrl) },
          },
        },
      }));
      console.log('Bug report email sent successfully');
    } catch (emailError) {
      console.error('Failed to send bug report email (issue still created):', emailError);
    }

    return JSON.stringify({ success: true, issueNumber });
  } catch (error) {
    console.error('Failed to submit bug report:', error);
    throw new Error('Failed to submit bug report');
  }
};
