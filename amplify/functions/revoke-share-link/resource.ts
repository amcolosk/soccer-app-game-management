import { defineFunction } from '@aws-amplify/backend';

export const revokeShareLink = defineFunction({
  name: 'revoke-share-link-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});
