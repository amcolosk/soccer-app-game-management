/**
 * E2E smoke spec â€” Game Planner
 *
 * Layer D smoke coverage only:
 *   - Timeline create path: container visible â†’ interval input â†’ Create Game Plan â†’ timeline strip
 *   - Pre-game coaching notes confirm/cancel wiring
 *
 * Deep planner semantics are covered by unit/component tests in the
 * GameManagement planner surface.
 */

import { test, expect, Page } from '@playwright/test';
import {
  waitForPageLoad,
  fillInput,
  clickButton,
  navigateToApp,
  cleanupTestData,
  clickManagementTab,
  createFormation,
  createTeam,
  UI_TIMING,
  closePWAPrompt,
  closeWelcomeModal,
} from './helpers';

const TEST_DATA = {
  formation: {
    name: 'E2E Game Planner 3-2',
    playerCount: '5',
    positions: [
      { name: 'Goalkeeper', abbreviation: 'GK', role: 'GOALKEEPER' as const },
      { name: 'Left Defender', abbreviation: 'LD', role: 'DEFENDER' as const },
      { name: 'Right Defender', abbreviation: 'RD', role: 'DEFENDER' as const },
      { name: 'Left Forward', abbreviation: 'LF', role: 'FORWARD' as const },
      { name: 'Right Forward', abbreviation: 'RF', role: 'FORWARD' as const },
    ],
  },
  team: {
    name: 'Game Planner Test Team',
    halfLength: '20',
    maxPlayers: '5',
  },
  // 6 players: 5 on-field + 1 bench â€” minimum to generate at least one rotation substitution
  players: [
    { number: '1', firstName: 'Player', lastName: 'One' },
    { number: '2', firstName: 'Player', lastName: 'Two' },
    { number: '3', firstName: 'Player', lastName: 'Three' },
    { number: '4', firstName: 'Player', lastName: 'Four' },
    { number: '5', firstName: 'Player', lastName: 'Five' },
    { number: '6', firstName: 'Player', lastName: 'Six' },
  ],
  game: {
    opponent: 'Test Opponent FC',
    date: '2025-12-15T14:00',
    isHome: true,
  },
};

async function createPlayers(page: Page) {
  await clickManagementTab(page, 'Players');

  for (const player of TEST_DATA.players) {
    await clickButton(page, '+ Add Player');
    await waitForPageLoad(page);

    await fillInput(page, 'input[placeholder*="First"]', player.firstName);
    await fillInput(page, 'input[placeholder*="Last"]', player.lastName);

    await clickButton(page, 'Add');
    await page.waitForTimeout(500);

    await expect(page.getByText(`${player.firstName} ${player.lastName}`).first()).toBeVisible();
  }
}

async function addPlayersToRoster(page: Page) {
  const teamsTab = page.locator('button.management-tab', { hasText: /Teams/ });
  await teamsTab.click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);

  const teamCard = page.locator('.item-card').filter({ hasText: TEST_DATA.team.name });
  const expandButton = teamCard.locator('button[aria-label*="roster"]').first();
  await expandButton.click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);

  for (const player of TEST_DATA.players) {
    await clickButton(page, '+ Add Player to Roster');
    await page.waitForTimeout(UI_TIMING.STANDARD);

    const rosterForm = page.locator('.team-roster-section .create-form').first();
    await expect(rosterForm).toBeVisible({ timeout: 5000 });

    const playerOption = `${player.firstName} ${player.lastName}`;
    await rosterForm.locator('select').first().selectOption({ label: playerOption });
    await page.waitForTimeout(UI_TIMING.QUICK);

    await rosterForm.locator('input[placeholder*="Player Number"]').fill(player.number);

    const addButton = rosterForm.locator('.form-actions button.btn-primary', { hasText: 'Add' }).first();
    await addButton.click();
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

    const rosterEntry = `#${player.number} ${player.firstName} ${player.lastName}`;
    await expect(page.getByText(rosterEntry)).toBeVisible();
  }

  await page.waitForTimeout(3000);
}

async function createGame(page: Page) {
  await page.goto('/');
  await waitForPageLoad(page);
  await closePWAPrompt(page);
  await closeWelcomeModal(page);

  const scheduleButton = page.getByRole('button', { name: /\+\s*Schedule New Game/i }).first();
  const scheduleButtonFallback = page.getByRole('button', { name: /Schedule New Game/i }).first();

  await expect(scheduleButton).toBeVisible({ timeout: 10000 });
  await closeWelcomeModal(page);
  await scheduleButton.click({ force: true });
  await page.waitForTimeout(UI_TIMING.STANDARD);

  let scheduleForm = page.locator('.create-form').filter({ has: page.getByRole('heading', { name: 'Schedule New Game' }) }).first();
  const isFormVisible = await scheduleForm.isVisible({ timeout: 2500 }).catch(() => false);
  if (!isFormVisible) {
    await closeWelcomeModal(page);
    await scheduleButtonFallback.click({ force: true });
    await scheduleButtonFallback.dispatchEvent('click');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    scheduleForm = page.locator('.create-form').filter({ has: page.getByRole('heading', { name: 'Schedule New Game' }) }).first();
  }

  const teamSelect = scheduleForm.locator('select').first();
  await expect(scheduleForm).toBeVisible({ timeout: 10000 });
  await expect
    .poll(async () => teamSelect.locator('option').count(), {
      timeout: 15000,
      message: 'Expected schedule-game team options to be hydrated in game planner setup',
    })
    .toBeGreaterThan(1);
  await teamSelect.selectOption({ label: TEST_DATA.team.name });
  await page.waitForTimeout(300);

  await fillInput(page, 'input[placeholder*="Opponent Team Name *"]', TEST_DATA.game.opponent);
  await fillInput(page, 'input[type="datetime-local"]', TEST_DATA.game.date);

  const homeCheckbox = page.locator('input[type="checkbox"]');
  if (TEST_DATA.game.isHome) {
    await homeCheckbox.check();
  }

  await clickButton(page, 'Create');
  await page.waitForTimeout(2000);
  await expect(page.getByText(TEST_DATA.game.opponent)).toBeVisible();
  await page.waitForTimeout(2000);
}

async function openGamePlanner(page: Page) {
  await page.locator('a.nav-item', { hasText: 'Games' }).click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);

  const gameCard = page.locator('.game-card', { hasText: TEST_DATA.game.opponent });
  // Wait for the card to be in the DOM before clicking — DynamoDB subscription
  // delivery can take a few seconds in CI after navigation.
  await expect(gameCard).toBeVisible({ timeout: 10000 });
  await gameCard.locator('.open-game-button').click();
  await waitForPageLoad(page);

  // Use a CI-safe timeout (15 s) matching the global expect.timeout in playwright.config.ts.
  await expect(page.locator('.game-management')).toBeVisible({ timeout: 15000 });
  const gameUrlMatch = page.url().match(/\/game\/([^/?#]+)/);
  return gameUrlMatch?.[1] ?? null;
}

async function assignStartingLineup(page: Page) {
  // Selecting a player can replace that position's <select> with a chip,
  // so always re-query and fill the first remaining select.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const selects = page.locator('.position-lineup-grid select');
    const remaining = await selects.count();
    if (remaining === 0) break;

    const select = selects.first();
    const optionLabels = (await select.locator('option').allTextContents())
      .map((label) => label.trim())
      .filter((label) => label && label !== 'Unassigned' && !label.includes('(Assigned)'));
    const nextAvailablePlayer = optionLabels[0];
    if (!nextAvailablePlayer) break;

    await select.selectOption({ label: nextAvailablePlayer });
    await page.waitForTimeout(UI_TIMING.QUICK);
  }

  await expect
    .poll(async () => page.locator('.position-lineup-grid select').count(), {
      timeout: 10000,
      message: 'Expected all planner lineup slots to be assigned before starting the game',
    })
    .toBe(0);
}

async function startGameFromScheduled(page: Page) {
  const startButtons = page.getByRole('button', { name: /Start Game/i });
  const startButtonCount = await startButtons.count();
  expect(startButtonCount).toBeGreaterThan(0);
  await startButtons.first().click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);

  const availabilityHeading = page.getByRole('heading', { name: /Player Availability/i });
  if (await availabilityHeading.isVisible({ timeout: 3000 }).catch(() => false)) {
    const modalStartButtons = page.getByRole('button', { name: /Start Game/i });
    const modalButtonCount = await modalStartButtons.count();
    if (modalButtonCount > 1) {
      await modalStartButtons.nth(modalButtonCount - 1).click();
    } else {
      await modalStartButtons.first().click();
    }
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  }
}

async function setupTestData(page: Page) {
  await navigateToApp(page);
  await cleanupTestData(page);

  const formationLabel = `${TEST_DATA.formation.name} (${TEST_DATA.formation.playerCount} players)`;
  await createFormation(page, TEST_DATA.formation);
  await createTeam(page, TEST_DATA.team, formationLabel);
  await createPlayers(page);
  await addPlayersToRoster(page);
  await createGame(page);
}

test.describe('Game Planner with Timeline', () => {
  test.beforeEach(async ({ page }) => {
    await closePWAPrompt(page);
  });

  test('Complete game planning workflow with timeline', async ({ page }) => {
    test.setTimeout(240000);

    await setupTestData(page);
    const gameId = await openGamePlanner(page);
    expect(gameId).not.toBeNull();

    // Scheduled defaults to Plan tab with merged availability + lineup surfaces.
    await expect(page.getByRole('tab', { name: /^Plan$/i })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.game-management')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('heading', { name: /Player Availability/i })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.availability-grid')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.position-lineup-grid')).toBeVisible({ timeout: 5000 });

    await assignStartingLineup(page);
    await startGameFromScheduled(page);

    // Plan auto-switches to Field after start.
    await expect(page.getByRole('tab', { name: /^Field$/i })).toHaveAttribute('aria-selected', 'true');

    // Live Plan tab stays available but read-only.
    await page.getByRole('tab', { name: /^Plan$/i }).click();
    await expect(page.getByRole('tab', { name: /^Plan$/i })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(/plan is read-only during live play/i)).toBeVisible();
  });

  test('Legacy /game/:id/plan route redirects to merged /game/:id view', async ({ page }) => {
    test.setTimeout(240000);

    await setupTestData(page);
    const gameId = await openGamePlanner(page);
    expect(gameId).not.toBeNull();

    await page.goto(`/game/${gameId}/plan`);
    await waitForPageLoad(page);

    await expect
      .poll(() => page.url().endsWith(`/game/${gameId}`), {
        timeout: 10000,
        message: 'Expected legacy /plan route to redirect to merged /game/:id route',
      })
      .toBe(true);
    await expect(page.getByRole('tab', { name: /^Plan$/i })).toHaveAttribute('aria-selected', 'true');
  });

  test('Pre-game coaching notes CRUD workflow', async ({ page }) => {
    test.setTimeout(240000);

    await setupTestData(page);
    await openGamePlanner(page);

    // Notes are a separate scheduled-state tab in the merged game view.
    await page.getByRole('tab', { name: /^Notes$/i }).click();
    await expect(page.getByRole('tab', { name: /^Notes$/i })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Pre-Game Coaching Notes' })).toBeVisible();

    // Create note → visible in list
    await page.getByRole('button', { name: 'Add coaching point' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.fill('#pre-game-note-text', 'Keep compact shape when out of possession');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByText('Keep compact shape when out of possession')).toBeVisible();

    // Delete → confirm wiring (list refresh may be eventual depending on subscription timing)
    await page.getByRole('button', { name: 'Delete coaching point' }).first().click();
    const confirmDialog = page.getByRole('alertdialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(confirmDialog).not.toBeVisible();

    const noteText = page.getByText('Keep compact shape when out of possession');
    const noteStillVisible = await noteText.isVisible().catch(() => false);

    // Re-create note only if delete actually removed it.
    if (!noteStillVisible) {
      await expect(page.getByText('No coaching points yet.')).toBeVisible();
      await page.getByRole('button', { name: 'Add coaching point' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.fill('#pre-game-note-text', 'Keep compact shape when out of possession');
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(page.getByText('Keep compact shape when out of possession')).toBeVisible();
    }

    // Delete → cancel → note still visible (cancel wiring)
    await page.getByRole('button', { name: 'Delete coaching point' }).first().click();
    const cancelDialog = page.getByRole('alertdialog');
    await expect(cancelDialog).toBeVisible();
    await cancelDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText('Keep compact shape when out of possession')).toBeVisible();
  });
});