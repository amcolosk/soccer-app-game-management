import { test, expect } from '@playwright/test';
import {
  clickButton,
  clickConfirmModalCancel,
  clickConfirmModalConfirm,
  clickManagementTab,
  createFormation,
  createTeam,
  fillInput,
  navigateToApp,
  navigateToManagement,
  addPlayerToRoster,
  swipeToDelete,
  UI_TIMING,
} from './helpers';
import { TEST_CONFIG } from '../test-config';

/**
 * Safe-delete smoke specs intentionally keep only browser wiring checks.
 * Deeper semantics and payload assertions belong in contract/static test layers.
 */

function runSuffix(workerIndex: number) {
  return `${Date.now()}-${workerIndex}`;
}

const BASE_POSITIONS = [
  { name: 'Goalkeeper', abbreviation: 'GK' },
  { name: 'Left Defender', abbreviation: 'LD' },
  { name: 'Center Defender', abbreviation: 'CD' },
  { name: 'Right Defender', abbreviation: 'RD' },
  { name: 'Left Midfielder', abbreviation: 'LM' },
  { name: 'Center Midfielder', abbreviation: 'CM' },
  { name: 'Forward', abbreviation: 'FW' },
];

test.describe('Safe Delete Guards', () => {
  test.beforeEach(async () => {
    test.setTimeout(TEST_CONFIG.timeout.long);
    
  });

  test('formation in-use guard is surfaced in browser wiring', async ({ page }, testInfo) => {
    const suffix = runSuffix(testInfo.workerIndex);
    const formationName = `Safe Delete Formation ${suffix}`;
    const teamName = `Safe Delete Team ${suffix}`;

    await navigateToApp(page);
    await navigateToManagement(page);

    await createFormation(page, {
      name: formationName,
      playerCount: '7',
      positions: BASE_POSITIONS,
    });

    await createTeam(
      page,
      {
        name: teamName,
        maxPlayers: '7',
        halfLength: '25',
      },
      `${formationName} (7 players)`,
    );

    await clickManagementTab(page, 'Formations');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    await swipeToDelete(page, `.item-card:has-text("${formationName}")`);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

    const toast = page.locator('[role="status"]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText(teamName);
    await expect(page.locator('.item-card').filter({ hasText: formationName })).toBeVisible();

    // Deterministic cleanup: remove team first, then formation.
    await clickManagementTab(page, 'Teams');
    await swipeToDelete(page, `.item-card:has-text("${teamName}")`);
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

    await clickManagementTab(page, 'Formations');
    await swipeToDelete(page, `.item-card:has-text("${formationName}")`);
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

    await expect(page.locator('.item-card').filter({ hasText: formationName })).toHaveCount(0);
  });

  test('player delete confirm/cancel wiring is surfaced for roster-linked player', async ({ page }, testInfo) => {
    const suffix = runSuffix(testInfo.workerIndex);
    const teamName = `Safe Delete Team ${suffix}`;
    const playerFirstName = `Roster${suffix}`;
    const playerLastName = 'Smoke';

    await navigateToApp(page);
    await navigateToManagement(page);

    await createTeam(page, {
      name: teamName,
      maxPlayers: '7',
      halfLength: '25',
    });

    await clickManagementTab(page, 'Players');
    await clickButton(page, '+ Add Player');
    await fillInput(page, 'input[placeholder*="First Name"]', playerFirstName);
    await fillInput(page, 'input[placeholder*="Last Name"]', playerLastName);
    await clickButton(page, 'Add');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

    const playerFullName = `${playerFirstName} ${playerLastName}`;
    await clickManagementTab(page, 'Teams');
    await addPlayerToRoster(page, teamName, playerFullName, '9');

    await clickManagementTab(page, 'Players');
    await swipeToDelete(page, `.item-card:has-text("${playerFirstName}")`);
    await expect(page.locator('.confirm-overlay')).toBeVisible({ timeout: 5000 });

    // Cancel wiring keeps the record.
    await clickConfirmModalCancel(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await expect(page.locator('.item-card').filter({ hasText: playerFirstName })).toBeVisible();

    // Confirm wiring deletes the record.
    await swipeToDelete(page, `.item-card:has-text("${playerFirstName}")`);
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await expect(page.locator('.item-card').filter({ hasText: playerFirstName })).toHaveCount(0);

    // Deterministic cleanup.
    await clickManagementTab(page, 'Teams');
    await swipeToDelete(page, `.item-card:has-text("${teamName}")`);
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await expect(page.locator('.item-card').filter({ hasText: teamName })).toHaveCount(0);
  });
});
