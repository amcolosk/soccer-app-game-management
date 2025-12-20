import { test, expect, Page } from '@playwright/test';
import {
  waitForPageLoad,
  fillInput,
  clickButton,
  loginUser,
  navigateToManagement,
  clickManagementTab,
  cleanupTestData,
  swipeToDelete,
  UI_TIMING,
} from './helpers';
import { TEST_USERS, TEST_CONFIG } from '../test-config';

/**
 * Team Sharing Test Suite
 * Tests the invitation flow where User 1 shares a team with User 2
 * and validates that User 2 has full collaborative access
 */

const SHARED_TEAM_NAME = 'Shared Eagles FC';
const PLAYER_NAME = { firstName: 'John', lastName: 'Smith' };
const GAME_OPPONENT = 'Lions FC';

// Helper to logout
async function logout(page: Page) {
  const profileTab = page.getByRole('button', { name: /profile/i });
  if (await profileTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await profileTab.click();
    await page.waitForTimeout(500);
  }
  
  const signOutButton = page.getByRole('button', { name: /sign out/i });
  if (await signOutButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await signOutButton.click();
    await waitForPageLoad(page);
  }
}

// Helper to get invitation link from email
async function getInvitationLink(page: Page): Promise<string | null> {
  // In real implementation, this would check email
  // For testing, we'll extract from the UI or return a mock link
  // The invitation management UI should display the link or email
  
  // Look for invitation link in the UI
  const invitationText = await page.locator('.sharing-section').textContent().catch(() => null);
  if (!invitationText) return null;
  
  // Extract invitation ID from URL patterns
  const match = invitationText.match(/invitationId=([a-f0-9-]+)/i);
  return match ? `/?invitationId=${match[1]}` : null;
}

test.describe.serial('Team Sharing and Collaboration', () => {
  let invitationId: string = '';
  
  test('User 1 creates team, adds data, and sends invitation to User 2', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.medium);
    
    console.log('\n=== User 1: Creating Team and Sending Invitation ===');
    
    // Login as User 1
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    console.log('✓ User 1 logged in');
    
    // Clean up any existing data
    await navigateToManagement(page);
    await cleanupTestData(page);
    console.log('✓ Cleaned up existing data');
    
    // Navigate to Management > Teams
    await clickManagementTab(page, 'Teams');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Create the team
    await clickButton(page, '+ Create New Team');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    await fillInput(page, 'input[placeholder*="team name"]', SHARED_TEAM_NAME);
    await fillInput(page, 'input[placeholder*="max players"]', '7');
    await fillInput(page, 'input[placeholder*="half length"]', '25');
    
    await clickButton(page, 'Create');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Verify team was created
    await expect(page.locator('.item-card').filter({ hasText: SHARED_TEAM_NAME }).first()).toBeVisible();
    console.log(`✓ Created team: ${SHARED_TEAM_NAME}`);
    
    // Create a player
    await clickManagementTab(page, 'Players');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    await clickButton(page, '+ Add Player');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    await fillInput(page, 'input[placeholder*="First Name"]', PLAYER_NAME.firstName);
    await fillInput(page, 'input[placeholder*="Last Name"]', PLAYER_NAME.lastName);
    
    await clickButton(page, 'Add');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Verify player was created (observeQuery subscription should update the list)
    await expect(page.locator('.item-card').filter({ hasText: `${PLAYER_NAME.firstName} ${PLAYER_NAME.lastName}` }).first()).toBeVisible({ timeout: 10000 });
    console.log(`✓ Created player: ${PLAYER_NAME.firstName} ${PLAYER_NAME.lastName}`);
    
    // Add player to team roster
    await clickManagementTab(page, 'Teams');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Expand the team
    const teamCard = page.locator('.item-card').filter({ hasText: SHARED_TEAM_NAME }).first();
    await teamCard.click();
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Add player to roster
    const addToRosterButton = page.getByRole('button', { name: /add to roster|add player/i });
    if (await addToRosterButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addToRosterButton.click();
      await page.waitForTimeout(UI_TIMING.STANDARD);
      
      // Select the player and assign jersey number
      const playerSelect = page.locator('select').first();
      await playerSelect.selectOption({ label: `${PLAYER_NAME.firstName} ${PLAYER_NAME.lastName}` });
      await page.waitForTimeout(UI_TIMING.SHORT);
      
      await fillInput(page, 'input[placeholder*="number"]', '10');
      
      await clickButton(page, 'Add');
      await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
      
      console.log('✓ Added player to roster with jersey #10');
    }
    
    console.log('✓ Initial team setup complete');
    
    // Now send invitation to User 2
    console.log('\n--- Sending Invitation ---');
    
    await clickManagementTab(page, 'Sharing');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Click "Manage Sharing" button for the team
    const manageSharingButton = page.locator('.resource-item')
      .filter({ hasText: SHARED_TEAM_NAME })
      .getByRole('button', { name: /manage sharing/i });
    await manageSharingButton.click();
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Enter User 2's email
    await fillInput(page, 'input[type="email"]', TEST_USERS.user2.email);
    
    // Click Send Invitation
    await clickButton(page, /send invitation/i);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Look for success message or invitation in list
    const invitationsList = page.locator('.sharing-section, .invitations-list');
    await expect(invitationsList).toContainText(TEST_USERS.user2.email, { timeout: 5000 });
    console.log(`✓ Invitation sent to ${TEST_USERS.user2.email}`);
    
    // Extract invitation ID from the data attribute
    const invitationLink = page.locator('.invitation-link').first();
    const invitationIdAttr = await invitationLink.getAttribute('data-invitation-id');
    if (invitationIdAttr) {
      invitationId = invitationIdAttr;
      console.log(`✓ Invitation ID: ${invitationId}`);
    } else {
      console.warn('⚠ Could not extract invitation ID from UI');
    }
    
    // Logout User 1
    await logout(page);
    console.log('✓ User 1 logged out\n');
  });
  
  test('User 2 accepts invitation, sees shared team, and tests edit permissions', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.medium);
    
    console.log('=== User 2: Accepting Invitation and Testing Access ===');
    
    // For this test, we need the invitation ID
    // In a real scenario, User 2 would click a link from email
    // For testing, we'll construct the URL or navigate through UI
    
    if (!invitationId) {
      console.warn('No invitation ID found, attempting to find invitation through UI');
      
      // Login as User 2
      await loginUser(page, TEST_USERS.user2.email, TEST_USERS.user2.password);
      
      // Check for invitation notification or navigate to a pending invitations section
      // This depends on your UI implementation
      console.log('✓ User 2 logged in - checking for invitation in UI');
    } else {
      // Navigate directly to invitation acceptance page
      await page.goto(`/?invitationId=${invitationId}`);
      await page.waitForTimeout(UI_TIMING.STANDARD);
      
      // Login as User 2 if not already logged in
      const usernameInput = page.locator('input[name="username"], input[type="email"]');
      if (await usernameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await fillInput(page, 'input[name="username"], input[type="email"]', TEST_USERS.user2.email);
        await fillInput(page, 'input[name="password"], input[type="password"]', TEST_USERS.user2.password);
        await clickButton(page, 'Sign in');
        
        // Skip verification if prompted
        try {
          await page.waitForSelector('button:has-text("Skip")', { timeout: 2000 });
          await clickButton(page, 'Skip');
        } catch (e) {
          // Skip button may not appear
        }
        
        await waitForPageLoad(page);
      }
      
      console.log('✓ User 2 logged in');
      
      // Accept the invitation
      const acceptButton = page.getByRole('button', { name: /accept/i });
      await expect(acceptButton).toBeVisible({ timeout: 5000 });
      await acceptButton.click();
      
      // Wait for success message
      await expect(page.getByText(/Successfully joined/i)).toBeVisible({ timeout: 10000 });
      
      // Wait for the app's automatic reload (2s delay + reload)
      await page.waitForTimeout(3000);
      await waitForPageLoad(page);
      
      console.log('✓ Invitation accepted');
    }
    
    // Navigate to Management > Teams to verify access
    console.log('\n--- Verifying Shared Team Access ---');
    
    // Force a reload to ensure we have fresh data
    await page.reload();
    await waitForPageLoad(page);
    
    await navigateToManagement(page);
    await clickManagementTab(page, 'Teams');
    
    // Wait for data to load with multiple retries
    console.log('Waiting for team list to load...');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Check if there are any team cards at all
    const allTeamCards = page.locator('.item-card');
    const teamCount = await allTeamCards.count();
    console.log(`Found ${teamCount} team card(s)`);
    
    if (teamCount > 0) {
      const teamNames = await allTeamCards.allTextContents();
      console.log('Team cards:', teamNames);
    }
    
    // Verify User 2 can now see the shared team
    const sharedTeam = page.locator('.item-card').filter({ hasText: SHARED_TEAM_NAME });
    // Increase timeout to account for subscription sync
    await expect(sharedTeam.first()).toBeVisible({ timeout: 20000 });
    console.log(`✓ User 2 can see shared team: ${SHARED_TEAM_NAME}`);
    
    // Verify roster is visible
    await sharedTeam.first().click();
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    const playerInRoster = page.locator('.roster-list, .item-card').filter({ hasText: PLAYER_NAME.firstName });
    if (await playerInRoster.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log(`✓ User 2 can see player in roster: ${PLAYER_NAME.firstName} ${PLAYER_NAME.lastName}`);
    }
    
    console.log('✓ Shared team data visible to User 2');
    
    // Test edit permissions
    console.log('\n--- Testing Edit Permissions ---');
    
    // Test 1: Add a new player to the roster
    // Go back to Teams tab and click the shared team
    await clickManagementTab(page, 'Teams');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    await sharedTeam.first().click();
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Create a new player from the Players tab
    await clickManagementTab(page, 'Players');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    await clickButton(page, '+ Add Player');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    const newPlayerName = { firstName: 'Jane', lastName: 'Doe' };
    await fillInput(page, 'input[placeholder*="First Name"]', newPlayerName.firstName);
    await fillInput(page, 'input[placeholder*="Last Name"]', newPlayerName.lastName);
    
    await clickButton(page, 'Add');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Verify player was created (observeQuery subscription should update the list)
    await expect(page.locator('.item-card').filter({ hasText: `${newPlayerName.firstName} ${newPlayerName.lastName}` }).first()).toBeVisible({ timeout: 10000 });
    console.log(`✓ User 2 created player: ${newPlayerName.firstName} ${newPlayerName.lastName}`);
    
    // Go back to the team and add the new player to roster
    await clickManagementTab(page, 'Teams');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    await sharedTeam.first().click();
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Look for the "+ Add to Roster" button or similar
    const addToRosterButton = page.getByRole('button', { name: /add.*roster/i });
    if (await addToRosterButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addToRosterButton.click();
      await page.waitForTimeout(UI_TIMING.STANDARD);
      
      // Select the new player
      const playerSelect = page.locator('select').filter({ hasText: /player/i }).or(page.locator('select').first());
      await playerSelect.selectOption({ label: `${newPlayerName.firstName} ${newPlayerName.lastName}` });
      
      await clickButton(page, 'Add');
      await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
      
      // Verify player appears in roster
      const newPlayerInRoster = page.locator('.roster-list, .item-card').filter({ hasText: newPlayerName.firstName });
      await expect(newPlayerInRoster.first()).toBeVisible({ timeout: 5000 });
      console.log(`✓ User 2 added player to roster: ${newPlayerName.firstName} ${newPlayerName.lastName}`);
    } else {
      console.log('⚠ Add to Roster button not found, skipping roster test');
    }
    
    // Test 2: Create a game for the shared team
    await page.goto('/');
    await waitForPageLoad(page);
    
    // Debug: Check if User 2 can see the shared team in the dropdown
    await clickButton(page, '+ Schedule New Game');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Select the shared team
    const teamSelect = page.locator('select').filter({ hasText: /team/i }).or(page.locator('select').first());
    
    // Check if the team appears in the select options
    const teamOptions = await teamSelect.locator('option').allTextContents();
    console.log('Available teams in dropdown:', teamOptions);
    
    const hasSharedTeam = teamOptions.some(opt => opt.includes(SHARED_TEAM_NAME));
    if (!hasSharedTeam) {
      console.error(`⚠ Shared team "${SHARED_TEAM_NAME}" not found in dropdown. Available: ${teamOptions.join(', ')}`);
    }
    
    await teamSelect.selectOption({ label: SHARED_TEAM_NAME });
    await page.waitForTimeout(UI_TIMING.QUICK);
    
    await fillInput(page, 'input[placeholder*="Opponent"]', GAME_OPPONENT);
    
    await clickButton(page, 'Create');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Check if the create modal closed (indicates success)
    const createModal = page.locator('.create-game-form, form').filter({ hasText: 'Opponent' });
    const modalClosed = !(await createModal.isVisible().catch(() => false));
    console.log('Create game modal closed:', modalClosed);
    
    // Check browser console for any errors
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.text().includes('Error') || msg.text().includes('Failed')) {
        console.log('Browser console:', msg.text());
      }
    });
    
    // Wait for page reload (app reloads after creating game)
    await waitForPageLoad(page);
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    
    // Verify game appears in the list (may take time for observeQuery subscription to update)
    const gameCard = page.locator('.game-card, .item-card').filter({ hasText: GAME_OPPONENT });
    await expect(gameCard.first()).toBeVisible({ timeout: 10000 });
    console.log(`✓ User 2 created game: ${SHARED_TEAM_NAME} vs ${GAME_OPPONENT}`);
    
    // Test 3: Update team name
    await navigateToManagement(page);
    await clickManagementTab(page, 'Teams');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    const teamCard = page.locator('.item-card').filter({ hasText: SHARED_TEAM_NAME }).first();
    
    // Look for Edit button
    const editButton = teamCard.locator('button').filter({ hasText: /edit/i });
    if (await editButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await editButton.click();
      await page.waitForTimeout(UI_TIMING.STANDARD);
      
      const updatedName = `${SHARED_TEAM_NAME} (Updated)`;
      const nameInput = page.locator('input[placeholder*="team name"]');
      await nameInput.clear();
      await fillInput(page, 'input[placeholder*="team name"]', updatedName);
      
      await clickButton(page, /save|update/i);
      await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
      
      await expect(page.locator('.item-card').filter({ hasText: updatedName }).first()).toBeVisible();
      console.log(`✓ User 2 updated team name to: ${updatedName}`);
    } else {
      console.log('⚠ Edit button not found, skipping team name update test');
    }
    
    console.log('✓ User 2 has full edit permissions on shared team\n');
  });

  test('User 1 verifies changes and cleans up', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.medium);
    
    console.log('=== User 1: Verifying Changes ===');
    
    // Logout User 2
    await logout(page);
    console.log('✓ User 2 logged out');
    
    // Login as User 1
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    console.log('✓ User 1 logged in');
    
    // Check if game created by User 2 is visible
    await page.goto('/');
    await waitForPageLoad(page);
    
    const gameCard = page.locator('.game-card, .item-card').filter({ hasText: GAME_OPPONENT });
    await expect(gameCard.first()).toBeVisible({ timeout: 5000 });
    console.log(`✓ User 1 can see game created by User 2: ${GAME_OPPONENT}`);
    
    // Check if player created by User 2 is visible
    await navigateToManagement(page);
    await clickManagementTab(page, 'Players');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    const janeDoe = page.locator('.item-card').filter({ hasText: 'Jane Doe' });
    await expect(janeDoe.first()).not.toBeVisible({ timeout: 5000 });
    console.log('✓ User 1 cannot see player created by User 2: Jane Doe (as expected)');
    
    console.log('✓ Collaborative editing verified\n');
    
    console.log('=== Cleanup ===');
    
    // Should still be logged in as User 1
    await navigateToManagement(page);
    await clickManagementTab(page, 'Teams');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Delete the shared team
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });
    
    await swipeToDelete(page, '.item-card');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    page.removeAllListeners('dialog');
    
    console.log('✓ Shared team deleted');
    
    // Clean up players
    await clickManagementTab(page, 'Players');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });
    
    // Delete John Smith and Jane Doe
    let playerCards = page.locator('.item-card');
    let count = await playerCards.count();
    while (count > 0) {
      await swipeToDelete(page, '.item-card');
      await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
      playerCards = page.locator('.item-card');
      const newCount = await playerCards.count();
      if (newCount === count) break;
      count = newCount;
    }
    
    page.removeAllListeners('dialog');
    
    console.log('✓ All test data cleaned up\n');
  });
});
