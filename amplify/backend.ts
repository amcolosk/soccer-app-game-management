import { defineBackend } from '@aws-amplify/backend';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { sendInvitationEmail } from './functions/send-invitation-email/resource';
import { acceptInvitation } from './functions/accept-invitation/resource';
import { getUserInvitations } from './functions/get-user-invitations/resource';
import { createGitHubIssue } from './functions/create-github-issue/resource';
import { createGameNote } from './functions/create-game-note/resource';
import { updateGameNote } from './functions/update-game-note/resource';
import { upsertCoachProfile } from './functions/upsert-coach-profile/resource';
import { getTeamCoachProfiles } from './functions/get-team-coach-profiles/resource';

const backend = defineBackend({
  auth,
  data,
  storage,
  sendInvitationEmail,
  acceptInvitation,
  getUserInvitations,
  createGitHubIssue,
  createGameNote,
  updateGameNote,
  upsertCoachProfile,
  getTeamCoachProfiles,
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

// SES configuration set ARN (used automatically by SES when a config set is attached to the identity)
const sesConfigSetArn = `arn:aws:ses:${region}:${accountId}:configuration-set/teamtrack-email-configuration`;

// Grant the sendInvitationEmail Lambda permission to send emails via SES
backend.sendInvitationEmail.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['ses:SendEmail', 'ses:SendRawEmail'],
    resources: [sesIdentityArn, sesConfigSetArn],
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
const playerTable = backend.data.resources.tables['Player'];
const formationTable = backend.data.resources.tables['Formation'];
const formationPositionTable = backend.data.resources.tables['FormationPosition'];
const teamRosterTable = backend.data.resources.tables['TeamRoster'];
const gameTable = backend.data.resources.tables['Game'];
teamTable.grantReadWriteData(backend.acceptInvitation.resources.lambda);
teamInvitationTable.grantReadWriteData(backend.acceptInvitation.resources.lambda);
playerTable.grantReadWriteData(backend.acceptInvitation.resources.lambda);
formationTable.grantReadWriteData(backend.acceptInvitation.resources.lambda);
formationPositionTable.grantReadWriteData(backend.acceptInvitation.resources.lambda);
teamRosterTable.grantReadWriteData(backend.acceptInvitation.resources.lambda);
gameTable.grantReadWriteData(backend.acceptInvitation.resources.lambda);

// Add table names as environment variables
backend.acceptInvitation.addEnvironment('TEAM_TABLE', teamTable.tableName);
backend.acceptInvitation.addEnvironment('TEAM_INVITATION_TABLE', teamInvitationTable.tableName);
backend.acceptInvitation.addEnvironment('PLAYER_TABLE', playerTable.tableName);
backend.acceptInvitation.addEnvironment('FORMATION_TABLE', formationTable.tableName);
backend.acceptInvitation.addEnvironment('FORMATION_POSITION_TABLE', formationPositionTable.tableName);
backend.acceptInvitation.addEnvironment('TEAM_ROSTER_TABLE', teamRosterTable.tableName);
backend.acceptInvitation.addEnvironment('GAME_TABLE', gameTable.tableName);

// Grant Cognito access for acceptInvitation Lambda to fetch user email if missing in claims
backend.acceptInvitation.addEnvironment(
  'USER_POOL_ID',
  backend.auth.resources.userPool.userPoolId
);
backend.acceptInvitation.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['cognito-idp:AdminGetUser'],
    resources: [backend.auth.resources.userPool.userPoolArn],
  })
);

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

// Grant table access for createGitHubIssue Lambda (rate limiting table only)
const rateLimitTable = backend.data.resources.tables['BugReportRateLimit'];
rateLimitTable.grantReadWriteData(backend.createGitHubIssue.resources.lambda);
backend.createGitHubIssue.addEnvironment('RATE_LIMIT_TABLE_NAME', rateLimitTable.tableName);

// GitHub API credentials for creating issues from bug reports
// Store GITHUB_TOKEN in .env.local (never commit) and set via Amplify secrets in CI
const githubToken = process.env.GITHUB_TOKEN || '';
if (githubToken) {
  backend.createGitHubIssue.addEnvironment('GITHUB_TOKEN', githubToken);
}
const githubRepo = process.env.GITHUB_REPO || '';
if (githubRepo) {
  backend.createGitHubIssue.addEnvironment('GITHUB_REPO', githubRepo);
}

// Grant table access for createGameNote Lambda (secure custom mutation)
const gameNoteTable = backend.data.resources.tables['GameNote'];
gameNoteTable.grantReadWriteData(backend.createGameNote.resources.lambda);
gameTable.grantReadData(backend.createGameNote.resources.lambda);
teamRosterTable.grantReadData(backend.createGameNote.resources.lambda);
backend.createGameNote.addEnvironment('GAME_NOTE_TABLE', gameNoteTable.tableName);
backend.createGameNote.addEnvironment('GAME_TABLE', gameTable.tableName);
backend.createGameNote.addEnvironment('TEAM_ROSTER_TABLE', teamRosterTable.tableName);

// Grant table access for updateGameNote Lambda (secure custom mutation)
gameNoteTable.grantReadWriteData(backend.updateGameNote.resources.lambda);
gameTable.grantReadData(backend.updateGameNote.resources.lambda);
teamRosterTable.grantReadData(backend.updateGameNote.resources.lambda);
backend.updateGameNote.addEnvironment('GAME_NOTE_TABLE', gameNoteTable.tableName);
backend.updateGameNote.addEnvironment('GAME_TABLE', gameTable.tableName);
backend.updateGameNote.addEnvironment('TEAM_ROSTER_TABLE', teamRosterTable.tableName);

// Grant table access for upsertCoachProfile Lambda (least-privilege: CoachProfile only)
const coachProfileTable = backend.data.resources.tables['CoachProfile'];
backend.upsertCoachProfile.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
    resources: [coachProfileTable.tableArn],
  })
);
backend.upsertCoachProfile.addEnvironment('COACH_PROFILE_TABLE', coachProfileTable.tableName);

// Grant table access for getTeamCoachProfiles Lambda (read-only: Team + CoachProfile)
backend.getTeamCoachProfiles.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['dynamodb:GetItem'],
    resources: [teamTable.tableArn],
  })
);
backend.getTeamCoachProfiles.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['dynamodb:GetItem', 'dynamodb:BatchGetItem'],
    resources: [coachProfileTable.tableArn],
  })
);
backend.getTeamCoachProfiles.addEnvironment('TEAM_TABLE', teamTable.tableName);
backend.getTeamCoachProfiles.addEnvironment('COACH_PROFILE_TABLE', coachProfileTable.tableName);
