import { defineFunction } from '@aws-amplify/backend';

export const acceptInvitation = defineFunction({
  entry: './handler.ts',
  timeoutSeconds: 60,
  resourceGroupName: 'data',
});
