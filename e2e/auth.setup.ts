import { mkdirSync } from 'fs';
import { test as setup } from '@playwright/test';
import { loginUser } from './helpers';
import { TEST_USERS } from '../test-config';

setup('authenticate as user1', async ({ page }) => {
  mkdirSync('.auth', { recursive: true });
  await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
  await page.context().storageState({ path: '.auth/user1.json' });
});

setup('authenticate as user2', async ({ page }) => {
  mkdirSync('.auth', { recursive: true });
  await loginUser(page, TEST_USERS.user2.email, TEST_USERS.user2.password);
  await page.context().storageState({ path: '.auth/user2.json' });
});
