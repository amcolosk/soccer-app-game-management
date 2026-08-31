import path from 'path';
import { test, expect } from '@playwright/test';
import {
  clickButton,
  cleanupTestData,
  createTeam,
  navigateToApp,
  waitForPageLoad,
  UI_TIMING,
} from './helpers';

/**
 * E2E smoke test for Calendar Feed Import Phase 2 (file-upload path — see
 * docs/plans/CALENDAR-FEED-GAME-IMPORT-PLAN.md, Test plan: "upload a
 * fixture .ics, assert the games appear on the home schedule"). Uses the
 * same reconstructed fixture the unit tests use — no network fetch, no
 * SSRF surface, and no dependency on the (deliberately never-committed)
 * live PlayMetrics feed URL.
 */
const FIXTURE_PATH = path.resolve(
  __dirname,
  '..',
  'amplify',
  'functions',
  'shared',
  'ical',
  '__fixtures__',
  'playmetrics-sample.ics',
);

test.describe('Calendar Feed Import Smoke', () => {
  test('uploading a fixture .ics imports games onto the Home schedule', async ({ page }) => {
    test.setTimeout(120_000);

    const teamName = `Calendar Import Smoke ${Date.now()}`;

    await navigateToApp(page);
    await cleanupTestData(page);
    await createTeam(page, { name: teamName, maxPlayers: '7', halfLength: '25' });

    await navigateToApp(page);
    await waitForPageLoad(page);

    await clickButton(page, '📅 Import from calendar');

    const teamSelect = page.getByLabel('Team to import games for');
    await expect(teamSelect).toBeVisible({ timeout: 5000 });
    await teamSelect.selectOption({ label: teamName });

    const fileInput = page.getByLabel('Calendar .ics file');
    await fileInput.setInputFiles(FIXTURE_PATH);

    // Preview modal: the fixture has 7 events, all new — never a no-op.
    const previewModal = page.locator('.calendar-import-preview-modal');
    await expect(previewModal).toBeVisible({ timeout: 15000 });
    await expect(previewModal.getByText(/will create 7 game/i)).toBeVisible();

    await previewModal.getByRole('button', { name: /^confirm$/i }).click();
    await expect(previewModal).not.toBeVisible({ timeout: 15000 });

    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

    // Spot-check a plain event and the feed-cancelled one, both under the
    // team we just imported into.
    await expect(page.getByText(`${teamName} vs BSC - MID-IOWA U13 BOYS`)).toBeVisible();
    const cancelledCard = page.locator('.game-card').filter({ hasText: 'Waukee Warriors' });
    await expect(cancelledCard).toBeVisible();
    await expect(cancelledCard.getByText(/cancelled by organizer/i)).toBeVisible();
  });
});
