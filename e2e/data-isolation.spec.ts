import { test, expect, Page } from '@playwright/test';
import {
  waitForPageLoad,
  fillInput,
  clickButton,
  clickButtonByText,
  loginUser,
  closePWAPrompt,
} from './helpers';
import { TEST_USERS, TEST_CONFIG } from '../test-config';

/**
 * Data Isolation Test Suite
 * Verifies that data created by one user is not visible to another user
 */

const TEST_SEASON_NAME = 'Private Season 2025';

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
  test('User 1 creates a season', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.medium);
    
    console.log('\n=== User 1: Creating Season ===');
    
    // Login as User 1
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    console.log('✓ User 1 logged in');
    
    // Navigate to Management tab
    await page.getByRole('button', { name: /manage/i }).click();
    await waitForPageLoad(page);
    
    // Create a season
    await clickButton(page, '+ Create New Season');
    await waitForPageLoad(page);
    
    await fillInput(page, 'input[placeholder*="Season Name (e.g., Fall League)"]', TEST_SEASON_NAME);
    await fillInput(page, 'input[placeholder*="Year (e.g., 2025)"]', '2025');
    
    await clickButton(page, 'Create');
    await waitForPageLoad(page);
    
    // Verify season was created
    await expect(page.getByText(TEST_SEASON_NAME)).toBeVisible();
    console.log(`✓ User 1 created season: ${TEST_SEASON_NAME}`);
    
    // Logout
    await logout(page);
    console.log('✓ User 1 logged out\n');
  });
  
  test('User 2 cannot see User 1\'s season', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.medium);
    
    console.log('=== User 2: Verifying Data Isolation ===');
    
    // Login as User 2
    await loginUser(page, TEST_USERS.user2.email, TEST_USERS.user2.password);
    console.log('✓ User 2 logged in');
    
    // Navigate to Management tab
    await page.getByRole('button', { name: /manage/i }).click();
    await waitForPageLoad(page);
    
    // Wait for season list to load
    await page.waitForTimeout(1000);
    
    // Verify User 1's season is NOT visible
    const seasonCard = page.getByText(TEST_SEASON_NAME);
    const isVisible = await seasonCard.isVisible({ timeout: 2000 }).catch(() => false);
    
    expect(isVisible).toBe(false);
    console.log(`✓ User 2 cannot see "${TEST_SEASON_NAME}"`);
    
    // Verify User 2 sees empty state or their own seasons only
    const createButton = page.getByRole('button', { name: '+ Create New Season' });
    await expect(createButton).toBeVisible();
    console.log('✓ User 2 sees their own empty season list');
    
    console.log('✓ Data isolation verified\n');
  });
});
