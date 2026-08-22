import { defineFunction } from '@aws-amplify/backend';

export const createGameSafe = defineFunction({
  name: 'create-game-safe-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});
