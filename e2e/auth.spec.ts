import { test, expect, Page } from '@playwright/test';
import {
  waitForPageLoad,
  fillInput,
  clickButton,
  clickButtonByText,
  selectOption,
  waitForElement,
} from './helpers';

/**
 * Authentication Test Suite
 * Tests login functionality with AWS Cognito
 */

// Get credentials from environment or use defaults
const TEST_EMAIL = process.env.TEST_USER_EMAIL || 'test@example.com';
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || 'TestPassword123!';

test.describe('Authentication', () => {
  test('should login successfully', async ({ page }) => {
    test.setTimeout(30000);
    
    console.log('Testing login with Cognito...');
    
    await page.goto('/');
    await waitForPageLoad(page);
    
    // Wait for auth UI to load
    await page.waitForSelector('input[name="username"], input[type="email"]', { timeout: 10000 });
    
    // Enter credentials
    await fillInput(page, 'input[name="username"], input[type="email"]', TEST_EMAIL);
    await fillInput(page, 'input[name="password"], input[type="password"]', TEST_PASSWORD);
    
    // Submit
    await clickButton(page, 'Sign in');

    // Click Skip Verification
    await clickButton(page, 'Skip');
    
    // Wait for successful login - should see main app
    await page.waitForSelector('text=Seasons', { timeout: 10000 });
    await expect(page.getByText('Seasons')).toBeVisible();
    
    console.log('✓ Login successful');
  });
  
  test('should show error for invalid credentials', async ({ page }) => {
    test.setTimeout(30000);
    
    await page.goto('/');
    await waitForPageLoad(page);
    
    // Wait for auth UI
    await page.waitForSelector('input[name="username"], input[type="email"]', { timeout: 10000 });
    
    // Enter invalid credentials
    await fillInput(page, 'input[name="username"], input[type="email"]', 'invalid@example.com');
    await fillInput(page, 'input[name="password"], input[type="password"]', 'WrongPassword123!');
    
    // Submit
    await clickButton(page, 'Sign in');
    
    // Should see error message
    await page.waitForSelector('text=/incorrect|invalid|error/i', { timeout: 5000 });
    
    console.log('✓ Error message shown for invalid credentials');
  });
});
