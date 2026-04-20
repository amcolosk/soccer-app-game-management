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
import { deleteGameNote } from './functions/delete-game-note/resource';
import { upsertCoachProfile } from './functions/upsert-coach-profile/resource';
import { getTeamCoachProfiles } from './functions/get-team-coach-profiles/resource';
import { deleteFormationSafe } from './functions/delete-formation-safe/resource';
import { deleteGameSafe } from './functions/delete-game-safe/resource';
import { deleteTeamSafe } from './functions/delete-team-safe/resource';
import { deletePlayerSafe } from './functions/delete-player-safe/resource';

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
  deleteGameNote,
  upsertCoachProfile,
  getTeamCoachProfiles,
  deleteFormationSafe,
  deleteGameSafe,
  deleteTeamSafe,
  deletePlayerSafe,
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
const playTimeRecordTable = backend.data.resources.tables['PlayTimeRecord'];
const goalTable = backend.data.resources.tables['Goal'];
const substitutionTable = backend.data.resources.tables['Substitution'];
const lineupAssignmentTable = backend.data.resources.tables['LineupAssignment'];
const playerAvailabilityTable = backend.data.resources.tables['PlayerAvailability'];
const gamePlanTable = backend.data.resources.tables['GamePlan'];
const plannedRotationTable = backend.data.resources.tables['PlannedRotation'];
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
teamTable.grantReadData(backend.updateGameNote.resources.lambda);
teamRosterTable.grantReadData(backend.updateGameNote.resources.lambda);
backend.updateGameNote.addEnvironment('GAME_NOTE_TABLE', gameNoteTable.tableName);
backend.updateGameNote.addEnvironment('GAME_TABLE', gameTable.tableName);
backend.updateGameNote.addEnvironment('TEAM_TABLE', teamTable.tableName);
backend.updateGameNote.addEnvironment('TEAM_ROSTER_TABLE', teamRosterTable.tableName);

// Grant table access for deleteGameNote Lambda (authoritative secure delete)
gameNoteTable.grantReadWriteData(backend.deleteGameNote.resources.lambda);
gameTable.grantReadData(backend.deleteGameNote.resources.lambda);
teamTable.grantReadData(backend.deleteGameNote.resources.lambda);
backend.deleteGameNote.addEnvironment('GAME_NOTE_TABLE', gameNoteTable.tableName);
backend.deleteGameNote.addEnvironment('GAME_TABLE', gameTable.tableName);
backend.deleteGameNote.addEnvironment('TEAM_TABLE', teamTable.tableName);

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

// Grant table access for deleteFormationSafe Lambda (authoritative deletion guard)
formationTable.grantReadWriteData(backend.deleteFormationSafe.resources.lambda);
formationPositionTable.grantReadWriteData(backend.deleteFormationSafe.resources.lambda);
teamTable.grantReadData(backend.deleteFormationSafe.resources.lambda);
backend.deleteFormationSafe.addEnvironment('FORMATION_TABLE', formationTable.tableName);
backend.deleteFormationSafe.addEnvironment('FORMATION_POSITION_TABLE', formationPositionTable.tableName);
backend.deleteFormationSafe.addEnvironment('TEAM_TABLE', teamTable.tableName);

// Grant table access for deleteGameSafe Lambda (authoritative game delete with rollback)
gameTable.grantReadWriteData(backend.deleteGameSafe.resources.lambda);
playTimeRecordTable.grantReadWriteData(backend.deleteGameSafe.resources.lambda);
goalTable.grantReadWriteData(backend.deleteGameSafe.resources.lambda);
gameNoteTable.grantReadWriteData(backend.deleteGameSafe.resources.lambda);
substitutionTable.grantReadWriteData(backend.deleteGameSafe.resources.lambda);
lineupAssignmentTable.grantReadWriteData(backend.deleteGameSafe.resources.lambda);
playerAvailabilityTable.grantReadWriteData(backend.deleteGameSafe.resources.lambda);
gamePlanTable.grantReadWriteData(backend.deleteGameSafe.resources.lambda);
plannedRotationTable.grantReadWriteData(backend.deleteGameSafe.resources.lambda);
backend.deleteGameSafe.addEnvironment('GAME_TABLE', gameTable.tableName);
backend.deleteGameSafe.addEnvironment('PLAY_TIME_RECORD_TABLE', playTimeRecordTable.tableName);
backend.deleteGameSafe.addEnvironment('GOAL_TABLE', goalTable.tableName);
backend.deleteGameSafe.addEnvironment('GAME_NOTE_TABLE', gameNoteTable.tableName);
backend.deleteGameSafe.addEnvironment('SUBSTITUTION_TABLE', substitutionTable.tableName);
backend.deleteGameSafe.addEnvironment('LINEUP_ASSIGNMENT_TABLE', lineupAssignmentTable.tableName);
backend.deleteGameSafe.addEnvironment('PLAYER_AVAILABILITY_TABLE', playerAvailabilityTable.tableName);
backend.deleteGameSafe.addEnvironment('GAME_PLAN_TABLE', gamePlanTable.tableName);
backend.deleteGameSafe.addEnvironment('PLANNED_ROTATION_TABLE', plannedRotationTable.tableName);

// Grant table access for deleteTeamSafe Lambda (authoritative team delete with rollback)
teamTable.grantReadWriteData(backend.deleteTeamSafe.resources.lambda);
gameTable.grantReadWriteData(backend.deleteTeamSafe.resources.lambda);
teamRosterTable.grantReadWriteData(backend.deleteTeamSafe.resources.lambda);
teamInvitationTable.grantReadWriteData(backend.deleteTeamSafe.resources.lambda);
playTimeRecordTable.grantReadWriteData(backend.deleteTeamSafe.resources.lambda);
goalTable.grantReadWriteData(backend.deleteTeamSafe.resources.lambda);
gameNoteTable.grantReadWriteData(backend.deleteTeamSafe.resources.lambda);
substitutionTable.grantReadWriteData(backend.deleteTeamSafe.resources.lambda);
lineupAssignmentTable.grantReadWriteData(backend.deleteTeamSafe.resources.lambda);
playerAvailabilityTable.grantReadWriteData(backend.deleteTeamSafe.resources.lambda);
gamePlanTable.grantReadWriteData(backend.deleteTeamSafe.resources.lambda);
plannedRotationTable.grantReadWriteData(backend.deleteTeamSafe.resources.lambda);
backend.deleteTeamSafe.addEnvironment('TEAM_TABLE', teamTable.tableName);
backend.deleteTeamSafe.addEnvironment('GAME_TABLE', gameTable.tableName);
backend.deleteTeamSafe.addEnvironment('TEAM_ROSTER_TABLE', teamRosterTable.tableName);
backend.deleteTeamSafe.addEnvironment('TEAM_INVITATION_TABLE', teamInvitationTable.tableName);
backend.deleteTeamSafe.addEnvironment('PLAY_TIME_RECORD_TABLE', playTimeRecordTable.tableName);
backend.deleteTeamSafe.addEnvironment('GOAL_TABLE', goalTable.tableName);
backend.deleteTeamSafe.addEnvironment('GAME_NOTE_TABLE', gameNoteTable.tableName);
backend.deleteTeamSafe.addEnvironment('SUBSTITUTION_TABLE', substitutionTable.tableName);
backend.deleteTeamSafe.addEnvironment('LINEUP_ASSIGNMENT_TABLE', lineupAssignmentTable.tableName);
backend.deleteTeamSafe.addEnvironment('PLAYER_AVAILABILITY_TABLE', playerAvailabilityTable.tableName);
backend.deleteTeamSafe.addEnvironment('GAME_PLAN_TABLE', gamePlanTable.tableName);
backend.deleteTeamSafe.addEnvironment('PLANNED_ROTATION_TABLE', plannedRotationTable.tableName);

// Grant table access for deletePlayerSafe Lambda (authoritative player delete with rollback)
playerTable.grantReadWriteData(backend.deletePlayerSafe.resources.lambda);
teamRosterTable.grantReadWriteData(backend.deletePlayerSafe.resources.lambda);
playTimeRecordTable.grantReadWriteData(backend.deletePlayerSafe.resources.lambda);
goalTable.grantReadWriteData(backend.deletePlayerSafe.resources.lambda);
gameNoteTable.grantReadWriteData(backend.deletePlayerSafe.resources.lambda);
playerAvailabilityTable.grantReadWriteData(backend.deletePlayerSafe.resources.lambda);
backend.deletePlayerSafe.addEnvironment('PLAYER_TABLE', playerTable.tableName);
backend.deletePlayerSafe.addEnvironment('TEAM_ROSTER_TABLE', teamRosterTable.tableName);
backend.deletePlayerSafe.addEnvironment('PLAY_TIME_RECORD_TABLE', playTimeRecordTable.tableName);
backend.deletePlayerSafe.addEnvironment('GOAL_TABLE', goalTable.tableName);
backend.deletePlayerSafe.addEnvironment('GAME_NOTE_TABLE', gameNoteTable.tableName);
backend.deletePlayerSafe.addEnvironment('PLAYER_AVAILABILITY_TABLE', playerAvailabilityTable.tableName);
