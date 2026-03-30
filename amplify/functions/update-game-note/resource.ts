import { defineFunction } from '@aws-amplify/backend';

export const updateGameNote = defineFunction({
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});
