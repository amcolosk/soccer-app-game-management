import { test, expect, Page } from '@playwright/test';
import {
  waitForPageLoad,
  fillInput,
  clickButton,
  closePWAPrompt,
  cleanupTestData,
  loginUser,
  navigateToManagement,
  clickManagementTab,
  handleConfirmDialog,
  UI_TIMING,
} from './helpers';
import { TEST_USERS, TEST_CONFIG } from '../test-config';

/**
 * Formation Management CRUD Test Suite
 * Tests Create, Read, Update, and Delete operations for formations in the Management tab
 */

// Test data
const TEST_DATA = {
  formation1: {
    name: '4-3-3',
    playerCount: '11',
    positions: [
      { name: 'Goalkeeper', abbreviation: 'GK' },
      { name: 'Left Back', abbreviation: 'LB' },
      { name: 'Center Back Left', abbreviation: 'CBL' },
      { name: 'Center Back Right', abbreviation: 'CBR' },
      { name: 'Right Back', abbreviation: 'RB' },
      { name: 'Center Midfielder', abbreviation: 'CM' },
      { name: 'Left Midfielder', abbreviation: 'LM' },
      { name: 'Right Midfielder', abbreviation: 'RM' },
      { name: 'Left Forward', abbreviation: 'LF' },
      { name: 'Center Forward', abbreviation: 'CF' },
      { name: 'Right Forward', abbreviation: 'RF' },
    ],
  },
  formation2: {
    name: '4-4-2',
    playerCount: '11',
    positions: [
      { name: 'Goalkeeper', abbreviation: 'GK' },
      { name: 'Left Back', abbreviation: 'LB' },
      { name: 'Center Back Left', abbreviation: 'CBL' },
      { name: 'Center Back Right', abbreviation: 'CBR' },
      { name: 'Right Back', abbreviation: 'RB' },
      { name: 'Left Midfielder', abbreviation: 'LM' },
      { name: 'Center Midfielder Left', abbreviation: 'CML' },
      { name: 'Center Midfielder Right', abbreviation: 'CMR' },
      { name: 'Right Midfielder', abbreviation: 'RM' },
      { name: 'Striker Left', abbreviation: 'STL' },
      { name: 'Striker Right', abbreviation: 'STR' },
    ],
  },
  formation3: {
    name: '3-5-2',
    playerCount: '7',
    positions: [
      { name: 'Goalkeeper', abbreviation: 'GK' },
      { name: 'Defender', abbreviation: 'D' },
      { name: 'Midfielder', abbreviation: 'M' },
      { name: 'Forward', abbreviation: 'F' },
    ],
  },
};

test.describe('Formation Management CRUD', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.long);
  });

  test('should perform complete CRUD operations on formations', async ({ page }) => {
    console.log('\n=== Starting Formation CRUD Test ===\n');
    
    // Login
    console.log('Step 1: Login');
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    console.log('✓ Logged in\n');
    
    // Navigate to Management
    console.log('Step 2: Navigate to Management');
    await navigateToManagement(page);
    console.log('✓ On Management page\n');
    
    // Clean up any existing data
    console.log('Step 3: Clean up existing data');
    await cleanupTestData(page);
    console.log('');
    
    // ===== CREATE: Create first formation =====
    console.log('Step 4: CREATE - Create first formation');
    await clickManagementTab(page, 'Formations');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Verify empty state
    await expect(page.locator('.empty-message')).toBeVisible();
    await expect(page.locator('.empty-message')).toContainText('No formations yet');
    console.log('  ✓ Empty state visible');
    
    // Click Create Formation button
    await clickButton(page, '+ Create Formation');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Verify form is visible
    await expect(page.locator('.create-form')).toBeVisible();
    await expect(page.locator('h3:has-text("Create New Formation")')).toBeVisible();
    console.log('  ✓ Create form visible');
    
    // Fill in formation details
    await fillInput(page, 'input[placeholder*="Formation Name"]', TEST_DATA.formation1.name);
    await fillInput(page, 'input[placeholder*="Number of Players"]', TEST_DATA.formation1.playerCount);
    console.log('  ✓ Basic form filled');
    
    // Add positions
    for (let i = 0; i < TEST_DATA.formation1.positions.length; i++) {
      const pos = TEST_DATA.formation1.positions[i];
      
      // Click Add Position button
      await clickButton(page, '+ Add Position');
      await page.waitForTimeout(UI_TIMING.QUICK);
      
      // Fill in position details - target the last position row
      const positionRows = page.locator('.position-row');
      const lastRow = positionRows.last();
      
      await lastRow.locator('input[placeholder*="Position Name"]').fill(pos.name);
      await lastRow.locator('input[placeholder*="Abbreviation"]').fill(pos.abbreviation);
      
      console.log(`  ✓ Added position ${i + 1}: ${pos.abbreviation}`);
    }
    
    // Submit
    await clickButton(page, 'Create');
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    
    // Verify formation was created
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.formation1.name })).toBeVisible();
    console.log('  ✓ Formation created\n');
    
    // ===== CREATE: Create second formation =====
    console.log('Step 5: CREATE - Create second formation');
    await clickButton(page, '+ Create Formation');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    await fillInput(page, 'input[placeholder*="Formation Name"]', TEST_DATA.formation2.name);
    await fillInput(page, 'input[placeholder*="Number of Players"]', TEST_DATA.formation2.playerCount);
    
    // Add positions for second formation
    for (let i = 0; i < TEST_DATA.formation2.positions.length; i++) {
      const pos = TEST_DATA.formation2.positions[i];
      await clickButton(page, '+ Add Position');
      await page.waitForTimeout(UI_TIMING.QUICK);
      
      const positionRows = page.locator('.position-row');
      const lastRow = positionRows.last();
      await lastRow.locator('input[placeholder*="Position Name"]').fill(pos.name);
      await lastRow.locator('input[placeholder*="Abbreviation"]').fill(pos.abbreviation);
    }
    
    await clickButton(page, 'Create');
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.formation2.name })).toBeVisible();
    console.log('  ✓ Second formation created\n');
    
    // ===== READ: Verify both formations are listed =====
    console.log('Step 6: READ - Verify formations list');
    const formationCards = page.locator('.item-card');
    const formationCount = await formationCards.count();
    expect(formationCount).toBe(2);
    console.log(`  ✓ Found ${formationCount} formations`);
    
    // Verify first formation details
    const formation1Card = page.locator('.item-card').filter({ hasText: TEST_DATA.formation1.name });
    await expect(formation1Card.locator('h3')).toContainText(TEST_DATA.formation1.name);
    await expect(formation1Card.locator('.item-meta').first()).toContainText(`${TEST_DATA.formation1.playerCount} players`);
    // Check that some positions are listed
    await expect(formation1Card.locator('.item-meta').last()).toContainText('GK');
    await expect(formation1Card.locator('.item-meta').last()).toContainText('CF');
    console.log('  ✓ Formation 1 details verified');
    
    // Verify second formation details
    const formation2Card = page.locator('.item-card').filter({ hasText: TEST_DATA.formation2.name });
    await expect(formation2Card.locator('h3')).toContainText(TEST_DATA.formation2.name);
    await expect(formation2Card.locator('.item-meta').first()).toContainText(`${TEST_DATA.formation2.playerCount} players`);
    await expect(formation2Card.locator('.item-meta').last()).toContainText('GK');
    console.log('  ✓ Formation 2 details verified\n');
    
    // ===== UPDATE: Verify data persistence =====
    console.log('Step 7: UPDATE - Verify data persistence');
    // Note: The current Management component doesn't have an edit/update feature for formations
    // Formations can only be created and deleted, not updated in the UI
    // We'll verify that the formation data persists correctly after page reload
    
    // Reload page to verify data persistence
    await page.reload();
    await waitForPageLoad(page);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Formations');
    await page.waitForTimeout(UI_TIMING.NAVIGATION);
    
    // Verify formations still exist after reload
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.formation1.name })).toBeVisible();
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.formation2.name })).toBeVisible();
    console.log('  ✓ Formations persist after reload');
    console.log('  ℹ Note: Formation update UI not available, only create/delete\n');
    
    // ===== DELETE: Delete second formation =====
    console.log('Step 8: DELETE - Delete second formation');
    
    // Set up dialog handler
    const cleanupDialog = handleConfirmDialog(page);
    
    // Click delete button on second formation
    const formation2DeleteBtn = page.locator('.item-card')
      .filter({ hasText: TEST_DATA.formation2.name })
      .locator('.btn-delete');
    await formation2DeleteBtn.click();
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    
    // Verify second formation is deleted
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.formation2.name })).not.toBeVisible();
    console.log('  ✓ Formation 2 deleted');
    
    // Verify first formation still exists
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.formation1.name })).toBeVisible();
    console.log('  ✓ Formation 1 still exists');
    
    // Verify count is now 1
    const remainingFormations = await page.locator('.item-card').count();
    expect(remainingFormations).toBe(1);
    console.log(`  ✓ Formation count: ${remainingFormations}\n`);
    
    // ===== DELETE: Delete first formation =====
    console.log('Step 9: DELETE - Delete first formation');
    
    // Dialog handler still active
    const formation1DeleteBtn = page.locator('.item-card')
      .filter({ hasText: TEST_DATA.formation1.name })
      .locator('.btn-delete');
    await formation1DeleteBtn.click();
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    
    // Verify first formation is deleted
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.formation1.name })).not.toBeVisible();
    console.log('  ✓ Formation 1 deleted');
    
    // Clean up dialog handler
    cleanupDialog();
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.formation1.name })).not.toBeVisible();
    console.log('  ✓ Formation 1 deleted');
    
    // Verify empty state returns
    await expect(page.locator('.empty-message')).toBeVisible();
    await expect(page.locator('.empty-message')).toContainText('No formations yet');
    console.log('  ✓ Empty state visible again');
    
    // Remove dialog handler
    page.removeAllListeners('dialog');
    
    console.log('\n=== Formation CRUD Test Completed Successfully ===\n');
  });
  
  test('should validate formation creation form', async ({ page }) => {
    console.log('\n=== Testing Formation Form Validation ===\n');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await cleanupTestData(page);
    await clickManagementTab(page, 'Formations');
    
    console.log('Step 1: Test empty form submission');
    await clickButton(page, '+ Create Formation');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    // Set up dialog handler to capture validation message
    let alertMessage = '';
    page.once('dialog', async (dialog) => {
      alertMessage = dialog.message();
      console.log(`  Alert shown: "${alertMessage}"`);
      await dialog.accept();
    });
    
    // Try to submit without filling anything
    await clickButton(page, 'Create');
    await page.waitForTimeout(UI_TIMING.NAVIGATION);
    
    // Verify alert was shown
    expect(alertMessage).toContain('formation name');
    console.log('  ✓ Validation triggered for empty fields\n');
    
    console.log('Step 2: Test form with name but no player count');
    await fillInput(page, 'input[placeholder*="Formation Name"]', 'Test Formation');
    
    page.once('dialog', async (dialog) => {
      alertMessage = dialog.message();
      console.log(`  Alert shown: "${alertMessage}"`);
      await dialog.accept();
    });
    
    await clickButton(page, 'Create');
    await page.waitForTimeout(UI_TIMING.NAVIGATION);
    
    expect(alertMessage).toContain('player count');
    console.log('  ✓ Validation triggered for missing player count\n');
    
    console.log('Step 3: Test form with name and player count but no positions');
    await fillInput(page, 'input[placeholder*="Number of Players"]', '7');
    
    page.once('dialog', async (dialog) => {
      alertMessage = dialog.message();
      console.log(`  Alert shown: "${alertMessage}"`);
      await dialog.accept();
    });
    
    await clickButton(page, 'Create');
    await page.waitForTimeout(UI_TIMING.NAVIGATION);
    
    expect(alertMessage).toContain('position');
    console.log('  ✓ Validation triggered for missing positions\n');
    
    console.log('Step 4: Test successful creation with all fields');
    // Add one position
    await clickButton(page, '+ Add Position');
    await page.waitForTimeout(UI_TIMING.QUICK);
    
    const positionRow = page.locator('.position-row').last();
    await positionRow.locator('input[placeholder*="Position Name"]').fill('Forward');
    await positionRow.locator('input[placeholder*="Abbreviation"]').fill('FW');
    
    await clickButton(page, 'Create');
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    
    // Verify formation was created
    await expect(page.locator('.item-card').filter({ hasText: 'Test Formation' })).toBeVisible();
    console.log('  ✓ Formation created successfully with valid data\n');
    
    console.log('\n=== Formation Form Validation Test Completed Successfully ===\n');
  });

  test('should handle position addition and removal', async ({ page }) => {
    console.log('\n=== Testing Position Addition and Removal ===\n');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await cleanupTestData(page);
    await clickManagementTab(page, 'Formations');
    
    console.log('Step 1: Open formation creation form');
    await clickButton(page, '+ Create Formation');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    await fillInput(page, 'input[placeholder*="Formation Name"]', TEST_DATA.formation3.name);
    await fillInput(page, 'input[placeholder*="Number of Players"]', TEST_DATA.formation3.playerCount);
    console.log('  ✓ Basic form filled\n');
    
    console.log('Step 2: Add multiple positions');
    for (let i = 0; i < TEST_DATA.formation3.positions.length; i++) {
      const pos = TEST_DATA.formation3.positions[i];
      await clickButton(page, '+ Add Position');
      await page.waitForTimeout(UI_TIMING.QUICK);
      
      const positionRows = page.locator('.position-row');
      const count = await positionRows.count();
      expect(count).toBe(i + 1);
      
      const lastRow = positionRows.last();
      await lastRow.locator('input[placeholder*="Position Name"]').fill(pos.name);
      await lastRow.locator('input[placeholder*="Abbreviation"]').fill(pos.abbreviation);
      
      console.log(`  ✓ Added position ${i + 1}: ${pos.name}`);
    }
    
    const totalPositions = await page.locator('.position-row').count();
    expect(totalPositions).toBe(TEST_DATA.formation3.positions.length);
    console.log(`  ✓ Total positions: ${totalPositions}\n`);
    
    console.log('Step 3: Remove a position');
    // Remove the second position
    const secondRow = page.locator('.position-row').nth(1);
    await secondRow.locator('.btn-delete').click();
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    const remainingPositions = await page.locator('.position-row').count();
    expect(remainingPositions).toBe(TEST_DATA.formation3.positions.length - 1);
    console.log(`  ✓ Position removed, remaining: ${remainingPositions}\n`);
    
    console.log('Step 4: Add position back');
    await clickButton(page, '+ Add Position');
    await page.waitForTimeout(UI_TIMING.QUICK);
    
    const lastRow = page.locator('.position-row').last();
    await lastRow.locator('input[placeholder*="Position Name"]').fill('New Position');
    await lastRow.locator('input[placeholder*="Abbreviation"]').fill('NP');
    
    const finalCount = await page.locator('.position-row').count();
    expect(finalCount).toBe(TEST_DATA.formation3.positions.length);
    console.log(`  ✓ Position added back, total: ${finalCount}\n`);
    
    console.log('Step 5: Submit formation');
    await clickButton(page, 'Create');
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    
    await expect(page.locator('.item-card').filter({ hasText: TEST_DATA.formation3.name })).toBeVisible();
    console.log('  ✓ Formation created with modified positions\n');
    
    console.log('\n=== Position Addition/Removal Test Completed Successfully ===\n');
  });

  test('should edit and update a formation', async ({ page }) => {
    console.log('\n=== Testing Formation Edit/Update ===\n');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await cleanupTestData(page);
    await clickManagementTab(page, 'Formations');
    
    // Create initial formation
    console.log('Step 1: Create initial formation');
    await clickButton(page, '+ Create Formation');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    await fillInput(page, 'input[placeholder*="Formation Name"]', '4-4-2');
    await fillInput(page, 'input[placeholder*="Number of Players"]', '11');
    
    // Add initial positions
    const initialPositions = [
      { name: 'Goalkeeper', abbreviation: 'GK' },
      { name: 'Defender', abbreviation: 'DEF' },
      { name: 'Midfielder', abbreviation: 'MID' },
      { name: 'Striker', abbreviation: 'STR' },
    ];
    
    for (const pos of initialPositions) {
      await clickButton(page, '+ Add Position');
      await page.waitForTimeout(UI_TIMING.QUICK);
      
      const positionRows = page.locator('.position-row');
      const lastRow = positionRows.last();
      await lastRow.locator('input[placeholder*="Position Name"]').fill(pos.name);
      await lastRow.locator('input[placeholder*="Abbreviation"]').fill(pos.abbreviation);
    }
    
    await clickButton(page, 'Create');
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    
    await expect(page.locator('.item-card').filter({ hasText: '4-4-2' })).toBeVisible();
    console.log('  ✓ Initial formation created\n');
    
    // Click edit button
    console.log('Step 2: Click edit button');
    const formationCard = page.locator('.item-card').filter({ hasText: '4-4-2' });
    const editBtn = formationCard.locator('.btn-edit');
    await editBtn.click();
    await page.waitForTimeout(UI_TIMING.NAVIGATION);
    
    // Verify edit form is visible with existing data
    await expect(page.locator('.create-form')).toBeVisible();
    await expect(page.locator('h3:has-text("Edit Formation")')).toBeVisible();
    console.log('  ✓ Edit form visible');
    
    // Verify form is pre-filled
    const nameInput = page.locator('input[placeholder*="Formation Name"]');
    const countInput = page.locator('input[placeholder*="Number of Players"]');
    await expect(nameInput).toHaveValue('4-4-2');
    await expect(countInput).toHaveValue('11');
    console.log('  ✓ Form pre-filled with existing data');
    
    // Verify positions are loaded
    const positionRows = page.locator('.position-row');
    const positionCount = await positionRows.count();
    expect(positionCount).toBe(4);
    console.log(`  ✓ Positions loaded: ${positionCount}\n`);
    
    // Update formation name and player count
    console.log('Step 3: Update formation details');
    await nameInput.fill('3-5-2');
    await countInput.fill('8');
    console.log('  ✓ Updated name and player count');
    
    // Remove one position
    const secondRow = positionRows.nth(1);
    await secondRow.locator('.btn-delete').click();
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    const updatedCount = await page.locator('.position-row').count();
    expect(updatedCount).toBe(3);
    console.log('  ✓ Removed one position');
    
    // Add a new position
    await clickButton(page, '+ Add Position');
    await page.waitForTimeout(UI_TIMING.QUICK);
    
    const newRow = page.locator('.position-row').last();
    await newRow.locator('input[placeholder*="Position Name"]').fill('Wing Back');
    await newRow.locator('input[placeholder*="Abbreviation"]').fill('WB');
    console.log('  ✓ Added new position');
    
    // Modify an existing position
    const firstRow = page.locator('.position-row').first();
    await firstRow.locator('input[placeholder*="Abbreviation"]').fill('GKP');
    console.log('  ✓ Modified existing position\n');
    
    // Submit update
    console.log('Step 4: Submit update');
    await clickButton(page, 'Update');
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    
    // Verify formation was updated
    await expect(page.locator('.item-card').filter({ hasText: '3-5-2' })).toBeVisible();
    await expect(page.locator('.item-card').filter({ hasText: '4-4-2' })).not.toBeVisible();
    console.log('  ✓ Formation name updated');
    
    // Verify updated details
    const updatedCard = page.locator('.item-card').filter({ hasText: '3-5-2' });
    await expect(updatedCard.locator('.item-meta').first()).toContainText('8 players');
    await expect(updatedCard.locator('.item-meta').last()).toContainText('GKP');
    await expect(updatedCard.locator('.item-meta').last()).toContainText('WB');
    await expect(updatedCard.locator('.item-meta').last()).not.toContainText('DEF');
    console.log('  ✓ All details updated correctly\n');
    
    console.log('\n=== Formation Edit/Update Test Completed Successfully ===\n');
  });

  test('should cancel formation edit without saving', async ({ page }) => {
    console.log('\n=== Testing Formation Edit Cancellation ===\n');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await cleanupTestData(page);
    await clickManagementTab(page, 'Formations');
    
    // Create formation
    console.log('Step 1: Create formation');
    await clickButton(page, '+ Create Formation');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    
    await fillInput(page, 'input[placeholder*="Formation Name"]', 'Original Formation');
    await fillInput(page, 'input[placeholder*="Number of Players"]', '7');
    
    await clickButton(page, '+ Add Position');
    await page.waitForTimeout(UI_TIMING.QUICK);
    const positionRow = page.locator('.position-row').last();
    await positionRow.locator('input[placeholder*="Position Name"]').fill('Forward');
    await positionRow.locator('input[placeholder*="Abbreviation"]').fill('FW');
    
    await clickButton(page, 'Create');
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    
    await expect(page.locator('.item-card').filter({ hasText: 'Original Formation' })).toBeVisible();
    console.log('  ✓ Formation created\n');
    
    // Start editing
    console.log('Step 2: Start editing');
    const editBtn = page.locator('.item-card')
      .filter({ hasText: 'Original Formation' })
      .locator('.btn-edit');
    await editBtn.click();
    await page.waitForTimeout(UI_TIMING.NAVIGATION);
    
    await expect(page.locator('h3:has-text("Edit Formation")')).toBeVisible();
    console.log('  ✓ Edit form opened');
    
    // Make changes
    await page.locator('input[placeholder*="Formation Name"]').fill('Changed Name');
    await page.locator('input[placeholder*="Number of Players"]').fill('10');
    console.log('  ✓ Made changes to form\n');
    
    // Cancel edit
    console.log('Step 3: Cancel edit');
    await clickButton(page, 'Cancel');
    await page.waitForTimeout(UI_TIMING.NAVIGATION);
    
    // Verify form is closed
    await expect(page.locator('.create-form')).not.toBeVisible();
    console.log('  ✓ Edit form closed');
    
    // Verify original data is unchanged
    const formationCard = page.locator('.item-card').filter({ hasText: 'Original Formation' });
    await expect(formationCard).toBeVisible();
    await expect(formationCard.locator('.item-meta').first()).toContainText('7 players');
    await expect(page.locator('.item-card').filter({ hasText: 'Changed Name' })).not.toBeVisible();
    console.log('  ✓ Original data unchanged\n');
    
    console.log('\n=== Formation Edit Cancellation Test Completed Successfully ===\n');
  });

  test('should clean up all formation data', async ({ page }) => {
    console.log('\n=== Testing Formation Data Cleanup ===\n');
    
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    
    // Use the cleanup helper
    await cleanupTestData(page);
    
    // Verify formations are cleaned up
    await clickManagementTab(page, 'Formations');
    await page.waitForTimeout(UI_TIMING.NAVIGATION);
    
    await expect(page.locator('.empty-message')).toBeVisible();
    await expect(page.locator('.empty-message')).toContainText('No formations yet');
    console.log('  ✓ All formations cleaned up\n');
    
    console.log('\n=== Formation Cleanup Test Completed Successfully ===\n');
  });
});


