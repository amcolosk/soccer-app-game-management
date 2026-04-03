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

test.describe('Formation Management Smoke', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async () => {
    test.setTimeout(TEST_CONFIG.timeout.long);
  });

  test('creates a formation and verifies delete cancel/confirm', async ({ page }) => {
    const formationName = `Smoke 3-2-1 ${Date.now()}`;

    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await cleanupTestData(page);

    await clickManagementTab(page, 'Formations');
    await clickButton(page, '+ Create Formation');

    await fillInput(page, 'input[placeholder*="Formation Name"]', formationName);
    await fillInput(page, 'input[placeholder*="Number of Players"]', '3');

    const rows = page.locator('.position-row');
    await rows.nth(0).locator('input[placeholder*="Position Name"]').fill('Goalkeeper');
    await rows.nth(0).locator('input[placeholder*="Abbr"]').fill('GK');
    await rows.nth(1).locator('input[placeholder*="Position Name"]').fill('Defender');
    await rows.nth(1).locator('input[placeholder*="Abbr"]').fill('DEF');
    await rows.nth(2).locator('input[placeholder*="Position Name"]').fill('Forward');
    await rows.nth(2).locator('input[placeholder*="Abbr"]').fill('FWD');

    await clickButton(page, 'Create');
    await expect(page.locator('.item-card').filter({ hasText: formationName })).toBeVisible();

    await swipeToDelete(page, '.item-card');
    await clickConfirmModalCancel(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await expect(page.locator('.item-card').filter({ hasText: formationName })).toBeVisible();

    await swipeToDelete(page, '.item-card');
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    await expect(page.locator('.item-card').filter({ hasText: formationName })).not.toBeVisible();
  });
});
