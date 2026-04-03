import { defineFunction } from '@aws-amplify/backend';

export const deleteGameSafe = defineFunction({
  name: 'delete-game-safe-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 60,
  resourceGroupName: 'data',
});
