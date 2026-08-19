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
  UI_TIMING,
} from './helpers';
import { TEST_CONFIG } from '../test-config';

test.describe('Team Management Smoke', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async () => {
    test.setTimeout(TEST_CONFIG.timeout.long);
  });

  test('creates a team and verifies archive + delete permanently cancel/confirm', async ({ page }) => {
    const teamName = `Smoke Team ${Date.now()}`;

    await navigateToApp(page);
    await navigateToManagement(page);
    await cleanupTestData(page);

    await clickManagementTab(page, 'Teams');
    await clickButton(page, '+ Create New Team');

    await fillInput(page, 'input[placeholder*="team name"]', teamName);
    await fillInput(page, 'input[placeholder*="max players"]', '7');
    await fillInput(page, 'input[placeholder*="half length"]', '25');

    await clickButton(page, 'Create');
    await expect(page.locator('.item-card').filter({ hasText: teamName })).toBeVisible();

    // Archive: cancel, then confirm.
    await page.locator('.team-card-wrapper').filter({ hasText: teamName }).getByRole('button', { name: 'Archive' }).click();
    await clickConfirmModalCancel(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await expect(page.locator('.item-card:not(.archived)').filter({ hasText: teamName })).toBeVisible();

    await page.locator('.team-card-wrapper').filter({ hasText: teamName }).getByRole('button', { name: 'Archive' }).click();
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await expect(page.locator('.item-card:not(.archived)').filter({ hasText: teamName })).not.toBeVisible();

    // Switch to Archived Teams; verify the card moved there; then permanent-delete: cancel, then confirm.
    await page.getByRole('button', { name: /Archived Teams/ }).click();
    await expect(page.locator('.item-card.archived').filter({ hasText: teamName })).toBeVisible();

    const archivedCard = page.locator('.team-card-wrapper').filter({ hasText: teamName });
    await archivedCard.getByRole('button', { name: 'Delete team permanently' }).click();
    await clickConfirmModalCancel(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await expect(page.locator('.item-card.archived').filter({ hasText: teamName })).toBeVisible();

    await archivedCard.getByRole('button', { name: 'Delete team permanently' }).click();
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    await expect(page.locator('.item-card').filter({ hasText: teamName })).not.toBeVisible();
  });
});
