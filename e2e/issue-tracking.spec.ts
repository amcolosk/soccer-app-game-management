import { test, expect } from '@playwright/test';
import {
  loginUser,
  clickButton,
} from './helpers';
import { TEST_USERS, TEST_CONFIG } from '../test-config';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const amplifyOutputs = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'amplify_outputs.json'), 'utf-8')
);

test.describe('Issue Tracking', () => {
  test('submitted bug report shows success UI with issue number', async ({ page }) => {
    test.setTimeout(TEST_CONFIG.timeout.medium);

    const FAKE_ISSUE_NUMBER = 9999;

    // 1. Login
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);

    // 2. Open bug report via the Help FAB (? button → "Report a Bug")
    await page.getByRole('button', { name: 'Help and bug report' }).click();
    await page.getByRole('menuitem', { name: 'Report a Bug' }).click();
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

test.describe('agent status restrictions', () => {
  const agentSecret = process.env.AGENT_API_SECRET;

  let testIssueNumber: number;

  test.beforeAll(async ({ browser }) => {
    if (!agentSecret) {
      test.skip();
      return;
    }

    // Create a test issue by submitting a bug report via the UI
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    // Open bug report via the Help FAB (? button → "Report a Bug")
    await page.getByRole('button', { name: 'Help and bug report' }).click();
    await page.getByRole('menuitem', { name: 'Report a Bug' }).click();
    await page.waitForSelector('.bug-report-modal', { state: 'visible', timeout: 5000 });

    const uniqueDescription = `Agent Restriction E2E Test ${Date.now()}`;
    await page.fill('#description', uniqueDescription);
    await page.selectOption('#severity', 'low');

    const responsePromise = page.waitForResponse(async (resp) => {
      if (!resp.url().includes('appsync-api') || resp.request().method() !== 'POST') return false;
      try {
        const body = resp.request().postDataJSON();
        return body?.query?.includes('createGitHubIssue') ?? false;
      } catch {
        return false;
      }
    });

    await clickButton(page, 'Submit Report');

    const graphqlResponse = await responsePromise;
    const responseBody = await graphqlResponse.json();

    let parsed: unknown = responseBody.data.createGitHubIssue;
    while (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch { break; }
    }
    testIssueNumber = (parsed as Record<string, unknown>)?.issueNumber as number;

    await context.close();
  });

  test('agent sets issue IN_PROGRESS', async ({ request }) => {
    if (!agentSecret) test.skip();
    const { url: appsyncUrl, api_key: apiKey } = amplifyOutputs.data;

    const response = await request.post(appsyncUrl, {
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      data: {
        query: `mutation UpdateStatus {
          updateIssueStatus(issueNumber: ${testIssueNumber}, status: "IN_PROGRESS", resolution: "SECRET:${agentSecret}|investigating")
        }`,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.errors).toBeFalsy();
    let parsed: unknown = body.data.updateIssueStatus;
    while (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch { break; }
    }
    expect((parsed as Record<string, unknown>).status).toBe('IN_PROGRESS');
  });

  test('agent sets issue FIXED with SHA in resolution', async ({ request }) => {
    if (!agentSecret) test.skip();
    const { url: appsyncUrl, api_key: apiKey } = amplifyOutputs.data;

    const response = await request.post(appsyncUrl, {
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      data: {
        query: `mutation UpdateStatus {
          updateIssueStatus(issueNumber: ${testIssueNumber}, status: "FIXED", resolution: "SECRET:${agentSecret}|Fixed in abc1234: test fix")
        }`,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.errors).toBeFalsy();
    let parsed: unknown = body.data.updateIssueStatus;
    while (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch { break; }
    }
    const result = parsed as Record<string, unknown>;
    expect(result.status).toBe('FIXED');
    expect(result.resolution).toBe('Fixed in abc1234: test fix');
  });

  test('agent is blocked from setting CLOSED', async ({ request }) => {
    if (!agentSecret) test.skip();
    const { url: appsyncUrl, api_key: apiKey } = amplifyOutputs.data;

    const response = await request.post(appsyncUrl, {
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      data: {
        query: `mutation UpdateStatus {
          updateIssueStatus(issueNumber: ${testIssueNumber}, status: "CLOSED", resolution: "SECRET:${agentSecret}|done")
        }`,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.errors?.[0]?.message).toContain('agents may only set IN_PROGRESS or FIXED');
  });

  test('agent is blocked from setting DEPLOYED', async ({ request }) => {
    if (!agentSecret) test.skip();
    const { url: appsyncUrl, api_key: apiKey } = amplifyOutputs.data;

    const response = await request.post(appsyncUrl, {
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      data: {
        query: `mutation UpdateStatus {
          updateIssueStatus(issueNumber: ${testIssueNumber}, status: "DEPLOYED", resolution: "SECRET:${agentSecret}|deployed")
        }`,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.errors?.[0]?.message).toContain('agents may only set IN_PROGRESS or FIXED');
  });

  test('agent is blocked from FIXED without SHA', async ({ request }) => {
    if (!agentSecret) test.skip();
    const { url: appsyncUrl, api_key: apiKey } = amplifyOutputs.data;

    const response = await request.post(appsyncUrl, {
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      data: {
        query: `mutation UpdateStatus {
          updateIssueStatus(issueNumber: ${testIssueNumber}, status: "FIXED", resolution: "SECRET:${agentSecret}|Fixed the bug")
        }`,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.errors?.[0]?.message).toContain('Resolution must include a git commit SHA');
  });
});
