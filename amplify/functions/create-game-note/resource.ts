import { defineFunction } from '@aws-amplify/backend';

export const createGameNote = defineFunction({
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});
