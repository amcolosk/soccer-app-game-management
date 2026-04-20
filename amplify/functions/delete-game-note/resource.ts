import { defineFunction } from '@aws-amplify/backend';

export const deleteGameNote = defineFunction({
  name: 'delete-game-note-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});
