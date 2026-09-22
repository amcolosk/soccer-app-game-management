import { defineFunction } from '@aws-amplify/backend';

export const listTeamShareLinks = defineFunction({
  name: 'list-team-share-links-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});
