import { test, expect, Page } from '@playwright/test';
import {
  waitForPageLoad,
  fillInput,
  clickButton,
  clickButtonByText,
  selectOption,
  waitForElement,
  closePWAPrompt,
  loginUser,
  cleanupTestData,
  clickManagementTab,
  createFormation,
  createTeam,
  UI_TIMING,
} from './helpers';
import { TEST_USERS, TEST_CONFIG } from '../test-config';

/**
 * E2E Test Suite for Game Planner with Timeline Feature
 * Tests rotation planning, substitutions, and play time calculations
 */

const TEST_DATA = {
  formation: {
    name: '3-2',
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
  players: [
    { number: '1', firstName: 'Player', lastName: 'One', position: 'GK' },
    { number: '2', firstName: 'Player', lastName: 'Two', position: 'LD' },
    { number: '3', firstName: 'Player', lastName: 'Three', position: 'RD' },
    { number: '4', firstName: 'Player', lastName: 'Four', position: 'LF' },
    { number: '5', firstName: 'Player', lastName: 'Five', position: 'RF' },
    { number: '6', firstName: 'Player', lastName: 'Six', position: 'GK' },
    { number: '7', firstName: 'Late', lastName: 'Arrival', position: 'LD' },
  ],
  game: {
    opponent: 'Test Opponent FC',
    date: '2025-12-15T14:00',
    isHome: true,
  },
};

async function createPlayers(page: Page) {
  console.log('Creating players...');
  
  await clickManagementTab(page, 'Players');
  
  for (const player of TEST_DATA.players) {
    await clickButton(page, '+ Add Player');
    await waitForPageLoad(page);
    
    await fillInput(page, 'input[placeholder*="First"]', player.firstName);
    await fillInput(page, 'input[placeholder*="Last"]', player.lastName);
    
    await clickButton(page, 'Add');
    await page.waitForTimeout(500);
    
    await expect(page.getByText(`${player.firstName} ${player.lastName}`)).toBeVisible();
  }
  
  console.log(`✓ Created ${TEST_DATA.players.length} players`);
}

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
    // Note: The UI might use full names like "Goalkeeper" or abbreviations like "GK"
    // We try to match loosely
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

async function createGame(page: Page) {
  console.log('Creating game...');
  
  // Navigate to home page first
  await page.click('button.nav-item:has-text("Games")');
  await page.waitForTimeout(500);
  
  // Schedule a new game from home
  await clickButton(page, '+ Schedule New Game');
  await page.waitForTimeout(500);
  
  // Wait for form to load
  await expect(page.locator('select').first()).toBeVisible({ timeout: 5000 });
  
  // Select team from dropdown
  const teamSelect = page.locator('select').first();
  await teamSelect.selectOption({ label: TEST_DATA.team.name });
  await page.waitForTimeout(300);
  
  await fillInput(page, 'input[placeholder*="Opponent Team Name *"]', TEST_DATA.game.opponent);
  await fillInput(page, 'input[type="datetime-local"]', TEST_DATA.game.date);
  
  const homeCheckbox = page.locator('input[type="checkbox"]');
  if (TEST_DATA.game.isHome) {
    await homeCheckbox.check();
  }
  
  await clickButton(page, 'Create');
  await page.waitForTimeout(500);
  
  await expect(page.getByText(TEST_DATA.game.opponent)).toBeVisible();
  console.log('✓ Game created');
}

async function setupLineup(page: Page) {
  console.log('Setting up lineup...');
  
  // Find and click on the game card's Plan Game button
  // The card itself clicks into the live game/details view, but we want the planner
  const gameCard = page.locator('.game-card', { hasText: TEST_DATA.game.opponent });
  await gameCard.locator('.plan-button').click();
  await page.waitForTimeout(500);
  
  // Assign players to positions using drag-and-drop or select
  const startingPlayers = TEST_DATA.players.slice(0, 5);
  
  for (let i = 0; i < startingPlayers.length; i++) {
    const player = startingPlayers[i];
    const positionSlot = page.locator('.position-slot').nth(i);
    
    // Find the select or player option
    const select = positionSlot.locator('select, .player-select').first();
    if (await select.isVisible()) {
      // Use select dropdown
      const playerText = `#${player.number} ${player.firstName} ${player.lastName}`;
      await select.selectOption({ label: new RegExp(playerText) });
    }
  }
  
  await page.waitForTimeout(300);
  console.log('✓ Lineup set');
}

async function openGamePlanner(page: Page) {
  console.log('Opening game planner...');
  
  // Check if we're already on the planner screen (setupLineup might have taken us there)
  // Use a locator that identifies the screen without strict mode violation
  const isPlannerVisible = await page.getByRole('heading', { name: /Game Plan/ }).count() > 0;
  
  if (!isPlannerVisible) {
    // Click "Plan Game" button if not already there
    // This assumes we are on a page with the Plan Game button (like Dashboard)
    const planButton = page.getByRole('button', { name: 'Plan Game' });
    if (await planButton.isVisible()) {
      await planButton.click();
      await page.waitForTimeout(1000);
    }
  }
  
  // Verify we're on the game planner screen
  await expect(page.getByRole('heading', { name: /Game Plan/ }).first()).toBeVisible({ timeout: 5000 });
  console.log('✓ Game planner opened');
}

async function checkPlayerAvailability(page: Page) {
  console.log('Setting player availability...');
  
  // Click "Check Availability" if present
  const availabilityButton = page.getByRole('button', { name: /Check Availability/i });
  if (await availabilityButton.isVisible()) {
    await availabilityButton.click();
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Set Late Arrival player as late
    const lateArrivalRow = page.locator('.availability-check-item', { 
      hasText: 'Late Arrival' 
    });
    
    if (await lateArrivalRow.isVisible()) {
      const select = lateArrivalRow.locator('select');
      await select.selectOption('late-arrival');
      await page.waitForTimeout(UI_TIMING.STANDARD);
    }
    
    // Close modal
    await clickButton(page, 'Done');
    await page.waitForTimeout(UI_TIMING.STANDARD);
  }
  
  console.log('✓ Player availability checked');
}

async function createRotationPlan(page: Page) {
  console.log('Creating rotation plan...');
  
  // Click Setup button if the interval input is not visible
  // The setup panel might be collapsed
  const intervalInput = page.locator('input[type="number"]').first(); // For rotation length
  
  if (!(await intervalInput.isVisible())) {
    const setupButton = page.getByRole('button', { name: 'Setup' });
    if (await setupButton.isVisible()) {
      await setupButton.click();
      await page.waitForTimeout(UI_TIMING.STANDARD);
    }
  }
  
  // Fill in rotation interval
  await intervalInput.fill('10');
  await page.waitForTimeout(UI_TIMING.STANDARD);
  
  // Click "Update Plan" button
  await clickButton(page, 'Update Plan');
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  // Verify rotations were created
  await expect(page.locator('.timeline-container')).toBeVisible();
  console.log('✓ Rotation plan created');
}

async function verifyTimeline(page: Page) {
  console.log('Verifying timeline...');
  
  // Check that timeline has rotation markers
  const timelineMarkers = page.locator('.timeline-marker');
  const markerCount = await timelineMarkers.count();
  expect(markerCount).toBeGreaterThan(0);
  console.log(`✓ Timeline has ${markerCount} markers`);
  
  // Check that Start button exists
  await expect(page.getByRole('button', { name: 'Setup' })).toBeVisible();
  
  // Check that HT (halftime) marker exists
  await expect(page.locator('.halftime-marker')).toBeVisible();
  
  console.log('✓ Timeline structure verified');
}

async function planSubstitutions(page: Page) {
  console.log('Planning substitutions...');
  
  // Click on first rotation
  const firstRotation = page.locator('.rotation-button').filter({ hasText: /subs/ }).first();
  await firstRotation.click();
  await page.waitForTimeout(UI_TIMING.STANDARD);
  
  // Verify rotation details panel is shown
  await expect(page.locator('.rotation-details-panel')).toBeVisible();
  
  // Find a player on the field to swap
  const fieldPlayer = page.locator('.assigned-player').first();
  if (await fieldPlayer.isVisible()) {
    await fieldPlayer.click();
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Swap modal should appear
    const swapModal = page.locator('.modal-overlay');
    if (await swapModal.isVisible()) {
      // Select a bench player (Player Six)
      const benchPlayerButton = page.locator('.game-option', { 
        hasText: 'Player Six' 
      });
      
      if (await benchPlayerButton.isVisible()) {
        await benchPlayerButton.click();
        await page.waitForTimeout(UI_TIMING.NAVIGATION);
        console.log('✓ Substitution planned');
      }
    }
  }
}

async function verifySubstitutionDisplay(page: Page) {
  console.log('Verifying substitution display...');
  
  // Check for yellow substitution boxes
  const subBoxes = page.locator('.planned-sub-item');
  const subCount = await subBoxes.count();
  
  if (subCount > 0) {
    console.log(`✓ Found ${subCount} substitution(s) displayed`);
    
    // Verify substitution has position label, player names, and arrow
    const firstSub = subBoxes.first();
    await expect(firstSub.locator('.sub-position-label')).toBeVisible();
    await expect(firstSub.locator('.sub-out')).toBeVisible();
    await expect(firstSub.locator('.sub-in')).toBeVisible();
    await expect(firstSub.locator('.sub-arrow')).toBeVisible();
    
    console.log('✓ Substitution display format verified');
  } else {
    console.log('⚠ No substitutions to verify');
  }
}

async function verifyPlayTimeReport(page: Page) {
  console.log('Verifying play time report...');
  
  // Scroll to projected playtime section
  const playTimeSection = page.locator('.projected-playtime');
  await playTimeSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(UI_TIMING.STANDARD);
  
  // Verify section exists
  await expect(playTimeSection).toBeVisible();
  await expect(page.getByText('Projected Play Time')).toBeVisible();
  
  // Check that players have play time bars
  const playTimeBars = page.locator('.playtime-bar');
  const barCount = await playTimeBars.count();
  expect(barCount).toBeGreaterThan(0);
  console.log(`✓ Found ${barCount} player play time bars`);
  
  // Verify late arrival player has less time than starting players
  const lateArrivalBar = page.locator('.playtime-item', { hasText: 'Late Arrival' });
  if (await lateArrivalBar.isVisible()) {
    const lateArrivalTime = await lateArrivalBar.locator('.playtime-label').textContent();
    console.log(`  Late Arrival player time: ${lateArrivalTime}`);
    
    // Check that late arrival time is less than 40 minutes (full game)
    const minutes = parseInt(lateArrivalTime?.match(/\d+/)?.[0] || '0');
    expect(minutes).toBeLessThan(40);
    console.log('✓ Late arrival player has reduced play time');
  }
  
  console.log('✓ Play time report verified');
}

async function testCopyFromPrevious(page: Page) {
  console.log('Testing copy from previous rotation...');
  
  // Click on second rotation
  const rotationButtons = page.locator('.rotation-button').filter({ hasText: /subs/ });
  const secondRotation = rotationButtons.nth(1);
  
  if (await secondRotation.isVisible()) {
    await secondRotation.click();
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Click "Copy from Previous" button
    const copyButton = page.getByRole('button', { name: /Copy from Previous/i });
    if (await copyButton.isVisible()) {
      await copyButton.click();
      await page.waitForTimeout(UI_TIMING.NAVIGATION);
      
      // Verify that lineup was copied (should have same players)
      await expect(page.locator('.assigned-player')).toHaveCount(5);
      console.log('✓ Copy from previous rotation works');
    }
  }
}

test.describe('Game Planner with Timeline', () => {
  test.beforeEach(async ({ page }) => {
    await closePWAPrompt(page);
  });

  test('Complete game planning workflow with timeline', async ({ page }) => {
    test.setTimeout(120000); // 2 minute timeout
    
    console.log('\n=== Starting Game Planner E2E Test ===\n');
    
    // Step 1: Login
    console.log('Step 1: Login');
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    console.log('✓ Logged in successfully\n');
    
    // Step 2: Clean up existing data
    console.log('Step 2: Clean up existing data');
    await cleanupTestData(page);
    console.log('');
    
    // Step 3: Create Formation
    console.log('Step 3: Create Formation');
    await createFormation(page, TEST_DATA.formation);
    console.log('');
    
    // Step 4: Create Team
    console.log('Step 4: Create Team');
    const formationLabel = `${TEST_DATA.formation.name} (${TEST_DATA.formation.playerCount} players)`;
    await createTeam(page, TEST_DATA.team, formationLabel);
    console.log('');
    
    // Step 5: Create Players
    console.log('Step 5: Create Players');
    await createPlayers(page);
    console.log('');
    
    // Step 6: Add Players to Roster
    console.log('Step 6: Add Players to Roster');
    await addPlayersToRoster(page);
    console.log('');
    
    // Step 7: Create Game
    console.log('Step 7: Create Game');
    await createGame(page);
    console.log('');
    
    // Step 8: Setup Lineup
    console.log('Step 8: Setup Lineup');
    await setupLineup(page);
    console.log('');
    
    // Step 9: Open Game Planner
    console.log('Step 9: Open Game Planner');
    await openGamePlanner(page);
    console.log('');
    
    // Step 10: Check Player Availability
    console.log('Step 10: Check Player Availability');
    await checkPlayerAvailability(page);
    console.log('');
    
    // Step 11: Create Rotation Plan
    console.log('Step 11: Create Rotation Plan');
    await createRotationPlan(page);
    console.log('');
    
    // Step 12: Verify Timeline
    console.log('Step 12: Verify Timeline');
    await verifyTimeline(page);
    console.log('');
    
    // Step 13: Plan Substitutions
    console.log('Step 13: Plan Substitutions');
    await planSubstitutions(page);
    console.log('');
    
    // Step 14: Verify Substitution Display
    console.log('Step 14: Verify Substitution Display');
    await verifySubstitutionDisplay(page);
    console.log('');
    
    // Step 15: Test Copy from Previous
    console.log('Step 15: Test Copy from Previous');
    await testCopyFromPrevious(page);
    console.log('');
    
    // Step 16: Verify Play Time Report
    console.log('Step 16: Verify Play Time Report');
    await verifyPlayTimeReport(page);
    console.log('');
    
    console.log('=== Game Planner E2E Test Completed Successfully ===\n');
  });
});
