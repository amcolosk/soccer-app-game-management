import { defineFunction } from '@aws-amplify/backend';

export const unlinkTeamCalendar = defineFunction({
  name: 'unlink-team-calendar-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});
