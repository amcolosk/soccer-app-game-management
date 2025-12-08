import { test, expect, Page } from '@playwright/test';
import {
  waitForPageLoad,
  fillInput,
  clickButton,
  clickButtonByText,
  selectOption,
  waitForElement,
} from './helpers';
import { TEST_USERS, TEST_CONFIG } from '../test-config';

/**
 * Authentication Test Suite
 * Tests login functionality with AWS Cognito
 */

test.describe('Authentication', () => {
  test('should login successfully', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.short);
    
    console.log('Testing login with Cognito...');
    
    await page.goto('/');
    await waitForPageLoad(page);
    
    // Wait for auth UI to load
    await page.waitForSelector('input[name="username"], input[type="email"]', { timeout: 10000 });
    
    // Enter credentials
    await fillInput(page, 'input[name="username"], input[type="email"]', TEST_USERS.user1.email);
    await fillInput(page, 'input[name="password"], input[type="password"]', TEST_USERS.user1.password);
    
    // Submit
    await clickButton(page, 'Sign in');

    // Click Skip Verification
    await clickButton(page, 'Skip');
    
    // Wait for successful login - should see main app
    await waitForPageLoad(page);
    await expect(page.locator('.season-selector')).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Create New Season' })).toBeVisible();

    console.log('✓ Login successful');
  });
  
  test('should login successfully with second user', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.short);
    
    console.log(`Testing login with second user (${TEST_USERS.user2.email})...`);
    
    await page.goto('/');
    await waitForPageLoad(page);
    
    // Wait for auth UI to load
    await page.waitForSelector('input[name="username"], input[type="email"]', { timeout: 10000 });
    
    // Enter second user credentials
    await fillInput(page, 'input[name="username"], input[type="email"]', TEST_USERS.user2.email);
    await fillInput(page, 'input[name="password"], input[type="password"]', TEST_USERS.user2.password);
    
    // Submit
    await clickButton(page, 'Sign in');

    // Click Skip Verification
    await clickButton(page, 'Skip');
    
    // Wait for successful login - should see main app
    await waitForPageLoad(page);
    await expect(page.locator('.season-selector')).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Create New Season' })).toBeVisible();

    console.log('✓ Second user login successful');
  });
  
  test('should show error for invalid credentials', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.short);
    
    await page.goto('/');
    await waitForPageLoad(page);
    
    // Wait for auth UI
    await page.waitForSelector('input[name="username"], input[type="email"]', { timeout: 10000 });
    
    // Enter invalid credentials
    await fillInput(page, 'input[name="username"], input[type="email"]', 'invalid@example.com');
    await fillInput(page, 'input[name="password"], input[type="password"]', 'WrongPassword123!');
    
    // Submit
    await clickButton(page, 'Sign in');
    
    // Should see error message (any alert indicates auth failure)
    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 5000 });
    
    console.log('✓ Error message shown for invalid credentials');
  });
});
