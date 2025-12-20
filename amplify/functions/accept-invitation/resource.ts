import { defineFunction } from '@aws-amplify/backend';

export const acceptInvitation = defineFunction({
  name: 'acceptInvitation',
  entry: './handler.ts',
  timeoutSeconds: 60,
  environment: {
    // Will be populated by Amplify with the GraphQL endpoint
  },
});
