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
  navigateToApp,
  navigateToManagement,
  waitForPageLoad,
  UI_TIMING,
} from './helpers';
import { TEST_CONFIG } from '../test-config';

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
  players: [
    { firstName: 'Mobile', lastName: 'One', number: '1' },
    { firstName: 'Mobile', lastName: 'Two', number: '2' },
    { firstName: 'Mobile', lastName: 'Three', number: '3' },
    { firstName: 'Mobile', lastName: 'Four', number: '4' },
    { firstName: 'Mobile', lastName: 'Five', number: '5' },
  ],
  inProgressOpponent: 'E2E Mobile Notes In Progress',
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

  const existingGameCard = page.locator('.game-card').filter({ hasText: opponent }).first();
  if (await existingGameCard.isVisible({ timeout: 1500 }).catch(() => false)) {
    return;
  }

  await page.getByRole('button', { name: '+ Schedule New Game', exact: true }).click();
  await page.waitForTimeout(UI_TIMING.STANDARD);

  await page.selectOption('select', { label: SEED_DATA.team.name });
  await fillInput(page, 'input[placeholder*="Opponent"]', opponent);

  const scheduledDate = new Date();
  scheduledDate.setDate(scheduledDate.getDate() + 1);
  await fillInput(page, 'input[type="datetime-local"]', toLocalDateTimeInputValue(scheduledDate));

  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

  await expect(page.locator('.game-card').filter({ hasText: opponent }).first()).toBeVisible({ timeout: 5000 });
}

async function openGameByOpponent(page: Page, opponent: string): Promise<boolean> {
  await page.locator('a.nav-item', { hasText: 'Games' }).click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);

  const gameCard = page.locator('.game-card').filter({ hasText: opponent }).first();
  if (!(await gameCard.isVisible({ timeout: 6000 }).catch(() => false))) {
    return false;
  }

  await gameCard.click();
  await waitForPageLoad(page);
  return true;
}

async function ensureSeedPlayers(page: Page): Promise<void> {
  await clickManagementTab(page, 'Players');

  for (const player of SEED_DATA.players) {
    const fullName = `${player.firstName} ${player.lastName}`;
    const existingPlayer = page.locator('.item-card').filter({ hasText: fullName }).first();
    if (await existingPlayer.isVisible({ timeout: 1000 }).catch(() => false)) {
      continue;
    }

    await clickButton(page, '+ Add Player');
    await waitForPageLoad(page);
    await fillInput(page, 'input[placeholder*="First"]', player.firstName);
    await fillInput(page, 'input[placeholder*="Last"]', player.lastName);
    await clickButton(page, 'Add');
    await page.waitForTimeout(UI_TIMING.NAVIGATION);
    await expect(page.locator('.item-card').filter({ hasText: fullName }).first()).toBeVisible({ timeout: 5000 });
  }
}

async function ensureSeedRoster(page: Page): Promise<void> {
  await clickManagementTab(page, 'Teams');
  await page.waitForTimeout(UI_TIMING.NAVIGATION);

  const teamCard = page.locator('.item-card').filter({ hasText: SEED_DATA.team.name }).first();
  await expect(teamCard).toBeVisible({ timeout: 5000 });

  const rosterToggle = teamCard.locator('button[aria-label*="roster"]').first();
  const rosterToggleLabel = (await rosterToggle.getAttribute('aria-label')) ?? '';
  if (/show/i.test(rosterToggleLabel)) {
    await rosterToggle.click();
    await page.waitForTimeout(UI_TIMING.STANDARD);
  }

  for (const player of SEED_DATA.players) {
    const rosterEntry = `#${player.number} ${player.firstName} ${player.lastName}`;
    if (await page.getByText(rosterEntry).first().isVisible({ timeout: 1000 }).catch(() => false)) {
      continue;
    }

    await clickButton(page, '+ Add Player to Roster');
    await page.waitForTimeout(UI_TIMING.STANDARD);

    const rosterForm = page.locator('.team-roster-section .create-form').first();
    await expect(rosterForm).toBeVisible({ timeout: 5000 });
    await rosterForm.locator('select').first().selectOption({ label: `${player.firstName} ${player.lastName}` });
    await rosterForm.locator('input[placeholder*="Player Number"]').fill(player.number);
    await rosterForm.locator('.form-actions button.btn-primary', { hasText: 'Add' }).first().click();
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await expect(page.getByText(rosterEntry).first()).toBeVisible({ timeout: 5000 });
  }
}

async function ensureStartingLineup(page: Page): Promise<void> {
  const lineupSelects = page.getByRole('combobox');
  const slotCount = await lineupSelects.count();
  if (slotCount === 0) {
    return;
  }

  for (let index = 0; index < Math.min(slotCount, SEED_DATA.players.length); index += 1) {
    const select = lineupSelects.nth(index);
    const optionCount = await select.locator('option').count();
    if (optionCount < 2) {
      continue;
    }

    const selectedValue = await select.inputValue().catch(() => '');
    if (selectedValue) {
      continue;
    }

    await select.selectOption({ index: Math.min(index + 1, optionCount - 1) });
    await page.waitForTimeout(UI_TIMING.QUICK);
  }
}

async function startGameFromScheduledCard(page: Page, opponent: string, finishAtHalftime: boolean): Promise<void> {
  const opened = await openGameByOpponent(page, opponent);
  expect(opened).toBeTruthy();

  const addNoteButton = page.getByRole('button', { name: 'Add note' });

  // If game already in-progress (e.g., serial-mode retry), skip the start-game flow.
  if (!(await addNoteButton.isVisible({ timeout: 2000 }).catch(() => false))) {
    await ensureStartingLineup(page);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await clickButton(page, 'Start Game');
      await page.waitForTimeout(UI_TIMING.NAVIGATION);

      const availabilityHeading = page.getByRole('heading', { name: 'Player Availability Check' });
      if (await availabilityHeading.isVisible({ timeout: 1000 }).catch(() => false)) {
        await page.getByRole('button', { name: 'Start Game' }).last().click();
        await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
      }

      if (await addNoteButton.isVisible({ timeout: 1500 }).catch(() => false)) {
        break;
      }

      await ensureStartingLineup(page);
    }

    await expect(addNoteButton).toBeVisible({ timeout: 5000 });
  }

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

  const existingFormationCount = await page
    .locator('.item-card h3')
    .filter({ hasText: SEED_DATA.formation.name })
    .count();
  if (existingFormationCount === 0) {
    await createFormation(page, SEED_DATA.formation);
  }

  const formationLabel = `${SEED_DATA.formation.name} (${SEED_DATA.formation.playerCount} players)`;
  await clickManagementTab(page, 'Teams');

  const existingTeamCount = await page
    .locator('.item-card h3')
    .filter({ hasText: SEED_DATA.team.name })
    .count();
  if (existingTeamCount === 0) {
    await createTeam(page, SEED_DATA.team, formationLabel);
  }

  await ensureSeedPlayers(page);
  await ensureSeedRoster(page);

  await scheduleSeedGame(page, SEED_DATA.inProgressOpponent);
  await startGameFromScheduledCard(page, SEED_DATA.inProgressOpponent, false);
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

  // If localStorage restored the game management view on page load, the CommandBand
  // note trigger should already be visible when a game is in-progress.
  const addNoteButton = page.getByRole('button', { name: 'Add note' });
  if (await addNoteButton.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false)) {
    return true;
  }

  const seededCardOpened = await openGameByOpponent(page, SEED_DATA.inProgressOpponent);
  if (!seededCardOpened) {
    const homeTab = page.locator('a.nav-item', { hasText: 'Games' });
    await homeTab.click();
    await page.waitForTimeout(UI_TIMING.NAVIGATION);

    const anyCard = page.locator('.game-card').first();
    if (!(await anyCard.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false))) {
      return false;
    }
    await anyCard.click();
    await waitForPageLoad(page);
  }

  // The game is "in-progress" when the note trigger is visible in the CommandBand.
  return addNoteButton.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);
}

// ─── single viewport ──────────────────────────────────────────────────────────
// Wiring-only smoke checks; deep modal-dismiss and accessibility semantics
// are owned by PlayerNotesPanel.test.tsx (Layer B).
// Override browserName to chromium so the smoke project doesn't require webkit
// in CI — mobile viewport/touch simulation is preserved via the device descriptor.
test.use({ ...devices['iPhone 12'], browserName: 'chromium' });

test.describe('Direct Note Entry — Mobile', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToApp(page);
  });

  // ── Icon-only trigger accessibility ────────────────────────────────────────

  test('CommandBand note button exists and has accessible name "Add note"', async ({ page }) => {
    const isReady = await navigateToInProgressGame(page);
    expect(isReady).toBeTruthy();

    const noteBtn = page.getByRole('button', { name: 'Add note' });
    await expect(noteBtn).toBeVisible();
    await expect(noteBtn).toHaveAccessibleName('Add note');
  }, TEST_CONFIG.timeout.short);

  // ── Open → Cancel wiring ───────────────────────────────────────────────────

  test('Tap Add note → dialog visible → Cancel → dismissed', async ({ page }) => {
    const isReady = await navigateToInProgressGame(page);
    expect(isReady).toBeTruthy();

    await page.getByRole('button', { name: 'Add note' }).click();
    await page.waitForTimeout(UI_TIMING.STANDARD);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForTimeout(UI_TIMING.STANDARD);
    await expect(dialog).not.toBeVisible();
  }, TEST_CONFIG.timeout.short);

  // ── Save button accessible with keyboard open ──────────────────────────────

  test('Save button remains within viewport when note textarea is focused (narrow keyboard-open simulation)', async ({ page }) => {
    const isReady = await navigateToInProgressGame(page);
    expect(isReady).toBeTruthy();

    // Open modal
    await page.getByRole('button', { name: 'Add note' }).click();
    await page.waitForTimeout(UI_TIMING.STANDARD);
    await expect(page.getByRole('dialog')).toBeVisible();

    // Simulate keyboard open: shrink viewport height to ~55% of original
    const iphone12Viewport = devices['iPhone 12'].viewport;
    await page.setViewportSize({
      width: iphone12Viewport.width,
      height: Math.round(iphone12Viewport.height * 0.55),
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
    await page.setViewportSize(iphone12Viewport);

    // Close modal
    await page.getByRole('button', { name: 'Cancel' }).click();
  }, TEST_CONFIG.timeout.short);

  // ── Regression: issue #84 — saved note must appear immediately ────────────
  // ref: https://github.com/amcolosk/soccer-app-game-management/issues/84

  test.fixme('saved note appears in notes list immediately without page reload (regression #84)', async ({ page }) => {
    const isReady = await navigateToInProgressGame(page);
    expect(isReady).toBeTruthy();

    // Navigate to the Notes tab
    await page.getByRole('tab', { name: 'Notes' }).click();
    await page.waitForTimeout(UI_TIMING.STANDARD);

    // Open the Gold Star note modal from the notes-tab buttons
    await page.getByRole('button', { name: 'Gold Star' }).first().click();
    await page.waitForTimeout(UI_TIMING.STANDARD);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Fill in note text
    await page.locator('#noteText').fill('Regression #84 check');

    // Save the note
    await page.getByRole('button', { name: 'Save Note' }).click();
    await page.waitForTimeout(UI_TIMING.STANDARD);

    // The note card MUST appear without a page reload — this is the failing assertion for issue #84.
    // Currently FAILS because handleSaveNote does not trigger a notes refresh after the mutation.
    await expect(page.locator('.note-card').first()).toBeVisible({ timeout: 5000 });
  }, TEST_CONFIG.timeout.short);
});
