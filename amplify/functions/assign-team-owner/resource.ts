import { defineFunction } from '@aws-amplify/backend';

export const assignTeamOwner = defineFunction({
  name: 'assign-team-owner-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});
