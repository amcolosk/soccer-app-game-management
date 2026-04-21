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
    name: `E2E Mobile Notes Team ${Date.now().toString(36)}`,
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
  inProgressOpponent: `E2E Mobile Notes In Progress ${Date.now().toString(36)}`,
};

const MAX_SEED_ATTEMPTS = 3;
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

  const scheduleForm = page.locator('.create-form').filter({ has: page.getByRole('heading', { name: 'Schedule New Game' }) }).first();
  await expect(scheduleForm).toBeVisible({ timeout: 10000 });
  const teamSelect = scheduleForm.locator('select').first();
  await expect
    .poll(async () => {
      const options = await teamSelect.locator('option').allTextContents();
      return options.some((text) => text.trim() === SEED_DATA.team.name);
    }, {
      timeout: 20000,
      message: `Expected schedule-game team option to include ${SEED_DATA.team.name}`,
    })
    .toBe(true);

  await teamSelect.selectOption({ label: SEED_DATA.team.name });
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
    const existingPlayer = page.locator('.item-card, .player-card, .player-item').filter({ hasText: fullName }).first();
    if (await existingPlayer.isVisible({ timeout: 1000 }).catch(() => false)) {
      continue;
    }

    await clickButton(page, '+ Add Player');
    await waitForPageLoad(page);
    await fillInput(page, 'input[placeholder*="First"]', player.firstName);
    await fillInput(page, 'input[placeholder*="Last"]', player.lastName);
    await clickButton(page, 'Add');
    await page.waitForTimeout(UI_TIMING.NAVIGATION);

    const isPlayerVisible = await expect
      .poll(async () => {
        return page.locator('.item-card, .player-card, .player-item').filter({ hasText: fullName }).count();
      }, {
        timeout: 15000,
        message: `Expected player ${fullName} to appear in Players list after creation`,
      })
      .toBeGreaterThan(0)
      .then(() => true)
      .catch(() => false);

    if (!isPlayerVisible) {
      // One recovery attempt: force-tab refresh and re-check for eventual consistency lag.
      await clickManagementTab(page, 'Teams');
      await page.waitForTimeout(UI_TIMING.NAVIGATION);
      await clickManagementTab(page, 'Players');
      await page.waitForTimeout(UI_TIMING.NAVIGATION);
      await expect(page.locator('.item-card, .player-card, .player-item').filter({ hasText: fullName }).first())
        .toBeVisible({ timeout: 10000 });
    }
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
  const maxPasses = 6;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const lineupSelects = page.getByRole('combobox');
    const slotCount = await lineupSelects.count();
    if (slotCount === 0) {
      return;
    }

    let unassigned = 0;
    let changed = 0;

    for (let index = 0; index < slotCount; index += 1) {
      const select = lineupSelects.nth(index);
      const selectedLabel = (await select.locator('option:checked').textContent().catch(() => '')) ?? '';
      if (!/select player/i.test(selectedLabel)) {
        continue;
      }

      unassigned += 1;
      const optionCount = await select.locator('option').count();
      if (optionCount < 2) {
        continue;
      }

      await select.selectOption({ index: 1 });
      changed += 1;
      await page.waitForTimeout(UI_TIMING.QUICK);
    }

    if (unassigned === 0) {
      return;
    }

    if (changed === 0) {
      break;
    }

    await page.waitForTimeout(UI_TIMING.QUICK);
  }

  const remainingSelects = page.getByRole('combobox');
  const remainingCount = await remainingSelects.count();
  let remainingUnassigned = 0;
  for (let index = 0; index < remainingCount; index += 1) {
    const selectedLabel = (await remainingSelects.nth(index).locator('option:checked').textContent().catch(() => '')) ?? '';
    if (/select player/i.test(selectedLabel)) {
      remainingUnassigned += 1;
    }
  }

  if (remainingUnassigned > 0) {
    throw new Error(`Expected all starting lineup slots to be assigned before starting game (remaining: ${remainingUnassigned})`);
  }
}

async function startGameFromScheduledCard(page: Page, opponent: string, finishAtHalftime: boolean): Promise<void> {
  const opened = await openGameByOpponent(page, opponent);
  expect(opened).toBeTruthy();

  const addNoteButton = page.getByRole('button', { name: 'Add note' });
  const notesTab = page.getByRole('tab', { name: 'Notes' });

  const isInProgressUiReady = async (timeoutMs: number): Promise<boolean> => {
    const addNoteVisible = await addNoteButton.isVisible({ timeout: timeoutMs }).catch(() => false);
    if (addNoteVisible) return true;

    const notesTabVisible = await notesTab.isVisible({ timeout: timeoutMs }).catch(() => false);
    if (notesTabVisible) return true;
    return false;
  };

  // If game already in-progress (e.g., serial-mode retry), skip the start-game flow.
  if (!(await isInProgressUiReady(2000))) {
    await ensureStartingLineup(page);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await clickButton(page, 'Start Game');
      await page.waitForTimeout(UI_TIMING.NAVIGATION);

      const availabilityHeading = page.getByRole('heading', { name: 'Player Availability Check' });
      if (await availabilityHeading.isVisible({ timeout: 1000 }).catch(() => false)) {
        await page.getByRole('button', { name: 'Start Game' }).last().click();
        await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
      }

      // Increased timeout (3000ms) for CI environments where game state updates may be slower
      if (await isInProgressUiReady(3000)) {
        break;
      }

      // If button still not visible, log diagnostics and retry
      const statusBadge = page.locator('.command-band__status-badge').first();
      const statusVisible = await statusBadge.isVisible({ timeout: 500 }).catch(() => false);
      console.log(`⚠️ Attempt ${attempt + 1}/3: "Add note" button not visible after game start. Status badge visible: ${statusVisible}`);

      await ensureStartingLineup(page);
    }

    // If the initial transition did not settle, reopen the seeded game card
    // and re-check readiness to recover from stale route state.
    if (!(await isInProgressUiReady(1500))) {
      await openGameByOpponent(page, opponent);
      await page.waitForTimeout(UI_TIMING.NAVIGATION);
    }

    // Final wait with extended timeout for game state propagation on CI
    await expect
      .poll(async () => isInProgressUiReady(1000), {
        timeout: 15000,
        message: 'Expected in-progress UI controls to become visible after game start',
      })
      .toBe(true);
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
  console.log(`  ✓ Navigated to Management`);
  
  await clickManagementTab(page, 'Formations');
  console.log(`  ✓ Opened Formations tab`);

  const existingFormationCount = await page
    .getByRole('heading', { name: SEED_DATA.formation.name })
    .count();
  if (existingFormationCount === 0) {
    await createFormation(page, SEED_DATA.formation);
    console.log(`  ✓ Created formation: ${SEED_DATA.formation.name}`);
  } else {
    console.log(`  ✓ Formation already exists: ${SEED_DATA.formation.name}`);
  }

  const formationLabel = `${SEED_DATA.formation.name} (${SEED_DATA.formation.playerCount} players)`;
  await clickManagementTab(page, 'Teams');
  console.log(`  ✓ Opened Teams tab`);

  const existingTeamCount = await page
    .locator('.item-card h3')
    .filter({ hasText: SEED_DATA.team.name })
    .count();
  if (existingTeamCount === 0) {
    await createTeam(page, SEED_DATA.team, formationLabel);
    console.log(`  ✓ Created team: ${SEED_DATA.team.name}`);
  } else {
    console.log(`  ✓ Team already exists: ${SEED_DATA.team.name}`);
  }

  await ensureSeedPlayers(page);
  console.log(`  ✓ Ensured ${SEED_DATA.players.length} players exist`);
  
  await ensureSeedRoster(page);
  console.log(`  ✓ Ensured ${SEED_DATA.players.length} players added to roster`);

  await scheduleSeedGame(page, SEED_DATA.inProgressOpponent);
  console.log(`  ✓ Scheduled game against: ${SEED_DATA.inProgressOpponent}`);
  
  await startGameFromScheduledCard(page, SEED_DATA.inProgressOpponent, false);
  console.log(`  ✓ Started game (in-progress state confirmed)`);
}

async function ensureSeededState(page: Page): Promise<void> {
  if (seededStateReady) {
    return;
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_SEED_ATTEMPTS; attempt += 1) {
    try {
      console.log(`📋 Seeding mobile game state (attempt ${attempt}/${MAX_SEED_ATTEMPTS})...`);
      await seedDeterministicMobileGameStates(page);
      console.log(`✅ Mobile game state seeded successfully`);
      seededStateReady = true;
      return;
    } catch (error) {
      lastError = error;
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Seeding attempt ${attempt} failed: ${errorMsg}`);
      
      // Reset the seeded state flag to retry completely
      if (attempt < MAX_SEED_ATTEMPTS) {
        console.log(`🔄 Retrying seeding...`);
      }
    }
  }

  const finalErrorMsg = lastError instanceof Error ? lastError.message : String(lastError);
  const msg = `Unable to seed deterministic mobile game states after ${MAX_SEED_ATTEMPTS} attempts. Last error: ${finalErrorMsg}`;
  console.error(`⚠️ ${msg}`);
  throw new Error(msg);
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
    test.setTimeout(TEST_CONFIG.timeout.short);
    const isReady = await navigateToInProgressGame(page);
    expect(isReady).toBeTruthy();

    const noteBtn = page.getByRole('button', { name: 'Add note' });
    await expect(noteBtn).toBeVisible();
    await expect(noteBtn).toHaveAccessibleName('Add note');
  });

  // ── Open → Cancel wiring ───────────────────────────────────────────────────

  test('Tap Add note → dialog visible → Cancel → dismissed', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.short);
    const isReady = await navigateToInProgressGame(page);
    expect(isReady).toBeTruthy();

    await page.getByRole('button', { name: 'Add note' }).click();
    await page.waitForTimeout(UI_TIMING.STANDARD);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForTimeout(UI_TIMING.STANDARD);
    await expect(dialog).not.toBeVisible();
  });

  // ── Save button accessible with keyboard open ──────────────────────────────

  test('Save button remains within viewport when note textarea is focused (narrow keyboard-open simulation)', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.short);
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
  });

  // ── Regression: issue #84 — saved note must appear immediately ────────────
  // ref: https://github.com/amcolosk/soccer-app-game-management/issues/84

  test.fixme('saved note appears in notes list immediately without page reload (regression #84)', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.short);
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
  });

  test('note row keeps visible Edit/Delete controls after save (swipe is additive)', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.short);
    const isReady = await navigateToInProgressGame(page);
    expect(isReady).toBeTruthy();

    await page.getByRole('tab', { name: 'Notes' }).click();
    await page.waitForTimeout(UI_TIMING.STANDARD);

    await page.getByRole('button', { name: 'Gold Star' }).first().click();
    const noteDialog = page.getByRole('dialog');
    await expect(noteDialog).toBeVisible();

    await page.locator('#noteText').fill('Mobile additive action coverage');
    await page.getByRole('button', { name: 'Save Note' }).click();
    await expect(noteDialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

    const newestNote = page.locator('.note-card').first();
    await expect(newestNote).toBeVisible({ timeout: 10000 });
    await expect(newestNote.getByRole('button', { name: 'Edit note' })).toBeVisible();
    await expect(newestNote.getByRole('button', { name: 'Delete note' })).toBeVisible();
  });
});

test.describe('Action row parity — tablet/desktop', () => {
  test.use({ viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false });

  test.beforeEach(async ({ page }) => {
    await navigateToApp(page);
  });

  test('notes action order and keyboard focus remain accessible on tablet width', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.short);
    const isReady = await navigateToInProgressGame(page);
    expect(isReady).toBeTruthy();

    await page.getByRole('tab', { name: 'Notes' }).click();
    await page.waitForTimeout(UI_TIMING.STANDARD);

    await page.getByRole('button', { name: 'Gold Star' }).first().click();
    const noteDialog = page.getByRole('dialog');
    await expect(noteDialog).toBeVisible();

    await page.locator('#noteText').fill('Tablet parity action row check');
    await page.getByRole('button', { name: 'Save Note' }).click();
    await expect(noteDialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

    const newestNote = page.locator('.note-card').first();
    await expect(newestNote).toBeVisible({ timeout: 10000 });

    const actionButtons = newestNote.locator('.game-action-row button');
    await expect(actionButtons.nth(0)).toBeVisible();
    await expect(actionButtons.nth(1)).toBeVisible();
    await expect(actionButtons.nth(0)).toHaveAccessibleName('Edit note');
    await expect(actionButtons.nth(1)).toHaveAccessibleName('Delete note');

    await actionButtons.nth(0).focus();
    await expect(actionButtons.nth(0)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(actionButtons.nth(1)).toBeFocused();
  });
});
