import { test, expect, Page } from '@playwright/test';
import {
  loginUser,
  cleanupTestData,
  createFormation,
  createTeam,
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
  getDisplayedGameSeconds,
} from './game-workflow-helpers';

/**
 * Field-conditions regression coverage for Issue B (timer gap confirmation)
 * from docs/plans/PITCH-RELIABILITY-HARDENING-PLAN.md (F6).
 *
 * Uses Playwright's Clock API (page.clock) to simulate a coach backgrounding
 * the app for ~15 real-world minutes while the game timer keeps running
 * server-side. `lastStartTime` is persisted to DynamoDB the instant the game
 * is started (see GameManagement.tsx's handleStartGame) — there is no
 * periodic re-sync to wait for, so the clock can be installed and
 * fast-forwarded immediately after the game reaches in-progress.
 * `clock.fastForward()` is documented as "equivalent to user closing the
 * laptop lid for a while and reopening it later" — the exact scenario
 * Issue B's gap-confirmation feature exists for. The clock is installed at
 * the BrowserContext level, so it persists across the page.reload() below,
 * which is what forces a fresh Game.observeQuery subscription snapshot with
 * isRunning starting false — the precondition computeGapConfirmationDecision
 * needs to evaluate the gap at all (see useGameSubscriptions.ts).
 *
 * Drives the real render tree (subscription + timer + modal stack), not a
 * mocked hook — see docs/specs/Game-Management-Spec.md §3.6 for the
 * behavior spec this pins, and docs/specs/UI-SPEC.md's "Timer Gap
 * Confirmation" section for the dialog copy/behavior asserted below.
 *
 * Part of the `field-conditions` Playwright project (WebKit + mobile
 * viewport, pre-release only — see playwright.config.ts).
 */

// Comfortably above ANOMALOUS_GAP_THRESHOLD_SECONDS (10 min) and comfortably
// below the team's 20-minute halfLengthMinutes (TEST_DATA.team.halfLength)
// and the 2-hour MAX_GAME_SECONDS cap, so this reliably proposes a
// confirmation rather than silently auto-applying (see
// computeGapConfirmationDecision's willAutoHalftime / willAutoEnd checks).
const BACKGROUND_GAP_SECONDS = 15 * 60;

async function setupAndStartGame(page: Page, opponent: string): Promise<void> {
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

  await createGame(page, { opponent, date: '2025-11-30T14:00', isHome: true });
  await setupLineup(page, opponent);
  await createGamePlan(page, opponent);

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

  // Do NOT pause: pausing clears lastStartTime to null in the DB (see
  // GameManagement.tsx's handleTimerPause), which would defeat this
  // feature's entire trigger condition — an in-progress game with a set
  // lastStartTime that the wall clock has since diverged from.
  await expect(page.locator('.command-band__timer')).toBeVisible({ timeout: 5000 });
}

async function backgroundAppFor(page: Page, seconds: number): Promise<void> {
  await page.clock.install({ time: Date.now() });
  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = seconds % 60;
  await page.clock.fastForward(`${minutes}:${String(remainderSeconds).padStart(2, '0')}`);
  await page.reload();
  await waitForPageLoad(page);
}

test.describe('Timer gap confirmation (Issue B regression)', () => {
  test('backgrounding for 15 minutes proposes a gap confirmation, and accepting resumes at the jumped time', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.medium * 3);

    await setupAndStartGame(page, 'Gap Confirm Accept FC');
    await backgroundAppFor(page, BACKGROUND_GAP_SECONDS);

    const gapDialog = page.getByRole('alertdialog', { name: /was play stopped/i });
    await expect(gapDialog).toBeVisible({ timeout: 15000 });

    const acceptButton = gapDialog.getByRole('button', { name: "Yes, that's right" });
    await expect(acceptButton).toBeVisible();
    await acceptButton.click();
    await expect(gapDialog).not.toBeVisible({ timeout: 10000 });

    // Timer should now be running again, having jumped forward by roughly the
    // backgrounded gap (allow slack for real setup time elapsed before the jump).
    await expect
      .poll(
        async () => getDisplayedGameSeconds(page),
        { timeout: 10000, message: 'Expected the timer to have jumped forward after accepting the gap correction' },
      )
      .toBeGreaterThanOrEqual(BACKGROUND_GAP_SECONDS - 30);

    const pauseButton = page.locator('.command-band__btn-pause[title="Pause timer"]');
    await expect(pauseButton).toBeVisible({ timeout: 10000 });
  });

  test('declining the gap confirmation leaves the timer paused at the pre-gap time', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.medium * 3);

    await setupAndStartGame(page, 'Gap Confirm Decline FC');
    const preGapSeconds = await getDisplayedGameSeconds(page);

    await backgroundAppFor(page, BACKGROUND_GAP_SECONDS);

    const gapDialog = page.getByRole('alertdialog', { name: /was play stopped/i });
    await expect(gapDialog).toBeVisible({ timeout: 15000 });

    const declineButton = gapDialog.getByRole('button', { name: 'No, let me adjust' });
    await expect(declineButton).toBeVisible();
    await declineButton.click();
    await expect(gapDialog).not.toBeVisible({ timeout: 10000 });

    // Timer must NOT have silently jumped forward — it stays at (approximately,
    // allowing a couple seconds of real-time drift while the dialog was open)
    // the pre-gap value, and a manual Resume affordance should be available
    // (see resolveGapCorrection's reject branch in useGameSubscriptions.ts).
    const postDeclineSeconds = await getDisplayedGameSeconds(page);
    expect(
      postDeclineSeconds,
      `Expected timer to stay near ${preGapSeconds}s after declining, got ${postDeclineSeconds}s`,
    ).toBeLessThan(preGapSeconds + 10);
    expect(postDeclineSeconds).toBeGreaterThanOrEqual(preGapSeconds);

    const resumeButton = page.locator('.command-band__btn-pause[title="Resume timer"]');
    await expect(resumeButton).toBeVisible({ timeout: 10000 });
  });
});
