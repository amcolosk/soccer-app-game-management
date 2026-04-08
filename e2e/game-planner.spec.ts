/**
 * E2E smoke spec â€” Game Planner
 *
 * Layer D smoke coverage only:
 *   - Timeline create path: container visible â†’ interval input â†’ Create Game Plan â†’ timeline strip
 *   - Pre-game coaching notes confirm/cancel wiring
 *
 * Deep planner semantics (interval input accessibility, plan/update button state,
 * projected play time, substitution display, rotation selection) are owned by
 * GamePlanner.interaction.test.tsx (Layer B).
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
      { name: 'Goalkeeper', abbreviation: 'GK' },
      { name: 'Left Defender', abbreviation: 'LD' },
      { name: 'Right Defender', abbreviation: 'RD' },
      { name: 'Left Forward', abbreviation: 'LF' },
      { name: 'Right Forward', abbreviation: 'RF' },
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
  const teamSelect = page.locator('select').first();

  await expect(scheduleButton).toBeVisible({ timeout: 10000 });
  await closeWelcomeModal(page);
  await scheduleButton.click({ force: true });
  await page.waitForTimeout(UI_TIMING.STANDARD);

  const isFormVisible = await teamSelect.isVisible({ timeout: 2500 }).catch(() => false);
  if (!isFormVisible) {
    await closeWelcomeModal(page);
    await scheduleButtonFallback.click({ force: true });
    await scheduleButtonFallback.dispatchEvent('click');
    await page.waitForTimeout(UI_TIMING.STANDARD);
  }

  await expect(teamSelect).toBeVisible({ timeout: 5000 });
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
  await gameCard.locator('.plan-button').click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);

  await expect(page.locator('.game-planner-container')).toBeVisible({ timeout: 5000 });
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
    await openGamePlanner(page);

    // Create path: container visible
    await expect(page.locator('.game-planner-container')).toBeVisible({ timeout: 5000 });

    // Rotations tab is the default; assert it is active
    await page.getByRole('tab', { name: /Rotations/i }).click();
    await expect(page.getByRole('tab', { name: /Rotations/i })).toHaveAttribute('aria-selected', 'true', { timeout: 5000 });

    // Interval input present (wiring check; accessibility semantics owned by Layer B)
    await expect(page.locator('[aria-label="Rotation interval in minutes"]')).toBeVisible();

    // Click "Create Game Plan" — smoke: wiring that the button is reachable
    const createPlanBtn = page.getByRole('button', { name: /Create Game Plan/i });
    await createPlanBtn.scrollIntoViewIfNeeded();
    await createPlanBtn.click();

    // Timeline strip appears after plan creation
    await expect(page.locator('.planner-timeline-strip')).toBeVisible({ timeout: 15000 });
  });

  test('Pre-game coaching notes CRUD workflow', async ({ page }) => {
    test.setTimeout(240000);

    await setupTestData(page);
    await openGamePlanner(page);

    // Create note → visible in list
    await page.getByRole('button', { name: 'Add coaching point' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.fill('#pre-game-note-text', 'Keep compact shape when out of possession');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByText('Keep compact shape when out of possession')).toBeVisible();

    // Delete → confirm → note gone (confirm wiring)
    await page.getByRole('button', { name: 'Delete coaching point' }).first().click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('No coaching points yet.')).toBeVisible();

    // Re-create note for cancel test
    await page.getByRole('button', { name: 'Add coaching point' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.fill('#pre-game-note-text', 'Keep compact shape when out of possession');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByText('Keep compact shape when out of possession')).toBeVisible();

    // Delete → cancel → note still visible (cancel wiring)
    await page.getByRole('button', { name: 'Delete coaching point' }).first().click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText('Keep compact shape when out of possession')).toBeVisible();
  });
});