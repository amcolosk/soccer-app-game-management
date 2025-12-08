import { test, expect, Page } from '@playwright/test';
import {
  waitForPageLoad,
  fillInput,
  clickButton,
  clickButtonByText,
} from './helpers';
import { TEST_USERS, TEST_CONFIG } from '../test-config';

/**
 * Data Isolation Test Suite
 * Verifies that data created by one user is not visible to another user
 */

const TEST_SEASON_NAME = 'Private Season 2025';

// Helper to login
async function login(page: Page, email: string, password: string) {
  await page.goto('/');
  await waitForPageLoad(page);
  
  await page.waitForSelector('input[name="username"], input[type="email"]', { timeout: 10000 });
  
  await fillInput(page, 'input[name="username"], input[type="email"]', email);
  await fillInput(page, 'input[name="password"], input[type="password"]', password);
  await clickButton(page, 'Sign in');
  await clickButton(page, 'Skip');
  
  await page.waitForSelector('text=Season', { timeout: 10000 });
  await waitForPageLoad(page);
}

// Helper to logout
async function logout(page: Page) {
  // Look for sign out button (adjust selector based on your UI)
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
    await login(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    console.log('✓ User 1 logged in');
    
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
    await login(page, TEST_USERS.user2.email, TEST_USERS.user2.password);
    console.log('✓ User 2 logged in');
    
    // Wait for season list to load
    await waitForPageLoad(page);
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
