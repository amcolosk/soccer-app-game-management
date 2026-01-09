import { defineFunction } from '@aws-amplify/backend';

export const acceptInvitation = defineFunction({
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 60,
  resourceGroupName: 'data',
});
