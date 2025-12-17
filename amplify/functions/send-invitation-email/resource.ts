import { defineFunction } from '@aws-amplify/backend';

export const sendInvitationEmail = defineFunction({
  name: 'send-invitation-email',
  entry: './handler.ts',
  environment: {
    FROM_EMAIL: 'amcolosk@gmail.com', // TODO: Update with your verified SES email
    APP_URL: process.env.APP_URL || 'http://localhost:5173'
  }
});
