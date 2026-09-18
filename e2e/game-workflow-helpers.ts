import { expect, Page } from '@playwright/test';
import {
  waitForPageLoad,
  fillInput,
  clickButton,
  clickManagementTab,
  UI_TIMING,
  parseTime,
} from './helpers';

/**
 * Shared game-day setup/interaction flow used by e2e/full-workflow.spec.ts and
 * reused by the field-conditions specs (e2e/offline-game-management.spec.ts,
 * e2e/concurrent-coaches.spec.ts, e2e/timer-gap-confirmation.spec.ts) instead
 * of duplicating this proven flow.
 *
 * Deliberately NOT a `*.spec.ts` file: it contains no `test()`/`test.describe()`
 * calls. Playwright loads a spec file's full module graph — including any
 * `test()` calls a transitively-imported module registers as a side effect —
 * so importing helpers from a real spec file would leak that file's own tests
 * into every project that imports these helpers, regardless of that project's
 * own `testMatch`/`testIgnore`. Keeping this module test-call-free is what
 * makes it safe to import from any project.
 */

// Test data
export const TEST_DATA = {
  formation: {
    name: '3-3-1',
    playerCount: '7',
    positions: [
      { name: 'Goalkeeper', abbreviation: 'GK', role: 'GOALKEEPER' as const },
      { name: 'Left Defender', abbreviation: 'LD', role: 'DEFENDER' as const },
      { name: 'Right Defender', abbreviation: 'RD', role: 'DEFENDER' as const },
      { name: 'Center Midfielder', abbreviation: 'CM', role: 'MIDFIELDER' as const },
      { name: 'Left Midfielder', abbreviation: 'LM', role: 'MIDFIELDER' as const },
      { name: 'Right Midfielder', abbreviation: 'RM', role: 'MIDFIELDER' as const },
      { name: 'Forward', abbreviation: 'FWD', role: 'FORWARD' as const },
    ],
  },
  team: {
    name: 'Thunder FC U10',
    halfLength: '20', // 20-minute halves = 40 min game
    maxPlayers: '7',
  },
  players: [
    // Starters (7 players)
    { number: '1', firstName: 'Alice', lastName: 'Anderson', position: 'GK' },
    { number: '2', firstName: 'Bob', lastName: 'Brown', position: 'LD' },
    { number: '3', firstName: 'Charlie', lastName: 'Clark', position: 'RD' },
    { number: '4', firstName: 'Diana', lastName: 'Davis', position: 'CM' },
    { number: '5', firstName: 'Ethan', lastName: 'Evans', position: 'LM' },
    { number: '6', firstName: 'Fiona', lastName: 'Fisher', position: 'RM' },
    { number: '7', firstName: 'George', lastName: 'Garcia', position: 'FWD' },
    // Bench (1 player for substitutions)
    { number: '8', firstName: 'Hannah', lastName: 'Harris', position: 'CM' },
  ],
  game1: {
    opponent: 'Lightning FC',
    date: '2025-11-30T14:00',
    isHome: true,
  },
  game2: {
    opponent: 'Thunder Strikers',
    date: '2025-12-07T15:00',
    isHome: false,
  },
  // Expected play time per game (40 min game with 10-min rotation interval)
  // Rotation at 10': Diana (#4) -> Hannah (#8)
  // Rotation at 30': Hannah (#8) -> Diana (#4)
  // Result: Diana plays 0-10 + 30-40 = 20 min, Hannah plays 10-30 = 20 min
  // Others play full 40 min
  expectedPlayTime: {
    perGame: {
      'Alice Anderson': 40,
      'Bob Brown': 40,
      'Charlie Clark': 40,
      'Diana Davis': 20,
      'Ethan Evans': 40,
      'Fiona Fisher': 40,
      'George Garcia': 40,
      'Hannah Harris': 20,
    },
  },
};

// Helper to create players globally
export async function createPlayers(page: Page) {
  console.log('Creating players...');

  // Navigate to Players tab in Management
  await clickManagementTab(page, 'Players');

  // Create each player
  for (const player of TEST_DATA.players) {
    await clickButton(page, '+ Add Player');
    await waitForPageLoad(page);

    await fillInput(page, 'input[placeholder*="First"]', player.firstName);
    await fillInput(page, 'input[placeholder*="Last"]', player.lastName);

    await clickButton(page, 'Add');
    await page.waitForTimeout(UI_TIMING.NAVIGATION);

    const playerCard = page
      .locator('.item-card')
      .filter({ hasText: `${player.firstName} ${player.lastName}` })
      .first();
    await expect(playerCard).toBeVisible({ timeout: 10000 });
  }

  console.log(`✓ Created ${TEST_DATA.players.length} players`);
}

// Helper to add players to team roster
export async function addPlayersToRoster(page: Page) {
  console.log('Adding players to team roster...');

  // Navigate to Teams tab
  const teamsTab = page.locator('button.management-tab', { hasText: /Teams/ });
  await teamsTab.click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);

  // Find and expand the team card
  const teamCard = page.locator('.team-card-wrapper').filter({ hasText: TEST_DATA.team.name }).first();
  await expect(teamCard).toBeVisible({ timeout: 10000 });

  const expandButton = teamCard.locator('button[aria-label*="roster"]').first();
  await expect(expandButton).toBeVisible({ timeout: 5000 });

  const expandButtonLabel = ((await expandButton.getAttribute('aria-label')) ?? '').trim();
  if (/show roster/i.test(expandButtonLabel)) {
    await expandButton.click();
  }

  const rosterSection = teamCard.locator('.team-roster-section').first();
  await expect(rosterSection).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(UI_TIMING.NAVIGATION);

  // Add each player to the roster
  for (const player of TEST_DATA.players) {
    await clickButton(page, '+ Add Player to Roster');
    await page.waitForTimeout(UI_TIMING.STANDARD);

    const rosterForm = rosterSection.locator('.create-form').first();
    await expect(rosterForm).toBeVisible({ timeout: 5000 });

    // Select player from dropdown
    const playerOption = `${player.firstName} ${player.lastName}`;
    await rosterForm.locator('select').first().selectOption({ label: playerOption });
    await page.waitForTimeout(UI_TIMING.QUICK);

    // Enter player number
    await rosterForm.locator('input[placeholder*="Player Number"]').fill(player.number);

    // Select preferred position if available
    const positionCheckbox = page.locator('.checkbox-label', { hasText: player.position });
    if (await positionCheckbox.isVisible({ timeout: 1000 }).catch(() => false)) {
      await positionCheckbox.locator('input[type="checkbox"]').check();
      await page.waitForTimeout(UI_TIMING.QUICK);
    }

    // Click the Add button in the form
    const addButton = rosterForm.locator('.form-actions button.btn-primary', { hasText: 'Add' }).first();
    await addButton.click();
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

    // Verify player was added to roster
    const rosterEntry = `#${player.number} ${player.firstName} ${player.lastName}`;
    await expect(page.getByText(rosterEntry)).toBeVisible();
  }

  console.log(`✓ Added ${TEST_DATA.players.length} players to team roster`);
}

// Helper to create and setup a game
export async function createGame(page: Page, gameData: { opponent: string; date: string; isHome: boolean }) {
  console.log(`Creating game vs ${gameData.opponent}...`);

  // Navigate to Home tab
  const homeTab = page.locator('a.nav-item', { hasText: 'Games' });
  await homeTab.click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);

  // Wait for the Schedule New Game button to be visible
  await page.waitForSelector('button:has-text("+ Schedule New Game")', { timeout: 5000 });

  // Open schedule form and wait until the newly-created team appears.
  let teamSelect = page.locator('.create-form select').first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const scheduleButton = page.getByRole('button', { name: '+ Schedule New Game', exact: true });
    if (await scheduleButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await scheduleButton.click();
      await page.waitForTimeout(UI_TIMING.STANDARD);
    }

    await waitForPageLoad(page);
    const scheduleForm = page
      .locator('.create-form')
      .filter({ has: page.getByRole('heading', { name: 'Schedule New Game' }) })
      .first();
    await expect(scheduleForm).toBeVisible({ timeout: 10000 });
    teamSelect = scheduleForm.locator('select').first();

    let hasTargetTeamOption = false;
    try {
      await expect
        .poll(async () => {
          const options = (await teamSelect.locator('option').allTextContents()).map((text) => text.trim());
          return options.includes(TEST_DATA.team.name);
        }, {
          timeout: 15000,
          message: `Expected schedule-game team option "${TEST_DATA.team.name}" to be hydrated`,
        })
        .toBe(true);
      hasTargetTeamOption = true;
    } catch {
      hasTargetTeamOption = false;
    }

    if (hasTargetTeamOption) {
      break;
    }

    const cancelButton = scheduleForm.getByRole('button', { name: 'Cancel' }).first();
    if (await cancelButton.isVisible({ timeout: 500 }).catch(() => false)) {
      await cancelButton.click();
      await page.waitForTimeout(UI_TIMING.STANDARD);
    }
  }

  await expect
    .poll(async () => {
      const options = (await teamSelect.locator('option').allTextContents()).map((text) => text.trim());
      return options.includes(TEST_DATA.team.name);
    }, {
      timeout: 5000,
      message: `Team option "${TEST_DATA.team.name}" must exist before scheduling game`,
    })
    .toBe(true);

  // Select team from dropdown
  await teamSelect.selectOption({ label: TEST_DATA.team.name });
  await page.waitForTimeout(UI_TIMING.STANDARD);

  // Fill game form
  await fillInput(page, 'input[placeholder*="Opponent"]', gameData.opponent);
  await fillInput(page, 'input[type="datetime-local"]', gameData.date);

  // Select home/away (it's a checkbox)
  const homeCheckbox = page.getByRole('checkbox', { name: /home game/i });
  if (gameData.isHome) {
    await homeCheckbox.check();
  } else {
    await homeCheckbox.uncheck();
  }

  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForTimeout(UI_TIMING.STANDARD);
  await waitForPageLoad(page);

  // Verify game was created
  await expect
    .poll(async () => {
      const card = page.locator('.game-card').filter({ hasText: gameData.opponent }).first();
      return await card.isVisible({ timeout: 1000 }).catch(() => false);
    }, {
      timeout: 30000,
      message: `Expected game card for opponent "${gameData.opponent}" after create`,
    })
    .toBe(true);
  console.log(`✓ Game created vs ${gameData.opponent}`);
}

// Helper to setup lineup for the game
export async function setupLineup(page: Page, opponent: string) {
  console.log(`Setting up lineup for game vs ${opponent}...`);

  // Navigate to Home tab if not already there
  const homeTab = page.locator('a.nav-item', { hasText: 'Games' });
  await homeTab.click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);

  // Open the game card to access inline planning in GameManagement
  const gameCard = page.locator('.game-card').filter({ hasText: opponent });
    const openButton = gameCard.locator('.open-game-button');
    await openButton.click();
  await waitForPageLoad(page);

    // Wait for game management to fully load
    await page.waitForSelector('.game-management', { timeout: 5000 });
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    console.log('✓ Game Management opened');

    // Wait for position slots to appear in the lineup grid (Plan tab in pre-game view).
    const firstHalfSlots = page.locator('.position-lineup-grid .position-slot');
    await expect(firstHalfSlots).toHaveCount(7, { timeout: 15000 });

  // In the Plan tab, use the dropdown selects to assign players to positions
  const positionSlots = firstHalfSlots;
  const slotCount = await positionSlots.count();
  console.log(`Found ${slotCount} position slots`);

  // Assign first 7 players to starting positions using dropdowns
  const startingPlayers = TEST_DATA.players.slice(0, 7);

  for (const player of startingPlayers.slice(0, slotCount)) {
    const removeButton = page.getByRole('button', {
      name: `Remove ${player.firstName} ${player.lastName} from ${player.position}`,
    });

    if (await removeButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      continue;
    }

    const select = page.getByRole('combobox', { name: `Player for ${player.position}` }).first();
    await expect(select).toBeVisible({ timeout: 10000 });

    const playerLabel = `#${player.number} ${player.firstName} ${player.lastName}`;
    let fallbackLabel: string | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const options = select.locator('option');
      const optionCount = await options.count();
      fallbackLabel = null;

      for (let optionIndex = 1; optionIndex < optionCount; optionIndex += 1) {
        const optionText = (await options.nth(optionIndex).textContent())?.trim() ?? '';
        if (optionText.includes(playerLabel)) {
          fallbackLabel = optionText;
          break;
        }
      }

      if (!fallbackLabel) {
        break;
      }

      await select.selectOption({ label: fallbackLabel });

      const assigned = await removeButton.isVisible({ timeout: 5000 }).catch(() => false);
      if (assigned) {
        console.log(`  ✓ ${player.firstName} ${player.lastName} assigned to ${player.position}`);
        break;
      }

      await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    }

    expect(fallbackLabel, `Expected option for ${player.firstName} ${player.lastName}`).toBeTruthy();
    await expect(removeButton).toBeVisible({ timeout: 10000 });
  }

  // Wait for assignments to be processed
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  await expect(page.locator('.position-lineup-grid button[aria-label^="Remove "]')).toHaveCount(7, { timeout: 10000 });

  console.log('✓ Lineup set up with 7 starters');
}

// Helper to create a game plan with rotation (assumes we're already in GameManagement from setupLineup)
export async function createGamePlan(page: Page, opponent: string) {
  console.log(`Game plan step for ${opponent}: rotation plan creation is handled inline in GameManagement.`);

  // After setupLineup, we are already on the GameManagement pre-game (scheduled) screen.
  // Inline rotation planning UI (formerly standalone GamePlanner) is embedded here.
  // Verify game management is visible and ready for Start Game.
  await expect(page.locator('.game-management')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('button', { hasText: 'Start Game' })).toBeVisible({ timeout: 5000 });

  console.log('✓ Game management pre-game screen ready for start');
}

// Helper to execute a planned rotation during the game
export async function executeRotation(page: Page, rotationMinute: number, playerOut: string, playerIn: string) {
  console.log(`Executing rotation at ${rotationMinute}': ${playerOut} → ${playerIn}...`);

  // Strategy 1: Use the "View Plan" button in the rotation countdown banner
  const viewPlanButton = page.locator('button.btn-view-rotation', { hasText: 'View Plan' });

  if (await viewPlanButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await viewPlanButton.click();
    await page.waitForTimeout(UI_TIMING.NAVIGATION);

    // Wait for rotation modal to appear
    await page.waitForSelector('.rotation-modal', { timeout: 5000 });

    // Find the planned sub item and click "+ Queue"
    const queueButton = page.locator('.planned-sub-item .btn-queue-sub:not(.queued)').first();
    if (await queueButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await queueButton.click();
      await page.waitForTimeout(UI_TIMING.STANDARD);
    }

    // Close the modal
    await clickButton(page, 'Close');
    await page.waitForTimeout(UI_TIMING.NAVIGATION);

    // Now execute the queued substitution using "Sub All Now"
    const subAllButton = page.locator('button.btn-sub-all', { hasText: /Sub All/ });
    if (await subAllButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await subAllButton.click();
      await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
      console.log(`✓ Executed rotation at ${rotationMinute}': ${playerOut} → ${playerIn}`);
      return true;
    }
  }

  // Strategy 2: Fallback - manually substitute via the ⇄ button on the player's position
  console.log(`  View Plan not available, using manual substitution fallback...`);

  // Find the position slot that has the player being subbed out
  const playerSlot = page.locator('.assigned-player-slot', { hasText: playerOut });
  if (await playerSlot.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Click the substitute (⇄) button on that player's position
    const subButton = playerSlot.locator('button.btn-substitute');
    if (await subButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await subButton.click();
      await page.waitForTimeout(UI_TIMING.NAVIGATION);

      // The substitution modal should appear - find the player to sub in and click "Sub Now"
      const subNowButton = page.locator('.sub-player-item', { hasText: playerIn })
        .locator('button.btn-sub-now');
      if (await subNowButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await subNowButton.click();
        await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
        console.log(`✓ Executed rotation at ${rotationMinute}': ${playerOut} → ${playerIn} (manual sub)`);
        return true;
      } else {
        // Close the modal if Sub Now wasn't found
        const closeBtn = page.locator('.modal-content button.btn-secondary', { hasText: 'Close' });
        await closeBtn.click().catch(() => {});
        await page.waitForTimeout(UI_TIMING.STANDARD);
      }
    }
  }

  console.log(`⚠️ Could not execute rotation at ${rotationMinute}'`);
  return false;
}

export async function getDisplayedGameSeconds(page: Page): Promise<number> {
  const timer = page.locator('.command-band__timer');
  await expect(timer).toBeVisible({ timeout: 5000 });
  const timerText = ((await timer.textContent()) ?? '').trim();
  return parseTime(timerText);
}

export async function addTestTimeAndWait(page: Page, minutes: 1 | 5): Promise<number> {
  const timerBefore = await getDisplayedGameSeconds(page);
  const fieldTestingControls = page.locator('#game-tab-panel-field .testing-controls').first();
  const addFiveBtn = fieldTestingControls.getByRole('button', { name: '+5 min' });
  const addOneBtn = fieldTestingControls.getByRole('button', { name: '+1 min' });
  const preferredBtn = minutes === 5 ? addFiveBtn : addOneBtn;

  const getStateHint = async (): Promise<string> => {
    const activeTabText = ((await page
      .locator('[role="tab"][aria-selected="true"]')
      .first()
      .textContent()
      .catch(() => null)) ?? 'unknown').trim();
    const currentStateText = ((await page
      .locator('.game-management')
      .first()
      .getAttribute('data-state')
      .catch(() => null)) ?? 'unknown').trim();
    const currentUrl = page.url();
    return `activeTab='${activeTabText}', gameState='${currentStateText}', url='${currentUrl}'`;
  };

  const tryStartGameRecovery = async (): Promise<void> => {
    const startGameButton = page.getByRole('button', { name: 'Start Game' }).first();
    const canStartGame = await startGameButton.isVisible({ timeout: 1000 }).catch(() => false);
    if (!canStartGame) {
      return;
    }

    await startGameButton.click({ force: true });
    await page.waitForTimeout(UI_TIMING.NAVIGATION);

    const availabilityHeading = page.getByRole('heading', { name: 'Player Availability Check' });
    if (await availabilityHeading.isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.getByRole('button', { name: 'Start Game' }).nth(1).click({ force: true });
      await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    }

    await page.getByRole('tab', { name: /^Field$/i }).first().click().catch(() => {});
    await page.waitForTimeout(UI_TIMING.QUICK);
  };

  // Ensure test-time controls are visible; if not, recover by returning to Field tab.
  const preferredVisible = await preferredBtn.isVisible({ timeout: 1500 }).catch(() => false);
  if (!preferredVisible) {
    await page.getByRole('tab', { name: /^Field$/i }).first().click().catch(() => {});
    await page.waitForTimeout(UI_TIMING.QUICK);
    await expect(fieldTestingControls).toBeVisible({ timeout: 5000 });
  }

  let actualMinutesAdded: 1 | 5 = minutes;

  if (minutes === 5) {
    const addFiveVisible = await addFiveBtn.isVisible({ timeout: 1500 }).catch(() => false);

    if (addFiveVisible) {
      await addFiveBtn.scrollIntoViewIfNeeded();
      await addFiveBtn.click({ force: true });
      actualMinutesAdded = 5;
    } else {
      const addOneVisible = await expect
        .poll(async () => addOneBtn.isVisible({ timeout: 250 }).catch(() => false), {
          timeout: 7000,
          intervals: [250, 500, 1000],
          message: 'Waiting for +1 min fallback control to become visible',
        })
        .toBeTruthy()
        .then(() => true)
        .catch(() => false);
      if (!addOneVisible) {
        await tryStartGameRecovery();
        const fallbackVisibleAfterRecovery = await addOneBtn.isVisible({ timeout: 1500 }).catch(() => false);
        if (fallbackVisibleAfterRecovery) {
          for (let i = 0; i < 5; i++) {
            await addOneBtn.scrollIntoViewIfNeeded();
            await addOneBtn.click({ force: true });
            await page.waitForTimeout(UI_TIMING.QUICK);
          }
          actualMinutesAdded = 5;
        } else {
          const stateHint = await getStateHint();
          throw new Error(
            `Cannot add test time: '+5 min' is not visible and '+1 min' fallback is unavailable (${stateHint}).`,
          );
        }
      } else {
        for (let i = 0; i < 5; i++) {
          await addOneBtn.scrollIntoViewIfNeeded();
          await addOneBtn.click({ force: true });
          await page.waitForTimeout(UI_TIMING.QUICK);
        }
        actualMinutesAdded = 5;
      }
    }
  } else {
    const addOneVisible = await expect
      .poll(async () => addOneBtn.isVisible({ timeout: 250 }).catch(() => false), {
        timeout: 7000,
        intervals: [250, 500, 1000],
        message: 'Waiting for +1 min control to become visible',
      })
      .toBeTruthy()
      .then(() => true)
      .catch(() => false);
    if (!addOneVisible) {
      await tryStartGameRecovery();
      const addOneVisibleAfterRecovery = await addOneBtn.isVisible({ timeout: 1500 }).catch(() => false);
      if (!addOneVisibleAfterRecovery) {
        const stateHint = await getStateHint();
        throw new Error(
          `Cannot add test time: '+1 min' button is unavailable (${stateHint}).`,
        );
      }
    }

    await addOneBtn.scrollIntoViewIfNeeded();
  await addOneBtn.click({ force: true });
    actualMinutesAdded = 1;
  }

  const minimumExpectedSeconds = timerBefore + actualMinutesAdded * 60 - 1;
  let clockAdvanced = false;

  try {
    await expect
      .poll(
        async () => getDisplayedGameSeconds(page),
        {
          timeout: 10000,
          message: `Expected game clock to advance by ${actualMinutesAdded} minute(s) from ${timerBefore} seconds`,
        },
      )
      .toBeGreaterThanOrEqual(minimumExpectedSeconds);
    clockAdvanced = true;
  } catch {
    clockAdvanced = false;
  }

  // CI can occasionally drop the first click while transitions settle.
  // Re-apply once before failing to keep time-based tests deterministic.
  if (!clockAdvanced) {
    await tryStartGameRecovery();
    if (actualMinutesAdded === 5) {
      const addFiveVisible = await addFiveBtn.isVisible({ timeout: 1500 }).catch(() => false);
      if (addFiveVisible) {
        await addFiveBtn.scrollIntoViewIfNeeded();
        await addFiveBtn.click({ force: true });
      } else {
        for (let i = 0; i < 5; i++) {
          await addOneBtn.scrollIntoViewIfNeeded();
          await addOneBtn.click({ force: true });
          await page.waitForTimeout(UI_TIMING.QUICK);
        }
      }
    } else {
      await addOneBtn.scrollIntoViewIfNeeded();
      await addOneBtn.click({ force: true });
    }

    await expect
      .poll(
        async () => getDisplayedGameSeconds(page),
        {
          timeout: 12000,
          message: `Expected game clock retry to advance by ${actualMinutesAdded} minute(s) from ${timerBefore} seconds`,
        },
      )
      .toBeGreaterThanOrEqual(minimumExpectedSeconds);
  }

  return getDisplayedGameSeconds(page);
}

export async function advanceGameClockTo(page: Page, targetMinute: number): Promise<void> {
  const targetSeconds = targetMinute * 60;

  while (true) {
    const currentSeconds = await getDisplayedGameSeconds(page);
    if (currentSeconds >= targetSeconds) {
      expect(currentSeconds).toBeLessThan(targetSeconds + 60);
      return;
    }

    const remainingSeconds = targetSeconds - currentSeconds;
    await addTestTimeAndWait(page, remainingSeconds >= 240 ? 5 : 1);
    await page.waitForTimeout(UI_TIMING.QUICK);
  }
}

export async function pauseGameClock(page: Page): Promise<void> {
  const pauseButton = page.locator('.command-band__btn-pause').first();
  if (await pauseButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await pauseButton.click();
    await page.waitForTimeout(UI_TIMING.QUICK);
  }
}

/** Parses a Reports-page play-time cell ("1h 20m" or "40m") into total minutes. */
export function parseDurationMinutes(value: string): number | null {
  const text = value.trim();
  const hourMinuteMatch = text.match(/^(\d+)h\s*(\d+)m$/i);
  if (hourMinuteMatch) {
    const hours = Number.parseInt(hourMinuteMatch[1], 10);
    const minutes = Number.parseInt(hourMinuteMatch[2], 10);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    return hours * 60 + minutes;
  }

  const minuteOnlyMatch = text.match(/^(\d+)m$/i);
  if (minuteOnlyMatch) {
    const minutes = Number.parseInt(minuteOnlyMatch[1], 10);
    return Number.isNaN(minutes) ? null : minutes;
  }

  return null;
}
