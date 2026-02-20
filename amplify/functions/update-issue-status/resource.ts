import { defineFunction } from '@aws-amplify/backend';

export const updateIssueStatus = defineFunction({
  name: 'update-issue-status-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 15,
  resourceGroupName: 'data',
});
