import { test, expect, Page } from '@playwright/test';
import {
  clickButton,
  clickConfirmModalCancel,
  clickConfirmModalConfirm,
  clickManagementTab,
  cleanupTestData,
  fillInput,
  navigateToApp,
  navigateToManagement,
  waitForPageLoad,
  UI_TIMING,
} from './helpers';
import { TEST_CONFIG } from '../test-config';

/**
 * Polls whether `teamName` appears in the Schedule Game team dropdown,
 * performing a fresh page load + form re-open on every attempt (not just a
 * re-read of the existing DOM). Required because `archiveTeam`/`restoreTeam`
 * write via the DynamoDB SDK directly and never trigger an AppSync
 * subscription (Step 1/Step 9), so a stale first read has no recovery path
 * other than a genuinely fresh query.
 *
 * Uses `expect(...).toPass()` rather than `expect.poll()`: the poll body
 * below performs `.click()` calls that can themselves throw (e.g. if an
 * element detaches mid-navigation), and `expect.poll()` only retries on a
 * returned wrong value, not on a thrown exception — `toPass()` retries the
 * whole body on either a thrown exception or a failed inner `expect()`.
 */
async function pollScheduleDropdownForTeam(page: Page, teamName: string, expected: boolean) {
  await expect(async () => {
    await page.goto('/');
    await waitForPageLoad(page);

    const scheduleButton = page.getByRole('button', { name: /\+\s*Schedule New Game/i }).first();
    await scheduleButton.click();
    const teamSelect = page.locator('.create-form select').first();
    let formVisible = await teamSelect.isVisible({ timeout: 2500 }).catch(() => false);
    if (!formVisible) {
      // Guard pattern borrowed from e2e/team-sharing.spec.ts: the schedule
      // form occasionally doesn't open on the first click.
      console.warn('Schedule form did not open on first try; retrying once');
      await scheduleButton.click();
      formVisible = await teamSelect.isVisible({ timeout: 2500 }).catch(() => false);
    }
    expect(formVisible).toBe(true);

    const options = await teamSelect.locator('option').allTextContents();
    const present = options.some((o) => o.includes(teamName));
    expect(present).toBe(expected);
  }).toPass({ timeout: 30000 });
}

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

  test('archives and restores a team, verifying it is excluded from and re-included in the Schedule Game dropdown', async ({ page }) => {
    const teamName = `Restore Smoke Team ${Date.now()}`;

    // No leading cleanupTestData() call (Minor 11): the preceding test in this
    // same serial block already cleans up, and this team's name is
    // timestamp-unique, so a redundant sweep here only costs smoke-lane budget.
    await navigateToApp(page);
    await navigateToManagement(page);

    await clickManagementTab(page, 'Teams');
    await clickButton(page, '+ Create New Team');
    await fillInput(page, 'input[placeholder*="team name"]', teamName);
    await fillInput(page, 'input[placeholder*="max players"]', '7');
    await fillInput(page, 'input[placeholder*="half length"]', '25');
    await clickButton(page, 'Create');
    await expect(page.locator('.item-card').filter({ hasText: teamName })).toBeVisible();

    // Owner is stamped implicitly at create time (Correction 1): Archive is
    // visible, no "Owner Unassigned" pill.
    const activeCard = page.locator('.team-card-wrapper').filter({ hasText: teamName });
    await expect(activeCard.getByRole('button', { name: 'Archive' })).toBeVisible();
    await expect(activeCard.getByText('Owner Unassigned')).not.toBeVisible();

    // Sanity: present in the Schedule Game dropdown while active. Team.create
    // is a normal AppSync mutation and *does* trigger a subscription push, so
    // this check does not need the reload-poll treatment (unlike the two
    // checks below, which read state written by the Lambda-backed lifecycle
    // mutations) — a plain non-polling assertion is used here to keep the
    // smoke lane's added runtime to only the two checks that actually matter.
    await navigateToApp(page);
    await clickButton(page, '+ Schedule New Game');
    const sanityTeamSelect = page.locator('.create-form select').first();
    await expect(sanityTeamSelect).toBeVisible({ timeout: 5000 });
    await expect(async () => {
      const options = await sanityTeamSelect.locator('option').allTextContents();
      expect(options.some((o) => o.includes(teamName))).toBe(true);
    }).toPass({ timeout: 10000 });

    // Archive, then confirm exclusion from the dropdown.
    await navigateToManagement(page);
    await clickManagementTab(page, 'Teams');
    await page.locator('.team-card-wrapper').filter({ hasText: teamName }).getByRole('button', { name: 'Archive' }).click();
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await expect(page.locator('.item-card:not(.archived)').filter({ hasText: teamName })).not.toBeVisible();

    await pollScheduleDropdownForTeam(page, teamName, false);

    // Restore, then confirm reappearance in Active Teams and the dropdown.
    await navigateToManagement(page);
    await clickManagementTab(page, 'Teams');
    await page.getByRole('button', { name: /Archived Teams/ }).click();
    const archivedCardForRestore = page.locator('.team-card-wrapper').filter({ hasText: teamName });
    await expect(archivedCardForRestore.getByRole('button', { name: 'Restore Team' })).toBeVisible();
    await archivedCardForRestore.getByRole('button', { name: 'Restore Team' }).click();
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await page.getByRole('button', { name: /Active Teams/ }).click();
    await expect(page.locator('.item-card:not(.archived)').filter({ hasText: teamName })).toBeVisible();

    await pollScheduleDropdownForTeam(page, teamName, true);

    // Cleanup: archive + delete permanently (matches the existing test's pattern).
    await navigateToManagement(page);
    await clickManagementTab(page, 'Teams');
    await page.locator('.team-card-wrapper').filter({ hasText: teamName }).getByRole('button', { name: 'Archive' }).click();
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await page.getByRole('button', { name: /Archived Teams/ }).click();
    await page.locator('.team-card-wrapper').filter({ hasText: teamName }).getByRole('button', { name: 'Delete team permanently' }).click();
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    await expect(page.locator('.item-card').filter({ hasText: teamName })).not.toBeVisible();
  });
});
