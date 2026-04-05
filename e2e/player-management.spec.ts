import { test, expect } from '@playwright/test';
import {
  clickButton,
  clickConfirmModalCancel,
  clickConfirmModalConfirm,
  clickManagementTab,
  cleanupTestData,
  createTeam,
  fillInput,
  navigateToApp,
  navigateToManagement,
  swipeToDelete,
  UI_TIMING,
} from './helpers';
import { TEST_CONFIG } from '../test-config';

test.describe('Player Management Smoke', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async () => {
    test.setTimeout(TEST_CONFIG.timeout.long);
  });

  test('creates a player and verifies delete cancel/confirm', async ({ page }) => {
    const firstName = 'Smoke';
    const lastName = `Player${Date.now()}`;

    await navigateToApp(page);
    await navigateToManagement(page);
    await cleanupTestData(page);

    await createTeam(page, {
      name: `Roster Team ${Date.now()}`,
      maxPlayers: '7',
      halfLength: '25',
    });

    await clickManagementTab(page, 'Players');
    await clickButton(page, '+ Add Player');

    await fillInput(page, 'input[placeholder*="First Name"]', firstName);
    await fillInput(page, 'input[placeholder*="Last Name"]', lastName);
    await clickButton(page, 'Add');

    const fullName = `${firstName} ${lastName}`;
    await expect(page.locator('.item-card').filter({ hasText: fullName })).toBeVisible();

    await swipeToDelete(page, `.item-card:has-text("${fullName}")`);
    await clickConfirmModalCancel(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await expect(page.locator('.item-card').filter({ hasText: fullName })).toBeVisible();

    await swipeToDelete(page, `.item-card:has-text("${fullName}")`);
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    await expect(page.locator('.item-card').filter({ hasText: fullName })).not.toBeVisible();
  });
});
