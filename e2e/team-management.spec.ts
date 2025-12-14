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
    await createSeason(page, TEST_DATA.season);
    console.log('');
    
    // ===== CREATE: Create first team =====
    console.log('Step 5: CREATE - Create first team');
    await clickManagementTab(page, 'Teams');
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
    await fillInput(page, 'input[placeholder*="team name"]', TEST_DATA.team1.name);
    await fillInput(page, 'input[placeholder*="max players"]', TEST_DATA.team1.maxPlayers);
    await fillInput(page, 'input[placeholder*="half length"]', TEST_DATA.team1.halfLength);
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
    await fillInput(page, 'input[placeholder*="team name"]', TEST_DATA.team2.name);
    await fillInput(page, 'input[placeholder*="max players"]', TEST_DATA.team2.maxPlayers);
    await fillInput(page, 'input[placeholder*="half length"]', TEST_DATA.team2.halfLength);
    
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
    await clickManagementTab(page, 'Teams');
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
    await createSeason(page, TEST_DATA.season);
    
    await clickManagementTab(page, 'Teams');
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
    await createSeason(page, TEST_DATA.season);
    
    // Create a test team
    await clickManagementTab(page, 'Teams');
    await clickButton(page, '+ Create New Team');
    await page.waitForTimeout(300);
    
    const seasonLabel = `${TEST_DATA.season.name} (${TEST_DATA.season.year})`;
    await page.selectOption('select', { label: seasonLabel });
    await fillInput(page, 'input[placeholder*="team name"]', 'Test Team for Deletion');
    await fillInput(page, 'input[placeholder*="max players"]', '7');
    await fillInput(page, 'input[placeholder*="half length"]', '25');
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

  test('should assign a formation to a team at creation', async ({ page }) => {
    console.log('\n=== Testing Team Creation with Formation ===\n');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await cleanupTestData(page);
    
    // Create test season
    await createSeason(page, TEST_DATA.season);
    console.log('');
    
    // Create a test formation
    console.log('Step 1: Create a test formation');
    await clickManagementTab(page, 'Formations');
    await page.waitForTimeout(300);
    
    await clickButton(page, '+ Create Formation');
    await page.waitForTimeout(300);
    
    await fillInput(page, 'input[placeholder*="Formation Name"]', '4-3-3');
    await fillInput(page, 'input[placeholder*="Number of Players"]', '7');
    
    // Add a few positions
    const positions = [
      { name: 'Goalkeeper', abbreviation: 'GK' },
      { name: 'Defender', abbreviation: 'D' },
      { name: 'Midfielder', abbreviation: 'M' },
      { name: 'Forward', abbreviation: 'F' },
    ];
    
    for (const pos of positions) {
      await clickButton(page, '+ Add Position');
      await page.waitForTimeout(200);
      
      const positionRows = page.locator('.position-row');
      const lastRow = positionRows.last();
      await lastRow.locator('input[placeholder*="Position Name"]').fill(pos.name);
      await lastRow.locator('input[placeholder*="Abbreviation"]').fill(pos.abbreviation);
    }
    
    await clickButton(page, 'Create');
    await page.waitForTimeout(1000);
    
    await expect(page.locator('.item-card').filter({ hasText: '4-3-3' })).toBeVisible();
    console.log('✓ Formation created\n');
    
    // Create team with formation
    console.log('Step 2: Create team with formation assignment');
    await clickManagementTab(page, 'Teams');
    await page.waitForTimeout(300);
    
    await clickButton(page, '+ Create New Team');
    await page.waitForTimeout(300);
    
    // Select season (first select element)
    const seasonLabel = `${TEST_DATA.season.name} (${TEST_DATA.season.year})`;
    await page.locator('select').first().selectOption({ label: seasonLabel });
    await page.waitForTimeout(200);
    
    // Fill in team details
    await fillInput(page, 'input[placeholder*="team name"]', 'Formation Test Team');
    await fillInput(page, 'input[placeholder*="max players"]', '7');
    await fillInput(page, 'input[placeholder*="half length"]', '25');
    
    // Select formation (second select element)
    await page.locator('select').nth(1).selectOption({ label: '4-3-3 (7 players)' });
    await page.waitForTimeout(200);
    console.log('✓ Formation selected');
    
    // Submit
    await clickButton(page, 'Create');
    await page.waitForTimeout(1000);
    
    // Verify team was created with formation
    const teamCard = page.locator('.item-card').filter({ hasText: 'Formation Test Team' });
    await expect(teamCard).toBeVisible();
    await expect(teamCard.locator('.item-meta')).toContainText('Formation: 4-3-3');
    console.log('✓ Team created with formation assigned\n');
    
    // Verify formation is displayed in team details
    console.log('Step 3: Verify formation details in team card');
    await expect(teamCard.locator('h3')).toContainText('Formation Test Team');
    await expect(teamCard.locator('.item-meta')).toContainText('7 players');
    await expect(teamCard.locator('.item-meta')).toContainText('25 min halves');
    await expect(teamCard.locator('.item-meta')).toContainText('Formation: 4-3-3');
    console.log('✓ All team details verified\n');
    
    console.log('=== Team Creation with Formation Test Complete ===\n');
  });
});



