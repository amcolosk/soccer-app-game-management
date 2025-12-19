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
  createTeam,
  handleConfirmDialog,
  swipeToDelete,
  UI_TIMING,
} from './helpers';
import { TEST_USERS, TEST_CONFIG } from '../test-config';

/**
 * Player Management CRUD Test Suite
 * Tests Create, Read, Update, and Delete operations for players in the Management tab
 */

// Test data
const TEST_DATA = {
  team1: {
    name: 'Thunder FC U10',
    maxPlayers: '7',
    halfLength: '25',
  },
  player1: {
    firstName: 'Alice',
    lastName: 'Anderson',
  },
  player2: {
    firstName: 'Bob',
    lastName: 'Brown',
  },
  player3: {
    firstName: 'Charlie',
    lastName: 'Clark',
  },
};

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
    
    // Create test team (for roster assignment later)
    console.log('Step 4: Create test team');
    await createTeam(page, TEST_DATA.team1);
    console.log('');
    
    // ===== CREATE: Create first player =====
    console.log('Step 5: CREATE - Create first player');
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
    
    // Fill in player details (only first and last name now)
    await fillInput(page, 'input[placeholder*="First Name"]', TEST_DATA.player1.firstName);
    await fillInput(page, 'input[placeholder*="Last Name"]', TEST_DATA.player1.lastName);
    console.log('  ✓ Form filled');
    
    // Submit
    await clickButton(page, 'Add');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Verify player was created
    const player1Card = page.locator('.item-card').filter({ hasText: TEST_DATA.player1.firstName });
    await expect(player1Card).toBeVisible();
    await expect(player1Card).toContainText('Not assigned to any team');
    console.log('  ✓ Player 1 created\n');
    
    // ===== CREATE: Create second player =====
    console.log('Step 6: CREATE - Create second player');
    await clickButton(page, '+ Add Player');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    await fillInput(page, 'input[placeholder*="First Name"]', TEST_DATA.player2.firstName);
    await fillInput(page, 'input[placeholder*="Last Name"]', TEST_DATA.player2.lastName);
    
    await clickButton(page, 'Add');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    const player2Card = page.locator('.item-card').filter({ hasText: TEST_DATA.player2.firstName });
    await expect(player2Card).toBeVisible();
    console.log('  ✓ Player 2 created\n');
    
    // ===== CREATE: Create third player =====
    console.log('Step 7: CREATE - Create third player');
    await clickButton(page, '+ Add Player');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    await fillInput(page, 'input[placeholder*="First Name"]', TEST_DATA.player3.firstName);
    await fillInput(page, 'input[placeholder*="Last Name"]', TEST_DATA.player3.lastName);
    
    await clickButton(page, 'Add');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    const player3Card = page.locator('.item-card').filter({ hasText: TEST_DATA.player3.firstName });
    await expect(player3Card).toBeVisible();
    console.log('  ✓ Player 3 created\n');
    
    // ===== READ: Verify all players are listed =====
    console.log('Step 8: READ - Verify players list');
    const playerCards = page.locator('.item-card');
    const playerCount = await playerCards.count();
    expect(playerCount).toBe(3);
    console.log(`  ✓ Found ${playerCount} players`);
    
    // Verify player 1 details
    await expect(player1Card.locator('h3')).toContainText(TEST_DATA.player1.firstName);
    await expect(player1Card.locator('h3')).toContainText(TEST_DATA.player1.lastName);
    console.log('  ✓ Player 1 details verified');
    
    // Verify player 2 details
    await expect(player2Card.locator('h3')).toContainText(TEST_DATA.player2.firstName);
    await expect(player2Card.locator('h3')).toContainText(TEST_DATA.player2.lastName);
    console.log('  ✓ Player 2 details verified');
    
    // Verify player 3 details
    await expect(player3Card.locator('h3')).toContainText(TEST_DATA.player3.firstName);
    await expect(player3Card.locator('h3')).toContainText(TEST_DATA.player3.lastName);
    console.log('  ✓ Player 3 details verified\n');
    
    // ===== DATA PERSISTENCE: Verify after reload =====
    console.log('Step 9: Verify data persistence');
    await page.reload();
    await waitForPageLoad(page);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Players');
    await page.waitForTimeout(UI_TIMING.NAVIGATION);
    
    // Verify all players still exist after reload
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.player1.firstName })).toBeVisible();
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.player2.firstName })).toBeVisible();
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.player3.firstName })).toBeVisible();
    console.log('  ✓ Players persist after reload\n');
    
    // ===== DELETE: Delete player 2 =====
    console.log('Step 10: DELETE - Delete player 2');
    
    // Set up dialog handler
    const cleanupDialog = handleConfirmDialog(page);
    
    // Swipe to delete player 2
    await swipeToDelete(page, '.item-card:has-text("' + TEST_DATA.player2.firstName + '")');
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
    // Swipe to delete player 1
    await swipeToDelete(page, '.item-card:has-text("' + TEST_DATA.player1.firstName + '")');
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    
    // Swipe to delete player 3
    await swipeToDelete(page, '.item-card:has-text("' + TEST_DATA.player3.firstName + '")');
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
    
    // Try with only first name
    console.log('Testing partial form submission (first name only)...');
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

  test('should handle player deletion with confirmation', async ({ page }) => {
    console.log('\n=== Testing Player Deletion Confirmation ===\n');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await cleanupTestData(page);
    
    // Create a test player
    await clickManagementTab(page, 'Players');
    await clickButton(page, '+ Add Player');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    await fillInput(page, 'input[placeholder*="First Name"]', 'Delete');
    await fillInput(page, 'input[placeholder*="Last Name"]', 'Test');
    
    await clickButton(page, 'Add');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Verify player exists
    await expect(page.locator('.item-card').filter({ hasText: 'Delete Test' })).toBeVisible();
    console.log('✓ Test player created\n');
    
    // Test cancel on confirmation dialog
    console.log('Testing deletion cancellation...');
    let dialogShown = false;
    page.once('dialog', async (dialog) => {
      dialogShown = true;
      console.log(`  Dialog shown: ${dialog.message()}`);
      await dialog.dismiss(); // Cancel deletion
    });
    
    // Swipe to delete the player
    await swipeToDelete(page, '.item-card:has-text("Delete Test")');
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
    
    // Swipe to delete the player
    await swipeToDelete(page, '.item-card:has-text("Delete Test")');
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    
    // Player should be deleted
    await expect(page.locator('.item-card').filter({ hasText: 'Delete Test' })).not.toBeVisible();
    console.log('✓ Player deleted after confirmation\n');
    
    console.log('=== Deletion Confirmation Test Complete ===\n');
  });
});



