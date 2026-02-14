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
  const button = page.getByRole('button', { name: text });
  
  // Scroll into view if needed, with center alignment to avoid bottom nav
  await button.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  
  await button.click();
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
    const overlay = page.locator('.update-prompt-overlay');
    if (await overlay.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('Closing PWA prompt...');
      // Try to click OK or Later or Reload
      const okButton = overlay.locator('button:has-text("OK")');
      const laterButton = overlay.locator('button:has-text("Later")');
      const reloadButton = overlay.locator('button:has-text("Reload")');
      
      if (await okButton.isVisible()) {
        await okButton.click();
      } else if (await laterButton.isVisible()) {
        await laterButton.click();
      } else if (await reloadButton.isVisible()) {
        await reloadButton.click();
      }
      
      await expect(overlay).not.toBeVisible({ timeout: 5000 });
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

  // Check if already logged in (bottom nav visible)
  const bottomNav = page.locator('.bottom-nav');
  if (await bottomNav.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('User already logged in, signing out...');
    // Navigate to profile and sign out
    await page.getByRole('button', { name: 'Profile' }).click();
    await page.getByRole('button', { name: 'Sign Out' }).click();
    await expect(page.getByRole('button', { name: 'Log In' })).toBeVisible({ timeout: 10000 });
  }
  
  // Check for Landing Page "Log In" button
  const loginButton = page.getByRole('button', { name: 'Log In' });
  if (await loginButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('On Landing Page, clicking Log In...');
    await loginButton.click();
    await waitForPageLoad(page);
  }

  // Wait for auth UI to load
  await page.waitForSelector('input[name="username"], input[type="email"]', { timeout: 10000 });
  
  // Enter credentials
  await fillInput(page, 'input[name="username"], input[type="email"]', email);
  await fillInput(page, 'input[name="password"], input[type="password"]', password);
  
  // Submit
  await clickButton(page, 'Sign in');

  // Click Skip Verification if it appears (wait longer for it to load)
  // try {
  //   await page.waitForSelector('button:has-text("Skip")', { timeout: 5000 });
  //   await clickButton(page, 'Skip');
  //   console.log('Clicked Skip on email verification');
  // } catch (e) {
  //   // Skip button may not appear if already verified
  //   console.log('No Skip button found - user may already be verified');
  // }
  
  // Wait for successful login
  await waitForPageLoad(page);
  
  // Wait for the app to be ready (bottom nav visible)
  await page.waitForSelector('.bottom-nav', { timeout: 30000 });
  
  // Close PWA update/offline prompt if it appears
  await closePWAPrompt(page);
}

/**
 * Clean up all test data (players, games, teams, seasons, formations)
 * Should be called after navigating to Management page
 */
export async function cleanupTestData(page: Page) {
  console.log('Cleaning up test data...');
  
  // Close PWA prompt if it's showing
  await closePWAPrompt(page);
  
  // Make sure we're on Management page
  const manageTab = page.locator('button.nav-item', { hasText: 'Manage' });
  if (await manageTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await manageTab.click();
    await page.waitForTimeout(500);
  }
  
  // Clean up teams first (which will clean up rosters)
  await clickManagementTab(page, 'Teams');
  await page.waitForTimeout(500);
  
  let teamCards = page.locator('.item-card');
  let teamCount = await teamCards.count();
  
  if (teamCount > 0) {
    console.log(`Found ${teamCount} team(s), deleting...`);
    
    const cleanupTeamDialog = handleConfirmDialog(page, false);
    
    while (teamCount > 0) {
      await swipeToDelete(page, '.item-card');
      await page.waitForTimeout(1000);
      teamCards = page.locator('.item-card'); // Re-query to get updated list
      const newCount = await teamCards.count();
      if (newCount === teamCount) break;
      teamCount = newCount;
    }
    
    cleanupTeamDialog();
    console.log('✓ Teams deleted');
  }
  
  // Clean up players (now global)
  await clickManagementTab(page, 'Players');
  await page.waitForTimeout(500);
  
  let playerCards = page.locator('.item-card');
  let playerCount = await playerCards.count();
  
  if (playerCount > 0) {
    console.log(`Found ${playerCount} player(s), deleting...`);
    
    const cleanupPlayerDialog = handleConfirmDialog(page, false);
    
    while (playerCount > 0) {
      await swipeToDelete(page, '.item-card');
      await page.waitForTimeout(1000);
      playerCards = page.locator('.item-card'); // Re-query to get updated list
      const newCount = await playerCards.count();
      if (newCount === playerCount) break;
      playerCount = newCount;
    }
    
    cleanupPlayerDialog();
    console.log('✓ Players deleted');
  }
  
  // Clean up formations
  await clickManagementTab(page, 'Formations');
  await page.waitForTimeout(500);
  
  let formationCards = page.locator('.item-card');
  let formationCount = await formationCards.count();
  
  if (formationCount > 0) {
    console.log(`Found ${formationCount} formation(s), deleting...`);
    
    const cleanupFormationDialog = handleConfirmDialog(page, false);
    
    while (formationCount > 0) {
      await swipeToDelete(page, '.item-card');
      await page.waitForTimeout(1000);
      formationCards = page.locator('.item-card'); // Re-query to get updated list
      const newCount = await formationCards.count();
      if (newCount === formationCount) break;
      formationCount = newCount;
    }
    
    cleanupFormationDialog();
    console.log('✓ Formations deleted');
  }
}

/**
 * Team Management Test Suite
 */

export async function navigateToManagement(page: Page) {
  // Close PWA prompt if it's still showing
  await closePWAPrompt(page);
  
  // Wait for any loading state to disappear
  const loadingIndicator = page.getByText('Loading...', { exact: true });
  if (await loadingIndicator.isVisible({ timeout: 2000 }).catch(() => false)) {
    await expect(loadingIndicator).not.toBeVisible({ timeout: 10000 });
  }

  // Wait for Manage button to be visible
  const manageButton = page.getByRole('button', { name: /manage/i });
  await manageButton.waitFor({ state: 'visible', timeout: 10000 });
  
  // Click Manage tab in bottom navigation
  await manageButton.click();
  await waitForPageLoad(page);
  await page.waitForTimeout(UI_TIMING.NAVIGATION);
  
  // Wait for management page to load
  await page.waitForSelector('.management', { timeout: 5000 });
}

/**
 * Click a specific management tab (Teams, Formations, or Players)
 * @param page - Playwright page object
 * @param tabName - Name of the tab: 'Teams' | 'Formations' | 'Players' | 'Sharing' | 'App'
 */
export async function clickManagementTab(page: Page, tabName: 'Teams' | 'Formations' | 'Players' | 'Sharing' | 'App') {
  const tab = page.locator('button.management-tab', { hasText: new RegExp(`^${tabName}`) });
  await tab.click();
  await page.waitForTimeout(UI_TIMING.STANDARD);
}

/**
 * Create a new team
 * @param page - Playwright page object
 * @param teamData - Team data object with name, maxPlayers, and halfLength
 * @param formationName - Optional formation name to select (with player count, e.g., "3-3-1 (7 players)")
 */
export async function createTeam(
  page: Page, 
  teamData: { name: string; maxPlayers: string; halfLength: string },
  formationName?: string
) {
  console.log(`Creating team: ${teamData.name}...`);
  
  // Make sure we're on the Management page
  const manageTab = page.locator('button.nav-item', { hasText: /Manage/i });
  if (await manageTab.isVisible({ timeout: 1000 }).catch(() => false)) {
    console.log('  Navigating to Management page...');
    await manageTab.click();
    await page.waitForTimeout(UI_TIMING.NAVIGATION);
  }
  
  console.log('  Clicking Teams tab...');
  await clickManagementTab(page, 'Teams');
  
  console.log('  Clicking Create New Team button...');
  await clickButton(page, '+ Create New Team');
  await page.waitForTimeout(UI_TIMING.STANDARD);
  
  console.log('  Filling team form...');
  await fillInput(page, 'input[placeholder*="team name"]', teamData.name);
  await fillInput(page, 'input[placeholder*="max players"]', teamData.maxPlayers);
  await fillInput(page, 'input[placeholder*="half length"]', teamData.halfLength);
  console.log(`    Name: ${teamData.name}, MaxPlayers: ${teamData.maxPlayers}, HalfLength: ${teamData.halfLength}`);
  
  // Select formation if provided
  if (formationName) {
    console.log(`  Selecting formation: ${formationName}...`);
    const formationSelect = page.getByLabel('Formation');
    await formationSelect.selectOption({ label: formationName });
    await page.waitForTimeout(UI_TIMING.STANDARD);
  }
  
  console.log('  Clicking Create button...');
  await clickButton(page, 'Create');
  await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
  
  console.log('  Verifying team was created...');
  
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
  
  // Extended wait to ensure positions propagate to DynamoDB replicas
  // Formation positions are written asynchronously and may not be immediately
  // visible on eventually consistent reads
  await page.waitForTimeout(3000);
  
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
 * Set up automatic confirmation for ConfirmModal dialogs.
 * Clicks the confirm button whenever a confirm modal appears.
 * Returns a cleanup function to stop auto-confirming.
 * @param page - Playwright page object
 * @param logMessage - Whether to log confirmation (default: true)
 * @returns Cleanup function to stop the observer
 */
export function handleConfirmDialog(page: Page, logMessage: boolean = true): () => void {
  let active = true;

  const poll = async () => {
    while (active) {
      try {
        const confirmBtn = page.locator('.confirm-btn--confirm');
        if (await confirmBtn.isVisible({ timeout: 200 }).catch(() => false)) {
          if (logMessage) {
            const message = await page.locator('.confirm-message').textContent().catch(() => '');
            console.log(`  Confirming: ${message}`);
          }
          await confirmBtn.click();
          await page.waitForTimeout(100);
        }
        await page.waitForTimeout(200);
      } catch {
        // ignore errors during polling (including "Test ended")
        break;
      }
    }
  };

  poll(); // fire and forget

  return () => {
    active = false;
  };
}

/**
 * Set up automatic dismissal for ConfirmModal dialogs.
 * Clicks the cancel button whenever a confirm modal appears.
 * Returns a cleanup function to stop auto-dismissing.
 * @param page - Playwright page object
 * @param logMessage - Whether to log dismissal (default: true)
 * @returns Cleanup function to stop the observer
 */
export function handleDismissDialog(page: Page, logMessage: boolean = true): () => void {
  let active = true;

  const poll = async () => {
    while (active) {
      try {
        const cancelBtn = page.locator('.confirm-btn--cancel');
        if (await cancelBtn.isVisible({ timeout: 200 }).catch(() => false)) {
          if (logMessage) {
            const message = await page.locator('.confirm-message').textContent().catch(() => '');
            console.log(`  Dismissing: ${message}`);
          }
          await cancelBtn.click();
          await page.waitForTimeout(100);
        }
        await page.waitForTimeout(200);
      } catch {
        // ignore errors during polling (including "Test ended")
        break;
      }
    }
  };

  poll(); // fire and forget

  return () => {
    active = false;
  };
}

/**
 * Wait for a ConfirmModal to appear and click the confirm button.
 * @param page - Playwright page object
 */
export async function clickConfirmModalConfirm(page: Page) {
  await page.locator('.confirm-overlay').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('.confirm-btn--confirm').click();
  await page.waitForTimeout(100);
}

/**
 * Wait for a ConfirmModal to appear and click the cancel button.
 * @param page - Playwright page object
 */
export async function clickConfirmModalCancel(page: Page) {
  await page.locator('.confirm-overlay').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('.confirm-btn--cancel').click();
  await page.waitForTimeout(100);
}

/**
 * Swipe an item to reveal the delete button and click it
 * This simulates the swipe-to-delete interaction for teams, players, and formations
 * @param page - Playwright page object
 * @param itemSelector - Selector for the item card to swipe
 */
export async function swipeToDelete(page: Page, itemSelector: string) {
  // Locate the swipeable container (use .first() if selector matches multiple elements)
  const itemCard = page.locator(itemSelector).first();
  
  // Get the bounding box to calculate swipe coordinates
  const box = await itemCard.boundingBox();
  if (!box) {
    throw new Error('Could not get bounding box for item');
  }
  
  // Perform a mouse drag from right to left to reveal delete button
  // Start from the right edge, drag left by 100px
  const startX = box.x + box.width - 10;
  const startY = box.y + box.height / 2;
  const endX = startX - 100;
  const endY = startY;
  
  // Perform the drag operation
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();
  
  // Wait for animation to complete
  await page.waitForTimeout(UI_TIMING.STANDARD);
  
  // Click the delete button that's now visible
  const deleteButton = page.locator('.btn-delete-swipe').first();
  await deleteButton.click();
  await page.waitForTimeout(UI_TIMING.QUICK);
}