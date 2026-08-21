import { test, expect, Page } from '@playwright/test';
import {
  clickButton,
  clickButtonByText,
  clickConfirmModalConfirm,
  clickManagementTab,
  fillInput,
  logout, // shared helper (e2e/helpers.ts)
  loginUser,
  navigateToManagement,
  waitForPageLoad,
  UI_TIMING,
} from './helpers';
import { TEST_USERS, TEST_CONFIG } from '../test-config';

const TEST_RUN_SUFFIX = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const TEAM_NAME = `Ownership Lockout FC ${TEST_RUN_SUFFIX}`;
const THROWAWAY_INVITE_EMAIL = `throwaway-${TEST_RUN_SUFFIX}@example.com`;

/**
 * Polls whether TEAM_NAME's archived card is visible for the current user,
 * reloading and re-navigating on every attempt (not just re-reading the
 * existing DOM). Required for the same reason as
 * team-management.spec.ts's pollScheduleDropdownForTeam: `archiveTeam`/
 * `restoreTeam`/`assignTeamOwner` write via the DynamoDB SDK directly and
 * never trigger an AppSync subscription.
 *
 * Uses `expect(...).toPass()` rather than `expect.poll()`: the body below
 * performs `.click()` calls that can throw, and `expect.poll()` only retries
 * on a returned wrong value, not on a thrown exception. Budgeted at 30s
 * (rather than a tighter 15s) because each attempt does a full reload +
 * re-navigation (~5-7s), so a shorter budget would only allow ~2 attempts
 * against an eventually-consistent read.
 */
async function pollArchivedCardVisible(page: Page, teamName: string) {
  await expect(async () => {
    await page.reload();
    await waitForPageLoad(page);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Teams');
    await page.getByRole('button', { name: /Archived Teams/ }).click();
    const card = page.locator('.team-card-wrapper').filter({ hasText: teamName });
    const visible = await card.locator('.item-card.archived').isVisible().catch(() => false);
    expect(visible).toBe(true);
  }).toPass({ timeout: 30000 });
}

test.describe.serial('Team archive ownership edge cases', () => {
  let invitationId = '';

  test('Coach A creates and shares a team; Coach B sees correct active/archived visibility; a pending invitation expires on archive', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.long);

    // --- Coach A: create + invite ---
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Teams');
    await clickButton(page, '+ Create New Team');
    await fillInput(page, 'input[placeholder*="team name"]', TEAM_NAME);
    await fillInput(page, 'input[placeholder*="max players"]', '7');
    await fillInput(page, 'input[placeholder*="half length"]', '25');
    await clickButton(page, 'Create');
    await expect(page.locator('.item-card').filter({ hasText: TEAM_NAME })).toBeVisible({ timeout: 30000 });

    await clickManagementTab(page, 'Sharing');
    const manageSharingButton = page.locator('.resource-item')
      .filter({ has: page.getByText(TEAM_NAME, { exact: true }) })
      .first()
      .getByRole('button', { name: /manage sharing/i });
    await manageSharingButton.click();
    await fillInput(page, 'input[type="email"]', TEST_USERS.user2.email);
    await clickButtonByText(page, /send invitation/i);
    await expect(page.locator('.sharing-section, .invitations-list')).toContainText(TEST_USERS.user2.email, { timeout: 5000 });

    const invitationItem = page.locator('.invitation-item').filter({ hasText: TEST_USERS.user2.email }).first();
    invitationId = (await invitationItem.locator('.invitation-link').first().getAttribute('data-invitation-id')) ?? '';
    expect(invitationId).toBeTruthy();

    // logout() (not loginUser()) is required here: the next step navigates to
    // an unauthenticated /invite/:id link and does its own inline login, not
    // via the loginUser() helper.
    await logout(page);

    // --- Coach B: accept ---
    await page.goto(`/invite/${invitationId}`);
    await waitForPageLoad(page);
    const loginButton = page.getByRole('banner').getByRole('button', { name: 'Log In' });
    if (await loginButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await loginButton.click();
      await waitForPageLoad(page);
    }
    const emailInput = page.locator('input[name="username"], input[type="email"]');
    if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await fillInput(page, 'input[name="username"], input[type="email"]', TEST_USERS.user2.email);
      await fillInput(page, 'input[name="password"], input[type="password"]', TEST_USERS.user2.password);
      await clickButton(page, 'Sign in');
      await waitForPageLoad(page);
      await page.goto(`/invite/${invitationId}`);
      await waitForPageLoad(page);
    }
    await page.getByRole('button', { name: /accept/i }).click();
    await expect(page.getByText(/Successfully joined/i)).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(3000);
    await waitForPageLoad(page);

    // Coach B, non-owner: active card shows neither Archive nor Owner Unassigned.
    await navigateToManagement(page);
    await clickManagementTab(page, 'Teams');
    const sharedCard = page.locator('.team-card-wrapper').filter({ hasText: TEAM_NAME });
    await expect(sharedCard).toBeVisible({ timeout: 20000 });
    await expect(sharedCard.getByRole('button', { name: 'Archive' })).not.toBeVisible();
    await expect(sharedCard.getByText('Owner Unassigned')).not.toBeVisible();

    // --- Coach A: send a throwaway invitation, then archive; the throwaway
    // invitation should be expired (removed from Pending Invitations) as a
    // side effect of archiving. loginUser() signs out Coach B's session
    // itself; no explicit logout() needed.
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Sharing');
    const manageSharingButtonForExpiry = page.locator('.resource-item')
      .filter({ has: page.getByText(TEAM_NAME, { exact: true }) })
      .first()
      .getByRole('button', { name: /manage sharing/i });
    await manageSharingButtonForExpiry.click();
    await fillInput(page, 'input[type="email"]', THROWAWAY_INVITE_EMAIL);
    await clickButtonByText(page, /send invitation/i);
    await expect(page.locator('.invitations-list')).toContainText(THROWAWAY_INVITE_EMAIL, { timeout: 5000 });

    await clickManagementTab(page, 'Teams');
    await page.locator('.team-card-wrapper').filter({ hasText: TEAM_NAME }).getByRole('button', { name: 'Archive' }).click();
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

    // Re-enter the Sharing tab rather than re-selecting the team from its
    // picker: sharingResourceId/sharingResourceType are Management-level
    // state, so switching tabs and back re-renders the same already-open
    // panel directly, skipping the (now active-teams-only, archived-team-
    // excluding) picker entirely — this is what makes the check below
    // possible at all post-archive. It also, incidentally, remounts
    // <InvitationManagement>, which re-runs its `useAmplifyQuery` hook and
    // issues a genuinely fresh query rather than relying on a subscription
    // push — necessary because archiveTeam's TeamInvitation expiry write
    // goes through the DynamoDB SDK directly and, like the other lifecycle
    // Lambdas, never triggers an AppSync subscription (satisfied here via
    // remount instead of a page reload).
    await clickManagementTab(page, 'Sharing');
    await expect(page.locator('.invitations-list')).not.toContainText(THROWAWAY_INVITE_EMAIL, { timeout: 10000 });

    // --- Coach B, re-entering after a full logout/login (no live subscription
    // for lifecycle Lambdas): sees the archived state correctly, cannot
    // Restore (not owner), can still Delete Permanently. This is the one
    // assertion in this test that reads Lambda-written state without an
    // intervening fresh loginUser() call producing a fresh page load on its
    // own — pollArchivedCardVisible reloads/re-navigates on every attempt
    // rather than re-reading a DOM snapshot that can never change if stale. ---
    await loginUser(page, TEST_USERS.user2.email, TEST_USERS.user2.password);
    await pollArchivedCardVisible(page, TEAM_NAME);
    const archivedForCoachB = page.locator('.team-card-wrapper').filter({ hasText: TEAM_NAME });
    await expect(archivedForCoachB.getByRole('button', { name: 'Restore Team' })).not.toBeVisible();
    await expect(archivedForCoachB.getByRole('button', { name: 'Delete team permanently' })).toBeVisible();
  });

  test('Coach A restores; Coach B revokes Coach A, reclaims ownership, and completes an archive/restore round trip', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.long);

    // Sharing & Permissions only lists active teams — Coach A must restore
    // before Coach B can reach "Manage Sharing" to revoke at all.
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Teams');
    await page.getByRole('button', { name: /Archived Teams/ }).click();
    await page.locator('.team-card-wrapper').filter({ hasText: TEAM_NAME }).getByRole('button', { name: 'Restore Team' }).click();
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

    // Coach B revokes Coach A's (the owner's) access.
    await loginUser(page, TEST_USERS.user2.email, TEST_USERS.user2.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Sharing');
    const manageSharingButtonB = page.locator('.resource-item')
      .filter({ has: page.getByText(TEAM_NAME, { exact: true }) })
      .first()
      .getByRole('button', { name: /manage sharing/i });
    await manageSharingButtonB.click();

    // Guard against ever clicking "Remove" on the wrong coach if the
    // permission list ever contains more than the expected single entry
    // (Coach A — the current user, Coach B, is filtered out of this list by
    // InvitationManagement.tsx).
    await expect(page.locator('.permission-item')).toHaveCount(1);
    const removeCoachA = page.locator('.permission-item').first().getByRole('button', { name: 'Remove' });
    await expect(removeCoachA).toBeVisible({ timeout: 10000 });
    await removeCoachA.click();
    await clickConfirmModalConfirm(page); // 'Revoke Access' confirm
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);

    // Confirm the revoked coach actually loses Team visibility. NOTE — this
    // only proves Team-level revocation. revokeCoachAccess
    // (src/services/invitationService.ts) removes the user from
    // Team.coaches only; it does NOT cascade to the coaches arrays on
    // TeamRoster/Player/Game/Formation/FormationPosition that
    // accept-invitation backfilled when Coach A originally joined. Those
    // child records are NOT swept by this test (or by the app) — see
    // docs/SHARING-PERMISSIONS.md's Known Residual Risks and this plan's
    // Required Follow-Ups.
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Teams');
    await expect(page.locator('.item-card').filter({ hasText: TEAM_NAME })).not.toBeVisible({ timeout: 10000 });

    // Coach B reclaims ownership.
    await loginUser(page, TEST_USERS.user2.email, TEST_USERS.user2.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'Teams');
    const lockedCard = page.locator('.team-card-wrapper').filter({ hasText: TEAM_NAME });
    await expect(lockedCard.getByText('Owner Unassigned')).toBeVisible({ timeout: 15000 });
    await expect(lockedCard.getByRole('button', { name: 'Archive' })).not.toBeVisible();

    await lockedCard.getByRole('button', { name: 'Assign Owner' }).click();
    await clickConfirmModalConfirm(page); // 'Assign Team Owner' confirm
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await expect(lockedCard.getByText('Owner Unassigned')).not.toBeVisible();
    await expect(lockedCard.getByRole('button', { name: 'Archive' })).toBeVisible({ timeout: 10000 });

    // Proves the reclaim is a *real* ownership transfer, not just a UI flag:
    // Coach B (the new owner) can now archive and restore the team.
    await lockedCard.getByRole('button', { name: 'Archive' }).click();
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await page.getByRole('button', { name: /Archived Teams/ }).click();
    const archivedByCoachB = page.locator('.team-card-wrapper').filter({ hasText: TEAM_NAME });
    await expect(archivedByCoachB.getByRole('button', { name: 'Restore Team' })).toBeVisible();
    await archivedByCoachB.getByRole('button', { name: 'Restore Team' }).click();
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await page.getByRole('button', { name: /Active Teams/ }).click();
    await expect(page.locator('.item-card:not(.archived)').filter({ hasText: TEAM_NAME })).toBeVisible();

    // Cleanup.
    await page.locator('.team-card-wrapper').filter({ hasText: TEAM_NAME }).getByRole('button', { name: 'Archive' }).click();
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
    await page.getByRole('button', { name: /Archived Teams/ }).click();
    await page.locator('.team-card-wrapper').filter({ hasText: TEAM_NAME }).getByRole('button', { name: 'Delete team permanently' }).click();
    await clickConfirmModalConfirm(page);
    await page.waitForTimeout(UI_TIMING.COMPLEX_OPERATION);
    await expect(page.locator('.item-card').filter({ hasText: TEAM_NAME })).not.toBeVisible();
  });

  // Stale-data safety net. If the revoke step (test 2) succeeds but a later
  // step in the same test fails, the team could be left orphaned on Coach B
  // and unreachable from Coach A's own cleanup sweeps in other specs. Runs
  // as Coach B specifically, matching e2e/team-sharing.spec.ts's
  // stale-team-sweep convention: Coach B is guaranteed to still be a coach
  // on the team even if the reclaim step never completed (Coach A may be
  // permanently locked out post-revoke), so cleanup must not assume Coach A
  // still has access.
  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await loginUser(page, TEST_USERS.user2.email, TEST_USERS.user2.password);
      await navigateToManagement(page);
      await clickManagementTab(page, 'Teams');

      // Scoped to this run's exact TEAM_NAME (which embeds TEST_RUN_SUFFIX), not the
      // bare "Ownership Lockout FC" prefix — so an overlapping/retried run against the
      // same shared test account can never sweep up another run's still-in-flight team.
      const activeStale = page.locator('.team-card-wrapper').filter({ hasText: TEAM_NAME });
      let activeCount = await activeStale.count();
      while (activeCount > 0) {
        const archiveButton = activeStale.first().getByRole('button', { name: 'Archive' });
        if (!(await archiveButton.isVisible({ timeout: 1000 }).catch(() => false))) break;
        await archiveButton.click();
        await clickConfirmModalConfirm(page);
        await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
        const newCount = await page.locator('.team-card-wrapper').filter({ hasText: TEAM_NAME }).count();
        if (newCount === activeCount) break;
        activeCount = newCount;
      }

      await page.getByRole('button', { name: /Archived Teams/ }).click().catch(() => {});
      let archivedStale = await page.locator('.team-card-wrapper').filter({ hasText: TEAM_NAME }).count();
      while (archivedStale > 0) {
        await page.locator('.team-card-wrapper').filter({ hasText: TEAM_NAME }).first()
          .getByRole('button', { name: 'Delete team permanently' }).click();
        await clickConfirmModalConfirm(page);
        await page.waitForTimeout(UI_TIMING.DATA_OPERATION);
        const newCount = await page.locator('.team-card-wrapper').filter({ hasText: TEAM_NAME }).count();
        if (newCount === archivedStale) break;
        archivedStale = newCount;
      }
    } finally {
      await context.close();
    }
  });
});
