import { defineFunction } from '@aws-amplify/backend';

export const submitStatEvent = defineFunction({
  name: 'submit-stat-event-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});
