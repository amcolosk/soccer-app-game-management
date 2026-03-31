import { test, expect } from '@playwright/test';
import {
  fillInput,
  clickButton,
  cleanupTestData,
  loginUser,
  navigateToManagement,
  clickManagementTab,
  createTeam,
  createFormation,
  addPlayerToRoster,
  swipeToDelete,
  clickConfirmModalConfirm,
  clickConfirmModalCancel,
  handleConfirmDialog,
  UI_TIMING,
} from './helpers';
import { TEST_USERS, TEST_CONFIG } from '../test-config';

/**
 * Safe Delete Guards E2E Test Suite
 *
 * Verifies that the application correctly:
 * 1. Blocks formation deletion when a team is using it (shows error toast with team name).
 * 2. Allows formation deletion when no team references it (normal confirm dialog).
 * 3. Shows a warning confirmation dialog with "Delete Anyway" before deleting a player
 *    that is on a team roster.
 * 4. Shows the standard danger dialog when deleting a player with no roster membership.
 */

const TEST_DATA = {
  formation: {
    name: 'Safe Delete Guard Formation',
    playerCount: '7',
    positions: [
      { name: 'Goalkeeper', abbreviation: 'GK' },
      { name: 'Left Defender', abbreviation: 'LD' },
      { name: 'Center Defender', abbreviation: 'CD' },
      { name: 'Right Defender', abbreviation: 'RD' },
      { name: 'Left Midfielder', abbreviation: 'LM' },
      { name: 'Center Midfielder', abbreviation: 'CM' },
      { name: 'Forward', abbreviation: 'FW' },
    ],
  },
  team: {
    name: 'Safe Delete Guard Team',
    maxPlayers: '7',
    halfLength: '25',
  },
  playerWithRoster: {
    firstName: 'RosterPlayer',
    lastName: 'SafeDelete',
    number: '7',
  },
  playerNoRoster: {
    firstName: 'NoRosterPlayer',
    lastName: 'SafeDelete',
  },
};

test.describe('Safe Delete Guards', () => {
  test.beforeEach(async () => {
    test.setTimeout(TEST_CONFIG.timeout.long);
  });

  // ---------------------------------------------------------------------------
  // Formation guard tests
  // ---------------------------------------------------------------------------

  test('should block formation deletion when a team is using it', async ({ page }) => {
    console.log('\n=== Safe Delete: Formation In-Use Guard ===\n');

    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await cleanupTestData(page);

    // Step 1: Create the formation
    console.log('Step 1: Create formation');
    await createFormation(page, TEST_DATA.formation);

    // Step 2: Create a team that uses the formation
    console.log('Step 2: Create team linked to the formation');
    const formationLabel = `${TEST_DATA.formation.name} (${TEST_DATA.formation.playerCount} players)`;
    await createTeam(page, TEST_DATA.team, formationLabel);

    // Step 3: Navigate to Formations tab and attempt to delete the formation
    console.log('Step 3: Attempt to delete the in-use formation');
    await clickManagementTab(page, 'Formations');
    await page.waitForTimeout(UI_TIMING.STANDARD);

    await swipeToDelete(page, `.item-card:has-text("${TEST_DATA.formation.name}")`);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

    // Step 4: Verify that an error toast is shown containing the team name
    console.log('Step 4: Verify error toast is shown');
    const toast = page.locator('[role="status"]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    const toastText = await toast.textContent();
    console.log(`  Toast: "${toastText}"`);
    expect(toastText).toContain(TEST_DATA.team.name);
    expect(toastText).toContain('Remove or reassign');
    console.log('  ✓ Error toast shown with team name and guidance');

    // Step 5: Verify the formation was NOT deleted
    console.log('Step 5: Verify formation still exists');
    await expect(
      page.locator('.item-card').filter({ hasText: TEST_DATA.formation.name }),
    ).toBeVisible();
    console.log('  ✓ Formation still exists after blocked delete');

    // No confirm modal should have appeared
    await expect(page.locator('.confirm-overlay')).not.toBeVisible();
    console.log('  ✓ No confirm dialog shown');

    // Cleanup
    const cleanupDialog = handleConfirmDialog(page, false);
    await clickManagementTab(page, 'Teams');
    await swipeToDelete(page, `.item-card:has-text("${TEST_DATA.team.name}")`);
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    await clickManagementTab(page, 'Formations');
    await swipeToDelete(page, `.item-card:has-text("${TEST_DATA.formation.name}")`);
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    cleanupDialog();

    console.log('\n=== Formation In-Use Guard Test PASSED ===\n');
  });

  test('should allow formation deletion when no team references it', async ({ page }) => {
    console.log('\n=== Safe Delete: Unused Formation Deletion ===\n');

    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await cleanupTestData(page);

    // Step 1: Create a formation (no team uses it)
    console.log('Step 1: Create formation (no team)');
    await createFormation(page, TEST_DATA.formation);

    // Step 2: Attempt to delete it — should show normal confirm dialog
    console.log('Step 2: Delete unused formation');
    await clickManagementTab(page, 'Formations');
    await page.waitForTimeout(UI_TIMING.STANDARD);

    await swipeToDelete(page, `.item-card:has-text("${TEST_DATA.formation.name}")`);

    // Normal confirm dialog should appear (not a toast error)
    console.log('Step 3: Verify standard danger confirm dialog appears');
    await expect(page.locator('.confirm-overlay')).toBeVisible({ timeout: 5000 });

    // Verify message content
    const message = await page.locator('.confirm-message').textContent();
    console.log(`  Message: "${message}"`);
    expect(message).toContain('delete this formation');
    console.log('  ✓ Standard confirm dialog shown');

    // Confirm the deletion
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);

    // Step 4: Verify the formation was deleted
    console.log('Step 4: Verify formation is deleted');
    await expect(
      page.locator('.item-card').filter({ hasText: TEST_DATA.formation.name }),
    ).not.toBeVisible();
    console.log('  ✓ Formation successfully deleted');

    // No error toast
    const toast = page.locator('[role="status"]').first();
    const toastVisible = await toast.isVisible({ timeout: 500 }).catch(() => false);
    if (toastVisible) {
      const toastText = await toast.textContent();
      expect(toastText).not.toContain('Remove or reassign');
    }
    console.log('  ✓ No blocking error toast shown');

    console.log('\n=== Unused Formation Deletion Test PASSED ===\n');
  });

  // ---------------------------------------------------------------------------
  // Player guard tests
  // ---------------------------------------------------------------------------

  test('should show warning dialog with "Delete Anyway" when player is on a roster', async ({ page }) => {
    console.log('\n=== Safe Delete: Player With Roster Warning ===\n');

    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await cleanupTestData(page);

    // Step 1: Create team and player
    console.log('Step 1: Create team and player');
    await createTeam(page, TEST_DATA.team);

    await clickManagementTab(page, 'Players');
    await clickButton(page, '+ Add Player');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    await fillInput(page, 'input[placeholder*="First Name"]', TEST_DATA.playerWithRoster.firstName);
    await fillInput(page, 'input[placeholder*="Last Name"]', TEST_DATA.playerWithRoster.lastName);
    await clickButton(page, 'Add');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    console.log(`  ✓ Player ${TEST_DATA.playerWithRoster.firstName} ${TEST_DATA.playerWithRoster.lastName} created`);

    // Step 2: Add the player to the team roster
    console.log('Step 2: Add player to team roster');
    await clickManagementTab(page, 'Teams');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    const playerFullName = `${TEST_DATA.playerWithRoster.firstName} ${TEST_DATA.playerWithRoster.lastName}`;
    await addPlayerToRoster(
      page,
      TEST_DATA.team.name,
      playerFullName,
      TEST_DATA.playerWithRoster.number,
    );

    // Step 3: Navigate to Players and attempt to delete the player
    console.log('Step 3: Attempt to delete the player that is on a roster');
    await clickManagementTab(page, 'Players');
    await page.waitForTimeout(UI_TIMING.STANDARD);

    await swipeToDelete(page, `.item-card:has-text("${TEST_DATA.playerWithRoster.firstName}")`);

    // Step 4: Verify warning confirm dialog appears (orange, not red)
    console.log('Step 4: Verify warning confirm dialog');
    await expect(page.locator('.confirm-overlay')).toBeVisible({ timeout: 5000 });

    // Verify warning variant styling (orange title)
    await expect(page.locator('.confirm-modal--warning')).toBeVisible();
    console.log('  ✓ Warning variant modal shown (orange styling)');

    // Verify message contains impact info (roster)
    const message = await page.locator('.confirm-message').textContent();
    console.log(`  Message: "${message}"`);
    expect(message).toContain('team roster');
    console.log('  ✓ Message mentions roster impact');

    // Verify confirm button text is "Delete Anyway"
    const confirmBtn = page.locator('.confirm-btn--confirm');
    await expect(confirmBtn).toHaveText('Delete Anyway');
    console.log('  ✓ Confirm button reads "Delete Anyway"');

    // Step 5: Cancel — player should not be deleted
    console.log('Step 5: Cancel — verify player survives');
    await clickConfirmModalCancel(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await expect(
      page.locator('.item-card').filter({ hasText: TEST_DATA.playerWithRoster.firstName }),
    ).toBeVisible();
    console.log('  ✓ Player still exists after canceling warning dialog');

    // Step 6: Delete again and confirm with "Delete Anyway"
    console.log('Step 6: Confirm deletion with "Delete Anyway"');
    await swipeToDelete(page, `.item-card:has-text("${TEST_DATA.playerWithRoster.firstName}")`);
    await expect(page.locator('.confirm-overlay')).toBeVisible({ timeout: 5000 });
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);

    // Verify player was deleted
    await expect(
      page.locator('.item-card').filter({ hasText: TEST_DATA.playerWithRoster.firstName }),
    ).not.toBeVisible();
    console.log('  ✓ Player deleted after confirming "Delete Anyway"');

    // Cleanup team
    const cleanupDialog = handleConfirmDialog(page, false);
    await clickManagementTab(page, 'Teams');
    await swipeToDelete(page, `.item-card:has-text("${TEST_DATA.team.name}")`);
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    cleanupDialog();

    console.log('\n=== Player With Roster Warning Test PASSED ===\n');
  });

  test('should show standard danger dialog when player has no roster or game history', async ({ page }) => {
    console.log('\n=== Safe Delete: Player With No Impact ===\n');

    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await cleanupTestData(page);

    // Step 1: Create a player (not assigned to any team)
    console.log('Step 1: Create player with no roster');
    await clickManagementTab(page, 'Players');
    await clickButton(page, '+ Add Player');
    await page.waitForTimeout(UI_TIMING.STANDARD);
    await fillInput(page, 'input[placeholder*="First Name"]', TEST_DATA.playerNoRoster.firstName);
    await fillInput(page, 'input[placeholder*="Last Name"]', TEST_DATA.playerNoRoster.lastName);
    await clickButton(page, 'Add');
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    console.log(`  ✓ Player ${TEST_DATA.playerNoRoster.firstName} ${TEST_DATA.playerNoRoster.lastName} created`);

    // Step 2: Delete the player — should show standard danger dialog
    console.log('Step 2: Attempt to delete player with no impact');
    await swipeToDelete(page, `.item-card:has-text("${TEST_DATA.playerNoRoster.firstName}")`);

    // Verify standard danger confirm dialog appears
    console.log('Step 3: Verify standard danger confirm dialog');
    await expect(page.locator('.confirm-overlay')).toBeVisible({ timeout: 5000 });

    // Verify danger variant styling (red)
    await expect(page.locator('.confirm-modal--danger')).toBeVisible();
    console.log('  ✓ Danger variant modal shown (red styling)');

    // Verify message is the basic "Are you sure" message
    const message = await page.locator('.confirm-message').textContent();
    console.log(`  Message: "${message}"`);
    expect(message).toContain('Are you sure you want to delete this player');
    console.log('  ✓ Message is the standard "Are you sure" prompt');

    // Verify confirm button text is "Delete" (not "Delete Anyway")
    const confirmBtn = page.locator('.confirm-btn--confirm');
    await expect(confirmBtn).toHaveText('Delete');
    console.log('  ✓ Confirm button reads "Delete" (not "Delete Anyway")');

    // Step 4: Confirm deletion
    console.log('Step 4: Confirm deletion');
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);

    // Verify player was deleted
    await expect(
      page.locator('.item-card').filter({ hasText: TEST_DATA.playerNoRoster.firstName }),
    ).not.toBeVisible();
    console.log('  ✓ Player deleted after standard confirmation');

    console.log('\n=== Player No Impact Test PASSED ===\n');
  });
});
