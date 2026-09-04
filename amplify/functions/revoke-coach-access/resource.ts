import { defineFunction } from '@aws-amplify/backend';

export const revokeCoachAccess = defineFunction({
  name: 'revoke-coach-access-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 60, // matches accept-invitation/archive-team's scan-heavy handlers, not assign-team-owner's 30s single-item one
  resourceGroupName: 'data',
});
