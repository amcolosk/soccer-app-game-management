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

// Grant the acceptInvitation Lambda function access to the data API
backend.acceptInvitation.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: [
      'dynamodb:GetItem',
      'dynamodb:UpdateItem',
      'dynamodb:Query'
    ],
    resources: [
      backend.data.resources.tables['Team'].tableArn,
      backend.data.resources.tables['TeamInvitation'].tableArn,
    ],
  })
);

// Add table names as environment variables using CDK
const { Stack } = await import('aws-cdk-lib');
const stack = Stack.of(backend.acceptInvitation.resources.lambda);
const cfnFunction = backend.acceptInvitation.resources.lambda.node.defaultChild;
if (cfnFunction) {
  (cfnFunction as any).addPropertyOverride('Environment.Variables.TEAM_TABLE', backend.data.resources.tables['Team'].tableName);
  (cfnFunction as any).addPropertyOverride('Environment.Variables.TEAM_INVITATION_TABLE', backend.data.resources.tables['TeamInvitation'].tableName);
}
