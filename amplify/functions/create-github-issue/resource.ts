import { defineFunction, secret } from '@aws-amplify/backend';

export const createGitHubIssue = defineFunction({
  name: 'create-github-issue-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30, // GitHub API calls can be slow
  resourceGroupName: 'data',
  environment: {
    GITHUB_TOKEN: secret('GITHUB_TOKEN'),
    GITHUB_REPO: secret('GITHUB_REPO'),
  },
});
