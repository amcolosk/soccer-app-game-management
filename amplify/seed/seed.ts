import { defineAuth } from '@aws-amplify/backend';

/**
 * Seed configuration for E2E tests
 * Creates a test user in the Cognito user pool
 */

// const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || 'test@example.com';
// const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || 'TestPassword123!';

// export default defineAuth({
//   loginWith: {
//     email: true,
//   },
// });

// Note: User creation should be done programmatically via AWS SDK
// See scripts/setup-e2e.mjs for implementation

import { readFile } from "node:fs/promises";
import {
  addToUserGroup,
  createAndSignUpUser,
  getSecret,
} from "@aws-amplify/seed";
import { Amplify } from "aws-amplify";
import { TEST_USERS } from "../../test-config.js";

// this is used to get the amplify_outputs.json file as the file will not exist until sandbox is created
const url = new URL("../../amplify_outputs.json", import.meta.url);
const outputs = JSON.parse(await readFile(url, { encoding: "utf8" }));
Amplify.configure(outputs);

// Create first test user
const user1 = await createAndSignUpUser({
  username: TEST_USERS.user1.email,
  password: TEST_USERS.user1.password,
  signInAfterCreation: false,
  signInFlow: "Password",
  userAttributes: {
    locale: "en",
  },
});

console.log(`✓ Created user: ${TEST_USERS.user1.email}`);

// Create second test user
const user2 = await createAndSignUpUser({
  username: TEST_USERS.user2.email,
  password: TEST_USERS.user2.password,
  signInAfterCreation: false,
  signInFlow: "Password",
  userAttributes: {
    locale: "en",
  },
});

console.log(`✓ Created user: ${TEST_USERS.user2.email}`);

// await addToUserGroup(user1, "admin");
// await addToUserGroup(user2, "admin");