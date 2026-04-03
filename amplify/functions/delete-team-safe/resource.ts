import { defineFunction } from '@aws-amplify/backend';

export const deleteTeamSafe = defineFunction({
  name: 'delete-team-safe-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 60,
  resourceGroupName: 'data',
});
