import { defineFunction } from '@aws-amplify/backend';

export const deleteFormationSafe = defineFunction({
  name: 'delete-formation-safe-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});
