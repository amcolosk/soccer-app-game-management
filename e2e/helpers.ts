import { Page, expect } from '@playwright/test';

/**
 * Helper functions for E2E tests
 */

/**
 * Wait for navigation and any loading states to complete
 */
export async function waitForPageLoad(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500); // Brief pause for any animations
}

/**
 * Fill input and wait for React to update
 */
export async function fillInput(page: Page, selector: string, value: string) {
  await page.fill(selector, value);
  await page.waitForTimeout(100);
}

/**
 * Click button and wait for action to complete
 */
export async function clickButton(page: Page, text: string) {
  await page.getByRole('button', { name: text }).click();
  await page.waitForTimeout(300);
}

/**
 * Click button by text content (more flexible)
 */
export async function clickButtonByText(page: Page, text: string | RegExp) {
  await page.getByRole('button', { name: text }).click();
  await page.waitForTimeout(300);
}

/**
 * Select option from dropdown
 */
export async function selectOption(page: Page, selector: string, value: string) {
  await page.selectOption(selector, value);
  await page.waitForTimeout(200);
}

/**
 * Wait for element to be visible
 */
export async function waitForElement(page: Page, selector: string) {
  await page.waitForSelector(selector, { state: 'visible' });
}

/**
 * Get text content of element
 */
export async function getTextContent(page: Page, selector: string): Promise<string> {
  const element = await page.locator(selector);
  return (await element.textContent()) || '';
}

/**
 * Format time for display (MM:SS)
 */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Parse time from display format (MM:SS) to seconds
 */
export function parseTime(timeString: string): number {
  const [mins, secs] = timeString.split(':').map(Number);
  return mins * 60 + secs;
}

/**
 * Close PWA update/offline prompt if it appears
 */
export async function closePWAPrompt(page: Page) {
  try {
    const okButton = page.locator('.update-prompt button:has-text("OK")');
    const isVisible = await okButton.isVisible({ timeout: 2000 }).catch(() => false);
    if (isVisible) {
      await okButton.click();
      await page.waitForTimeout(500);
    }
  } catch (e) {
    // Prompt may not appear or already closed
  }
}

/**
 * Login user with email and password
 */
export async function loginUser(page: Page, email: string, password: string) {
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

/**
 * Navigate to specific tab in Management section
 */
async function clickManagementTab(page: Page, tabName: string) {
  const tab = page.locator('button.management-tab', { hasText: new RegExp(`^${tabName}`) });
  await tab.click();
  await page.waitForTimeout(300);
}

/**
 * Clean up all test data (players, games, teams, seasons, formations)
 * Should be called after navigating to Management page
 */
export async function cleanupTestData(page: Page) {
  console.log('Cleaning up test data...');
  
  // Make sure we're on Management page
  const manageTab = page.locator('button.nav-item', { hasText: 'Manage' });
  if (await manageTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await manageTab.click();
    await page.waitForTimeout(500);
  }
  
  // Clean up teams first (which will clean up rosters)
  await clickManagementTab(page, 'Teams');
  await page.waitForTimeout(500);
  
  let teamDeleteButtons = page.locator('.item-card .btn-delete');
  let teamCount = await teamDeleteButtons.count();
  
  if (teamCount > 0) {
    console.log(`Found ${teamCount} team(s), deleting...`);
    
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });
    
    while (teamCount > 0) {
      await teamDeleteButtons.first().click();
      await page.waitForTimeout(1000);
      const newCount = await teamDeleteButtons.count();
      if (newCount === teamCount) break;
      teamCount = newCount;
    }
    
    page.removeAllListeners('dialog');
    console.log('✓ Teams deleted');
  }
  
  // Clean up players (now global)
  await clickManagementTab(page, 'Players');
  await page.waitForTimeout(500);
  
  let playerDeleteButtons = page.locator('.item-card .btn-delete');
  let playerCount = await playerDeleteButtons.count();
  
  if (playerCount > 0) {
    console.log(`Found ${playerCount} player(s), deleting...`);
    
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });
    
    while (playerCount > 0) {
      await playerDeleteButtons.first().click();
      await page.waitForTimeout(1000);
      const newCount = await playerDeleteButtons.count();
      if (newCount === playerCount) break;
      playerCount = newCount;
    }
    
    page.removeAllListeners('dialog');
    console.log('✓ Players deleted');
  }
  
  // Clean up formations
  await clickManagementTab(page, 'Formations');
  await page.waitForTimeout(500);
  
  let formationDeleteButtons = page.locator('.item-card .btn-delete');
  let formationCount = await formationDeleteButtons.count();
  
  if (formationCount > 0) {
    console.log(`Found ${formationCount} formation(s), deleting...`);
    
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });
    
    while (formationCount > 0) {
      await formationDeleteButtons.first().click();
      await page.waitForTimeout(1000);
      const newCount = await formationDeleteButtons.count();
      if (newCount === formationCount) break;
      formationCount = newCount;
    }
    
    page.removeAllListeners('dialog');
    console.log('✓ Formations deleted');
  }
  
  // Clean up seasons
  await clickManagementTab(page, 'Seasons');
  await page.waitForTimeout(500);
  
  let seasonDeleteButtons = page.locator('.item-card .btn-delete');
  let seasonCount = await seasonDeleteButtons.count();
  
  if (seasonCount > 0) {
    console.log(`Found ${seasonCount} season(s), deleting...`);
    
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });
    
    while (seasonCount > 0) {
      await seasonDeleteButtons.first().click();
      await page.waitForTimeout(1000);
      const newCount = await seasonDeleteButtons.count();
      if (newCount === seasonCount) break;
      seasonCount = newCount;
    }
    
    page.removeAllListeners('dialog');
    console.log('✓ Seasons deleted');
  }
}

/**
 * Season Management Test Suite
 * Tests CRUD operations for seasons in the Management tab
 */

export async function navigateToManagement(page: Page) {
  // Close PWA prompt if it's still showing
  await closePWAPrompt(page);
  
  // Click Manage tab in bottom navigation
  await page.getByRole('button', { name: /manage/i }).click();
  await waitForPageLoad(page);
  
  // Verify we're on the management page
  await expect(page.locator('.management')).toBeVisible();
}