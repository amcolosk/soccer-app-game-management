import { defineFunction } from '@aws-amplify/backend';

export const archiveTeam = defineFunction({
  name: 'archive-team-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 60,
  resourceGroupName: 'data',
});
