import { defineBackend } from '@aws-amplify/backend';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { sendInvitationEmail } from './functions/send-invitation-email/resource';
import { acceptInvitation } from './functions/accept-invitation/resource';
import { getUserInvitations } from './functions/get-user-invitations/resource';
import { sendBugReport } from './functions/send-bug-report/resource';
import { updateIssueStatus } from './functions/update-issue-status/resource';

const backend = defineBackend({
  auth,
  data,
  sendInvitationEmail,
  acceptInvitation,
  getUserInvitations,
  sendBugReport,
  updateIssueStatus,
});

// Add deployment ID to outputs
const deploymentId = process.env.AWS_APP_ID || 'local';
backend.addOutput({
  custom: {
    deployment_id: deploymentId,
  },
});

// Add GA Measurement ID to outputs
const gaMeasurementId = process.env.GA_MEASUREMENT_ID;
if (gaMeasurementId) {
  backend.addOutput({
    custom: {
      ga_measurement_id: gaMeasurementId,
    },
  });
}

// SES identity ARN for scoped email permissions
const region = backend.stack.region;
const accountId = backend.stack.account;
const sesIdentityArn = `arn:aws:ses:${region}:${accountId}:identity/coachteamtrack.com`;

// Grant the Lambda functions permission to send emails via SES
backend.sendInvitationEmail.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['ses:SendEmail', 'ses:SendRawEmail'],
    resources: [sesIdentityArn],
  })
);

backend.sendBugReport.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['ses:SendEmail'],
    resources: [sesIdentityArn],
  })
);

// Get the DynamoDB table for team invitations
const teamInvitationTable = backend.data.resources.tables['TeamInvitation'];

// Add DynamoDB Stream event source to trigger email sending
backend.sendInvitationEmail.resources.lambda.addEventSource(
  new DynamoEventSource(teamInvitationTable, {
    startingPosition: StartingPosition.LATEST,
    batchSize: 1,
    retryAttempts: 3,
  })
);

// Grant table access for acceptInvitation Lambda
const teamTable = backend.data.resources.tables['Team'];
teamTable.grantReadWriteData(backend.acceptInvitation.resources.lambda);
teamInvitationTable.grantReadWriteData(backend.acceptInvitation.resources.lambda);

// Add table names as environment variables
backend.acceptInvitation.addEnvironment('TEAM_TABLE', teamTable.tableName);
backend.acceptInvitation.addEnvironment('TEAM_INVITATION_TABLE', teamInvitationTable.tableName);

// Grant table access for getUserInvitations Lambda
teamInvitationTable.grantReadData(backend.getUserInvitations.resources.lambda);
backend.getUserInvitations.addEnvironment('TEAMINVITATION_TABLE_NAME', teamInvitationTable.tableName);

// Grant Cognito access for getUserInvitations Lambda to fetch user email if missing in claims
backend.getUserInvitations.addEnvironment(
  'USER_POOL_ID',
  backend.auth.resources.userPool.userPoolId
);

backend.getUserInvitations.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['cognito-idp:AdminGetUser'],
    resources: [backend.auth.resources.userPool.userPoolArn],
  })
);

// Set APP_URL environment variable for sendInvitationEmail based on branch
const branchName = process.env.AWS_BRANCH || 'local';
const appUrl = branchName === 'main' ? 'https://coachteamtrack.com' : 'http://localhost:5173';
backend.sendInvitationEmail.addEnvironment('APP_URL', appUrl);

// Add bug report email from environment variable
const bugReportEmail = process.env.BUG_REPORT_EMAIL || 'admin@coachteamtrack.com';
backend.sendBugReport.addEnvironment('TO_EMAIL', bugReportEmail);

// Grant sendBugReport Lambda access to Issue and IssueCounter tables
const issueTable = backend.data.resources.tables['Issue'];
const issueCounterTable = backend.data.resources.tables['IssueCounter'];
issueTable.grantReadWriteData(backend.sendBugReport.resources.lambda);
issueCounterTable.grantReadWriteData(backend.sendBugReport.resources.lambda);
backend.sendBugReport.addEnvironment('ISSUE_TABLE_NAME', issueTable.tableName);
backend.sendBugReport.addEnvironment('ISSUE_COUNTER_TABLE_NAME', issueCounterTable.tableName);

// Grant updateIssueStatus Lambda access to Issue table only
issueTable.grantReadWriteData(backend.updateIssueStatus.resources.lambda);
backend.updateIssueStatus.addEnvironment('ISSUE_TABLE_NAME', issueTable.tableName);

// Agent API secret for updateIssueStatus authentication
const agentApiSecret = process.env.AGENT_API_SECRET || '';
if (agentApiSecret) {
  backend.updateIssueStatus.addEnvironment('AGENT_API_SECRET', agentApiSecret);
}

// Developer emails allowlist for updateIssueStatus authentication
const developerEmails = process.env.DEVELOPER_EMAILS || '';
if (developerEmails) {
  backend.updateIssueStatus.addEnvironment('DEVELOPER_EMAILS', developerEmails);
}
