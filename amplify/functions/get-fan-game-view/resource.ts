import { defineFunction } from '@aws-amplify/backend';

export const getFanGameView = defineFunction({
  name: 'get-fan-game-view-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});
