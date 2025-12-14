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

/**
 * Click a specific management tab (Seasons, Teams, Formations, or Players)
 * @param page - Playwright page object
 * @param tabName - Name of the tab: 'Seasons' | 'Teams' | 'Formations' | 'Players'
 */
export async function clickManagementTab(page: Page, tabName: 'Seasons' | 'Teams' | 'Formations' | 'Players') {
  const tab = page.locator('button.management-tab', { hasText: new RegExp(`^${tabName}`) });
  await tab.click();
  await page.waitForTimeout(UI_TIMING.STANDARD);
}

/**
 * Create a new season
 * @param page - Playwright page object
 * @param seasonData - Season data object with name and year
 */
export async function createSeason(page: Page, seasonData: { name: string; year: string }) {
  console.log(`Creating season: ${seasonData.name}...`);
  
  await clickManagementTab(page, 'Seasons');
  await clickButton(page, '+ Create New Season');
  await page.waitForTimeout(UI_TIMING.STANDARD);
  
  await fillInput(page, 'input[placeholder*="Season Name"]', seasonData.name);
  await fillInput(page, 'input[placeholder*="Year"]', seasonData.year);
  
  await clickButton(page, 'Create');
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  // Verify season was created
  await expect(page.getByText(seasonData.name).first()).toBeVisible();
  console.log(`✓ Season created: ${seasonData.name}`);
}

/**
 * Create a new team
 * @param page - Playwright page object
 * @param teamData - Team data object with name, maxPlayers, and halfLength
 * @param seasonData - Season data to select the team's season
 * @param formationName - Optional formation name to select (with player count, e.g., "3-3-1 (7 players)")
 */
export async function createTeam(
  page: Page, 
  teamData: { name: string; maxPlayers: string; halfLength: string },
  seasonData: { name: string; year: string },
  formationName?: string
) {
  console.log(`Creating team: ${teamData.name}...`);
  
  await clickManagementTab(page, 'Teams');
  await clickButton(page, '+ Create New Team');
  await page.waitForTimeout(UI_TIMING.STANDARD);
  
  // Select season
  const seasonLabel = `${seasonData.name} (${seasonData.year})`;
  await page.selectOption('select', { label: seasonLabel });
  await page.waitForTimeout(UI_TIMING.QUICK);
  
  await fillInput(page, 'input[placeholder*="team name"]', teamData.name);
  await fillInput(page, 'input[placeholder*="max players"]', teamData.maxPlayers);
  await fillInput(page, 'input[placeholder*="half length"]', teamData.halfLength);
  
  // Select formation if provided
  if (formationName) {
    const formationSelect = page.locator('select').nth(1); // Second select is for formation
    await formationSelect.selectOption({ label: formationName });
    await page.waitForTimeout(UI_TIMING.STANDARD);
  }
  
  await clickButton(page, 'Create');
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  
  // Verify team was created
  await expect(page.locator('.item-card').filter({ hasText: teamData.name })).toBeVisible();
  console.log(`✓ Team created: ${teamData.name}`);
}

/**
 * Create a new formation with positions
 * @param page - Playwright page object
 * @param formationData - Formation data object with name, playerCount, and positions array
 */
export async function createFormation(
  page: Page,
  formationData: {
    name: string;
    playerCount: string;
    positions: Array<{ name: string; abbreviation: string }>;
  }
) {
  console.log(`Creating formation: ${formationData.name}...`);
  
  await clickManagementTab(page, 'Formations');
  await clickButton(page, '+ Create Formation');
  await page.waitForTimeout(UI_TIMING.STANDARD);
  
  await fillInput(page, 'input[placeholder*="Formation Name"]', formationData.name);
  await fillInput(page, 'input[placeholder*="Number of Players on Field"]', formationData.playerCount);
  
  // Add each position to the formation
  for (const position of formationData.positions) {
    await clickButton(page, '+ Add Position');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Get all position inputs and fill the last (newly added) one
    const positionNameInputs = page.locator('input[placeholder*="Position Name"]');
    const abbreviationInputs = page.locator('input[placeholder*="Abbreviation"]');
    
    const count = await positionNameInputs.count();
    await positionNameInputs.nth(count - 1).fill(position.name);
    await abbreviationInputs.nth(count - 1).fill(position.abbreviation);
  }
  
  await clickButton(page, 'Create');
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  
  // Verify formation was created
  await expect(page.getByText(formationData.name)).toBeVisible();
  console.log(`✓ Formation created: ${formationData.name}`);
}

/**
 * UI timing constants for consistent wait patterns across tests
 */
export const UI_TIMING = {
  /** Short delay for simple UI updates (100ms) */
  INSTANT: 100,
  /** Standard delay for form inputs and minor updates (200ms) */
  QUICK: 200,
  /** Medium delay for tab switches and modal animations (300ms) */
  STANDARD: 300,
  /** Longer delay for navigation and page loads (500ms) */
  NAVIGATION: 500,
  /** Extended delay for data operations and async updates (1000ms) */
  DATA_OPERATION: 1000,
  /** Extra long delay for complex operations (1500ms) */
  COMPLEX_OPERATION: 1500,
} as const;

/**
 * Wait for UI to update after an action
 * @param page - Playwright page object
 * @param duration - Optional duration in ms (defaults to UI_TIMING.STANDARD)
 */
export async function waitForUIUpdate(page: Page, duration: number = UI_TIMING.STANDARD) {
  await page.waitForTimeout(duration);
}

/**
 * Set up a dialog handler to automatically accept confirmation dialogs
 * Returns a cleanup function to remove the handler
 * @param page - Playwright page object
 * @param logMessage - Whether to log the dialog message (default: true)
 * @returns Cleanup function to remove the dialog listener
 */
export function handleConfirmDialog(page: Page, logMessage: boolean = true): () => void {
  const handler = async (dialog: any) => {
    if (logMessage) {
      console.log(`  Confirming: ${dialog.message()}`);
    }
    await dialog.accept();
  };
  
  page.on('dialog', handler);
  
  // Return cleanup function
  return () => {
    page.removeListener('dialog', handler);
  };
}

/**
 * Set up a dialog handler to automatically dismiss/cancel dialogs
 * Returns a cleanup function to remove the handler
 * @param page - Playwright page object
 * @param logMessage - Whether to log the dialog message (default: true)
 * @returns Cleanup function to remove the dialog listener
 */
export function handleDismissDialog(page: Page, logMessage: boolean = true): () => void {
  const handler = async (dialog: any) => {
    if (logMessage) {
      console.log(`  Dismissing: ${dialog.message()}`);
    }
    await dialog.dismiss();
  };
  
  page.on('dialog', handler);
  
  // Return cleanup function
  return () => {
    page.removeListener('dialog', handler);
  };
}