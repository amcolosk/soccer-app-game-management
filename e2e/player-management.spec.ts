import { test, expect, Page } from '@playwright/test';
import {
  waitForPageLoad,
  fillInput,
  clickButton,
  closePWAPrompt,
  cleanupTestData,
  loginUser,
  navigateToManagement,
  clickManagementTab,
  createSeason,
  createTeam,
  handleConfirmDialog,
  UI_TIMING,
} from './helpers';
import { TEST_USERS, TEST_CONFIG } from '../test-config';

/**
 * Player Management CRUD Test Suite
 * Tests Create, Read, Update, and Delete operations for players in the Management tab
 */

// Test data
const TEST_DATA = {
  season: {
    name: 'Test Season',
    year: '2025',
  },
  team1: {
    name: 'Thunder FC U10',
    maxPlayers: '7',
    halfLength: '25',
  },
  team2: {
    name: 'Lightning FC U12',
    maxPlayers: '9',
    halfLength: '30',
  },
  positions: [
    { name: 'Goalkeeper', abbreviation: 'GK' },
    { name: 'Defender', abbreviation: 'DF' },
    { name: 'Midfielder', abbreviation: 'MF' },
    { name: 'Forward', abbreviation: 'FW' },
  ],
  player1: {
    firstName: 'Alice',
    lastName: 'Anderson',
    number: '1',
    preferredPositions: ['GK'],
  },
  player2: {
    firstName: 'Bob',
    lastName: 'Brown',
    number: '2',
    preferredPositions: ['DF', 'MF'],
  },
  player3: {
    firstName: 'Charlie',
    lastName: 'Clark',
    number: '3',
    preferredPositions: [],
  },
};

async function createPositionsForTeam(page: Page, teamName: string) {
  console.log(`Creating positions for ${teamName}...`);
  
  // Navigate to Home to access team through a game
  const homeTab = page.locator('button.nav-item', { hasText: 'Home' });
  await homeTab.click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  // Go back to Management to create a temporary game
  const manageTab = page.locator('button.nav-item', { hasText: 'Manage' });
  await manageTab.click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  const gamesTab = page.locator('button.management-tab', { hasText: /Games/ });
  await gamesTab.click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  // Create temporary game to access team
  const createGameBtn = page.locator('button.btn-primary', { hasText: 'Schedule New Game' });
  await createGameBtn.click();
  await page.waitForTimeout(UI_TIMING.STANDARD);
  
  await page.selectOption('select', { label: teamName });
  await page.waitForTimeout(UI_TIMING.STANDARD);
  
  await fillInput(page, 'input[placeholder*="opponent"]', 'Temp Position Setup');
  await fillInput(page, 'input[type="datetime-local"]', '2025-12-31T12:00');
  await page.getByRole('radio', { name: /home/i }).check();
  
  await clickButton(page, 'Create');
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  
  // Navigate to Home and access game
  await homeTab.click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  const gameCard = page.locator('.game-card').filter({ hasText: 'Temp Position Setup' });
  await gameCard.click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  // Go to Positions tab
  const positionsTab = page.locator('button.tab', { hasText: 'Positions' });
  await positionsTab.click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  // Create positions
  for (const position of TEST_DATA.positions) {
    const addPositionBtn = page.locator('button.btn-primary', { hasText: 'Add Position' });
    await addPositionBtn.click();
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    await fillInput(page, 'input[placeholder*="Position Name"]', position.name);
    await fillInput(page, 'input[placeholder*="Abbreviation"]', position.abbreviation);
    
    await clickButton(page, 'Add');
    await page.waitForTimeout(UI_TIMING.NAVIGATION);
    
    await expect(page.getByText(position.name)).toBeVisible();
  }
  
  console.log(`✓ Created ${TEST_DATA.positions.length} positions`);
  
  // Delete temporary game
  const gamesTabInTeam = page.locator('button.tab', { hasText: 'Games' });
  await gamesTabInTeam.click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  const tempGameCard = page.locator('.game-card').filter({ hasText: 'Temp Position Setup' });
  await tempGameCard.click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  const cleanupDialog = handleConfirmDialog(page, false);
  
  const deleteButton = page.locator('button.btn-delete-game', { hasText: 'Delete Game' });
  await deleteButton.click();
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  
  cleanupDialog();
  console.log('✓ Temporary game deleted');
  
  // Navigate back to Management
  await manageTab.click();
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
}

test.describe('Player Management CRUD', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.long);
  });

  test('should perform complete CRUD operations on players', async ({ page }) => {
    console.log('\n=== Starting Player CRUD Test ===\n');
    
    // Login
    console.log('Step 1: Login');
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    console.log('✓ Logged in\n');
    
    // Navigate to Management
    console.log('Step 2: Navigate to Management');
    await navigateToManagement(page);
    console.log('✓ On Management page\n');
    
    // Clean up any existing data
    console.log('Step 3: Clean up existing data');
    await cleanupTestData(page);
    console.log('');
    
    // Create test season
    console.log('Step 4: Create test season');
    await createSeason(page, TEST_DATA.season);
    console.log('');
    
    // Create test teams
    console.log('Step 5: Create test teams');
    await createTeam(page, TEST_DATA.team1, TEST_DATA.season);
    await createTeam(page, TEST_DATA.team2, TEST_DATA.season);
    console.log('');
    
    // Create positions for team1
    console.log('Step 6: Create positions for team1');
    await createPositionsForTeam(page, TEST_DATA.team1.name);
    console.log('');
    
    // ===== CREATE: Create first player =====
    console.log('Step 7: CREATE - Create first player with preferred positions');
    await clickManagementTab(page, 'Players');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Verify empty state
    await expect(page.locator('.empty-message')).toBeVisible();
    await expect(page.locator('.empty-message')).toContainText('No players yet');
    console.log('  ✓ Empty state visible');
    
    // Click Add Player button
    await clickButton(page, '+ Add Player');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Verify form is visible
    await expect(page.locator('.create-form')).toBeVisible();
    await expect(page.locator('h3:has-text("Add New Player")')).toBeVisible();
    console.log('  ✓ Create form visible');
    
    // Select team
    await page.selectOption('select', { label: TEST_DATA.team1.name });
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Fill in player details
    await fillInput(page, 'input[placeholder*="First Name"]', TEST_DATA.player1.firstName);
    await fillInput(page, 'input[placeholder*="Last Name"]', TEST_DATA.player1.lastName);
    await fillInput(page, 'input[placeholder*="Player Number"]', TEST_DATA.player1.number);
    console.log('  ✓ Form filled');
    
    // Select preferred position (GK)
    const gkCheckbox = page.locator('.checkbox-label').filter({ hasText: 'GK -' }).locator('input[type="checkbox"]');
    await gkCheckbox.check();
    await page.waitForTimeout(UI_TIMING.QUICK);
    console.log('  ✓ Preferred position selected');
    
    // Submit
    await clickButton(page, 'Add');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Verify player was created
    const player1Card = page.locator('.item-card').filter({ hasText: TEST_DATA.player1.firstName });
    await expect(player1Card).toBeVisible();
    console.log('  ✓ Player 1 created\n');
    
    // ===== CREATE: Create second player with multiple positions =====
    console.log('Step 8: CREATE - Create second player with multiple positions');
    await clickButton(page, '+ Add Player');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    await page.selectOption('select', { label: TEST_DATA.team1.name });
    await page.waitForTimeout(UI_TIMING.STANDARD);
    await fillInput(page, 'input[placeholder*="First Name"]', TEST_DATA.player2.firstName);
    await fillInput(page, 'input[placeholder*="Last Name"]', TEST_DATA.player2.lastName);
    await fillInput(page, 'input[placeholder*="Player Number"]', TEST_DATA.player2.number);
    
    // Select two preferred positions (DF and MF)
    const dfCheckbox = page.locator('.checkbox-label').filter({ hasText: 'DF -' }).locator('input[type="checkbox"]');
    await dfCheckbox.check();
    await page.waitForTimeout(UI_TIMING.QUICK);
    
    const mfCheckbox = page.locator('.checkbox-label').filter({ hasText: 'MF -' }).locator('input[type="checkbox"]');
    await mfCheckbox.check();
    await page.waitForTimeout(UI_TIMING.QUICK);
    
    await clickButton(page, 'Add');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    const player2Card = page.locator('.item-card').filter({ hasText: TEST_DATA.player2.firstName });
    await expect(player2Card).toBeVisible();
    console.log('  ✓ Player 2 created\n');
    
    // ===== CREATE: Create third player without positions =====
    console.log('Step 9: CREATE - Create third player without preferred positions');
    await clickButton(page, '+ Add Player');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    await page.selectOption('select', { label: TEST_DATA.team2.name });
    await page.waitForTimeout(UI_TIMING.STANDARD);
    await fillInput(page, 'input[placeholder*="First Name"]', TEST_DATA.player3.firstName);
    await fillInput(page, 'input[placeholder*="Last Name"]', TEST_DATA.player3.lastName);
    await fillInput(page, 'input[placeholder*="Player Number"]', TEST_DATA.player3.number);
    
    await clickButton(page, 'Add');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    const player3Card = page.locator('.item-card').filter({ hasText: TEST_DATA.player3.firstName });
    await expect(player3Card).toBeVisible();
    console.log('  ✓ Player 3 created\n');
    
    // ===== READ: Verify all players are listed =====
    console.log('Step 10: READ - Verify players list');
    const playerCards = page.locator('.item-card');
    const playerCount = await playerCards.count();
    expect(playerCount).toBe(3);
    console.log(`  ✓ Found ${playerCount} players`);
    
    // Verify player 1 details
    await expect(player1Card.locator('h3')).toContainText(`#${TEST_DATA.player1.number}`);
    await expect(player1Card.locator('h3')).toContainText(TEST_DATA.player1.firstName);
    await expect(player1Card.locator('h3')).toContainText(TEST_DATA.player1.lastName);
    await expect(player1Card.locator('.item-meta')).toContainText(TEST_DATA.team1.name);
    await expect(player1Card.locator('.item-meta')).toContainText('Preferred: GK');
    console.log('  ✓ Player 1 details verified');
    
    // Verify player 2 details
    await expect(player2Card.locator('h3')).toContainText(`#${TEST_DATA.player2.number}`);
    await expect(player2Card.locator('.item-meta')).toContainText(TEST_DATA.team1.name);
    await expect(player2Card.locator('.item-meta')).toContainText('Preferred: DF, MF');
    console.log('  ✓ Player 2 details verified');
    
    // Verify player 3 details
    await expect(player3Card.locator('h3')).toContainText(`#${TEST_DATA.player3.number}`);
    await expect(player3Card.locator('.item-meta')).toContainText(TEST_DATA.team2.name);
    // Should not have "Preferred:" text since no positions selected
    const player3Meta = await player3Card.locator('.item-meta').textContent();
    expect(player3Meta).not.toContain('Preferred:');
    console.log('  ✓ Player 3 details verified\n');
    
    // ===== UPDATE: Verify data persistence =====
    console.log('Step 11: UPDATE - Verify data persistence');
    // Note: Current implementation doesn't have edit/update UI
    
    // Reload page to verify data persistence
    await page.reload();
    await waitForPageLoad(page);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Players');
    await page.waitForTimeout(UI_TIMING.NAVIGATION);
    
    // Verify all players still exist after reload
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.player1.firstName })).toBeVisible();
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.player2.firstName })).toBeVisible();
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.player3.firstName })).toBeVisible();
    console.log('  ✓ Players persist after reload');
    console.log('  ℹ Note: Player update UI not available, only create/delete\n');
    
    // ===== DELETE: Delete player 2 =====
    console.log('Step 12: DELETE - Delete player 2');
    
    // Set up dialog handler
    const cleanupDialog = handleConfirmDialog(page);
    
    const player2DeleteBtn = page.locator('.item-card')
      .filter({ hasText: TEST_DATA.player2.firstName })
      .locator('.btn-delete');
    await player2DeleteBtn.click();
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    
    // Verify player 2 is deleted
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.player2.firstName })).not.toBeVisible();
    console.log('  ✓ Player 2 deleted');
    
    // Verify other players still exist
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.player1.firstName })).toBeVisible();
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.player3.firstName })).toBeVisible();
    console.log('  ✓ Other players still exist');
    
    const remainingPlayers = await page.locator('.item-card').count();
    expect(remainingPlayers).toBe(2);
    console.log(`  ✓ Player count: ${remainingPlayers}\n`);
    
    // ===== DELETE: Delete remaining players =====
    console.log('Step 13: DELETE - Delete remaining players');
    
    // Dialog handler still active
    const player1DeleteBtn = page.locator('.item-card')
      .filter({ hasText: TEST_DATA.player1.firstName })
      .locator('.btn-delete');
    await player1DeleteBtn.click();
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    
    const player3DeleteBtn = page.locator('.item-card')
      .filter({ hasText: TEST_DATA.player3.firstName })
      .locator('.btn-delete');
    await player3DeleteBtn.click();
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    
    // Verify empty state returns
    await expect(page.locator('.empty-message')).toBeVisible();
    await expect(page.locator('.empty-message')).toContainText('No players yet');
    console.log('  ✓ All players deleted');
    console.log('  ✓ Empty state visible again');
    
    // Clean up dialog handler
    cleanupDialog();
    page.removeAllListeners('dialog');
    
    console.log('\n=== Player CRUD Test Completed Successfully ===\n');
  });

  test('should validate player creation form', async ({ page }) => {
    console.log('\n=== Testing Player Form Validation ===\n');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await cleanupTestData(page);
    await createSeason(page, TEST_DATA.season);
    await createTeam(page, TEST_DATA.team1, TEST_DATA.season);
    
    await clickManagementTab(page, 'Players');
    await clickButton(page, '+ Add Player');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Try to submit empty form
    console.log('Testing empty form submission...');
    await clickButton(page, 'Add');
    await page.waitForTimeout(UI_TIMING.NAVIGATION);
    
    // Form should still be visible (not closed)
    await expect(page.locator('.create-form')).toBeVisible();
    console.log('✓ Empty form blocked\n');
    
    // Try with team selected but missing required fields
    console.log('Testing partial form submission...');
    await page.selectOption('select', { label: TEST_DATA.team1.name });
    await page.waitForTimeout(UI_TIMING.STANDARD);
    await fillInput(page, 'input[placeholder*="First Name"]', 'Test');
    
    await clickButton(page, 'Add');
    await page.waitForTimeout(UI_TIMING.NAVIGATION);
    
    // Form should still be visible
    await expect(page.locator('.create-form')).toBeVisible();
    console.log('✓ Partial form blocked\n');
    
    // Test cancel button
    console.log('Testing cancel button...');
    await clickButton(page, 'Cancel');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Form should be hidden
    await expect(page.locator('.create-form')).not.toBeVisible();
    console.log('✓ Cancel button works\n');
    
    console.log('=== Form Validation Test Complete ===\n');
  });

  test('should show positions only for selected team', async ({ page }) => {
    console.log('\n=== Testing Team-Specific Position Display ===\n');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await cleanupTestData(page);
    await createSeason(page, TEST_DATA.season);
    await createTeam(page, TEST_DATA.team1, TEST_DATA.season);
    await createTeam(page, TEST_DATA.team2, TEST_DATA.season);
    await createPositionsForTeam(page, TEST_DATA.team1.name);
    
    await clickManagementTab(page, 'Players');
    await clickButton(page, '+ Add Player');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Select team1 (has positions)
    console.log('Testing team with positions...');
    await page.selectOption('select', { label: TEST_DATA.team1.name });
    await page.waitForTimeout(UI_TIMING.NAVIGATION);
    
    // Should show position checkboxes
    await expect(page.locator('.checkbox-group')).toBeVisible();
    const positionCheckboxes = page.locator('.checkbox-label');
    const positionCount = await positionCheckboxes.count();
    expect(positionCount).toBe(TEST_DATA.positions.length);
    console.log(`✓ Shows ${positionCount} positions for team with positions\n`);
    
    // Select team2 (no positions)
    console.log('Testing team without positions...');
    await page.selectOption('select', { label: TEST_DATA.team2.name });
    await page.waitForTimeout(UI_TIMING.NAVIGATION);
    
    // Should show empty state message
    await expect(page.locator('.empty-state').filter({ hasText: 'No positions defined' })).toBeVisible();
    await expect(page.locator('.checkbox-group')).not.toBeVisible();
    console.log('✓ Shows empty state for team without positions\n');
    
    console.log('=== Position Display Test Complete ===\n');
  });

  test('should handle player deletion with confirmation', async ({ page }) => {
    console.log('\n=== Testing Player Deletion Confirmation ===\n');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await cleanupTestData(page);
    await createSeason(page, TEST_DATA.season);
    await createTeam(page, TEST_DATA.team1, TEST_DATA.season);
    
    // Create a test player
    await clickManagementTab(page, 'Players');
    await clickButton(page, '+ Add Player');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Verify form is open
    await expect(page.locator('.create-form')).toBeVisible();
    
    // Check what teams are available
    const teamOptions = await page.locator('select option').allTextContents();
    console.log('Available team options:', teamOptions);
    
    // Set up dialog listener to catch any alerts
    let alertMessage = '';
    page.on('dialog', async (dialog) => {
      alertMessage = dialog.message();
      console.log('Alert appeared:', alertMessage);
      await dialog.accept();
    });
    
    // Select team by value instead of label to be more reliable
    const teamSelect = page.locator('select');
    await teamSelect.selectOption({ label: TEST_DATA.team1.name });
    await page.waitForTimeout(UI_TIMING.NAVIGATION);
    
    // Verify team was selected
    const selectedValue = await teamSelect.inputValue();
    console.log('Selected team value:', selectedValue);
    
    await fillInput(page, 'input[placeholder*="First Name"]', 'Delete');
    await fillInput(page, 'input[placeholder*="Last Name"]', 'Test');
    await fillInput(page, 'input[placeholder*="Player Number"]', '99');
    
    console.log('Submitting player form...');
    await clickButton(page, 'Add');
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    
    if (alertMessage) {
      console.log('Form submission failed with alert:', alertMessage);
    }
    
    // Check if form is still visible (which means submission failed)
    const formStillVisible = await page.locator('.create-form').isVisible();
    if (formStillVisible) {
      console.log('Form still visible after submission - submission may have failed');
      // Take a screenshot for debugging
      await page.screenshot({ path: 'test-results/player-form-error.png' });
    }
    
    // Wait for form to close after submission
    await expect(page.locator('.create-form')).not.toBeVisible({ timeout: 3000 });
    
    // Wait for player to appear in list
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    
    // Debug: Log all player cards visible
    const allPlayerCards = await page.locator('.item-card h3').allTextContents();
    console.log('All player cards visible:', allPlayerCards);
    
    // Verify player exists
    await expect(page.locator('.item-card').filter({ hasText: 'Delete Test' })).toBeVisible({ timeout: 5000 });
    console.log('✓ Test player created\n');
    
    // Test cancel on confirmation dialog
    console.log('Testing deletion cancellation...');
    let dialogShown = false;
    page.once('dialog', async (dialog) => {
      dialogShown = true;
      console.log(`  Dialog shown: ${dialog.message()}`);
      await dialog.dismiss(); // Cancel deletion
    });
    
    const deleteBtn = page.locator('.item-card')
      .filter({ hasText: 'Delete Test' })
      .locator('.btn-delete');
    await deleteBtn.click();
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    expect(dialogShown).toBe(true);
    
    // Player should still exist after canceling
    await expect(page.locator('.item-card').filter({ hasText: 'Delete Test' })).toBeVisible();
    console.log('✓ Deletion canceled, player still exists\n');
    
    // Test confirm deletion
    console.log('Testing deletion confirmation...');
    page.once('dialog', async (dialog) => {
      console.log(`  Confirming: ${dialog.message()}`);
      await dialog.accept();
    });
    
    await deleteBtn.click();
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    
    // Player should be deleted
    await expect(page.locator('.item-card').filter({ hasText: 'Delete Test' })).not.toBeVisible();
    console.log('✓ Player deleted after confirmation\n');
    
    console.log('=== Deletion Confirmation Test Complete ===\n');
  });
});



