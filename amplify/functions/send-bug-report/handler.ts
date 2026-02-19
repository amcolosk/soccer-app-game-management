import type { Schema } from '../../data/resource';
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ses = new SESClient({ region: process.env.AWS_REGION });
const FROM_EMAIL = process.env.FROM_EMAIL || 'admin@coachteamtrack.com';
const TO_EMAIL = process.env.TO_EMAIL || 'amcolosk+teamtrack@gmail.com';

export const handler: Schema['submitBugReport']['functionHandler'] = async (event) => {
  console.log('Bug report submission received');

  const identity = event.identity as AppSyncIdentityCognito;
  const userId = identity?.sub || 'unknown';
  const userEmail = (identity?.claims?.email
    || identity?.claims?.username
    || identity?.claims?.['cognito:username']
    || 'unknown') as string;

  const { description, steps, severity, systemInfo } = event.arguments;

  let parsedSystemInfo: Record<string, string> = {};
  try {
    parsedSystemInfo = JSON.parse(systemInfo || '{}');
  } catch {
    parsedSystemInfo = { raw: systemInfo || '' };
  }

  const severityEmoji: Record<string, string> = {
    low: '🟢',
    medium: '🟡',
    high: '🔴',
  };

  const emailHtml = `
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
        <h2 style="margin:0">${severityEmoji[severity || 'medium'] || '🟡'} Bug Report — ${(severity || 'medium').toUpperCase()}</h2>
      </div>
      <div class="content">
        <div class="field">
          <div class="field-label">Severity</div>
          <div class="field-value">
            <span class="severity-badge severity-${severity || 'medium'}">${(severity || 'medium').toUpperCase()}</span>
          </div>
        </div>

        <div class="field">
          <div class="field-label">Description</div>
          <div class="field-value">${escapeHtml(description)}</div>
        </div>

        ${steps ? `
        <div class="field">
          <div class="field-label">Steps to Reproduce</div>
          <div class="field-value" style="white-space: pre-wrap;">${escapeHtml(steps)}</div>
        </div>
        ` : ''}

        <div class="field">
          <div class="field-label">Reporter</div>
          <div class="field-value">${escapeHtml(userEmail)} (${userId})</div>
        </div>

        <div class="field">
          <div class="field-label">System Information</div>
          <div class="field-value">
            <table class="system-info">
              ${Object.entries(parsedSystemInfo).map(([key, val]) =>
                `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(String(val))}</td></tr>`
              ).join('')}
            </table>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  const emailText = [
    `Bug Report — ${(severity || 'medium').toUpperCase()}`,
    '',
    `Description: ${description}`,
    steps ? `Steps: ${steps}` : '',
    `Reporter: ${userEmail} (${userId})`,
    '',
    'System Info:',
    ...Object.entries(parsedSystemInfo).map(([k, v]) => `  ${k}: ${v}`),
  ].filter(Boolean).join('\n');

  try {
    await ses.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [TO_EMAIL] },
      Message: {
        Subject: { Data: `${severityEmoji[severity || 'medium'] || '🟡'} TeamTrack Bug: ${description.replace(/[\r\n]+/g, ' ').slice(0, 80)}` },
        Body: {
          Html: { Data: emailHtml },
          Text: { Data: emailText },
        },
      },
    }));

    console.log('Bug report email sent successfully');
    return true;
  } catch (error) {
    console.error('Failed to send bug report email:', error);
    throw new Error('Failed to send bug report email');
  }
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
