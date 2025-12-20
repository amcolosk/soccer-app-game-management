import { defineFunction } from '@aws-amplify/backend';

export const acceptInvitation = defineFunction({
  name: 'accept-invitation',
  entry: './handler.ts',
  timeoutSeconds: 60,
});
