import { defineFunction, secret } from '@aws-amplify/backend';

export const sendBugReport = defineFunction({
  name: 'send-bug-report-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 15,
  resourceGroupName: 'data',
  environment: {
    FROM_EMAIL: 'TeamTrack Bug Reports <admin@coachteamtrack.com>',
  },
});
