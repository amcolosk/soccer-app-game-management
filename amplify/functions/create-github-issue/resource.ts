import { defineFunction } from '@aws-amplify/backend';

export const createGitHubIssue = defineFunction({
  name: 'create-github-issue-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30, // GitHub API calls can be slow
  resourceGroupName: 'data',
});
