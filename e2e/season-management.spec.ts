import { test, expect, Page } from '@playwright/test';
import {
  waitForPageLoad,
  fillInput,
  clickButton,
  clickButtonByText,
  waitForElement,
  closePWAPrompt,
  loginUser,
  navigateToManagement,
  clickManagementTab,
  handleConfirmDialog,
  UI_TIMING,
} from './helpers';
import { TEST_USERS, TEST_CONFIG } from '../test-config';

test.describe('Season Management', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.medium);
  });

  test('should display seasons management page', async ({ page }) => {
    console.log('Testing seasons page display...');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    
    // Verify management page sections
    await expect(page.locator('.management')).toBeVisible();
    await expect(page.locator('h2:has-text("Management")')).toBeVisible();
    
    // Verify Seasons tab is present
    await expect(page.getByRole('button', { name: /^Seasons/ })).toBeVisible();
    
    console.log('✓ Seasons management page displayed');
  });

  test('should create a new season', async ({ page }) => {
    console.log('Testing season creation...');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Seasons');
    
    // Click Create New Season button
    await clickButton(page, '+ Create New Season');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Verify form is visible
    await expect(page.locator('.create-form')).toBeVisible();
    await expect(page.locator('h3:has-text("Create New Season")')).toBeVisible();
    
    // Fill in season details
    const seasonName = `Test Season ${Date.now()}`;
    const seasonYear = '2025';
    
    await fillInput(page, 'input[placeholder*="Season Name"]', seasonName);
    await fillInput(page, 'input[placeholder*="Year"]', seasonYear);
    
    // Submit form
    await clickButton(page, 'Create');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Verify season appears in the list
    await expect(page.locator('.item-card').filter({ hasText: seasonName })).toBeVisible();
    await expect(page.locator(`text=${seasonYear}`).first()).toBeVisible();
    
    console.log('✓ Season created successfully');
  });

  test('should edit an existing season', async ({ page }) => {
    console.log('Testing season editing...');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Seasons');
    
    // Create a season first
    await clickButton(page, '+ Create New Season');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    const originalName = `Edit Test ${Date.now()}`;
    const originalYear = '2025';
    
    await fillInput(page, 'input[placeholder*="Season Name"]', originalName);
    await fillInput(page, 'input[placeholder*="Year"]', originalYear);
    await clickButton(page, 'Create');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Find the season card and click edit button
    const seasonCard = page.locator('.item-card').filter({ hasText: originalName });
    await expect(seasonCard).toBeVisible();
    
    const editButton = seasonCard.locator('button[aria-label="Edit season"]');
    await editButton.click();
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Verify edit form is visible
    await expect(page.locator('h3:has-text("Edit Season")')).toBeVisible();
    
    // Verify form is pre-filled
    await expect(page.locator('input[placeholder*="Season Name"]')).toHaveValue(originalName);
    await expect(page.locator('input[placeholder*="Year"]')).toHaveValue(originalYear);
    
    // Update season details
    const updatedName = `${originalName} Updated`;
    const updatedYear = '2026';
    
    await page.locator('input[placeholder*="Season Name"]').clear();
    await fillInput(page, 'input[placeholder*="Season Name"]', updatedName);
    await page.locator('input[placeholder*="Year"]').clear();
    await fillInput(page, 'input[placeholder*="Year"]', updatedYear);
    
    // Submit update
    await clickButton(page, 'Update');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Verify updated season appears in the list
    await expect(page.locator('.item-card').filter({ hasText: updatedName })).toBeVisible();
    await expect(page.locator(`text=${updatedYear}`).first()).toBeVisible();
    
    console.log('✓ Season updated successfully');
  });

  test('should archive a season', async ({ page }) => {
    console.log('Testing season archiving...');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Seasons');
    
    // Create a season
    await clickButton(page, '+ Create New Season');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    const seasonName = `Archive Test ${Date.now()}`;
    await fillInput(page, 'input[placeholder*="Season Name"]', seasonName);
    await fillInput(page, 'input[placeholder*="Year"]', '2024');
    await clickButton(page, 'Create');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Edit the season to archive it
    const seasonCard = page.locator('.item-card').filter({ hasText: seasonName });
    const editButton = seasonCard.locator('button[aria-label="Edit season"]');
    await editButton.click();
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Check the archive checkbox - locate by the label container
    const archiveCheckbox = page.locator('.checkbox-label:has-text("Archive")').locator('input[type="checkbox"]');
    await archiveCheckbox.check();
    
    // Submit update
    await clickButton(page, 'Update');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Verify season has archived badge - scoped to THIS season
    const updatedSeasonCard = page.locator('.item-card').filter({ hasText: seasonName });
    await expect(updatedSeasonCard).toBeVisible();
    await expect(updatedSeasonCard.locator('span:has-text("📦 Archived")')).toBeVisible();
    
    // Verify archived card has special styling
    const archivedCard = page.locator('.item-card.archived').filter({ hasText: seasonName });
    await expect(archivedCard).toBeVisible();
    
    console.log('✓ Season archived successfully');
  });

  test('should unarchive a season', async ({ page }) => {
    console.log('Testing season unarchiving...');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Seasons');
    
    // Create and archive a season
    await clickButton(page, '+ Create New Season');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    const seasonName = `Unarchive Test ${Date.now()}`;
    await fillInput(page, 'input[placeholder*="Season Name"]', seasonName);
    await fillInput(page, 'input[placeholder*="Year"]', '2024');
    await clickButton(page, 'Create');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Archive it
    let seasonCard = page.locator('.item-card').filter({ hasText: seasonName });
    let editButton = seasonCard.locator('button[aria-label="Edit season"]');
    await editButton.click();
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    await page.locator('.checkbox-label:has-text("Archive")').locator('input[type="checkbox"]').check();
    await clickButton(page, 'Update');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Now unarchive it
    seasonCard = page.locator('.item-card').filter({ hasText: seasonName });
    editButton = seasonCard.locator('button[aria-label="Edit season"]');
    await editButton.click();
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    await page.locator('.checkbox-label:has-text("Archive")').locator('input[type="checkbox"]').uncheck();
    await clickButton(page, 'Update');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Verify archived badge is gone from THIS specific season
    seasonCard = page.locator('.item-card').filter({ hasText: seasonName });
    const archivedBadge = await seasonCard.locator('span:has-text("📦 Archived")').count();
    expect(archivedBadge).toBe(0);
    
    console.log('✓ Season unarchived successfully');
  });

  test('should delete a season', async ({ page }) => {
    console.log('Testing season deletion...');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Seasons');
    
    // Create a season to delete
    await clickButton(page, '+ Create New Season');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    const seasonName = `Delete Test ${Date.now()}`;
    await fillInput(page, 'input[placeholder*="Season Name"]', seasonName);
    await fillInput(page, 'input[placeholder*="Year"]', '2023');
    await clickButton(page, 'Create');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Verify season exists
    await expect(page.locator('.item-card').filter({ hasText: seasonName })).toBeVisible();
    
    // Click delete button
    const seasonCard = page.locator('.item-card').filter({ hasText: seasonName });
    const deleteButton = seasonCard.locator('button[aria-label="Delete season"]');
    
    // Set up dialog handler for confirmation
    const cleanupDialog = handleConfirmDialog(page, false);
    
    await deleteButton.click();
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Verify season is deleted
    const deletedSeason = await page.locator('.item-card').filter({ hasText: seasonName }).count();
    expect(deletedSeason).toBe(0);
    
    // Clean up dialog handler
    cleanupDialog();
    
    console.log('✓ Season deleted successfully');
  });

  test('should cancel season creation', async ({ page }) => {
    console.log('Testing cancel season creation...');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Seasons');
    
    // Get initial season count
    const initialCount = await page.locator('.item-card').count();
    
    // Click Create New Season
    await clickButton(page, '+ Create New Season');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Fill form partially
    await fillInput(page, 'input[placeholder*="Season Name"]', 'Cancelled Season');
    
    // Click Cancel
    await clickButton(page, 'Cancel');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Verify form is hidden
    const formVisible = await page.locator('.create-form').count();
    expect(formVisible).toBe(0);
    
    // Verify create button is visible again
    await expect(page.getByRole('button', { name: '+ Create New Season' })).toBeVisible();
    
    // Verify no new season was created
    const finalCount = await page.locator('.item-card').count();
    expect(finalCount).toBe(initialCount);
    
    console.log('✓ Season creation cancelled successfully');
  });

  test('should cancel season edit', async ({ page }) => {
    console.log('Testing cancel season edit...');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Seasons');
    
    // Create a season
    await clickButton(page, '+ Create New Season');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    const originalName = `Cancel Edit ${Date.now()}`;
    const originalYear = '2025';
    
    await fillInput(page, 'input[placeholder*="Season Name"]', originalName);
    await fillInput(page, 'input[placeholder*="Year"]', originalYear);
    await clickButton(page, 'Create');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    
    // Click edit
    const seasonCard = page.locator('.item-card').filter({ hasText: originalName });
    const editButton = seasonCard.locator('button[aria-label="Edit season"]');
    await editButton.click();
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Modify the name
    await page.locator('input[placeholder*="Season Name"]').clear();
    await fillInput(page, 'input[placeholder*="Season Name"]', 'Modified Name');
    
    // Cancel edit
    await clickButton(page, 'Cancel');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Verify original name is still displayed
    await expect(page.locator('.item-card').filter({ hasText: originalName })).toBeVisible();
    
    // Verify modified name is not in the list
    const modifiedCard = await page.locator('.item-card').filter({ hasText: 'Modified Name' }).count();
    expect(modifiedCard).toBe(0);
    
    console.log('✓ Season edit cancelled successfully');
  });

  test('should validate required fields on season creation', async ({ page }) => {
    console.log('Testing season creation validation...');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Seasons');
    
    // Click Create New Season
    await clickButton(page, '+ Create New Season');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Try to submit empty form
    const initialCount = await page.locator('.item-card').count();
    
    // Set up dialog handler for alert
    let alertShown = false;
    page.on('dialog', async dialog => {
      if (dialog.type() === 'alert') {
        expect(dialog.message()).toContain('season name and year');
        alertShown = true;
        await dialog.accept();
      }
    });
    
    await clickButton(page, 'Create');
    await page.waitForTimeout(UI_TIMING.NAVIGATION);
    
    // Verify alert was shown
    expect(alertShown).toBe(true);
    
    // Verify no season was created
    const finalCount = await page.locator('.item-card').count();
    expect(finalCount).toBe(initialCount);
    
    console.log('✓ Validation working correctly');
  });

  test('should display empty state when no seasons exist', async ({ page }) => {
    console.log('Testing empty state...');
    
    await loginUser(page, TEST_USERS.user2.email, TEST_USERS.user2.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Seasons');
    
    // Check if empty message or create button is visible
    const hasSeasons = await page.locator('.item-card').count() > 0;
    
    if (!hasSeasons) {
      // Verify empty state message
      await expect(page.locator('text=/No seasons yet/i')).toBeVisible();
    }
    
    // Create button should always be visible
    await expect(page.getByRole('button', { name: '+ Create New Season' })).toBeVisible();
    
    console.log('✓ Empty state handled correctly');
  });
});


