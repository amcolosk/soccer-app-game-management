import { test, expect, Page } from '@playwright/test';
import {
  clickConfirmModalConfirm,
  clickManagementTab,
  createTeam,
  loginUser,
  navigateToManagement,
  swipeToDelete,
  UI_TIMING,
  waitForPageLoad,
} from './helpers';
import { TEST_USERS, TEST_CONFIG } from '../test-config';

function runSuffix(workerIndex: number) {
  return `${Date.now()}-${workerIndex}`;
}

async function logout(page: Page) {
  const profileTab = page.getByRole('link', { name: /profile/i });
  if (await profileTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await profileTab.click();
    await page.waitForTimeout(UI_TIMING.NAVIGATION);
  }

  const signOutButton = page.getByRole('button', { name: /sign out/i });
  if (await signOutButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await signOutButton.click();
    await waitForPageLoad(page);
  }
}

test.describe.serial('Data isolation smoke wiring', () => {
  test('switching users wires visibility to owner-scoped data', async ({ page }, testInfo) => {
    test.setTimeout(TEST_CONFIG.timeout.long);
    const teamName = `Isolation Smoke Team ${runSuffix(testInfo.workerIndex)}`;

    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await createTeam(page, {
      name: teamName,
      maxPlayers: '7',
      halfLength: '25',
    });

    await logout(page);

    await loginUser(page, TEST_USERS.user2.email, TEST_USERS.user2.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Teams');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

    await expect(page.locator('.item-card').filter({ hasText: teamName })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '+ Create New Team' })).toBeVisible();

    // Deterministic cleanup under the creating owner.
    await logout(page);
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Teams');
    await swipeToDelete(page, `.item-card:has-text("${teamName}")`);
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await expect(page.locator('.item-card').filter({ hasText: teamName })).toHaveCount(0);
  });
});
