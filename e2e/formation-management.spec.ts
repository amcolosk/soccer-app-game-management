import { test, expect } from '@playwright/test';
import {
  clickButton,
  clickConfirmModalCancel,
  clickConfirmModalConfirm,
  clickManagementTab,
  cleanupTestData,
  fillInput,
  navigateToApp,
  navigateToManagement,
  swipeToDelete,
  UI_TIMING,
} from './helpers';
import { TEST_CONFIG } from '../test-config';

test.describe('Formation Management Smoke', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async () => {
    test.setTimeout(TEST_CONFIG.timeout.long);
  });

  test('creates a formation and verifies delete cancel/confirm', async ({ page }) => {
    const formationName = `Smoke 3-2-1 ${Date.now()}`;

    await navigateToApp(page);
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
    // Wait for the create form to fully close (RESET dispatch fires after async DynamoDB writes)
    await expect(page.getByRole('button', { name: '+ Create Formation' })).toBeVisible({ timeout: 5000 });

    await swipeToDelete(page, `.item-card:has-text("${formationName}")`);
    await clickConfirmModalCancel(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await expect(page.locator('.item-card').filter({ hasText: formationName })).toBeVisible();

    await swipeToDelete(page, `.item-card:has-text("${formationName}")`);
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    await expect(page.locator('.item-card').filter({ hasText: formationName })).not.toBeVisible();
  });
});
