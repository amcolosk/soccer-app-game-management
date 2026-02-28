import { test, expect } from '@playwright/test';
import {
  loginUser,
  navigateToManagement,
  clickManagementTab,
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
  test('submitted bug report creates an issue retrievable via API key', async ({ page, request }) => {
    test.setTimeout(TEST_CONFIG.timeout.medium);

    // 1. Login
    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);

    // 2. Navigate to Management > App tab
    await navigateToManagement(page);
    await clickManagementTab(page, 'App');

    // 3. Click "Report Issue" button
    await clickButton(page, 'Report Issue');
    await page.waitForSelector('.bug-report-modal', { state: 'visible', timeout: 5000 });

    // 4. Fill out the bug report form with a unique description
    const uniqueDescription = `E2E Test Issue ${Date.now()}`;
    await page.fill('#description', uniqueDescription);
    await page.selectOption('#severity', 'low');

    // 5. Intercept the submitBugReport mutation response to capture the issue number
    const responsePromise = page.waitForResponse(async (resp) => {
      if (!resp.url().includes('appsync-api') || resp.request().method() !== 'POST') return false;
      try {
        const body = resp.request().postDataJSON();
        return body?.query?.includes('submitBugReport') ?? false;
      } catch {
        return false;
      }
    });

    // 6. Submit the report
    await clickButton(page, 'Submit Report');

    // 7. Capture the issue number from the mutation response
    const graphqlResponse = await responsePromise;
    const responseBody = await graphqlResponse.json();

    // Check for Lambda errors
    if (responseBody.errors?.length) {
      console.error('submitBugReport mutation failed:', JSON.stringify(responseBody.errors, null, 2));
    }
    expect(responseBody.errors).toBeFalsy();

    // AWSJSON scalar may double-encode: parse until we get an object
    let parsed: unknown = responseBody.data.submitBugReport;
    while (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch { break; }
    }
    const issueNumber = (parsed as Record<string, unknown>)?.issueNumber;
    expect(issueNumber).toBeTruthy();
    console.log(`Bug report submitted as Issue #${issueNumber}`);

    // 8. Wait for success UI confirmation
    const successEl = page.locator('.bug-report-success');
    await expect(successEl).toBeVisible({ timeout: 15000 });

    // 9. Query the issue via API key (no Cognito token needed)
    const { url: appsyncUrl, api_key: apiKey } = amplifyOutputs.data;

    const response = await request.post(appsyncUrl, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      data: {
        query: `query GetIssueByNumber {
          getIssueByNumber(issueNumber: ${issueNumber}) {
            items {
              issueNumber
              description
              status
              type
              severity
            }
          }
        }`,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    const items = body.data.getIssueByNumber.items;
    expect(items.length).toBe(1);

    const issue = items[0];
    expect(issue.issueNumber).toBe(issueNumber);
    expect(issue.description).toContain(uniqueDescription);
    expect(issue.status).toBe('OPEN');
    expect(issue.type).toBe('BUG');
    expect(issue.severity).toBe('low');

    console.log(`Issue #${issueNumber} verified via API key query`);
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
    const request = context.request;

    await loginUser(page, TEST_USERS.user1.email, TEST_USERS.user1.password);
    await navigateToManagement(page);
    await clickManagementTab(page, 'App');
    await clickButton(page, 'Report Issue');
    await page.waitForSelector('.bug-report-modal', { state: 'visible', timeout: 5000 });

    const uniqueDescription = `Agent Restriction E2E Test ${Date.now()}`;
    await page.fill('#description', uniqueDescription);
    await page.selectOption('#severity', 'low');

    const responsePromise = page.waitForResponse(async (resp) => {
      if (!resp.url().includes('appsync-api') || resp.request().method() !== 'POST') return false;
      try {
        const body = resp.request().postDataJSON();
        return body?.query?.includes('submitBugReport') ?? false;
      } catch {
        return false;
      }
    });

    await clickButton(page, 'Submit Report');

    const graphqlResponse = await responsePromise;
    const responseBody = await graphqlResponse.json();

    let parsed: unknown = responseBody.data.submitBugReport;
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
