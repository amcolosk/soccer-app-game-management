import { test, expect } from '@playwright/test';
import {
  clickButton,
  clickConfirmModalCancel,
  clickConfirmModalConfirm,
  clickManagementTab,
  cleanupTestData,
  fillInput,
  loginUser,
  navigateToManagement,
  swipeToDelete,
  UI_TIMING,
} from './helpers';
import { TEST_USERS, TEST_CONFIG } from '../test-config';

test.describe('Team Management Smoke', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async () => {
    test.setTimeout(TEST_CONFIG.timeout.long);
  });

  test('creates a team and verifies delete cancel/confirm', async ({ page }) => {
    const teamName = `Smoke Team ${Date.now()}`;

    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await cleanupTestData(page);

    await clickManagementTab(page, 'Teams');
    await clickButton(page, '+ Create New Team');

    await fillInput(page, 'input[placeholder*="team name"]', teamName);
    await fillInput(page, 'input[placeholder*="max players"]', '7');
    await fillInput(page, 'input[placeholder*="half length"]', '25');

    await clickButton(page, 'Create');
    await expect(page.locator('.item-card').filter({ hasText: teamName })).toBeVisible();

    await swipeToDelete(page, `.item-card:has-text("${teamName}")`);
    await clickConfirmModalCancel(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await expect(page.locator('.item-card').filter({ hasText: teamName })).toBeVisible();

    await swipeToDelete(page, `.item-card:has-text("${teamName}")`);
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    await expect(page.locator('.item-card').filter({ hasText: teamName })).not.toBeVisible();
  });
});
