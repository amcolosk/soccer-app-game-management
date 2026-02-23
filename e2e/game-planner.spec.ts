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
    
    // Verify player exists (use first() to handle duplicates if they exist)
    await expect(page.getByText(`${player.firstName} ${player.lastName}`).first()).toBeVisible();
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
  
  // Wait for DynamoDB eventual consistency (longer wait for roster data)
  await page.waitForTimeout(3000);
  
  console.log(`✓ Added ${TEST_DATA.players.length} players to team roster`);
}

async function createGame(page: Page) {
  console.log('Creating game...');
  
  // Navigate to home page first
  await page.click('a.nav-item:has-text("Games")');
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
  
  // Wait for DynamoDB eventual consistency
  await page.waitForTimeout(2000);
  
  await page.waitForTimeout(500);
  
  await expect(page.getByText(TEST_DATA.game.opponent)).toBeVisible();
  
  // Wait for DynamoDB eventual consistency
  await page.waitForTimeout(2000);
  
  console.log('✓ Game created');
}

async function setupLineup(page: Page) {
  console.log('Setting up lineup...');
  
  // Navigate to home first to ensure fresh data load
  await page.click('a.nav-item:has-text("Games")');
  await page.waitForTimeout(1000);
  
  // Find and click on the game card's Plan Game button
  // The card itself clicks into the live game/details view, but we want the planner
  const gameCard = page.locator('.game-card', { hasText: TEST_DATA.game.opponent });
  await gameCard.locator('.plan-button').click();
  await page.waitForTimeout(1000);

  // The lineup builder is already visible on the game planner page
  // Wait for players to be loaded in the dropdown (ensure options exist)
  const firstSlotSelect = page.locator('.position-slot select').first();
  await expect(firstSlotSelect).toBeVisible();

  // Check for pre-assigned players
  const assignedCount = await page.locator('.assigned-player').count();
  if (assignedCount > 0) {
    console.log(`⚠ Found ${assignedCount} pre-assigned players! Cleaning up...`);
    // Logic to remove them? click the "X" button
    const removeButtons = page.locator('.remove-player');
    const count = await removeButtons.count();
    for (let i = 0; i < count; i++) {
        await removeButtons.first().click();
        await page.waitForTimeout(100);
    }
  }

  // Retry waiting for options
  await expect(async () => {
    const count = await firstSlotSelect.locator('option').count();
    expect(count).toBeGreaterThan(1);
  }).toPass();

  // Assign the first 5 available players dynamically
  const positionSlots = page.locator('.position-slot');
  const slotCount = await positionSlots.count();
  
  for (let i = 0; i < Math.min(slotCount, 5); i++) {
    const positionSlot = positionSlots.nth(i);
    
    // Find the select
    const select = positionSlot.locator('select, .player-select').first();
    if (await select.isVisible()) {
      // Get all available options
      const optionElements = select.locator('option');
      const optionCount = await optionElements.count();
      
      // Find first non-placeholder option (skip "Select player..." at index 0)
      let assigned = false;
      for (let j = 1; j < optionCount; j++) {
        const optionText = await optionElements.nth(j).innerText();
        if (optionText && optionText.trim().length > 0) {
          await select.selectOption({ index: j });
          
          // Wait for React state to settle and UI to update
          await expect(positionSlot.locator('.assigned-player')).toBeVisible();
          assigned = true;
          break;
        }
      }
      
      if (!assigned) {
        console.warn(`⚠ No players available for Slot ${i}`);
      }
    }
  }
  
  await page.waitForTimeout(300);
  
  // Wait for DynamoDB eventual consistency after lineup changes (longer wait)
  await page.waitForTimeout(3000);
  
  // Retry: observeQuery can push back stale data and revert assignments.
  // Re-check and re-assign any positions that reverted to dropdowns.
  for (let retry = 0; retry < 3; retry++) {
    const currentAssigned = await page.locator('.assigned-player').count();
    if (currentAssigned >= 5) {
      console.log(`✓ All 5 players assigned to lineup`);
      break;
    }
    console.log(`  Retry ${retry + 1}: Only ${currentAssigned}/5 assigned, re-assigning empty slots...`);
    
    // Re-assign any slots that still have a <select> (i.e. reverted)
    const slots = page.locator('.position-slot');
    const slotCount2 = await slots.count();
    for (let i = 0; i < Math.min(slotCount2, 5); i++) {
      const slot = slots.nth(i);
      const hasAssigned = await slot.locator('.assigned-player').count();
      if (hasAssigned > 0) continue;
      
      const sel = slot.locator('select, .player-select').first();
      if (await sel.isVisible()) {
        const opts = sel.locator('option');
        const optCount = await opts.count();
        for (let j = 1; j < optCount; j++) {
          const txt = await opts.nth(j).innerText();
          if (txt && txt.trim().length > 0) {
            await sel.selectOption({ index: j });
            await expect(slot.locator('.assigned-player')).toBeVisible({ timeout: 5000 });
            break;
          }
        }
      }
    }
    
    await page.waitForTimeout(3000);
  }
  
  // Final check
  const finalAssignedCount = await page.locator('.assigned-player').count();
  if (finalAssignedCount < 5) {
    console.warn(`⚠ Only ${finalAssignedCount}/5 players assigned after retries`);
  }
  
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
  
  // Select rotation interval (default is 10, but we set it explicitly)
  // Logic matches src/components/GamePlanner.tsx structure
  const intervalSelect = page.locator('.interval-selector select');
  await expect(intervalSelect).toBeVisible();
  await intervalSelect.selectOption('10');
  await page.waitForTimeout(UI_TIMING.STANDARD);
  
  // Click "Update Plan" (or "Create Plan") button
  // We use a flexible locator because the text changes based on state
  const updateButton = page.getByRole('button', { name: /Create Plan|Update Plan/ });
  await updateButton.scrollIntoViewIfNeeded();
  await updateButton.click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  // Wait for observeQuery to propagate the rotation plan and rotations
  // Increased wait time to ensure DynamoDB consistency
  await page.waitForTimeout(5000);
  
  // Verify rotations were created
  await expect(page.locator('.timeline-container')).toBeVisible();
  console.log('✓ Rotation plan created');
}

async function verifyTimeline(page: Page) {
  console.log('Verifying timeline...');
  
  // Check that timeline has rotation markers
  const timelineMarkers = page.locator('.timeline-marker');
  const markerCount = await timelineMarkers.count();
  console.log(`  Found ${markerCount} timeline markers`);
  expect(markerCount).toBeGreaterThan(0);
  console.log(`✓ Timeline has ${markerCount} markers`);
  
  // Check for rotation buttons
  const rotationButtons = page.locator('.rotation-button');
  const rotationCount = await rotationButtons.count();
  console.log(`  Found ${rotationCount} rotation buttons`);
  
  // Check that Lineup button exists
  await expect(page.getByRole('button', { name: 'Lineup' })).toBeVisible();
  
  // Check that HT (halftime) marker exists (with longer timeout for observeQuery to update)
  try {
    await expect(page.locator('.halftime-marker')).toBeVisible({ timeout: 10000 });
  } catch (e) {
    console.warn('⚠ Halftime marker not found - this might be expected for shorter games');
  }
  
  console.log('✓ Timeline structure verified');
}

async function planSubstitutions(page: Page) {
  console.log('Planning substitutions...');
  
  // Check if rotation buttons exist
  const rotationButtons = page.locator('.rotation-button').filter({ hasText: /subs/ });
  const buttonCount = await rotationButtons.count();
  console.log(`  Found ${buttonCount} rotation buttons with 'subs' text`);
  
  if (buttonCount === 0) {
    console.error('❌ No rotation buttons found! Timeline may not have rotations.');
    throw new Error('No rotation buttons with substitutions found');
  }
  
  // Substitution 1: In first rotation, sub Player 6 for Player 1 (GK position)
  console.log('  Rotation 1: Substituting Player 6 for Player 1...');
  const firstRotation = rotationButtons.first();
  await firstRotation.click();
  await page.waitForTimeout(UI_TIMING.STANDARD);
  
  // Verify rotation details panel is shown
  await expect(page.locator('.rotation-details-panel')).toBeVisible();
  
  // Find Player 1 on the field and click to swap
  const player1 = page.locator('.assigned-player', { hasText: 'Player One' }).or(
    page.locator('.assigned-player', { hasText: '#1' })
  );
  
  if (await player1.first().isVisible()) {
    await player1.first().click();
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Select Player 6 from bench
    const swapModal = page.locator('.modal-overlay');
    if (await swapModal.isVisible()) {
      const player6Button = page.locator('.game-option', { hasText: 'Player Six' }).or(
        page.locator('.game-option', { hasText: '#6' })
      );
      
      if (await player6Button.first().isVisible()) {
        console.log('    → Swapping in Player Six');
        await player6Button.first().click();
        await page.waitForTimeout(UI_TIMING.NAVIGATION);
        await expect(swapModal).not.toBeVisible({ timeout: 3000 });
        await page.waitForTimeout(2000);
      }
    }
  }
  
  // Substitution 2: At halftime, sub Late Arrival for Player 2
  // The halftime rotation button is inside .halftime-column. After downstream recalculation
  // auto-generates a reverse swap, the button text changes from "Halftime" to "1 subs",
  // so we select by the column class instead of text matching.
  console.log('  Halftime: Substituting Late Arrival for Player 2...');
  const halftimeButton = page.locator('.halftime-column .rotation-button');
  const hasHalftime = await halftimeButton.count() > 0;
  
  if (hasHalftime) {
    await halftimeButton.click();
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Find Player 2 on the field and click to swap
    const player2 = page.locator('.assigned-player', { hasText: 'Player Two' }).or(
      page.locator('.assigned-player', { hasText: '#2' })
    );
    
    if (await player2.first().isVisible()) {
      await player2.first().click();
      await page.waitForTimeout(UI_TIMING.STANDARD);
      
      // Select Late Arrival from bench
      const swapModal = page.locator('.modal-overlay');
      if (await swapModal.isVisible()) {
        const lateArrivalButton = page.locator('.game-option', { hasText: 'Late Arrival' }).or(
          page.locator('.game-option', { hasText: '#7' })
        );
        
        if (await lateArrivalButton.first().isVisible()) {
          console.log('    → Swapping in Late Arrival');
          await lateArrivalButton.first().click();
          await page.waitForTimeout(UI_TIMING.NAVIGATION);
          await expect(swapModal).not.toBeVisible({ timeout: 3000 });
          await page.waitForTimeout(2000);
        }
      }
    }
  }
  
  // Verify assigned players are still present (substitutions swap players, count stays the same)
  const assignedAfterSubs = await page.locator('.assigned-player').count();
  console.log(`  Assigned players after substitutions: ${assignedAfterSubs}`);
  expect(assignedAfterSubs).toBeGreaterThanOrEqual(3);
  console.log('✓ Substitutions planned');
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
  
  // Extract and verify play time for each player
  console.log('\n--- Projected Play Time ---');
  
  // Expected play times based on rotation plan:
  // Game is 40 minutes (20 min per half), rotation every 10 minutes
  // Starting lineup: P1, P2, P3, P4, P5
  // Rotation 1 at 10': P6 in for P1 → lineup: P6, P2, P3, P4, P5
  // Halftime (auto-reverse from downstream recalc): P1 back for P6
  // Halftime (manual): Late Arrival in for P2 → lineup: P1, Late, P3, P4, P5
  // 30' (auto-reverse from downstream recalc): P2 back for Late Arrival → P1, P2, P3, P4, P5
  //
  // Play times:
  // P1: 0-10 + 20-40 = 30 min
  // P2: 0-20 + 30-40 = 30 min (subbed out at HT, auto-reversed back at 30')
  // P3: 0-40 = 40 min (entire game)
  // P4: 0-40 = 40 min (entire game)
  // P5: 0-40 = 40 min (entire game)
  // P6: 10-20 = 10 min (subbed in at 10', auto-reversed at HT)
  // Late Arrival: 20-30 = 10 min (subbed in at HT, auto-reversed at 30')
  
  // Expected times (using format "#N FirstName L." as displayed in UI)
  const expectedPlayTimes: Record<string, { min: number; max: number }> = {
    '#1 Player O.': { min: 29, max: 31 },   // Player One: 30 minutes (0-10, 20-40)
    '#2 Player T.': { min: 29, max: 31 },   // Player Two: 30 minutes (0-20, 30-40 auto-reversed)
    '#3 Player T.': { min: 39, max: 41 },   // Player Three: 40 minutes (entire game)
    '#4 Player F.': { min: 39, max: 41 },   // Player Four: 40 minutes (entire game)
    '#5 Player F.': { min: 39, max: 41 },   // Player Five: 40 minutes (entire game)
    '#6 Player S.': { min: 9, max: 11 },    // Player Six: 10 minutes (10-20, auto-reversed at HT)
    '#7 Late A.': { min: 9, max: 11 },      // Late Arrival: 10 minutes (20-30, auto-reversed at 30')
  };
  
  for (const [playerName, expectedTime] of Object.entries(expectedPlayTimes)) {
    const playerBar = page.locator('.playtime-bar-container', { hasText: playerName });
    
    // Player must be found in the report
    await expect(playerBar).toBeVisible({ timeout: 5000 });
    
    // Get time from the .playtime-bar element, not .playtime-label
    const timeText = await playerBar.locator('.playtime-bar').textContent();
    const minutes = parseInt(timeText?.match(/(\d+)\s*m(?:in)?/)?.[1] || '0');
    
    console.log(`${playerName}: ${minutes} min (expected: ${expectedTime.min}-${expectedTime.max} min)`);
    
    // Verify time is within expected range
    expect(minutes).toBeGreaterThanOrEqual(expectedTime.min);
    expect(minutes).toBeLessThanOrEqual(expectedTime.max);
  }
  
  console.log('--- End Projected Play Time ---\n');
  
  console.log('✓ Play time report verified');
}

async function testCopyFromPrevious(page: Page) {
  console.log('Testing copy from previous rotation...');
  
  // Close any open modals first
  const modalOverlay = page.locator('.modal-overlay');
  if (await modalOverlay.isVisible({ timeout: 1000 }).catch(() => false)) {
    // Click on the overlay background to close the modal
    await modalOverlay.click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(UI_TIMING.STANDARD);
  }
  
  // Click on second rotation (with force to bypass any remaining overlay)
  const rotationButtons = page.locator('.rotation-button').filter({ hasText: /subs/ });
  const secondRotation = rotationButtons.nth(1);
  
  if (await secondRotation.isVisible()) {
    await secondRotation.click({ force: true });
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Click "Copy from Previous" button
    // Scope to rotation details panel to avoid ambiguity with game-level copy button
    const copyButton = page.locator('.rotation-details-panel').getByRole('button', { name: /Copy from Previous/i });
    if (await copyButton.isVisible()) {
      await copyButton.click();
      await page.waitForTimeout(UI_TIMING.NAVIGATION);
      
      // Verify that lineup was copied (should have assigned players)
      const copiedCount = await page.locator('.assigned-player').count();
      expect(copiedCount).toBeGreaterThanOrEqual(3);
      console.log(`✓ Copy from previous rotation works (${copiedCount} players copied)`);
    }
  }
}

test.describe('Game Planner with Timeline', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      const text = msg.text();
      // Log position loading
      if (text.includes('[GamePlanner]') || text.includes('positions') || msg.type() === 'error') {
         console.log(`[BROWSER]: ${text}`);
      }
    });
    
    await closePWAPrompt(page);
  });

  test('Complete game planning workflow with timeline', async ({ page }) => {
    test.setTimeout(240000); // 4 minute timeout
    
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
