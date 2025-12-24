import { defineFunction } from '@aws-amplify/backend';

export const getUserInvitations = defineFunction({
  name: 'get-user-invitations',
  entry: './handler.ts',
  timeoutSeconds: 30,
  resourceGroupName: 'data', // Assign to data stack to avoid circular dependency
});
