import { defineFunction } from '@aws-amplify/backend';

export const sendInvitationEmail = defineFunction({
  name: 'send-invitation-email-handler',
  entry: './handler.ts',
  runtime: 22,
  environment: {
    FROM_EMAIL: 'TeamTrack Support <admin@coachteamtrack.com>',
    APP_URL: process.env.APP_URL || 'http://localhost:5173'
  }
});
