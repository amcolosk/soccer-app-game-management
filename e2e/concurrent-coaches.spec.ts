import { test, expect, Page, BrowserContext, devices } from '@playwright/test';
import {
  loginUser,
  cleanupTestData,
  createFormation,
  createTeam,
  navigateToManagement,
  clickManagementTab,
  handleConfirmDialog,
  clickButton,
  clickButtonByText,
  fillInput,
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
} from './game-workflow-helpers';

/**
 * Field-conditions regression coverage for Issue C (game-state race guard
 * consolidation) from docs/plans/PITCH-RELIABILITY-HARDENING-PLAN.md (F5).
 *
 * Two REAL, concurrently-running browser contexts (not a single page
 * switching identities, unlike team-sharing.spec.ts's sequential login
 * swaps) drive genuinely concurrent actions against the same shared game:
 * one coach substitutes a player while the other records a goal, at the
 * same time via Promise.all(). `workers: 1` / `fullyParallel: false` in
 * playwright.config.ts only serialize test *files* — both contexts below
 * still run concurrently within this one test, which is what the
 * regression needs. This exercises the same class of race the
 * useGameSubscriptions.ts guard refs (see docs/ARCHITECTURE.md §4a) are
 * consolidated to protect against: two Game.observeQuery/PlayTimeRecord
 * events landing back-to-back from two different coaches' mutations.
 *
 * Deliberately NOT importing team-sharing.spec.ts's invite/accept helpers —
 * see e2e/game-workflow-helpers.ts's header comment for why importing a
 * real spec file's exports leaks its test() registrations into any project
 * that imports it. The invite/accept flow is reimplemented locally instead.
 *
 * Part of the `field-conditions` Playwright project (WebKit + mobile
 * viewport, pre-release only — see playwright.config.ts).
 */

const opponent = 'Concurrent FC';

async function sendInvitation(page: Page, inviteeEmail: string): Promise<string> {
  await navigateToManagement(page);
  await clickManagementTab(page, 'Sharing');
  await page.waitForTimeout(UI_TIMING.STANDARD);

  const manageSharingButton = page.locator('.resource-item')
    .filter({ has: page.getByText(TEST_DATA.team.name, { exact: true }) })
    .first()
    .getByRole('button', { name: /manage sharing/i });
  await manageSharingButton.click();
  await page.waitForTimeout(UI_TIMING.STANDARD);

  await fillInput(page, 'input[type="email"]', inviteeEmail);
  await clickButtonByText(page, /send invitation/i);
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

  const invitationsList = page.locator('.sharing-section, .invitations-list');
  await expect(invitationsList).toContainText(inviteeEmail, { timeout: 5000 });

  const invitationItem = page.locator('.invitation-item').filter({ hasText: inviteeEmail }).first();
  const invitationLink = invitationItem.locator('.invitation-link').first();
  const invitationId = await invitationLink.getAttribute('data-invitation-id');
  expect(invitationId, 'Expected an invitation id to be captured from the UI').toBeTruthy();
  return invitationId as string;
}

async function acceptInvitation(page: Page, invitationId: string, email: string, password: string): Promise<void> {
  await page.goto(`/invite/${invitationId}`);
  await page.waitForTimeout(UI_TIMING.STANDARD);

  const loginButton = page.getByRole('banner').getByRole('button', { name: 'Log In' });
  if (await loginButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await loginButton.click();
    await waitForPageLoad(page);
  }

  const invitePageLoginInput = page.locator('input[name="username"], input[type="email"]');
  if (await invitePageLoginInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await fillInput(page, 'input[name="username"], input[type="email"]', email);
    await fillInput(page, 'input[name="password"], input[type="password"]', password);
    await clickButton(page, 'Sign in');

    try {
      await page.waitForSelector('button:has-text("Skip")', { timeout: 2000 });
      await clickButton(page, 'Skip');
    } catch {
      // Skip (verification) button may not appear.
    }

    await waitForPageLoad(page);
    // Amplify auth redirects to '/' after sign-in; navigate back to the invite URL.
    await page.goto(`/invite/${invitationId}`);
    await waitForPageLoad(page);
  }

  const acceptButton = page.getByRole('button', { name: /accept/i });
  await expect(acceptButton).toBeVisible({ timeout: 10000 });
  await acceptButton.click();

  await expect(page.getByText(/Successfully joined/i)).toBeVisible({ timeout: 10000 });
  // The app reloads automatically ~2s after a successful accept.
  await page.waitForTimeout(3000);
  await waitForPageLoad(page);
}

async function openSharedGame(page: Page): Promise<void> {
  await page.goto('/');
  await waitForPageLoad(page);

  const gameCard = page.locator('.game-card').filter({ hasText: opponent }).first();
  await expect(gameCard).toBeVisible({ timeout: 20000 });
  const openButton = gameCard.locator('.open-game-button').first();
  if (await openButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await openButton.click();
  } else {
    await gameCard.click();
  }
  await waitForPageLoad(page);
  await expect(page.locator('.game-management')).toBeVisible({ timeout: 10000 });
}

async function readCommandBandScore(page: Page): Promise<string> {
  const scoreText = ((await page.locator('.command-band__score').first().textContent()) ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const match = scoreText.match(/(\d+)\s*[–-]\s*(\d+)/);
  expect(match).toBeTruthy();
  return `${match![1]}-${match![2]}`;
}

test.describe('Concurrent coaches (Issue C regression)', () => {
  test('two coaches acting concurrently on the same game stay in sync with no lost writes', async ({ page, context }) => {
    test.setTimeout(TEST_CONFIG.timeout.long);

    let context2: BrowserContext | undefined;
    const cleanupConfirm = handleConfirmDialog(page, false);

    try {
      // --- Coach 1 (owner): set up team, roster, game, lineup, start the game ---
      await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
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
      await expect(page.locator('.command-band__timer')).toBeVisible({ timeout: 5000 });
      await pauseGameClock(page);
      await advanceGameClockTo(page, 5);

      // --- Invite coach 2 to the same team. Team/roster/game already exist and
      // backfill onto coach 2's coaches[] on accept (see CLAUDE.md's authorization
      // pattern and team-sharing.spec.ts's own pre-invite-game regression guard). ---
      const invitationId = await sendInvitation(page, TEST_USERS.user2.email);

      // --- Coach 2: a separate, concurrently-running browser context — the real
      // concurrency this regression needs, not a sequential identity swap. ---
      const browser = context.browser();
      expect(browser, 'Expected an owning Browser instance to open a second context').toBeTruthy();
      context2 = await browser!.newContext({ ...devices['iPhone 13'], storageState: '.auth/user2.json' });
      const page2 = await context2.newPage();

      await acceptInvitation(page2, invitationId, TEST_USERS.user2.email, TEST_USERS.user2.password);

      await openSharedGame(page2);
      await expect(page2.locator('.command-band__timer')).toBeVisible({ timeout: 15000 });

      const fieldTabCoach1 = page.getByRole('tab', { name: 'Field' });
      if (await fieldTabCoach1.isVisible({ timeout: 2000 }).catch(() => false)) {
        await fieldTabCoach1.click();
        await page.waitForTimeout(UI_TIMING.QUICK);
      }

      const goalsTabCoach2 = page2.getByRole('tab', { name: 'Goals' });
      if (await goalsTabCoach2.isVisible({ timeout: 2000 }).catch(() => false)) {
        await goalsTabCoach2.click();
        await page2.waitForTimeout(UI_TIMING.QUICK);
      }

      // --- Genuinely concurrent actions: coach 1 substitutes a player while coach 2
      // records the opponent's goal, at the same time, via Promise.all — not
      // sequential turns on a shared page. ---
      const recordOpponentGoalConcurrently = async () => {
        const opponentGoalButton = page2.getByRole('button', { name: /Goal -/ }).last();
        await expect(opponentGoalButton).toBeVisible({ timeout: 10000 });
        await opponentGoalButton.click({ force: true });
        await expect(page2.getByRole('heading', { name: 'Record Goal' })).toBeVisible({ timeout: 5000 });
        await page2.locator('.modal-content .form-actions .btn-primary', { hasText: 'Record Goal' }).click({ force: true });
        await page2.waitForTimeout(UI_TIMING.DATA_OPERATION);
      };

      const executeSubConcurrently = async () => {
        const executed = await executeRotation(page, 5, 'Diana', 'Hannah');
        expect(executed, 'Concurrent substitution (Diana -> Hannah) must succeed').toBe(true);
      };

      await Promise.all([recordOpponentGoalConcurrently(), executeSubConcurrently()]);

      // --- Verify no lost write: both changes must converge and be visible to BOTH coaches. ---
      await expect
        .poll(async () => readCommandBandScore(page), {
          timeout: 30000,
          message: 'Coach 1 should see the goal coach 2 recorded concurrently',
        })
        .toBe('0-1');
      await expect
        .poll(async () => readCommandBandScore(page2), {
          timeout: 30000,
          message: 'Coach 2 should see its own goal reflected',
        })
        .toBe('0-1');

      await expect(page.locator('.position-lineup-grid')).toContainText('Hannah', { timeout: 15000 });
      await expect
        .poll(
          async () => {
            const lineupText = (await page2.locator('.position-lineup-grid').textContent().catch(() => '')) ?? '';
            return lineupText.includes('Hannah');
          },
          { timeout: 30000, message: 'Coach 2 should see the substitution coach 1 executed concurrently' },
        )
        .toBe(true);

      console.log('✓ Concurrent goal + substitution converged with no lost write for both coaches');
    } finally {
      cleanupConfirm();
      if (context2) {
        await context2.close();
      }
    }
  });
});
