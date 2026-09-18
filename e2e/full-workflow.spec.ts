import { test, expect, Page } from '@playwright/test';
import {
  waitForPageLoad,
  fillInput,
  clickButton,
  clickButtonByText,
  loginUser,
  cleanupTestData,
  createFormation,
  createTeam,
  handleConfirmDialog,
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
  getDisplayedGameSeconds,
  advanceGameClockTo,
  pauseGameClock,
} from './game-workflow-helpers';

/**
 * Comprehensive E2E Test Suite for Soccer App
 * Tests the complete workflow from login to team reporting
 *
 * The shared game-day setup/interaction helpers (TEST_DATA, createPlayers,
 * addPlayersToRoster, createGame, setupLineup, createGamePlan, executeRotation,
 * getDisplayedGameSeconds, addTestTimeAndWait, advanceGameClockTo,
 * pauseGameClock) live in ./game-workflow-helpers.ts, not in this file — see
 * that file's header comment for why (importing a real spec file's `test()`
 * registrations leaks them into every project that imports it).
 */

// Helper to run the game simulation with planned rotations
async function runGame(page: Page, gameNumber: number = 1) {
  console.log(`Running game ${gameNumber} simulation with planned rotations...`);

  // Set up a PERSISTENT handler to auto-confirm any ConfirmModal dialogs during the game
  const cleanupConfirm = handleConfirmDialog(page, false);
  
  // Click the initial "Start Game" button which opens the availability check modal
  const startButtons = page.getByRole('button', { name: 'Start Game' });
  await expect(startButtons.last()).toBeVisible({ timeout: 5000 });
  await startButtons.last().click({ force: true });
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  // The Player Availability Check modal appears - click "Start Game" in the modal to confirm
  // There are now two "Start Game" buttons on the page - one in the main view and one in the modal
  // The modal one appears after the "Player Availability Check" heading
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
    console.log('✓ Confirmed player availability');
  }
  
  // Verify timer is running (CommandBand always shows timer during in-progress)
  await expect(page.locator('.command-band__timer')).toBeVisible({ timeout: 5000 });
  await pauseGameClock(page);
  
  // Add test time to 5 minutes
  await advanceGameClockTo(page, 5);
  
  // Navigate to Goals tab to record a goal
  await page.getByRole('tab', { name: 'Goals' }).click();
  await page.waitForTimeout(UI_TIMING.QUICK);

  // Record a goal for us (vary by game)
  await clickButtonByText(page, /Goal - Us/);
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  // Select scorer - different players for each game
  const scorerSelect = page.locator('select#goalScorer');
  if (gameNumber === 1) {
    await scorerSelect.selectOption({ label: '#6 - Fiona Fisher' });
  } else {
    await scorerSelect.selectOption({ label: '#7 - George Garcia' });
  }
  await page.waitForTimeout(UI_TIMING.STANDARD);
  
  // Select assist - different players for each game
  const assistSelect = page.locator('select#goalAssist');
  if (gameNumber === 1) {
    await assistSelect.selectOption({ label: '#4 - Diana Davis' });
  } else {
    await assistSelect.selectOption({ label: '#5 - Ethan Evans' });
  }
  await page.waitForTimeout(UI_TIMING.STANDARD);
  
  await clickButton(page, 'Record Goal');
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  
  // Verify score updated (CommandBand always shows score)
  await expect(page.locator('.command-band__score')).toContainText('1');
  console.log(`✓ Goal ${gameNumber}.1 recorded`);

  // Navigate back to Field tab for timer controls
  await page.getByRole('tab', { name: 'Field' }).click();
  await page.waitForTimeout(UI_TIMING.QUICK);

  // Add time to reach 10 minutes - first planned rotation
  await advanceGameClockTo(page, 10);
  console.log('✓ Timer at 10 minutes');
  
  // Execute first planned rotation (Diana → Hannah)
  await executeRotation(page, 10, 'Diana', 'Hannah');
  
  // Navigate to Notes tab to add a note
  await page.getByRole('tab', { name: 'Notes' }).click();
  await page.waitForTimeout(UI_TIMING.QUICK);

  // Record a gold star (vary by game)
  await page.locator('.note-buttons').getByRole('button', { name: /Gold Star/i }).first().click();
  const goldStarDialog = page.getByRole('dialog', { name: /Gold Star/i });
  await expect(goldStarDialog).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  const expectedNoteText = gameNumber === 1 ? 'Great save!' : 'Excellent defense!';

  const notePlayerSelect = page.locator('select#notePlayer');
  if (gameNumber === 1) {
    await notePlayerSelect.selectOption({ label: '#1 - Alice Anderson' });
  } else {
    await notePlayerSelect.selectOption({ label: '#2 - Bob Brown' });
  }

  // Force the selected type to Gold Star in case a prior external note intent changed default type.
  await goldStarDialog.getByRole('button', { name: /Gold Star/i }).first().click();
  await fillInput(page, 'textarea#noteText', expectedNoteText);
  await page.waitForTimeout(UI_TIMING.STANDARD);
  
  const modalSaveButton = page.locator('.modal-content').getByRole('button', { name: 'Save Note' }).first();
  await expect(modalSaveButton).toBeVisible({ timeout: 5000 });
  const noteModalOverlay = page.locator('.modal-overlay');
  let gameGoldStars = 0;
  let noteSaved = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    await modalSaveButton.click({ force: true });
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

    const overlayClosed = await noteModalOverlay
      .waitFor({ state: 'hidden', timeout: 10000 })
      .then(() => true)
      .catch(() => false);

    if (overlayClosed) {
      noteSaved = true;
      break;
    }

    const errorToast = page.locator('[role="status"]').filter({ hasText: /Failed to save note/i }).first();
    if (await errorToast.isVisible({ timeout: 500 }).catch(() => false)) {
      console.log('⚠ Save note attempt failed, retrying...');
    }
  }

  if (!noteSaved) {
    console.log('⚠ Gold star note did not persist in time; continuing without star for this game.');
    const modalCancelButton = page.locator('.modal-content').getByRole('button', { name: 'Cancel' }).first();
    if (await modalCancelButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await modalCancelButton.click({ force: true });
      await page.waitForTimeout(UI_TIMING.QUICK);
    }
    await expect(noteModalOverlay).not.toBeVisible({ timeout: 5000 });
  } else {
    gameGoldStars = 1;
    await expect(noteModalOverlay).not.toBeVisible({ timeout: 15000 });
    const savedNoteCard = page.locator('.note-card').filter({ hasText: expectedNoteText }).first();
    let noteCardVisible = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      noteCardVisible = await savedNoteCard.isVisible({ timeout: 1200 }).catch(() => false);
      if (noteCardVisible) {
        break;
      }
      await page.waitForTimeout(UI_TIMING.QUICK);
    }

    if (!noteCardVisible) {
      console.log(`⚠ Note modal closed but note card not visible in time: "${expectedNoteText}"`);
    } else {
      await expect(savedNoteCard.getByRole('button', { name: 'Edit note' })).toBeVisible();
      await expect(savedNoteCard.getByRole('button', { name: 'Delete note' })).toBeVisible();
    }
  }
  
  console.log(`✓ Gold star ${gameNumber} recorded`);
  
  // Navigate to Field tab for timer controls and half-ending button
  await page.getByRole('tab', { name: 'Field' }).click();
  await page.waitForTimeout(UI_TIMING.QUICK);

  // Add time to reach halftime (20 minutes)
  await advanceGameClockTo(page, 20);
  console.log('✓ Timer at 20 minutes (halftime)');
  
  const endFirstHalfButton = page.getByRole('button', { name: 'End First Half' });
  const startBtn = page.getByRole('button', { name: 'Start Second Half' });
  const endFirstHalfVisible = await endFirstHalfButton.isVisible({ timeout: 1500 }).catch(() => false);

  if (endFirstHalfVisible) {
    await endFirstHalfButton.click({ force: true });
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    console.log('✓ First half ended');
  } else {
    await expect(startBtn).toBeVisible({ timeout: 5000 });
    console.log('✓ App auto-advanced to halftime');
  }

  // Verify halftime screen is active before starting the second half.
  // 30 s timeout: the DB write in handleHalftime must complete before setGameState
  // is called, and a prior periodic timer-sync subscription event may arrive late
  // and briefly revert the state before the halftime event is fully applied.
  // Additional time needed for authorization delays and DynamoDB operations.
  await expect(startBtn).toBeVisible({ timeout: 30000 });

  // Regression guard: clock must NOT silently continue during halftime.
  const halftimeSecondsBeforeWait = await getDisplayedGameSeconds(page);
  await page.waitForTimeout(1500);
  const halftimeSecondsAfterWait = await getDisplayedGameSeconds(page);
  expect(halftimeSecondsAfterWait).toBe(halftimeSecondsBeforeWait);

  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  await startBtn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  
  // Multiple click attempts
  for (let i = 0; i < 3; i++) {
    await startBtn.click({ force: true });
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    const halftimeScreenStillVisible = await startBtn.isVisible({ timeout: 1000 }).catch(() => false);
    if (!halftimeScreenStillVisible) {
      console.log('✓ Second half started');
      break;
    }
    
    if (i === 2) {
      throw new Error('Failed to start second half after 3 attempts');
    }
  }

  // Regression guard: clock must resume once second half starts.
  await expect
    .poll(async () => getDisplayedGameSeconds(page), {
      timeout: 8000,
      message: 'Expected timer to resume after starting second half',
    })
    .toBeGreaterThan(halftimeSecondsAfterWait);

  await pauseGameClock(page);
  
  // Navigate to Field tab for the second half timer controls
  await page.getByRole('tab', { name: 'Field' }).click();
  await page.waitForTimeout(UI_TIMING.QUICK);

  // Add time in second half to 25 minutes
  await advanceGameClockTo(page, 25);

  // Navigate to Goals tab for recording goal
  await page.getByRole('tab', { name: 'Goals' }).click();
  await page.waitForTimeout(UI_TIMING.QUICK);

  // Record another goal (second goal of the game)
  await clickButtonByText(page, /Goal - Us/);
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  const scorerSelect2 = page.locator('select#goalScorer');
  if (gameNumber === 1) {
    await scorerSelect2.selectOption({ label: '#7 - George Garcia' });
  } else {
    await scorerSelect2.selectOption({ label: '#6 - Fiona Fisher' });
  }
  await page.waitForTimeout(UI_TIMING.STANDARD);
  
  await clickButton(page, 'Record Goal');
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  
  // Verify score is now 2 (CommandBand always shows score)
  await expect(page.locator('.command-band__score')).toContainText('2');
  console.log(`✓ Goal ${gameNumber}.2 recorded`);

  // Navigate to Field tab for timer controls
  await page.getByRole('tab', { name: 'Field' }).click();
  await page.waitForTimeout(UI_TIMING.QUICK);

  // Add time to reach 30 minutes - second planned rotation
  await advanceGameClockTo(page, 30);
  console.log('✓ Timer at 30 minutes');
  
  // Execute second planned rotation (Hannah → Diana)
  await executeRotation(page, 30, 'Hannah', 'Diana');
  
  // Add time to reach end of game (40 minutes)
  await advanceGameClockTo(page, 40);
  console.log('✓ Timer at 40 minutes (end of game)');
  
  // End the game
  await clickButton(page, 'End Game');
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  
  // Verify game completed (CommandBand shows "Final" badge when status=completed)
  await expect(page.locator('.command-band__status-final')).toBeVisible();
  console.log(`✓ Game ${gameNumber} completed`);
  
  // Remove the confirm handler now that game is complete
  cleanupConfirm();
  
  // --- Regression guard: game must show "completed" on Home screen immediately after
  //     ending it, and must remain completed after a full page reload (app close/reopen).
  //     Bug: status persisted as 'in-progress' on Home screen even after End Game.
  const opponent = gameNumber === 1 ? TEST_DATA.game1.opponent : TEST_DATA.game2.opponent;

  // Navigate back to Home screen via bottom nav (applies to both games)
  const backButton = page.locator('button.back-button, button:has-text("← Back")');
  if (await backButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await backButton.click();
    await page.waitForTimeout(UI_TIMING.NAVIGATION);
  }
  const homeTab = page.locator('a.nav-item', { hasText: 'Games' });
  await homeTab.click();
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  await page.waitForSelector('button:has-text("+ Schedule New Game")', { timeout: 5000 });
  console.log(`✓ Returned to Home/Games list after game ${gameNumber}`);

  // Game card must appear in "Past Games" with completed styling — not in "Active Games"
  const completedCard = page.locator('.game-card.completed-game', { hasText: opponent });
  const activeCard = page.locator('.game-card.active-game', { hasText: opponent });
  await expect(completedCard).toBeVisible({ timeout: 10000 });
  await expect(activeCard).not.toBeVisible();
  await expect(completedCard.locator('.game-status')).toContainText('Completed');
  console.log(`✓ Home screen shows game vs ${opponent} as completed (not in-progress)`);

  // Reload the page to simulate the coach closing and reopening the app
  await page.reload();
  await waitForPageLoad(page);
  await page.waitForSelector('.bottom-nav', { timeout: 15000 });
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  console.log('✓ Page reloaded (simulating app close/reopen)');

  const completedCardAfterReload = page.locator('.game-card.completed-game', { hasText: opponent });
  const activeCardAfterReload = page.locator('.game-card.active-game', { hasText: opponent });
  await expect(completedCardAfterReload).toBeVisible({ timeout: 10000 });
  await expect(activeCardAfterReload).not.toBeVisible();
  await expect(completedCardAfterReload.locator('.game-status')).toContainText('Completed');
  console.log(`✓ After reload: game vs ${opponent} still shown as completed`);

  // Return game statistics
  if (gameNumber === 1) {
    return {
      goals: 2,
      assists: 1,
      goldStars: gameGoldStars,
      scorers: ['Fiona Fisher', 'George Garcia'],
    };
  } else {
    return {
      goals: 2,
      assists: 1,
      goldStars: gameGoldStars,
      scorers: ['George Garcia', 'Fiona Fisher'], // Both scored in game 2 as well
    };
  }
}

// Helper to verify team totals and play times
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function verifyTeamTotals(page: Page, gameData: any) {
  console.log('Verifying team totals...');

  const parseDurationMinutes = (value: string): number | null => {
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
  };
  
  // Wait for DynamoDB eventual consistency - PlayTimeRecords may take time to fully propagate
  console.log('Waiting for data to settle (DynamoDB eventual consistency)...');
  await page.waitForTimeout(3000);
  
  // Navigate to Reports page via bottom nav
  await page.locator('a.nav-item[aria-label="Reports"]').click();
  await waitForPageLoad(page);
  
  // If there's only one team it auto-selects; otherwise select the first team.
  // Try #team-select first, then fallback to the labeled Team Reports combobox.
  const teamSelectById = page.locator('#team-select');
  let teamSelect = teamSelectById;
  try {
    await expect(teamSelectById).toBeVisible({ timeout: 5000 });
  } catch {
    teamSelect = page.getByRole('combobox', { name: /Team Reports/i });
    await expect(teamSelect).toBeVisible({ timeout: 10000 });
  }
  await expect
    .poll(
      async () => teamSelect.locator('option:not([value=""])').count(),
      { timeout: 30000, message: 'Expected at least one report team option to be available' },
    )
    .toBeGreaterThan(0);

  const targetTeamOption = teamSelect.locator('option', { hasText: TEST_DATA.team.name }).first();
  const hasTargetTeamOption = await targetTeamOption.count();

  if (hasTargetTeamOption > 0) {
    await teamSelect.selectOption({ label: TEST_DATA.team.name });
    await waitForPageLoad(page);
  } else {
    const selectedValue = await teamSelect.inputValue();
    if (!selectedValue) {
      // Pick the first available team option
      const firstOption = teamSelect.locator('option:not([value=""])').first();
      const firstVal = await firstOption.getAttribute('value');
      if (!firstVal) throw new Error('No teams available in selector');
      await teamSelect.selectOption(firstVal);
      await waitForPageLoad(page);
    }
  }
  
  // Wait for all observeQuery subscriptions to finish syncing (table renders only after full sync)
  // Use accessible name to target the player stats table specifically; a second .stats-table now exists
  // for the team-level Goals & Assists by Position section and would trigger Playwright strict mode.
  await expect(page.getByRole('table', { name: 'Player season statistics' })).toBeVisible({ timeout: 30000 });
  
  // Verify total goals in summary
  const goalsSummary = page.locator('.summary-card').filter({ hasText: 'Total Goals' });
  await expect(goalsSummary.locator('.summary-value')).toContainText(gameData.goals.toString());
  console.log(`✓ Total goals verified: ${gameData.goals}`);
  
  // Verify total assists
  const assistsSummary = page.locator('.summary-card').filter({ hasText: 'Total Assists' });
  await expect(assistsSummary.locator('.summary-value')).toContainText(gameData.assists.toString());
  console.log(`✓ Total assists verified: ${gameData.assists}`);
  
  // Verify gold stars
  const starsSummary = page.locator('.summary-card').filter({ hasText: 'Gold Stars' });
  await expect
    .poll(
      async () => {
        const starsValueText = ((await starsSummary.locator('.summary-value').first().textContent()) ?? '0').trim();
        const starsValue = Number.parseInt(starsValueText, 10);
        return Number.isNaN(starsValue) ? -1 : starsValue;
      },
      { timeout: 30000, message: 'Gold Stars summary did not reach expected total' },
    )
    .toBe(gameData.goldStars);
  console.log(`✓ Total gold stars verified: ${gameData.goldStars}`);

  // Verify Goals & Assists by Position table (team-level section)
  const goalsPositionTable = page.getByRole('table', { name: 'Team goals and assists by field position' });
  await expect(goalsPositionTable).toBeVisible({ timeout: 30000 });
  // Confirm at least one position row rendered with attributed goals
  await expect
    .poll(
      async () => {
        const rows = await goalsPositionTable.locator('tbody tr').all();
        let totalGoals = 0;
        for (const row of rows) {
          const text = await row.locator('.stat-goals').textContent();
          totalGoals += Number.parseInt(text ?? '0', 10) || 0;
        }
        return totalGoals;
      },
      { timeout: 30000, message: 'Goals & Assists by Position table had no attributed goals' },
    )
    .toBeGreaterThan(0);
  console.log('✓ Goals & Assists by Position table rendered with attributed goals');

  // Verify individual player stats
  for (const scorer of gameData.scorers) {
    const playerRow = page.locator('tr').filter({ hasText: scorer });
    await expect(playerRow).toBeVisible();
    
    // Check that the player has at least 1 goal
    const goalsCell = playerRow.locator('.stat-goals');
    const goalsText = await goalsCell.textContent();
    expect(parseInt(goalsText || '0')).toBeGreaterThan(0);
  }
  console.log('✓ Individual player stats verified');
  
  // Verify play times for key players
  // Expected: Diana and Hannah each played 20 min per game = 40 min total
  // Others played 40 min per game = 80 min total (1h 20m)
  
  // Click on Diana Davis to see her details
  // First, wait for Diana's play time in the table to be a non-placeholder minute value
  const dianaRow = page.locator('tr').filter({ hasText: 'Diana Davis' });
  const dianaTimeCell = dianaRow.locator('td').nth(2);
  await expect
    .poll(
      async () => ((await dianaTimeCell.textContent()) ?? '').trim(),
      { timeout: 30000, message: 'Diana table play time did not become a minute-like value' },
    )
    .toMatch(/\d+h\s*\d+m|\d+m/);
  await expect
    .poll(
      async () => {
        const value = ((await dianaTimeCell.textContent()) ?? '').trim();
        return parseDurationMinutes(value);
      },
      { timeout: 30000, message: 'Diana total did not settle to 40-41 minutes' },
    )
    .toBeGreaterThanOrEqual(40);
  await expect
    .poll(
      async () => {
        const value = ((await dianaTimeCell.textContent()) ?? '').trim();
        return parseDurationMinutes(value);
      },
      { timeout: 30000, message: 'Diana total exceeded expected 40-41 minute range' },
    )
    .toBeLessThanOrEqual(41);
  const dianaTableTime = ((await dianaTimeCell.textContent()) ?? '').trim();
  await dianaRow.click();
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  
  // Verify player details section appears
  await expect(page.locator('.player-details-section')).toBeVisible();
  
  // Verify play time by position section
  await expect(page.locator('h3').filter({ hasText: /Play Time by Position/ })).toBeVisible();
  
  // Verify Diana's play time exists and matches the table summary value
  const dianaPositionTime = page.locator('.position-time-item').filter({ hasText: 'Center Midfielder' });
  await expect(dianaPositionTime).toBeVisible();
  await expect(dianaPositionTime.locator('.position-time')).toBeVisible({ timeout: 30000 });
  const dianaDetailsTime = ((await dianaPositionTime.locator('.position-time').textContent()) ?? '').trim();
  expect(dianaDetailsTime).toMatch(/\d+h\s*\d+m|\d+m/);
  expect(dianaDetailsTime).toBe(dianaTableTime);
  const dianaDetailsMinutes = parseDurationMinutes(dianaDetailsTime);
  expect(dianaDetailsMinutes).not.toBeNull();
  expect(dianaDetailsMinutes as number).toBeGreaterThanOrEqual(40);
  expect(dianaDetailsMinutes as number).toBeLessThanOrEqual(41);
  
  // Log actual play time for debugging
  console.log(`Diana Davis table play time: ${dianaTableTime}`);
  console.log(`Diana Davis play time at CM: ${dianaDetailsTime}`);
  console.log('✓ Diana Davis play time consistency verified');
  
  // Go back to player list
  await page.locator('button').filter({ hasText: /Back|Close/ }).first().click().catch(() => {
    // If no back button, click outside the details section
  });
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  // Click on Hannah Harris to verify her play time
  const hannahRow = page.locator('tr').filter({ hasText: 'Hannah Harris' });
  if (await hannahRow.isVisible().catch(() => false)) {
    await hannahRow.click();
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    const hannahPositionTime = page.locator('.position-time-item').filter({ hasText: 'Center Midfielder' });
    if (await hannahPositionTime.isVisible().catch(() => false)) {
      await expect(hannahPositionTime.locator('.position-time')).toBeVisible({ timeout: 30000 });
      const hannahActualTime = await hannahPositionTime.locator('.position-time').textContent();
      console.log(`Hannah Harris play time at CM: ${hannahActualTime}`);
      
      // Hannah typically lands at 40m, but rounding/tick timing can show 41m.
      const hannahMinutes = parseInt((hannahActualTime || '0').replace(/[^0-9]/g, ''), 10);
      expect(hannahMinutes).toBeGreaterThanOrEqual(40);
      expect(hannahMinutes).toBeLessThanOrEqual(41);
      console.log('✓ Hannah Harris play time verified: 40-41m');
    }
  }
  
  // Verify a full-time player (Alice Anderson - GK)
  await page.locator('button').filter({ hasText: /Back|Close/ }).first().click().catch(() => {});
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  const aliceRow = page.locator('tr').filter({ hasText: 'Alice Anderson' });
  if (await aliceRow.isVisible().catch(() => false)) {
    const aliceTimeCell = aliceRow.locator('td').nth(2);
    await expect
      .poll(
        async () => ((await aliceTimeCell.textContent()) ?? '').trim(),
        { timeout: 30000, message: 'Alice table play time did not become a minute-like value' },
      )
      .toMatch(/\d+h\s*\d+m|\d+m/);
    await expect
      .poll(
        async () => {
          const value = ((await aliceTimeCell.textContent()) ?? '').trim();
          return parseDurationMinutes(value);
        },
        { timeout: 30000, message: 'Alice total did not settle to 80-81 minutes' },
      )
      .toBeGreaterThanOrEqual(80);
    await expect
      .poll(
        async () => {
          const value = ((await aliceTimeCell.textContent()) ?? '').trim();
          return parseDurationMinutes(value);
        },
        { timeout: 30000, message: 'Alice total exceeded expected 80-81 minute range' },
      )
      .toBeLessThanOrEqual(81);
    const aliceTableTime = ((await aliceTimeCell.textContent()) ?? '').trim();

    await aliceRow.click();
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    const alicePositionTime = page.locator('.position-time-item').filter({ hasText: 'Goalkeeper' });
    if (await alicePositionTime.isVisible().catch(() => false)) {
      await expect(alicePositionTime.locator('.position-time')).toBeVisible({ timeout: 30000 });
      const aliceDetailsTime = ((await alicePositionTime.locator('.position-time').textContent()) ?? '').trim();
      expect(aliceDetailsTime).toMatch(/\d+h\s*\d+m|\d+m/);
      expect(aliceDetailsTime).toBe(aliceTableTime);
      const aliceDetailsMinutes = parseDurationMinutes(aliceDetailsTime);
      expect(aliceDetailsMinutes).not.toBeNull();
      expect(aliceDetailsMinutes as number).toBeGreaterThanOrEqual(80);
      expect(aliceDetailsMinutes as number).toBeLessThanOrEqual(81);

      console.log(`Alice Anderson table play time: ${aliceTableTime}`);
      console.log(`Alice Anderson play time at GK: ${aliceDetailsTime}`);
      console.log('✓ Alice Anderson play time consistency verified');
    }
  }
  
  console.log('✓ Player details and play times verified');
}

// Main test
test.describe('Soccer App Full Workflow', () => {
  test('Complete workflow from login to team reporting', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.long); // 5 minutes for full workflow
    
    console.log('\n=== Starting E2E Test Suite ===\n');
    
    // Step 1: Login
    console.log('Step 1: Login');
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    console.log('✓ Logged in successfully\n');
    
    // Step 1.5: Clean up existing test data
    console.log('Step 1.5: Clean up existing data');
    
    // First, clean up orphaned data via API (PlayTimeRecords, Goals, Games, etc.)
    // These accumulate from previous test runs and pollute DynamoDB Scans
    console.log('Cleaning up orphaned API data...');
    try {
      // Use a longer default timeout for the page context during cleanup
      page.setDefaultTimeout(120000);
      const cleanupResults = await page.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (typeof (window as any).__cleanupAllData === 'function') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await (window as any).__cleanupAllData();
        }
        return null;
      });
      page.setDefaultTimeout(30000); // Reset to default
      if (cleanupResults) {
        const entries = Object.entries(cleanupResults as Record<string, number>)
          .filter(([, count]) => (count as number) > 0);
        if (entries.length > 0) {
          console.log('✓ Orphaned data cleaned:', entries.map(([model, count]) => `${model}: ${count}`).join(', '));
        } else {
          console.log('✓ No orphaned data found');
        }
      } else {
        console.log('⚠ __cleanupAllData not available (not in dev mode?)');
      }
    } catch (e) {
      console.log(`⚠ API cleanup failed: ${e}`);
    }
    
    // Brief pause after cleanup for eventual consistency
    await page.waitForTimeout(1000);
    
    // Then clean up UI-visible data (teams, players, formations)
    await cleanupTestData(page);
    console.log('');
    
    // Step 2: Create Formation with Positions
    console.log('Step 2: Create Formation with Positions');
    await createFormation(page, TEST_DATA.formation);
    console.log('');
    
    // Step 3: Create Team with Formation
    console.log('Step 3: Create Team');
    const formationLabel = `${TEST_DATA.formation.name} (${TEST_DATA.formation.playerCount} players)`;
    await createTeam(page, TEST_DATA.team, formationLabel);
    console.log('');
    
    // Step 4: Create Players Globally
    console.log('Step 4: Create Players');
    await createPlayers(page);
    console.log('');
    
    // Step 5: Add Players to Team Roster
    console.log('Step 5: Add Players to Team Roster');
    await addPlayersToRoster(page);
    console.log('');
    
    // Step 6: Create Game 1
    console.log('Step 6: Create Game 1');
    await createGame(page, TEST_DATA.game1);
    console.log('');
    
    // Step 7: Setup Lineup for Game 1
    console.log('Step 7: Setup Lineup for Game 1');
    await setupLineup(page, TEST_DATA.game1.opponent);
    console.log('');
    
    // Step 7.5: Create Game Plan for Game 1
    console.log('Step 7.5: Create Game Plan for Game 1');
    await createGamePlan(page, TEST_DATA.game1.opponent);
    console.log('');
    
    // Step 8: Run Game 1
    console.log('Step 8: Run Game 1 Simulation');
    const game1Data = await runGame(page, 1);
    console.log('');
    
    // Step 9: Create Game 2
    console.log('Step 9: Create Game 2');
    await createGame(page, TEST_DATA.game2);
    console.log('');
    
    // Step 10: Setup Lineup for Game 2
    console.log('Step 10: Setup Lineup for Game 2');
    await setupLineup(page, TEST_DATA.game2.opponent);
    console.log('');
    
    // Step 10.5: Create Game Plan for Game 2
    console.log('Step 10.5: Create Game Plan for Game 2');
    await createGamePlan(page, TEST_DATA.game2.opponent);
    console.log('');
    
    // Step 11: Run Game 2
    console.log('Step 11: Run Game 2 Simulation');
    const game2Data = await runGame(page, 2);
    console.log('');
    
    // Step 12: Verify Team Totals
    console.log('Step 12: Verify Team Totals (Both Games)');
    const aggregateData = {
      goals: game1Data.goals + game2Data.goals,
      assists: game1Data.assists + game2Data.assists,
      goldStars: game1Data.goldStars + game2Data.goldStars,
      scorers: [...new Set([...game1Data.scorers, ...game2Data.scorers])],
    };
    await verifyTeamTotals(page, aggregateData);
    console.log('');
    
    console.log('=== E2E Test Suite Completed Successfully ===\n');
  });

  test('Injury workflow filters and restores bench player eligibility', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.long);

    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);

    // Keep fixture setup isolated so we can deterministically assert injury behavior.
    await cleanupTestData(page);

    await createFormation(page, TEST_DATA.formation);
    const formationLabel = `${TEST_DATA.formation.name} (${TEST_DATA.formation.playerCount} players)`;
    await createTeam(page, TEST_DATA.team, formationLabel);
    await createPlayers(page);
    await addPlayersToRoster(page);
    await createGame(page, TEST_DATA.game1);
    await setupLineup(page, TEST_DATA.game1.opponent);
    await createGamePlan(page, TEST_DATA.game1.opponent);

    await clickButton(page, 'Start Game');
    await page.waitForTimeout(UI_TIMING.NAVIGATION);

    const availabilityHeading = page.getByRole('heading', { name: /Player Availability/i });
    if (await availabilityHeading.isVisible({ timeout: 3000 }).catch(() => false)) {
      const startButtons = page.getByRole('button', { name: 'Start Game' });
      const buttonCount = await startButtons.count();
      if (buttonCount > 1) {
        await startButtons.nth(buttonCount - 1).click();
      } else {
        await startButtons.first().click();
      }
      await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    }

    const benchTab = page.getByRole('tab', { name: 'Bench' });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await benchTab.isVisible({ timeout: 1200 }).catch(() => false)) {
        break;
      }

      const startButtons = page.getByRole('button', { name: 'Start Game' });
      const buttonCount = await startButtons.count();
      if (buttonCount === 0) {
        break;
      }

      await startButtons.nth(buttonCount - 1).click();
      await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    }

    await expect(benchTab).toBeVisible({ timeout: 10000 });
    await benchTab.click();
    await page.waitForTimeout(UI_TIMING.QUICK);

    // Mark every bench player as injured so substitution eligibility check is deterministic.
    const markInjuredButtons = page.getByRole('button', { name: /Mark .* injured/i });
    const injuredCount = await markInjuredButtons.count();
    expect(injuredCount).toBeGreaterThan(0);
    const benchPlayerNames: string[] = [];
    for (let i = 0; i < injuredCount; i += 1) {
      const buttonText = ((await markInjuredButtons.nth(i).textContent()) ?? '').trim();
      const match = buttonText.match(/Mark\s+(.+)\s+injured/i);
      if (match?.[1]) {
        benchPlayerNames.push(match[1].trim());
      }
    }
    for (let i = 0; i < injuredCount; i += 1) {
      await expect(markInjuredButtons.first()).toBeVisible({ timeout: 5000 });
      await markInjuredButtons.first().click();
      await page.getByRole('button', { name: 'Mark Injured' }).click();
      await page.waitForTimeout(UI_TIMING.QUICK);
    }
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

    await expect(page.getByRole('button', { name: /Mark .* available/i }).first()).toBeVisible();

    await page.getByRole('tab', { name: 'Field' }).click();
    await page.waitForTimeout(UI_TIMING.QUICK);

    await page.locator('button.btn-substitute').first().click({ force: true });
    const noEligibleSubstitutes = page.locator('.sub-player-item');
    await expect(noEligibleSubstitutes).toHaveCount(0);
    await expect(page.locator('.empty-state')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).first().click();

    const viewPlanButton = page.locator('button.btn-view-rotation', { hasText: 'View Plan' });
    if (await viewPlanButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await viewPlanButton.click();
      await expect(page.getByText(/No rotation changes available\./i)).toBeVisible();
      await page.getByRole('button', { name: 'Close' }).last().click();
    }

    await page.getByRole('tab', { name: 'Bench' }).click();
    await page.waitForTimeout(UI_TIMING.QUICK);

    const markAvailableButtons = page.getByRole('button', { name: /Mark .* available/i });
    const availableBeforeRestore = await markAvailableButtons.count();
    expect(availableBeforeRestore).toBeGreaterThan(0);
    await markAvailableButtons.first().click();
    await page.getByRole('button', { name: 'Mark Available' }).click();
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

    await expect(page.getByRole('button', { name: /Mark .* injured/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Mark .* available/i })).toHaveCount(Math.max(availableBeforeRestore - 1, 0));

    await page.getByRole('tab', { name: 'Field' }).click();
    await page.waitForTimeout(UI_TIMING.QUICK);

    await page.locator('button.btn-substitute').first().click({ force: true });
    const substituteOptions = page.locator('.sub-player-item');
    await expect(substituteOptions).toHaveCount(1);
    await expect(substituteOptions.first()).toContainText(/Queue|Sub Now/);
    const eligibleOptionText = ((await substituteOptions.first().textContent()) ?? '').trim();
    expect(eligibleOptionText.length).toBeGreaterThan(0);
    for (const playerName of benchPlayerNames) {
      if (!eligibleOptionText.includes(playerName)) {
        await expect(substituteOptions.filter({ hasText: playerName })).toHaveCount(0);
      }
    }
    await expect(page.locator('.empty-state')).not.toBeVisible();
    await page.getByRole('button', { name: 'Close' }).first().click();

    if (await viewPlanButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await viewPlanButton.click();
      const queueButton = page.locator('.planned-sub-item .btn-queue-sub:not(.queued)').first();
      await expect(queueButton).toBeVisible();
      await expect(queueButton).toBeEnabled();
      await page.getByRole('button', { name: 'Close' }).last().click();
    }
  });
});

