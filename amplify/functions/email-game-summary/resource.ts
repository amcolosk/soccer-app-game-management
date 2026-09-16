import { defineFunction } from '@aws-amplify/backend';

export const emailGameSummary = defineFunction({
  name: 'email-game-summary-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 60, // Cognito AdminGetUser + 2 point reads + 2 GSI queries + BatchGet + SES send, cold start — matches revoke-coach-access's 60s (not assign-team-owner's 30s single-item one)
  resourceGroupName: 'data',
  environment: {
    FROM_EMAIL: 'TeamTrack Support <admin@coachteamtrack.com>',
  },
});
