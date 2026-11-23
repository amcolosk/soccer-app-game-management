import { defineFunction } from '@aws-amplify/backend';

export const rescindSendOff = defineFunction({
  name: 'rescind-send-off-handler',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});
