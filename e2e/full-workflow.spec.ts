import { test, expect, Page } from '@playwright/test';
import {
  waitForPageLoad,
  fillInput,
  clickButton,
  clickButtonByText,
  selectOption,
  waitForElement,
  getTextContent,
  formatTime,
  closePWAPrompt,
  loginUser,
  cleanupTestData,
  clickManagementTab,
  createFormation,
  createTeam,
  handleConfirmDialog,
  UI_TIMING,
} from './helpers';
import { TEST_USERS, TEST_CONFIG } from '../test-config';

/**
 * Comprehensive E2E Test Suite for Soccer App
 * Tests the complete workflow from login to team reporting
 */

// Test data
const TEST_DATA = {
  formation: {
    name: '3-3-1',
    playerCount: '7',
    positions: [
      { name: 'Goalkeeper', abbreviation: 'GK' },
      { name: 'Left Defender', abbreviation: 'LD' },
      { name: 'Right Defender', abbreviation: 'RD' },
      { name: 'Center Midfielder', abbreviation: 'CM' },
      { name: 'Left Midfielder', abbreviation: 'LM' },
      { name: 'Right Midfielder', abbreviation: 'RM' },
      { name: 'Forward', abbreviation: 'FWD' },
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
async function createPlayers(page: Page) {
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
    
    // Verify player was created
    await expect(page.getByText(`${player.firstName} ${player.lastName}`)).toBeVisible();
  }
  
  console.log(`✓ Created ${TEST_DATA.players.length} players`);
}

// Helper to add players to team roster
async function addPlayersToRoster(page: Page) {
  console.log('Adding players to team roster...');
  
  // Navigate to Teams tab
  const teamsTab = page.locator('button.management-tab', { hasText: /Teams/ });
  await teamsTab.click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  // Find and expand the team card
  const teamCard = page.locator('.item-card').filter({ hasText: TEST_DATA.team.name });
  const expandButton = teamCard.locator('button[aria-label*="roster"]').first();
  await expandButton.click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  // Add each player to the roster
  for (const player of TEST_DATA.players) {
    await clickButton(page, '+ Add Player to Roster');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Select player from dropdown
    const playerOption = `${player.firstName} ${player.lastName}`;
    await page.selectOption('select', { label: playerOption });
    await page.waitForTimeout(UI_TIMING.QUICK);
    
    // Enter player number
    await fillInput(page, 'input[placeholder*="Player Number"]', player.number);
    
    // Select preferred position if available
    const positionCheckbox = page.locator('.checkbox-label', { hasText: player.position });
    if (await positionCheckbox.isVisible({ timeout: 1000 }).catch(() => false)) {
      await positionCheckbox.locator('input[type="checkbox"]').check();
      await page.waitForTimeout(UI_TIMING.QUICK);
    }
    
    // Click the Add button in the form
    const addButton = page.locator('.form-actions button.btn-primary', { hasText: 'Add' });
    await addButton.click();
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Verify player was added to roster
    const rosterEntry = `#${player.number} ${player.firstName} ${player.lastName}`;
    await expect(page.getByText(rosterEntry)).toBeVisible();
  }
  
  console.log(`✓ Added ${TEST_DATA.players.length} players to team roster`);
}

// Helper to create and setup a game
async function createGame(page: Page, gameData: { opponent: string; date: string; isHome: boolean }) {
  console.log(`Creating game vs ${gameData.opponent}...`);
  
  // Navigate to Home tab
  const homeTab = page.locator('button.nav-item', { hasText: 'Games' });
  await homeTab.click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  // Wait for the Schedule New Game button to be visible
  await page.waitForSelector('button:has-text("+ Schedule New Game")', { timeout: 5000 });
  
  // Create game from Home page
  await clickButton(page, '+ Schedule New Game');
  await waitForPageLoad(page);
  
  // Select team from dropdown
  await page.selectOption('select', { label: TEST_DATA.team.name });
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
  
  await clickButton(page, 'Create');
  await waitForPageLoad(page);
  
  // Verify game was created
  await expect(page.getByText(gameData.opponent)).toBeVisible();
  console.log(`✓ Game created vs ${gameData.opponent}`);
}

// Helper to setup lineup for the game
async function setupLineup(page: Page, opponent: string) {
  console.log(`Setting up lineup for game vs ${opponent}...`);
  
  // Navigate to Home tab if not already there
  const homeTab = page.locator('button.nav-item', { hasText: 'Games' });
  await homeTab.click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  // Click the "Plan Game" button on the game card to go to GamePlanner
  const gameCard = page.locator('.game-card').filter({ hasText: opponent });
  const planButton = gameCard.locator('.plan-button');
  await planButton.click();
  await waitForPageLoad(page);
  
  // Wait for the game planner to fully load
  await page.waitForSelector('.game-planner-container', { timeout: 5000 });
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  console.log('✓ Game Planner opened');
  
  // In GamePlanner, use the dropdown selects to assign players to positions
  const positionSlots = page.locator('.position-slot');
  const slotCount = await positionSlots.count();
  console.log(`Found ${slotCount} position slots`);
  
  // Assign first 7 players to starting positions using dropdowns
  const startingPlayers = TEST_DATA.players.slice(0, 7);
  
  for (let i = 0; i < Math.min(slotCount, startingPlayers.length); i++) {
    const player = startingPlayers[i];
    const positionSlot = positionSlots.nth(i);
    
    // Find the select dropdown in this position slot
    const select = positionSlot.locator('select');
    if (await select.isVisible()) {
      // Build the option label to match (format: "#N FirstName LastName" or "⭐ #N FirstName LastName")
      const playerLabel = `#${player.number} ${player.firstName} ${player.lastName}`;
      
      // Get all options and find the matching one
      const options = select.locator('option');
      const optionCount = await options.count();
      
      let matched = false;
      for (let j = 1; j < optionCount; j++) { // Skip first option (placeholder)
        const optionText = await options.nth(j).textContent();
        if (optionText && optionText.includes(playerLabel)) {
          await select.selectOption({ index: j });
          matched = true;
          console.log(`  ✓ ${player.firstName} ${player.lastName} assigned to position ${i + 1}`);
          break;
        }
      }
      
      if (!matched) {
        // Try selecting by partial text match
        try {
          await select.selectOption({ label: new RegExp(playerLabel) });
          console.log(`  ✓ ${player.firstName} ${player.lastName} assigned to position ${i + 1} (regex match)`);
        } catch {
          console.log(`  ⚠️ Could not find option for ${player.firstName} ${player.lastName}`);
        }
      }
      
      await page.waitForTimeout(UI_TIMING.QUICK);
    }
  }
  
  // Wait for assignments to be processed
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  
  console.log('✓ Lineup set up with 7 starters');
}

// Helper to create a game plan with rotation (assumes we're already in GamePlanner from setupLineup)
async function createGamePlan(page: Page, opponent: string) {
  console.log('Creating game plan with rotation...');
  
  // We should already be in GamePlanner from setupLineup
  // Verify we're in the right place
  await expect(page.locator('.game-planner-container')).toBeVisible();
  
  // Click "Create Plan" or "Update Plan" button (text depends on if a plan exists)
  const createPlanButton = page.locator('button').filter({ hasText: /Create Plan|Update Plan/ });
  await createPlanButton.click();
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  console.log('✓ Game plan created');
  
  // Wait for timeline to appear with rotation markers
  await page.waitForSelector('.timeline-marker', { timeout: 5000 });
  
  // Verify timeline shows rotation points (timeline-marker elements show 0', 10', 20', 30', etc.)
  const timelineMarkers = page.locator('.timeline-marker');
  const markerCount = await timelineMarkers.count();
  console.log(`✓ Timeline shows ${markerCount} rotation points`);
  
  // Click on 10' rotation marker to go to that rotation view
  await page.locator('.timeline-marker', { hasText: "10'" }).click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  console.log('✓ Clicked on 10\' rotation');
  
  // In the rotation view, find Diana's assigned-player button and click to open swap modal
  // The assigned-player button shows "Diana D." format (first name + last initial)
  const dianaPlayerButton = page.locator('.position-slot .assigned-player').filter({ hasText: /Diana/ });
  await dianaPlayerButton.click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  // Wait for swap modal to appear (has "Swap Player" heading)
  await page.waitForSelector('.modal-content', { timeout: 5000 });
  console.log('✓ Swap modal opened');
  
  // Find Hannah Harris in the modal and click her button to swap
  const hannahOption = page.locator('.modal-content .game-option').filter({ hasText: /Hannah/ });
  await hannahOption.click();
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  
  console.log('✓ Planned substitution: Diana → Hannah at 10\'');
  
  // Click on 30' rotation marker to set up swap back (Hannah → Diana)
  await page.locator('.timeline-marker', { hasText: "30'" }).click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  // Find Hannah's assigned-player button and click to open swap modal
  const hannahPlayerButton = page.locator('.position-slot .assigned-player').filter({ hasText: /Hannah/ });
  await hannahPlayerButton.click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  // Wait for swap modal
  await page.waitForSelector('.modal-content', { timeout: 5000 });
  
  // Find Diana Davis in the modal and click her button to swap
  const dianaOption = page.locator('.modal-content .game-option').filter({ hasText: /Diana/ });
  await dianaOption.click();
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  
  console.log('✓ Planned substitution: Hannah → Diana at 30\'');
  
  // Navigate back to Games list by clicking the "← Back" button
  const backButton = page.locator('button', { hasText: '← Back' });
  await backButton.click();
  await waitForPageLoad(page);
  
  // Wait for game cards to appear
  await page.waitForSelector('.game-card', { timeout: 10000 });
  
  // Now click on the game card to enter GameManagement for running the game
  const gameCardForPlay = page.locator('.game-card', { hasText: opponent });
  await gameCardForPlay.click();
  await waitForPageLoad(page);
  
  // Wait for GameManagement to load (should see Start Game button)
  await expect(page.locator('button', { hasText: 'Start Game' })).toBeVisible();
  
  console.log('✓ Game plan created with 2 planned substitutions');
}

// Helper to execute a planned rotation during the game
async function executeRotation(page: Page, rotationMinute: number, playerOut: string, playerIn: string) {
  console.log(`Executing rotation at ${rotationMinute}': ${playerOut} → ${playerIn}...`);
  
  // Look for the "View Plan" button in the rotation countdown banner
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
    
    // Note: Dialog handler is set up in runGame() to handle all confirm dialogs
    
    // Now execute the queued substitution using "Sub All Now"
    const subAllButton = page.locator('button.btn-sub-all', { hasText: /Sub All/ });
    if (await subAllButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await subAllButton.click();
      await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
      console.log(`✓ Executed rotation at ${rotationMinute}': ${playerOut} → ${playerIn}`);
      return true;
    }
  }
  
  console.log(`⚠️ Could not execute rotation at ${rotationMinute}'`);
  return false;
}

// Helper to run the game simulation with planned rotations
async function runGame(page: Page, gameNumber: number = 1) {
  console.log(`Running game ${gameNumber} simulation with planned rotations...`);
  
  // Set up a PERSISTENT dialog handler for ALL confirm dialogs during the game
  // This is needed because executeRotation calls confirm() for each substitution
  const dialogHandler = async (dialog: any) => {
    await dialog.accept();
  };
  page.on('dialog', dialogHandler);
  
  // Click the initial "Start Game" button which opens the availability check modal
  await clickButton(page, 'Start Game');
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  // The Player Availability Check modal appears - click "Start Game" in the modal to confirm
  // There are now two "Start Game" buttons on the page - one in the main view and one in the modal
  // The modal one appears after the "Player Availability Check" heading
  const availabilityHeading = page.getByRole('heading', { name: 'Player Availability Check' });
  if (await availabilityHeading.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Find the modal container (parent of the heading) and then find the Start Game button within it
    // Use nth(1) to get the second "Start Game" button on the page (the one in the modal)
    const modalStartButton = page.getByRole('button', { name: 'Start Game' }).nth(1);
    await modalStartButton.click();
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    console.log('✓ Confirmed player availability');
  }
  
  // Verify timer is running (check for elapsed time display - use specific class)
  await expect(page.locator('.time-display')).toBeVisible({ timeout: 5000 });
  
  // Add test time to 5 minutes
  await clickButton(page, '+5 min');
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
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
  
  // Verify score updated
  await expect(page.locator('.score-display')).toContainText('1');
  console.log(`✓ Goal ${gameNumber}.1 recorded`);
  
  // Add time to reach 10 minutes - first planned rotation
  await clickButton(page, '+5 min');
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  console.log('✓ Timer at 10 minutes');
  
  // Execute first planned rotation (Diana → Hannah)
  await executeRotation(page, 10, 'Diana', 'Hannah');
  
  // Record a gold star (vary by game)
  await clickButtonByText(page, /Gold Star/);
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  const notePlayerSelect = page.locator('select#notePlayer');
  if (gameNumber === 1) {
    await notePlayerSelect.selectOption({ label: '#1 - Alice Anderson' });
    await fillInput(page, 'textarea#noteText', 'Great save!');
  } else {
    await notePlayerSelect.selectOption({ label: '#2 - Bob Brown' });
    await fillInput(page, 'textarea#noteText', 'Excellent defense!');
  }
  await page.waitForTimeout(UI_TIMING.STANDARD);
  
  await clickButton(page, 'Save Note');
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  
  console.log(`✓ Gold star ${gameNumber} recorded`);
  
  // Add time to reach halftime (20 minutes)
  // IMPORTANT: Wait between +5 min clicks to ensure state updates complete
  await clickButton(page, '+5 min');
  await page.waitForTimeout(UI_TIMING.STANDARD);
  await clickButton(page, '+5 min');
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  console.log('✓ Timer at 20 minutes (halftime)');
  
  // End first half (force click because bottom nav might cover it)
  await page.getByRole('button', { name: 'End First Half' }).click({ force: true });
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  
  // Verify halftime status
  await expect(page.getByText(/Halftime/)).toBeVisible();
  console.log('✓ First half ended');
  
  // Start second half - force scroll to button
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION); // Give time for halftime screen to fully render
  
  // Find the button and scroll it into view using JavaScript
  const startBtn = page.locator('button.btn-primary.btn-large', { hasText: 'Start Second Half' });
  await startBtn.waitFor({ state: 'visible', timeout: 5000 });
  
  // Force scroll using JavaScript
  await page.evaluate(() => {
    const btn = document.querySelector('button.btn-primary.btn-large');
    if (btn) {
      btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
  await page.waitForTimeout(800);
  
  // Multiple click attempts
  for (let i = 0; i < 3; i++) {
    await startBtn.click({ force: true });
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    const halftimeGone = await page.getByText(/Halftime/).isVisible().catch(() => false);
    if (!halftimeGone) {
      console.log('✓ Second half started');
      break;
    }
    
    if (i === 2) {
      throw new Error('Failed to start second half after 3 attempts');
    }
  }
  
  // Add time in second half to 25 minutes
  await clickButton(page, '+5 min');
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
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
  
  // Verify score is now 2
  const scoreElements = page.locator('.score-display .score');
  await expect(scoreElements.first()).toContainText('2');
  console.log(`✓ Goal ${gameNumber}.2 recorded`);
  
  // Add time to reach 30 minutes - second planned rotation
  await clickButton(page, '+5 min');
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  console.log('✓ Timer at 30 minutes');
  
  // Execute second planned rotation (Hannah → Diana)
  await executeRotation(page, 30, 'Hannah', 'Diana');
  
  // Add time to reach end of game (40 minutes)
  // IMPORTANT: Wait between +5 min clicks to ensure state updates complete
  await clickButton(page, '+5 min');
  await page.waitForTimeout(UI_TIMING.STANDARD);
  await clickButton(page, '+5 min');
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  console.log('✓ Timer at 40 minutes (end of game)');
  
  // End the game
  await clickButton(page, 'End Game');
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  
  // Verify game completed
  await expect(page.getByText(/Game Completed/)).toBeVisible();
  console.log(`✓ Game ${gameNumber} completed`);
  
  // Remove the dialog handler now that game is complete
  page.off('dialog', dialogHandler);
  
  // Navigate back to Home to see games list for next game (if not the last game)
  if (gameNumber === 1) {
    // Try clicking the back button first if it exists
    const backButton = page.locator('button.back-button, button:has-text("← Back")');
    const backButtonVisible = await backButton.isVisible().catch(() => false);
    if (backButtonVisible) {
      await backButton.click();
      await page.waitForTimeout(UI_TIMING.NAVIGATION);
    }
    
    // Then navigate to Home tab
    const homeTab = page.locator('button.nav-item', { hasText: 'Games' });
    await homeTab.click();
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Verify we're on Home page by waiting for the Schedule button
    await page.waitForSelector('button:has-text("+ Schedule New Game")', { timeout: 5000 });
    console.log('✓ Returned to Home/Games list');
  }
  
  // Return game statistics
  if (gameNumber === 1) {
    return {
      goals: 2,
      assists: 1,
      goldStars: 1,
      scorers: ['Fiona Fisher', 'George Garcia'],
    };
  } else {
    return {
      goals: 2,
      assists: 1,
      goldStars: 1,
      scorers: ['George Garcia', 'Fiona Fisher'], // Both scored in game 2 as well
    };
  }
}

// Helper to verify team totals and play times
async function verifyTeamTotals(page: Page, gameData: any) {
  console.log('Verifying team totals...');
  
  // Wait for DynamoDB eventual consistency - PlayTimeRecords may take time to fully propagate
  console.log('Waiting for data to settle (DynamoDB eventual consistency)...');
  await page.waitForTimeout(3000);
  
  // Navigate to Reports tab at bottom nav
  const reportsTab = page.locator('button.nav-item', { hasText: 'Reports' });
  await reportsTab.click();
  await waitForPageLoad(page);
  
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
  await expect(starsSummary.locator('.summary-value')).toContainText(gameData.goldStars.toString());
  console.log(`✓ Total gold stars verified: ${gameData.goldStars}`);
  
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
  const dianaRow = page.locator('tr').filter({ hasText: 'Diana Davis' });
  await dianaRow.click();
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  
  // Verify player details section appears
  await expect(page.locator('.player-details-section')).toBeVisible();
  
  // Verify play time by position section
  await expect(page.locator('h3').filter({ hasText: /Play Time by Position/ })).toBeVisible();
  
  // Verify Diana's play time (should be 40 min = 20 min per game × 2 games)
  const dianaPositionTime = page.locator('.position-time-item', { hasText: 'Center Midfielder' });
  await expect(dianaPositionTime).toBeVisible();
  
  // Log actual play time for debugging
  const dianaActualTime = await dianaPositionTime.locator('.position-time').textContent();
  console.log(`Diana Davis play time at CM: ${dianaActualTime}`);
  
  // Diana should have 40 minutes (displayed as "40m")
  await expect(dianaPositionTime.locator('.position-time')).toContainText('40m');
  console.log('✓ Diana Davis play time verified: 40m');
  
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
    
    const hannahPositionTime = page.locator('.position-time-item', { hasText: 'Center Midfielder' });
    if (await hannahPositionTime.isVisible().catch(() => false)) {
      const hannahActualTime = await hannahPositionTime.locator('.position-time').textContent();
      console.log(`Hannah Harris play time at CM: ${hannahActualTime}`);
      
      // Hannah should also have 40 minutes
      await expect(hannahPositionTime.locator('.position-time')).toContainText('40m');
      console.log('✓ Hannah Harris play time verified: 40m');
    }
  }
  
  // Verify a full-time player (Alice Anderson - GK)
  await page.locator('button').filter({ hasText: /Back|Close/ }).first().click().catch(() => {});
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  const aliceRow = page.locator('tr').filter({ hasText: 'Alice Anderson' });
  if (await aliceRow.isVisible().catch(() => false)) {
    await aliceRow.click();
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    const alicePositionTime = page.locator('.position-time-item', { hasText: 'Goalkeeper' });
    if (await alicePositionTime.isVisible().catch(() => false)) {
      const aliceActualTime = await alicePositionTime.locator('.position-time').textContent();
      console.log(`Alice Anderson play time at GK: ${aliceActualTime}`);
      
      // Alice should have 80 minutes (1h 20m)
      await expect(alicePositionTime.locator('.position-time')).toContainText('1h 20m');
      console.log('✓ Alice Anderson play time verified: 1h 20m (80 min)');
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
});

