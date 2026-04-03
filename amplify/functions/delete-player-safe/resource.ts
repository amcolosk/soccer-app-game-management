import { defineFunction } from '@aws-amplify/backend';

export const deletePlayerSafe = defineFunction({
  name: 'delete-player-safe-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 60,
  resourceGroupName: 'data',
});
