import { defineStorage } from '@aws-amplify/backend';

export const storage = defineStorage({
  name: 'teamtrackStorage',
  access: () => ({
    // No paths currently require client-accessible storage.
    // Bug report screenshots are uploaded to GitHub Issues directly by the Lambda.
  }),
});
