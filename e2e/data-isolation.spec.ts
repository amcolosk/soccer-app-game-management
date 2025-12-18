import { test, expect, Page } from '@playwright/test';
import {
  waitForPageLoad,
  fillInput,
  clickButton,
  clickButtonByText,
  loginUser,
  closePWAPrompt,
  navigateToManagement,
  clickManagementTab,
  UI_TIMING,
} from './helpers';
import { TEST_USERS, TEST_CONFIG } from '../test-config';

/**
 * Data Isolation Test Suite
 * Verifies that data created by one user is not visible to another user
 */

const TEST_TEAM_NAME = 'Private Team FC';

// Helper to logout
async function logout(page: Page) {
  // Navigate to profile tab
  const profileTab = page.getByRole('button', { name: /profile/i });
  if (await profileTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await profileTab.click();
    await page.waitForTimeout(500);
  }
  
  // Look for sign out button
  const signOutButton = page.getByRole('button', { name: /sign out/i });
  if (await signOutButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await signOutButton.click();
    await waitForPageLoad(page);
  }
}

test.describe.serial('Data Isolation Between Users', () => {
  test('User 1 creates a team', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.medium);
    
    console.log('\n=== User 1: Creating Team ===');
    
    // Login as User 1
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    console.log('✓ User 1 logged in');
    
    // Navigate to Management tab
    await navigateToManagement(page);
    await clickManagementTab(page, 'Teams');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Create a team
    await clickButton(page, '+ Create New Team');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    await fillInput(page, 'input[placeholder*="team name"]', TEST_TEAM_NAME);
    await fillInput(page, 'input[placeholder*="max players"]', '7');
    await fillInput(page, 'input[placeholder*="half length"]', '25');
    
    await clickButton(page, 'Create');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Verify team was created
    await expect(page.locator('.item-card').filter({ hasText: TEST_TEAM_NAME })).toBeVisible();
    console.log(`✓ User 1 created team: ${TEST_TEAM_NAME}`);
    
    // Logout
    await logout(page);
    console.log('✓ User 1 logged out\n');
  });
  
  test('User 2 cannot see User 1\'s team', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.medium);
    
    console.log('=== User 2: Verifying Data Isolation ===');
    
    // Login as User 2
    await loginUser(page, TEST_USERS.user2.email, TEST_USERS.user2.password);
    console.log('✓ User 2 logged in');
    
    // Navigate to Management tab
    await navigateToManagement(page);
    await clickManagementTab(page, 'Teams');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Verify User 1's team is NOT visible
    const teamCard = page.locator('.item-card').filter({ hasText: TEST_TEAM_NAME });
    const isVisible = await teamCard.isVisible({ timeout: 2000 }).catch(() => false);
    
    expect(isVisible).toBe(false);
    console.log(`✓ User 2 cannot see "${TEST_TEAM_NAME}"`);
    
    // Verify User 2 sees empty state or their own teams only
    const createButton = page.getByRole('button', { name: '+ Create New Team' });
    await expect(createButton).toBeVisible();
    console.log('✓ User 2 sees their own empty team list');
    
    console.log('✓ Data isolation verified\n');
  });
});
