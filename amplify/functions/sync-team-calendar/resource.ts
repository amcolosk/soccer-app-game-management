import { defineFunction } from '@aws-amplify/backend';

export const syncTeamCalendar = defineFunction({
  name: 'sync-team-calendar-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 60,
  resourceGroupName: 'data',
});
