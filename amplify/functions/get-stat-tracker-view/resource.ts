import { defineFunction } from '@aws-amplify/backend';

export const getStatTrackerView = defineFunction({
  name: 'get-stat-tracker-view-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});
