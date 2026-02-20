import type { Schema } from '../../data/resource';
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const ses = new SESClient({ region: process.env.AWS_REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));
const FROM_EMAIL = process.env.FROM_EMAIL || 'admin@coachteamtrack.com';
const TO_EMAIL = process.env.TO_EMAIL || 'admin@coachteamtrack.com';
const ISSUE_TABLE = process.env.ISSUE_TABLE_NAME;
const ISSUE_COUNTER_TABLE = process.env.ISSUE_COUNTER_TABLE_NAME;

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

export function buildTextBody(input: BugReportInput): string {
  return [
    input.severity === 'feature-request' ? 'Feature Request' : `Bug Report — ${input.severity.toUpperCase()}`,
    '',
    `Description: ${input.description}`,
    input.steps ? `Steps: ${input.steps}` : '',
    `Reporter: ${input.userEmail} (${input.userId})`,
    '',
    'System Info:',
    ...Object.entries(input.systemInfo).map(([k, v]) => `  ${k}: ${v}`),
  ].filter(Boolean).join('\n');
}

export function buildHtmlBody(input: BugReportInput): string {
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

export const handler: Schema['submitBugReport']['functionHandler'] = async (event) => {
  console.log('Bug report submission received');

  const identity = event.identity as AppSyncIdentityCognito;
  const { description, steps, severity, systemInfo } = event.arguments;

  const input: BugReportInput = {
    description,
    steps: steps || undefined,
    severity: sanitizeSeverity(severity || 'medium'),
    systemInfo: parseSystemInfo(systemInfo),
    userEmail: resolveUserEmail(identity),
    userId: identity?.sub || 'unknown',
  };

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
            Html: { Data: buildHtmlBody(input) },
            Text: { Data: buildTextBody(input) },
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
