import { defineFunction } from '@aws-amplify/backend';

export const generateShareLink = defineFunction({
  name: 'generate-share-link-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});
