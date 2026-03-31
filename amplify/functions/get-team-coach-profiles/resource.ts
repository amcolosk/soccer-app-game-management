import { defineFunction } from '@aws-amplify/backend';

export const getTeamCoachProfiles = defineFunction({
  name: 'get-team-coach-profiles-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 60,
  resourceGroupName: 'data',
});
