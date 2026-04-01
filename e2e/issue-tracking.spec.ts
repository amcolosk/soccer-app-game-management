import { test, expect } from '@playwright/test';
import {
  loginUser,
  clickButton,
  closeWelcomeModal,
} from './helpers';
import { TEST_USERS, TEST_CONFIG } from '../test-config';

test.describe('Issue Tracking', () => {
  test('submitted bug report shows success UI with issue number', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.medium);

    const FAKE_ISSUE_NUMBER = 9999;

    // 1. Login
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await closeWelcomeModal(page);

    // 2. Open bug report via the Help FAB (? button → "Report a Bug")
    await page.getByRole('button', { name: 'Help and bug report' }).click();
    const reportBugMenuItem = page.getByRole('menuitem', { name: 'Report a Bug' });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await closeWelcomeModal(page);
      try {
        await reportBugMenuItem.click({ timeout: 3000 });
        break;
      } catch {
        if (attempt === 2) {
          throw new Error('Unable to open Report a Bug menu item due to overlay interception');
        }
      }
    }
    await page.waitForSelector('.bug-report-modal', { state: 'visible', timeout: 5000 });

    // 3. Fill out the bug report form with a unique description
    const uniqueDescription = `E2E Test Issue ${Date.now()}`;
    await page.fill('#description', uniqueDescription);
    await page.selectOption('#severity', 'low');

    // 4. Intercept the createGitHubIssue mutation so no real GitHub issue is created.
    //    Capture the request body so we can assert the correct payload was sent.
    let interceptedVariables: Record<string, unknown> | undefined;
    await page.route('**appsync-api**', async (route, request) => {
      const body = request.postDataJSON() as Record<string, unknown> | null;
      if (body?.query && String(body.query).includes('createGitHubIssue')) {
        interceptedVariables = body.variables as Record<string, unknown>;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: { createGitHubIssue: JSON.stringify({ issueNumber: FAKE_ISSUE_NUMBER }) },
          }),
        });
      } else {
        await route.continue();
      }
    });

    // 5. Submit the report
    await clickButton(page, 'Submit Report');

    // 6. Verify the success UI shows the faked issue number
    const successEl = page.locator('.bug-report-success');
    await expect(successEl).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(`GitHub Issue #${FAKE_ISSUE_NUMBER}`)).toBeVisible();

    // 7. Assert the mutation was called with the correct payload
    expect(interceptedVariables).toBeTruthy();
    expect(interceptedVariables?.description).toContain(uniqueDescription);
    expect(interceptedVariables?.severity).toBe('low');
    expect(interceptedVariables?.type).toBe('BUG');
  });
});
