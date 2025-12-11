import { test, expect, Page } from '@playwright/test';
import {
  waitForPageLoad,
  fillInput,
  clickButton,
  closePWAPrompt,
  cleanupTestData,
} from './helpers';
import { TEST_USERS, TEST_CONFIG } from '../test-config';

/**
 * Team Management CRUD Test Suite
 * Tests Create, Read, Update, and Delete operations for teams in the Management tab
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
  teamUpdate: {
    name: 'Thunder FC U10 Updated',
    maxPlayers: '8',
    halfLength: '30',
  },
};

async function loginUser(page: Page, email: string, password: string) {
  await page.goto('/');
  await waitForPageLoad(page);
  
  // Wait for auth UI to load
  await page.waitForSelector('input[name="username"], input[type="email"]', { timeout: 10000 });
  
  // Enter credentials
  await fillInput(page, 'input[name="username"], input[type="email"]', email);
  await fillInput(page, 'input[name="password"], input[type="password"]', password);
  
  // Submit
  await clickButton(page, 'Sign in');

  // Click Skip Verification if it appears
  try {
    await page.waitForSelector('button:has-text("Skip")', { timeout: 2000 });
    await clickButton(page, 'Skip');
  } catch (e) {
    // Skip button may not appear if already verified
  }
  
  // Wait for successful login
  await waitForPageLoad(page);
  
  // Close PWA update/offline prompt if it appears
  await closePWAPrompt(page);
}

async function navigateToManagement(page: Page) {
  // Close PWA prompt if it's still showing
  await closePWAPrompt(page);
  
  // Click Manage tab in bottom navigation
  const manageTab = page.locator('button.nav-item', { hasText: 'Manage' });
  await manageTab.click();
  await waitForPageLoad(page);
  
  // Verify we're on the management page
  await expect(page.locator('.management')).toBeVisible();
}

async function clickTeamsTab(page: Page) {
  // Click Teams tab within Management
  const teamsTab = page.locator('button.management-tab', { hasText: /^Teams/ });
  await teamsTab.click();
  await page.waitForTimeout(300);
}

async function clickSeasonsTab(page: Page) {
  // Click Seasons tab within Management
  const seasonsTab = page.locator('button.management-tab', { hasText: /^Seasons/ });
  await seasonsTab.click();
  await page.waitForTimeout(300);
}

async function createTestSeason(page: Page) {
  console.log('Creating test season...');
  
  await clickSeasonsTab(page);
  
  // Click Create New Season button
  await clickButton(page, '+ Create New Season');
  await page.waitForTimeout(300);
  
  // Fill in season details
  await fillInput(page, 'input[placeholder*="Season Name"]', TEST_DATA.season.name);
  await fillInput(page, 'input[placeholder*="Year"]', TEST_DATA.season.year);
  
  // Submit
  await clickButton(page, 'Create');
  await page.waitForTimeout(500);
  
  // Verify season was created
  await expect(page.getByText(TEST_DATA.season.name).first()).toBeVisible();
  console.log('✓ Test season created');
}

test.describe('Team Management CRUD', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.long);
  });

  test('should perform complete CRUD operations on teams', async ({ page }) => {
    console.log('\n=== Starting Team CRUD Test ===\n');
    
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
    await createTestSeason(page);
    console.log('');
    
    // ===== CREATE: Create first team =====
    console.log('Step 5: CREATE - Create first team');
    await clickTeamsTab(page);
    await page.waitForTimeout(300);
    
    // Verify empty state
    await expect(page.locator('.empty-message')).toBeVisible();
    await expect(page.locator('.empty-message')).toContainText('No teams yet');
    console.log('  ✓ Empty state visible');
    
    // Click Create New Team button
    await clickButton(page, '+ Create New Team');
    await page.waitForTimeout(300);
    
    // Verify form is visible
    await expect(page.locator('.create-form')).toBeVisible();
    await expect(page.locator('h3:has-text("Create New Team")')).toBeVisible();
    console.log('  ✓ Create form visible');
    
    // Select season
    const seasonLabel = `${TEST_DATA.season.name} (${TEST_DATA.season.year})`;
    await page.selectOption('select', { label: seasonLabel });
    await page.waitForTimeout(200);
    
    // Fill in team details
    await fillInput(page, 'input[placeholder*="Team Name"]', TEST_DATA.team1.name);
    await fillInput(page, 'input[placeholder*="Max Players"]', TEST_DATA.team1.maxPlayers);
    await fillInput(page, 'input[placeholder*="Half Length"]', TEST_DATA.team1.halfLength);
    console.log('  ✓ Form filled');
    
    // Submit
    await clickButton(page, 'Create');
    await page.waitForTimeout(1000);
    
    // Verify team was created
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.team1.name })).toBeVisible();
    console.log('  ✓ Team created\n');
    
    // ===== CREATE: Create second team =====
    console.log('Step 6: CREATE - Create second team');
    await clickButton(page, '+ Create New Team');
    await page.waitForTimeout(300);
    
    await page.selectOption('select', { label: seasonLabel });
    await page.waitForTimeout(200);
    await fillInput(page, 'input[placeholder*="Team Name"]', TEST_DATA.team2.name);
    await fillInput(page, 'input[placeholder*="Max Players"]', TEST_DATA.team2.maxPlayers);
    await fillInput(page, 'input[placeholder*="Half Length"]', TEST_DATA.team2.halfLength);
    
    await clickButton(page, 'Create');
    await page.waitForTimeout(1000);
    
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.team2.name })).toBeVisible();
    console.log('  ✓ Second team created\n');
    
    // ===== READ: Verify both teams are listed =====
    console.log('Step 7: READ - Verify teams list');
    const teamCards = page.locator('.item-card');
    const teamCount = await teamCards.count();
    expect(teamCount).toBe(2);
    console.log(`  ✓ Found ${teamCount} teams`);
    
    // Verify first team details
    const team1Card = page.locator('.item-card').filter({ hasText: TEST_DATA.team1.name });
    await expect(team1Card.locator('h3')).toContainText(TEST_DATA.team1.name);
    await expect(team1Card.locator('.item-meta')).toContainText(`${TEST_DATA.team1.maxPlayers} players`);
    await expect(team1Card.locator('.item-meta')).toContainText(`${TEST_DATA.team1.halfLength} min halves`);
    await expect(team1Card.locator('.item-meta')).toContainText(TEST_DATA.season.name);
    console.log('  ✓ Team 1 details verified');
    
    // Verify second team details
    const team2Card = page.locator('.item-card').filter({ hasText: TEST_DATA.team2.name });
    await expect(team2Card.locator('h3')).toContainText(TEST_DATA.team2.name);
    await expect(team2Card.locator('.item-meta')).toContainText(`${TEST_DATA.team2.maxPlayers} players`);
    await expect(team2Card.locator('.item-meta')).toContainText(`${TEST_DATA.team2.halfLength} min halves`);
    console.log('  ✓ Team 2 details verified\n');
    
    // ===== UPDATE: Update first team (Note: Current implementation doesn't have edit, only delete) =====
    console.log('Step 8: UPDATE - Verify update capability');
    // Note: The current Management component doesn't have an edit/update feature for teams
    // Teams can only be created and deleted, not updated in the UI
    // We'll verify that the team data persists correctly after page reload
    
    // Reload page to verify data persistence
    await page.reload();
    await waitForPageLoad(page);
    await navigateToManagement(page);
    await clickTeamsTab(page);
    await page.waitForTimeout(500);
    
    // Verify teams still exist after reload
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.team1.name })).toBeVisible();
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.team2.name })).toBeVisible();
    console.log('  ✓ Teams persist after reload');
    console.log('  ℹ Note: Team update UI not available, only create/delete\n');
    
    // ===== DELETE: Delete second team =====
    console.log('Step 9: DELETE - Delete second team');
    
    // Set up dialog handler
    page.on('dialog', async (dialog) => {
      console.log(`  Confirming: ${dialog.message()}`);
      await dialog.accept();
    });
    
    // Click delete button on second team
    const team2DeleteBtn = page.locator('.item-card')
      .filter({ hasText: TEST_DATA.team2.name })
      .locator('.btn-delete');
    await team2DeleteBtn.click();
    await page.waitForTimeout(1500);
    
    // Verify second team is deleted
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.team2.name })).not.toBeVisible();
    console.log('  ✓ Team 2 deleted');
    
    // Verify first team still exists
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.team1.name })).toBeVisible();
    console.log('  ✓ Team 1 still exists');
    
    // Verify count is now 1
    const remainingTeams = await page.locator('.item-card').count();
    expect(remainingTeams).toBe(1);
    console.log(`  ✓ Team count: ${remainingTeams}\n`);
    
    // ===== DELETE: Delete first team =====
    console.log('Step 10: DELETE - Delete first team');
    
    const team1DeleteBtn = page.locator('.item-card')
      .filter({ hasText: TEST_DATA.team1.name })
      .locator('.btn-delete');
    await team1DeleteBtn.click();
    await page.waitForTimeout(1500);
    
    // Verify first team is deleted
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.team1.name })).not.toBeVisible();
    console.log('  ✓ Team 1 deleted');
    
    // Verify empty state returns
    await expect(page.locator('.empty-message')).toBeVisible();
    await expect(page.locator('.empty-message')).toContainText('No teams yet');
    console.log('  ✓ Empty state visible again');
    
    // Remove dialog handler
    page.removeAllListeners('dialog');
    
    console.log('\n=== Team CRUD Test Completed Successfully ===\n');
  });
  
  test('should validate team creation form', async ({ page }) => {
    console.log('\n=== Testing Team Form Validation ===\n');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await cleanupTestData(page);
    await createTestSeason(page);
    
    await clickTeamsTab(page);
    await clickButton(page, '+ Create New Team');
    await page.waitForTimeout(300);
    
    // Try to submit empty form
    console.log('Testing empty form submission...');
    await clickButton(page, 'Create');
    await page.waitForTimeout(500);
    
    // Should show alert (browser native alert)
    // Note: We can't easily test native alerts, but the form should not submit
    
    // Form should still be visible (not closed)
    await expect(page.locator('.create-form')).toBeVisible();
    console.log('✓ Empty form blocked\n');
    
    // Test cancel button
    console.log('Testing cancel button...');
    await clickButton(page, 'Cancel');
    await page.waitForTimeout(300);
    
    // Form should be hidden
    await expect(page.locator('.create-form')).not.toBeVisible();
    console.log('✓ Cancel button works\n');
    
    console.log('=== Form Validation Test Complete ===\n');
  });
  
  test('should handle team deletion with confirmation', async ({ page }) => {
    console.log('\n=== Testing Team Deletion Confirmation ===\n');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await cleanupTestData(page);
    await createTestSeason(page);
    
    // Create a test team
    await clickTeamsTab(page);
    await clickButton(page, '+ Create New Team');
    await page.waitForTimeout(300);
    
    const seasonLabel = `${TEST_DATA.season.name} (${TEST_DATA.season.year})`;
    await page.selectOption('select', { label: seasonLabel });
    await fillInput(page, 'input[placeholder*="Team Name"]', 'Test Team for Deletion');
    await fillInput(page, 'input[placeholder*="Max Players"]', '7');
    await fillInput(page, 'input[placeholder*="Half Length"]', '25');
    await clickButton(page, 'Create');
    await page.waitForTimeout(1000);
    
    // Verify team exists
    await expect(page.locator('.item-card').filter({ hasText: 'Test Team for Deletion' })).toBeVisible();
    console.log('✓ Test team created\n');
    
    // Test cancel on confirmation dialog
    console.log('Testing deletion cancellation...');
    let dialogShown = false;
    page.once('dialog', async (dialog) => {
      dialogShown = true;
      console.log(`  Dialog shown: ${dialog.message()}`);
      await dialog.dismiss(); // Cancel deletion
    });
    
    const deleteBtn = page.locator('.item-card')
      .filter({ hasText: 'Test Team for Deletion' })
      .locator('.btn-delete');
    await deleteBtn.click();
    await page.waitForTimeout(1000);
    
    expect(dialogShown).toBe(true);
    
    // Team should still exist after canceling
    await expect(page.locator('.item-card').filter({ hasText: 'Test Team for Deletion' })).toBeVisible();
    console.log('✓ Deletion canceled, team still exists\n');
    
    // Test confirm deletion
    console.log('Testing deletion confirmation...');
    page.once('dialog', async (dialog) => {
      console.log(`  Confirming: ${dialog.message()}`);
      await dialog.accept();
    });
    
    await deleteBtn.click();
    await page.waitForTimeout(1500);
    
    // Team should be deleted
    await expect(page.locator('.item-card').filter({ hasText: 'Test Team for Deletion' })).not.toBeVisible();
    console.log('✓ Team deleted after confirmation\n');
    
    console.log('=== Deletion Confirmation Test Complete ===\n');
  });
});
