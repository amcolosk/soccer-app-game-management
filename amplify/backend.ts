import { defineBackend } from '@aws-amplify/backend';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { sendInvitationEmail } from './functions/send-invitation-email/resource';
import { acceptInvitation } from './functions/accept-invitation/resource';

const backend = defineBackend({
  auth,
  data,
  sendInvitationEmail,
  acceptInvitation,
});

// Grant the Lambda function permission to send emails via SES
backend.sendInvitationEmail.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['ses:SendEmail', 'ses:SendRawEmail'],
    resources: ['*'],
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
