import { defineFunction } from '@aws-amplify/backend';

export const getUserInvitations = defineFunction({
  name: 'get-user-invitations',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
  resourceGroupName: 'data', // Assign to data stack to avoid circular dependency
});
