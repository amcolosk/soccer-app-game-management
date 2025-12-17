import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { DynamoDBRecord, AttributeValue } from 'aws-lambda';

const ses = new SESClient({ region: process.env.AWS_REGION });
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@yourdomain.com';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

interface DynamoDBStreamEvent {
  Records: DynamoDBRecord[];
}

export const handler = async (event: DynamoDBStreamEvent) => {
  console.log('Processing invitation email event:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    if (record.eventName === 'INSERT' && record.dynamodb?.NewImage) {
      try {
        const invitation = unmarshallRecord(record.dynamodb.NewImage);
        
        // Only send email for new pending invitations
        if (invitation.status === 'PENDING') {
          await sendInvitationEmail(invitation);
        }
      } catch (error) {
        console.error('Error processing invitation:', error);
        // Continue processing other records
      }
    }
  }

  return { statusCode: 200, body: 'OK' };
};

function unmarshallRecord(item: Record<string, AttributeValue>): any {
  const result: any = {};
  
  for (const [key, value] of Object.entries(item)) {
    if (value.S !== undefined) {
      result[key] = value.S;
    } else if (value.N !== undefined) {
      result[key] = Number(value.N);
    } else if (value.BOOL !== undefined) {
      result[key] = value.BOOL;
    } else if (value.NULL !== undefined) {
      result[key] = null;
    }
  }
  
  return result;
}

async function sendInvitationEmail(invitation: any) {
  // DynamoDB stores the field as 'email', not 'inviteeEmail'
  const recipientEmail = invitation.email || invitation.inviteeEmail;
  console.log('Sending invitation email to:', recipientEmail);
  
  if (!recipientEmail) {
    console.error('No email address found in invitation:', invitation);
    throw new Error('No email address provided in invitation');
  }
  
  // Determine if this is a season or team invitation based on the presence of seasonId or teamId
  const invitationType = invitation.seasonId ? 'season' : 'team';
  const resourceId = invitation.seasonId || invitation.teamId;
  const acceptUrl = `${APP_URL}?invitationId=${invitation.id}`;
  
  const roleDisplay = invitation.role === 'PARENT' 
    ? 'Parent (Read-only)' 
    : invitation.role;

  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 30px;
          text-align: center;
          border-radius: 8px 8px 0 0;
        }
        .content {
          background: #f9f9f9;
          padding: 30px;
          border-radius: 0 0 8px 8px;
        }
        .cta-button {
          display: inline-block;
          background: #667eea;
          color: white;
          padding: 12px 30px;
          text-decoration: none;
          border-radius: 6px;
          margin: 20px 0;
          font-weight: bold;
        }
        .role-badge {
          background: #667eea;
          color: white;
          padding: 4px 12px;
          border-radius: 12px;
          font-weight: 600;
          display: inline-block;
        }
        .footer {
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid #ddd;
          font-size: 0.9em;
          color: #666;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>🎉 You're Invited!</h1>
      </div>
      <div class="content">
        <p>Hello!</p>
        
        <p>You've been invited to join a ${invitationType} as a <span class="role-badge">${roleDisplay}</span>.</p>
        
        ${invitationType === 'season' 
          ? '<p>By accepting this invitation, you\'ll be able to see and manage all teams in this season.</p>'
          : '<p>By accepting this invitation, you\'ll be able to help manage this team.</p>'
        }
        
        <p style="text-align: center;">
          <a href="${acceptUrl}" class="cta-button">Accept Invitation</a>
        </p>
        
        <p style="font-size: 0.9em; color: #666;">
          Or copy and paste this link into your browser:<br>
          <code>${acceptUrl}</code>
        </p>
        
        <div class="footer">
          <p><strong>Important:</strong> This invitation will expire on ${new Date(invitation.expiresAt).toLocaleDateString()}.</p>
          <p>If you don't recognize this invitation or believe you received it in error, you can safely ignore this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const emailParams = {
    Source: FROM_EMAIL,
    Destination: {
      ToAddresses: [recipientEmail]
    },
    Message: {
      Subject: {
        Data: `You've been invited to join a ${invitationType}!`,
        Charset: 'UTF-8'
      },
      Body: {
        Html: {
          Data: emailHtml,
          Charset: 'UTF-8'
        },
        Text: {
          Data: `
You've been invited to join a ${invitationType} as a ${roleDisplay}.

${invitationType === 'season' 
  ? 'By accepting this invitation, you\'ll be able to see and manage all teams in this season.'
  : 'By accepting this invitation, you\'ll be able to help manage this team.'
}

To accept this invitation, click the link below or copy it into your browser:
${acceptUrl}

This invitation will expire on ${new Date(invitation.expiresAt).toLocaleDateString()}.

If you don't recognize this invitation or believe you received it in error, you can safely ignore this email.
          `,
          Charset: 'UTF-8'
        }
      }
    }
  };

  try {
    const command = new SendEmailCommand(emailParams);
    const response = await ses.send(command);
    console.log('Email sent successfully:', response.MessageId);
  } catch (error) {
    console.error('Failed to send email:', error);
    throw error;
  }
}
