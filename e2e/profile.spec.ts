import { test, expect, Page } from '@playwright/test';
import {
  waitForPageLoad,
  fillInput,
  clickButton,
  clickButtonByText,
  waitForElement,
  loginUser,
  UI_TIMING,
} from './helpers';
import { TEST_USERS, TEST_CONFIG } from '../test-config';

async function navigateToProfile(page: Page) {
  // Close PWA prompt if it's still showing
  try {
    const okButton = page.locator('.update-prompt button:has-text("OK")');
    await okButton.click({ timeout: 1000 });
    await page.waitForTimeout(300);
  } catch (e) {
    // Prompt not present
  }
  
  // Click Profile tab in bottom navigation
  await page.getByRole('button', { name: /profile/i }).click();
  await waitForPageLoad(page);
  
  // Verify we're on the profile page
  await expect(page.locator('.user-profile')).toBeVisible();
}

async function navigateToManagement(page: Page) {
  // Close PWA prompt if it's still showing
  try {
    const okButton = page.locator('.update-prompt button:has-text("OK")');
    await okButton.click({ timeout: 1000 });
    await page.waitForTimeout(300);
  } catch (e) {
    // Prompt not present
  }
  
  // Click Manage tab in bottom navigation
  await page.getByRole('button', { name: /manage/i }).click();
  await waitForPageLoad(page);
  
  // Verify we're on the management page
  await expect(page.locator('.management')).toBeVisible();
}

test.describe('User Profile', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.medium);
  });

  test('should display user profile information', async ({ page }) => {
    console.log('Testing profile display...');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToProfile(page);
    
    // Verify profile sections are visible
    await expect(page.locator('.user-profile')).toBeVisible();
    await expect(page.locator('h2:has-text("Profile")')).toBeVisible();
    
    // Verify email is displayed in Account Information section
    await expect(page.locator('h3:has-text("Account Information")')).toBeVisible();
    const emailValue = page.locator('.info-value');
    await expect(emailValue.first()).toBeVisible();
    await expect(emailValue.first()).toContainText(TEST_USERS.user1.email);
    
    console.log('✓ Profile information displayed correctly');
  });

  test('should change password successfully', async ({ page }) => {
    console.log('Testing password change...');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToProfile(page);
    
    // Define new password
    const newPassword = 'NewTestPassword123!';
    
    // Fill password change form
    await fillInput(page, '#oldPassword', TEST_USERS.user1.password);
    await fillInput(page, '#newPassword', newPassword);
    await fillInput(page, '#confirmPassword', newPassword);
    
    // Submit password change
    await clickButton(page, 'Update Password');
    await page.waitForTimeout(1000);
    
    // Should see success message
    await expect(page.locator('.message-success, .success-message')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=/Password updated successfully/i')).toBeVisible();
    
    console.log('✓ Password changed successfully');
    
    // Sign out
    await clickButton(page, 'Sign Out');
    await waitForPageLoad(page);
    
    // Verify we're on Landing Page and click Log In
    const loginButton = page.getByRole('button', { name: 'Log In' });
    await expect(loginButton).toBeVisible();
    await loginButton.click();
    
    // Verify we're back at login
    await page.waitForSelector('input[name="username"], input[type="email"]', { timeout: 10000 });
    
    console.log('✓ Signed out after password change');
    
    // Test login with new password
    console.log('Testing login with new password...');
    await fillInput(page, 'input[name="username"], input[type="email"]', TEST_USERS.user1.email);
    await fillInput(page, 'input[name="password"], input[type="password"]', newPassword);
    await clickButton(page, 'Sign in');
    
    // Skip verification if needed
    try {
      await page.waitForSelector('button:has-text("Skip")', { timeout: 2000 });
      await clickButton(page, 'Skip');
    } catch (e) {
      // Skip button may not appear
    }
    
    // Should successfully login
    await waitForPageLoad(page);
    await expect(page.locator('.bottom-nav')).toBeVisible();
    
    console.log('✓ Login successful with new password');
    
    // Reset password back to original
    console.log('Resetting password to original...');
    await navigateToProfile(page);
    await fillInput(page, '#oldPassword', newPassword);
    await fillInput(page, '#newPassword', TEST_USERS.user1.password);
    await fillInput(page, '#confirmPassword', TEST_USERS.user1.password);
    await clickButton(page, 'Update Password');
    await page.waitForTimeout(1000);
    
    console.log('✓ Password reset to original');
  });

  test('should validate password requirements', async ({ page }) => {
    console.log('Testing password validation...');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToProfile(page);
    
    // Try to change password with mismatched confirmation
    await fillInput(page, '#oldPassword', TEST_USERS.user1.password);
    await fillInput(page, '#newPassword', 'NewPassword123!');
    await fillInput(page, '#confirmPassword', 'DifferentPassword123!');
    
    await clickButton(page, 'Update Password');
    await page.waitForTimeout(500);
    
    // Should see error message
    const errorVisible = await page.locator('.message-error').count() > 0 || 
                         await page.locator('text=/do not match/i').count() > 0;
    expect(errorVisible).toBeTruthy();
    
    console.log('✓ Password mismatch validation working');
    
    // Try with weak password
    await page.reload();
    await waitForPageLoad(page);
    await navigateToProfile(page);
    
    await fillInput(page, '#oldPassword', TEST_USERS.user1.password);
    await fillInput(page, '#newPassword', 'weak');
    await fillInput(page, '#confirmPassword', 'weak');
    
    await clickButton(page, 'Update Password');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Wait for error message to appear
    await page.waitForTimeout(500);
    
    // Should see error (either from validation or AWS Cognito)
    // AWS Cognito requires: 8+ chars, uppercase, lowercase, number, special char
    const hasError = await page.locator('.message.message-error').count() > 0 || 
                     await page.locator('[role="alert"]').count() > 0 ||
                     await page.locator('text=/password.*requirement/i').count() > 0 ||
                     await page.locator('text=/8 characters/i').count() > 0;
    
    expect(hasError).toBeTruthy();
    console.log('✓ Weak password validation working');
  });

  test('should sign out successfully', async ({ page }) => {
    console.log('Testing sign out...');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToProfile(page);
    
    // Verify Sign Out button is visible
    const signOutButton = page.getByRole('button', { name: /sign out/i });
    await expect(signOutButton).toBeVisible();
    
    // Click Sign Out
    await signOutButton.click();
    await waitForPageLoad(page);
    
    // Should be redirected to Landing Page
    await expect(page.getByRole('button', { name: 'Log In' })).toBeVisible();
    
    console.log('✓ Sign out successful');
    
    // Verify we can't access the app without logging in
    await page.goto('/');
    await page.waitForTimeout(1000);
    
    // Should see Landing Page
    await expect(page.getByRole('button', { name: 'Log In' })).toBeVisible();
    
    console.log('✓ Protected routes require authentication (redirect to landing)');
  });

  test('should navigate between tabs while on profile', async ({ page }) => {
    console.log('Testing navigation from profile...');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToProfile(page);
    
    // Navigate to Home
    await page.getByRole('button', { name: /home/i }).click();
    await waitForPageLoad(page);
    await expect(page.locator('.home')).toBeVisible();
    
    // Navigate back to Profile
    await navigateToProfile(page);
    await expect(page.locator('.user-profile')).toBeVisible();
    
    // Navigate to Manage
    await page.getByRole('button', { name: /manage/i }).click();
    await waitForPageLoad(page);
    await expect(page.locator('.management')).toBeVisible();
    
    // Navigate back to Profile
    await navigateToProfile(page);
    await expect(page.locator('.user-profile')).toBeVisible();
    
    console.log('✓ Navigation working correctly');
  });

  test('should show password change form validation', async ({ page }) => {
    console.log('Testing form validation...');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToProfile(page);
    
    // Try to submit empty form
    const currentPasswordInput = page.locator('#oldPassword');
    const newPasswordInput = page.locator('#newPassword');
    const confirmPasswordInput = page.locator('#confirmPassword');
    
    // Verify all fields are present
    await expect(currentPasswordInput).toBeVisible();
    await expect(newPasswordInput).toBeVisible();
    await expect(confirmPasswordInput).toBeVisible();
    
    // Clear any existing values
    await currentPasswordInput.clear();
    await newPasswordInput.clear();
    await confirmPasswordInput.clear();
    
    // Try to submit with empty fields
    await clickButton(page, 'Update Password');
    await page.waitForTimeout(500);
    
    // Form should not submit (either HTML5 validation or custom validation)
    // If there's a success message, something went wrong
    const successMessageCount = await page.locator('.message-success').count();
    const successTextCount = await page.getByText(/updated successfully/i).count();
    expect(successMessageCount + successTextCount).toBe(0);
    
    console.log('✓ Empty form validation working');
  });

  test('should handle incorrect current password', async ({ page }) => {
    console.log('Testing incorrect current password...');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToProfile(page);
    
    // Try to change password with wrong current password
    await fillInput(page, '#oldPassword', 'WrongPassword123!');
    await fillInput(page, '#newPassword', 'NewPassword123!');
    await fillInput(page, '#confirmPassword', 'NewPassword123!');
    
    await clickButton(page, 'Update Password');
    await page.waitForTimeout(1000);
    
    // Should see error message
    const errorVisible = await page.locator('.message-error').count() > 0 || 
                         await page.locator('[role="alert"]').count() > 0;
    expect(errorVisible).toBeTruthy();
    
    console.log('✓ Incorrect current password handled correctly');
  });
});
