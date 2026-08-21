import { defineFunction } from '@aws-amplify/backend';

export const createGame = defineFunction({
  name: 'create-game-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});
