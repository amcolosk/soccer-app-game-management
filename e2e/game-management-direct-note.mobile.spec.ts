/**
 * Mobile E2E Spec — Direct Note Entry
 *
 * Verifies the CommandBand "Add note" trigger and live-note modal on common
 * mobile viewport sizes. The spec seeds deterministic in-progress and halftime
 * game states via UI when needed, so key coverage does not depend on pre-seeded data.
 *
 * Viewport coverage:
 *   - iPhone 12      390 × 844
 *   - iPhone SE      375 × 667
 *   - iPhone 14 Pro Max  430 × 932
 */

import { test, expect, devices, Page } from '@playwright/test';
import {
  clickButton,
  clickManagementTab,
  createFormation,
  createTeam,
  fillInput,
  loginUser,
  navigateToManagement,
  waitForPageLoad,
  UI_TIMING,
} from './helpers';
import { TEST_USERS, TEST_CONFIG } from '../test-config';

// ─── helpers ────────────────────────────────────────────────────────────────

const SEED_DATA = {
  formation: {
    name: 'E2E-Mobile-5v5',
    playerCount: '5',
    positions: [
      { name: 'Goalkeeper', abbreviation: 'GK' },
      { name: 'Left Back', abbreviation: 'LB' },
      { name: 'Right Back', abbreviation: 'RB' },
      { name: 'Midfielder', abbreviation: 'MID' },
      { name: 'Forward', abbreviation: 'FWD' },
    ],
  },
  team: {
    name: 'E2E Mobile Notes Team',
    halfLength: '5',
    maxPlayers: '5',
  },
  inProgressOpponent: 'E2E Mobile Notes In Progress',
  halftimeOpponent: 'E2E Mobile Notes Halftime',
} as const;

const MAX_SEED_ATTEMPTS = 2;
let seededStateReady = false;

function toLocalDateTimeInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function scheduleSeedGame(page: Page, opponent: string): Promise<void> {
  await page.locator('a.nav-item', { hasText: 'Games' }).click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);

  await page.getByRole('button', { name: '+ Schedule New Game', exact: true }).click();
  await page.waitForTimeout(UI_TIMING.STANDARD);

  await page.selectOption('select', { label: SEED_DATA.team.name });
  await fillInput(page, 'input[placeholder*="Opponent"]', opponent);

  const scheduledDate = new Date();
  scheduledDate.setDate(scheduledDate.getDate() + 1);
  await fillInput(page, 'input[type="datetime-local"]', toLocalDateTimeInputValue(scheduledDate));

  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

  await expect(page.getByText(opponent)).toBeVisible();
}

async function openGameByOpponent(page: Page, opponent: string): Promise<boolean> {
  await page.locator('a.nav-item', { hasText: 'Games' }).click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);

  const gameCard = page.locator('.game-card').filter({ hasText: opponent }).first();
  if (!(await gameCard.isVisible({ timeout: 3000 }).catch(() => false))) {
    return false;
  }

  await gameCard.click();
  await waitForPageLoad(page);
  return true;
}

async function startGameFromScheduledCard(page: Page, opponent: string, finishAtHalftime: boolean): Promise<void> {
  const opened = await openGameByOpponent(page, opponent);
  expect(opened).toBeTruthy();

  await clickButton(page, 'Start Game');
  await page.waitForTimeout(UI_TIMING.NAVIGATION);

  const availabilityHeading = page.getByRole('heading', { name: 'Player Availability Check' });
  if (await availabilityHeading.isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.getByRole('button', { name: 'Start Game' }).nth(1).click();
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  }

  await expect(page.locator('.command-band__timer')).toBeVisible({ timeout: 5000 });

  if (finishAtHalftime) {
    await clickButton(page, '+5 min');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    await page.getByRole('button', { name: 'End First Half' }).click({ force: true });
    await expect(page.locator('.command-band__status-badge')).toBeVisible({ timeout: 5000 });
  }
}

async function seedDeterministicMobileGameStates(page: Page): Promise<void> {
  await navigateToManagement(page);
  await clickManagementTab(page, 'Formations');

  const existingFormation = page.locator('.item-card').filter({ hasText: SEED_DATA.formation.name }).first();
  if (!(await existingFormation.isVisible({ timeout: 2000 }).catch(() => false))) {
    await createFormation(page, SEED_DATA.formation);
  }

  const formationLabel = `${SEED_DATA.formation.name} (${SEED_DATA.formation.playerCount} players)`;
  await clickManagementTab(page, 'Teams');

  const existingTeam = page.locator('.item-card').filter({ hasText: SEED_DATA.team.name }).first();
  if (!(await existingTeam.isVisible({ timeout: 2000 }).catch(() => false))) {
    await createTeam(page, SEED_DATA.team, formationLabel);
  }

  await scheduleSeedGame(page, SEED_DATA.inProgressOpponent);
  await scheduleSeedGame(page, SEED_DATA.halftimeOpponent);
  await startGameFromScheduledCard(page, SEED_DATA.inProgressOpponent, false);
  await startGameFromScheduledCard(page, SEED_DATA.halftimeOpponent, true);
}

async function ensureSeededState(page: Page): Promise<void> {
  if (seededStateReady) {
    return;
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_SEED_ATTEMPTS; attempt += 1) {
    try {
      await seedDeterministicMobileGameStates(page);
      seededStateReady = true;
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Unable to seed deterministic mobile game states after ${MAX_SEED_ATTEMPTS} attempts: ${String(lastError)}`);
}

/**
 * Navigate to the Games tab and open the first game card whose status is
 * in-progress (timer visible in CommandBand).  Returns true when successful.
 */
async function navigateToInProgressGame(page: Page): Promise<boolean> {
  await ensureSeededState(page);

  const seededCardOpened = await openGameByOpponent(page, SEED_DATA.inProgressOpponent);
  if (!seededCardOpened) {
    const homeTab = page.locator('a.nav-item', { hasText: 'Games' });
    await homeTab.click();
    await page.waitForTimeout(UI_TIMING.NAVIGATION);

    const anyCard = page.locator('.game-card').first();
    if (!(await anyCard.isVisible({ timeout: 3000 }).catch(() => false))) {
      return false;
    }
    await anyCard.click();
    await waitForPageLoad(page);
  }

  // The game is "in-progress" when the CommandBand timer is visible
  const timer = page.locator('.command-band__timer');
  return timer.isVisible({ timeout: 3000 }).catch(() => false);
}

/**
 * Navigate to Games and open the first game card that is at halftime.
 * Returns true when successful.
 */
async function navigateToHalftimeGame(page: Page): Promise<boolean> {
  await ensureSeededState(page);

  const seededCardOpened = await openGameByOpponent(page, SEED_DATA.halftimeOpponent);
  if (!seededCardOpened) {
    const homeTab = page.locator('a.nav-item', { hasText: 'Games' });
    await homeTab.click();
    await page.waitForTimeout(UI_TIMING.NAVIGATION);

    const anyCard = page.locator('.game-card').first();
    if (!(await anyCard.isVisible({ timeout: 3000 }).catch(() => false))) {
      return false;
    }
    await anyCard.click();
    await waitForPageLoad(page);
  }

  // Halftime shows a status badge and the "Start Second Half" button
  const halftimeBadge = page.locator('.command-band__status-badge');
  return halftimeBadge.isVisible({ timeout: 3000 }).catch(() => false);
}

// ─── viewport matrix ─────────────────────────────────────────────────────────

const MOBILE_VIEWPORTS = [
  { label: 'iPhone 12', device: devices['iPhone 12'] },
  { label: 'iPhone SE', device: devices['iPhone SE'] },
  { label: 'iPhone 14 Pro Max', device: devices['iPhone 14 Pro Max'] },
] as const;

// ─── test suites per viewport ─────────────────────────────────────────────────

for (const { label, device } of MOBILE_VIEWPORTS) {
  test.describe(`Direct Note Entry — ${label} (${device.viewport.width}×${device.viewport.height})`, () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { defaultBrowserType, ...deviceOptions } = device;
    test.use({ ...deviceOptions });

    test.beforeEach(async ({ page }) => {
      await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    });

    // ── 5. Icon-only trigger accessibility ─────────────────────────────────

    test('CommandBand note button exists and has accessible name "Add note"', async ({ page }) => {
      const isReady = await navigateToInProgressGame(page);
      expect(isReady).toBeTruthy();

      const noteBtn = page.getByRole('button', { name: 'Add note' });
      await expect(noteBtn).toBeVisible();
      await expect(noteBtn).toHaveAccessibleName('Add note');
    }, TEST_CONFIG.timeout.short);

    // ── 1. From Lineup (Field) tab ──────────────────────────────────────────

    test('Tap CommandBand "Add note" from Lineup tab opens modal without switching tabs', async ({ page }) => {
      const isReady = await navigateToInProgressGame(page);
      expect(isReady).toBeTruthy();

      // Ensure we are on the Lineup/Field tab
      const lineupTab = page.getByRole('tab', { name: /lineup|field/i });
      if (await lineupTab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await lineupTab.click();
        await page.waitForTimeout(UI_TIMING.STANDARD);
      }

      // Tap the CommandBand note trigger
      await page.getByRole('button', { name: 'Add note' }).click();
      await page.waitForTimeout(UI_TIMING.STANDARD);

      // Modal should open
      await expect(page.getByRole('dialog')).toBeVisible();

      // The active tab should still be Lineup/Field — not Notes
      const notesTab = page.getByRole('tab', { name: /notes/i });
      if (await notesTab.isVisible({ timeout: 1000 }).catch(() => false)) {
        await expect(notesTab).not.toHaveAttribute('aria-selected', 'true');
      }

      // Close modal
      await page.getByRole('button', { name: 'Cancel' }).click();
      await page.waitForTimeout(UI_TIMING.STANDARD);
    }, TEST_CONFIG.timeout.short);

    // ── 2. From Bench tab ──────────────────────────────────────────────────

    test('Tap CommandBand "Add note" from Bench tab opens modal without switching tabs', async ({ page }) => {
      const isReady = await navigateToInProgressGame(page);
      expect(isReady).toBeTruthy();

      // Navigate to Bench tab if it exists
      const benchTab = page.getByRole('tab', { name: /bench/i });
      if (await benchTab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await benchTab.click();
        await page.waitForTimeout(UI_TIMING.STANDARD);
      } else {
        test.skip(true, 'Bench tab not visible on this game state — skipping');
      }

      // Tap the CommandBand note trigger
      await page.getByRole('button', { name: 'Add note' }).click();
      await page.waitForTimeout(UI_TIMING.STANDARD);

      // Modal should open
      await expect(page.getByRole('dialog')).toBeVisible();

      // Active tab should still be Bench
      const recheckBenchTab = page.getByRole('tab', { name: /bench/i });
      if (await recheckBenchTab.isVisible({ timeout: 1000 }).catch(() => false)) {
        await expect(recheckBenchTab).toHaveAttribute('aria-selected', 'true');
      }

      // Close modal
      await page.getByRole('button', { name: 'Cancel' }).click();
      await page.waitForTimeout(UI_TIMING.STANDARD);
    }, TEST_CONFIG.timeout.short);

    // ── 3. From halftime ────────────────────────────────────────────────────

    test('Tap halftime "Add note" opens modal', async ({ page }) => {
      const isHalftime = await navigateToHalftimeGame(page);
      expect(isHalftime).toBeTruthy();

      // Find the halftime-actions area Add note button
      const addNoteBtn = page.locator('.halftime-actions').getByRole('button', { name: /add note/i });
      if (!(await addNoteBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
        test.skip(true, 'Halftime "Add note" button not visible — skipping');
      }

      await addNoteBtn.click();
      await page.waitForTimeout(UI_TIMING.STANDARD);

      await expect(page.getByRole('dialog')).toBeVisible();

      // Close modal
      await page.getByRole('button', { name: 'Cancel' }).click();
      await page.waitForTimeout(UI_TIMING.STANDARD);
    }, TEST_CONFIG.timeout.short);

    // ── 4. Common 4-tap modal flow ──────────────────────────────────────────

    test('4-tap flow: open → dictation controls visible → cancel → modal dismissed', async ({ page }) => {
      const isReady = await navigateToInProgressGame(page);
      expect(isReady).toBeTruthy();

      // 1. Open modal via CommandBand
      await page.getByRole('button', { name: 'Add note' }).click();
      await page.waitForTimeout(UI_TIMING.STANDARD);

      // 2. Modal visible
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // 3. Dictation controls visible (either Start Dictation button or fallback text)
      const dictationVisible = await page
        .getByRole('button', { name: /dictation/i })
        .isVisible({ timeout: 2000 })
        .catch(() => false);
      const fallbackVisible = await page
        .getByText(/voice capture is not supported/i)
        .isVisible({ timeout: 1000 })
        .catch(() => false);
      expect(dictationVisible || fallbackVisible).toBe(true);

      // 4. Cancel → modal dismissed
      await page.getByRole('button', { name: 'Cancel' }).click();
      await page.waitForTimeout(UI_TIMING.STANDARD);
      await expect(dialog).not.toBeVisible();
    }, TEST_CONFIG.timeout.short);

    // ── 6. Save button accessible with keyboard open ───────────────────────

    test('Save button remains within viewport when note textarea is focused (narrow keyboard-open simulation)', async ({ page }) => {
      const isReady = await navigateToInProgressGame(page);
      expect(isReady).toBeTruthy();

      // Open modal
      await page.getByRole('button', { name: 'Add note' }).click();
      await page.waitForTimeout(UI_TIMING.STANDARD);
      await expect(page.getByRole('dialog')).toBeVisible();

      // Simulate keyboard open: shrink viewport height to ~55% of original
      const originalViewport = device.viewport;
      await page.setViewportSize({
        width: originalViewport.width,
        height: Math.round(originalViewport.height * 0.55),
      });

      // Focus the textarea (triggers on-screen keyboard on real device)
      const textarea = page.locator('#noteText');
      await textarea.focus();
      await page.waitForTimeout(UI_TIMING.STANDARD);

      // Save button should be scrollable into view and accessible
      const saveBtn = page.getByRole('button', { name: 'Save Note' });
      await saveBtn.scrollIntoViewIfNeeded();
      await expect(saveBtn).toBeVisible();

      // Restore original viewport
      await page.setViewportSize(originalViewport);

      // Close modal
      await page.getByRole('button', { name: 'Cancel' }).click();
    }, TEST_CONFIG.timeout.short);
  });
}
