import { defineFunction } from '@aws-amplify/backend';

export const restoreTeam = defineFunction({
  name: 'restore-team-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});
