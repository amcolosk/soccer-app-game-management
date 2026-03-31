import { defineFunction } from '@aws-amplify/backend';

export const upsertCoachProfile = defineFunction({
  name: 'upsert-coach-profile-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 60,
  resourceGroupName: 'data',
});
