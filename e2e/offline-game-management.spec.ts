import { test, expect, Page } from '@playwright/test';
import {
  loginUser,
  cleanupTestData,
  createFormation,
  createTeam,
  handleConfirmDialog,
  clickButton,
  waitForPageLoad,
  UI_TIMING,
} from './helpers';
import { TEST_USERS, TEST_CONFIG } from '../test-config';
import {
  TEST_DATA,
  createPlayers,
  addPlayersToRoster,
  createGame,
  setupLineup,
  createGamePlan,
  executeRotation,
  advanceGameClockTo,
  pauseGameClock,
  parseDurationMinutes,
} from './game-workflow-helpers';

/**
 * Field-conditions regression coverage for Issue A (orphaned PlayTimeRecord
 * over-crediting) from docs/plans/PITCH-RELIABILITY-HARDENING-PLAN.md (F3).
 *
 * Drives real offline/reconnect cycles via context.setOffline() against the
 * real UI + real IndexedDB offline mutation queue + real drain on reconnect,
 * not mocked pieces. Part of the `field-conditions` Playwright project
 * (WebKit + mobile viewport, pre-release only — see playwright.config.ts).
 */

async function setupTeamAndRoster(page: Page) {
  await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);

  try {
    page.setDefaultTimeout(120000);
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (typeof (window as any).__cleanupAllData === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (window as any).__cleanupAllData();
      }
    });
  } catch {
    // Best-effort orphaned-data cleanup, mirrors full-workflow.spec.ts.
  } finally {
    page.setDefaultTimeout(30000);
  }
  await page.waitForTimeout(1000);

  await cleanupTestData(page);

  await createFormation(page, TEST_DATA.formation);
  const formationLabel = `${TEST_DATA.formation.name} (${TEST_DATA.formation.playerCount} players)`;
  await createTeam(page, TEST_DATA.team, formationLabel);
  await createPlayers(page);
  await addPlayersToRoster(page);
}

async function startGameAndPause(page: Page) {
  const startButtons = page.getByRole('button', { name: 'Start Game' });
  await expect(startButtons.last()).toBeVisible({ timeout: 5000 });
  await startButtons.last().click({ force: true });
  await page.waitForTimeout(UI_TIMING.NAVIGATION);

  const availabilityHeading = page.getByRole('heading', { name: 'Player Availability Check' });
  if (await availabilityHeading.isVisible({ timeout: 3000 }).catch(() => false)) {
    const modalStartButtons = page.getByRole('button', { name: 'Start Game' });
    const buttonCount = await modalStartButtons.count();
    for (let i = buttonCount - 1; i >= 0; i -= 1) {
      const candidate = modalStartButtons.nth(i);
      if (await candidate.isVisible({ timeout: 800 }).catch(() => false)) {
        await candidate.click({ force: true });
        await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
        break;
      }
    }
  }

  await expect(page.locator('.command-band__timer')).toBeVisible({ timeout: 5000 });
  await pauseGameClock(page);
}

test.describe('Offline game management (Issue A regression)', () => {
  test('offline substitution + offline halftime close PlayTimeRecords correctly on reconnect', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.long);

    await setupTeamAndRoster(page);

    const opponent = 'Offline Sub FC';
    await createGame(page, { opponent, date: '2025-11-30T14:00', isHome: true });
    await setupLineup(page, opponent);
    await createGamePlan(page, opponent);

    const cleanupConfirm = handleConfirmDialog(page, false);

    await startGameAndPause(page);
    await advanceGameClockTo(page, 10);

    // Go offline before the substitution: this is exactly the scenario Issue A's
    // fix targets — the new PlayTimeRecord created by the sub is queued locally
    // (IndexedDB), not yet in DynamoDB or synced React state, when the halftime
    // boundary is crossed below while still offline.
    await page.context().setOffline(true);
    await expect(page.locator('.offline-banner')).toContainText(/you.?re offline/i, { timeout: 10000 });

    const subExecuted = await executeRotation(page, 10, 'Diana', 'Hannah');
    expect(subExecuted, 'Offline substitution (Diana -> Hannah) must succeed while offline').toBe(true);

    await advanceGameClockTo(page, 20);

    const endFirstHalfButton = page.getByRole('button', { name: 'End First Half' });
    const startSecondHalfButton = page.getByRole('button', { name: 'Start Second Half' });
    if (await endFirstHalfButton.isVisible({ timeout: 1500 }).catch(() => false)) {
      await endFirstHalfButton.click({ force: true });
    }

    // Must not hard-block while offline — this is exactly the Critical bug a
    // throw-based design would introduce (see Issue A "Root cause" in the plan).
    await expect(startSecondHalfButton).toBeVisible({ timeout: 15000 });

    // Reconnect and let the offline mutation queue drain before continuing.
    await page.context().setOffline(false);
    await expect(page.locator('.offline-banner')).not.toBeVisible({ timeout: 30000 });

    await startSecondHalfButton.click({ force: true });
    await expect(startSecondHalfButton).not.toBeVisible({ timeout: 10000 });
    await pauseGameClock(page);

    await advanceGameClockTo(page, 40);
    await clickButton(page, 'End Game');
    await expect(page.locator('.command-band__status-final')).toBeVisible({ timeout: 15000 });

    cleanupConfirm();

    // Verify via the Reports page that the offline-created PlayTimeRecords landed
    // correctly: Diana's pre-sub segment closes at the 10' sub (not overrun past
    // it), and Hannah's post-sub segment closes at 40' (not orphaned open past
    // the halftime boundary it crossed while offline).
    await page.waitForTimeout(3000);
    await page.locator('a.nav-item[aria-label="Reports"]').click();
    await waitForPageLoad(page);

    const teamSelect = page.locator('#team-select');
    if (await teamSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
      const hasTargetTeamOption = await teamSelect.locator('option', { hasText: TEST_DATA.team.name }).count();
      if (hasTargetTeamOption > 0) {
        await teamSelect.selectOption({ label: TEST_DATA.team.name });
        await waitForPageLoad(page);
      }
    }

    const statsTable = page.getByRole('table', { name: 'Player season statistics' });
    await expect(statsTable).toBeVisible({ timeout: 30000 });

    const expectedMinutes: Array<[string, number]> = [
      ['Diana Davis', 10],
      ['Hannah Harris', 30],
      ['Alice Anderson', 40],
    ];

    for (const [playerName, expected] of expectedMinutes) {
      const playerRow = page.locator('tr').filter({ hasText: playerName });
      await expect(playerRow).toBeVisible({ timeout: 10000 });
      const timeCell = playerRow.locator('td').nth(2);

      await expect
        .poll(
          async () => {
            const value = ((await timeCell.textContent()) ?? '').trim();
            return parseDurationMinutes(value);
          },
          { timeout: 30000, message: `${playerName} play time did not settle near ${expected} minutes` },
        )
        .not.toBeNull();

      const finalValue = ((await timeCell.textContent()) ?? '').trim();
      const finalMinutes = parseDurationMinutes(finalValue) ?? -1;
      // Allow +/-1 minute for rounding/tick timing, matching full-workflow.spec.ts's tolerance.
      expect(
        finalMinutes,
        `${playerName}: expected ~${expected}m, got '${finalValue}'`,
      ).toBeGreaterThanOrEqual(expected);
      expect(
        finalMinutes,
        `${playerName}: expected ~${expected}m, got '${finalValue}'`,
      ).toBeLessThanOrEqual(expected + 1);
    }
  });

  test('offline at second-half start does not hard-block the coach', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.medium * 3);

    await setupTeamAndRoster(page);

    const opponent = 'Offline Halftime FC';
    await createGame(page, { opponent, date: '2025-11-30T14:00', isHome: true });
    await setupLineup(page, opponent);
    await createGamePlan(page, opponent);

    const cleanupConfirm = handleConfirmDialog(page, false);

    await startGameAndPause(page);
    await advanceGameClockTo(page, 20);

    const endFirstHalfButton = page.getByRole('button', { name: 'End First Half' });
    const startSecondHalfButton = page.getByRole('button', { name: 'Start Second Half' });
    if (await endFirstHalfButton.isVisible({ timeout: 1500 }).catch(() => false)) {
      await endFirstHalfButton.click({ force: true });
    }
    await expect(startSecondHalfButton).toBeVisible({ timeout: 15000 });

    // Go offline only at the second-half-start boundary — regression coverage for
    // the specific bug Opus's plan review caught: a throw-based
    // closeAllOpenPlayTimeRecords design would make handleStartSecondHalf block
    // or return early here, stranding a coach unable to start the second half
    // while offline. The shipped deterministic-id + local-tracking-map design
    // must not block.
    await page.context().setOffline(true);
    await expect(page.locator('.offline-banner')).toContainText(/you.?re offline/i, { timeout: 10000 });

    await startSecondHalfButton.click({ force: true });
    await expect(startSecondHalfButton).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('tab', { name: 'Field' })).toBeVisible({ timeout: 10000 });

    await page.context().setOffline(false);
    await expect(page.locator('.offline-banner')).not.toBeVisible({ timeout: 30000 });

    await pauseGameClock(page);
    await advanceGameClockTo(page, 40);
    await clickButton(page, 'End Game');
    await expect(page.locator('.command-band__status-final')).toBeVisible({ timeout: 15000 });

    cleanupConfirm();
  });
});
