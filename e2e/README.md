# E2E Test Suite

End-to-end tests for TeamTrack using Playwright.

## Test Files

| File | Coverage |
|---|---|
| `auth.spec.ts` | Sign up, sign in, sign out flows |
| `team-management.spec.ts` | Create teams, formations, edit rosters |
| `player-management.spec.ts` | Add players, assign to roster, birth year filter |
| `formation-management.spec.ts` | Create and manage formation templates |
| `game-planner.spec.ts` | Pre-game planning, player availability, rotation builder |
| `full-workflow.spec.ts` | Full game day workflow (lineup → timer → subs → report) |
| `team-sharing.spec.ts` | Invite coaches, accept/decline invitations |
| `data-isolation.spec.ts` | Verify users can only see their own teams/data |
| `profile.spec.ts` | Profile page, pending invitations |
| `issue-tracking.spec.ts` | Bug report submission |

## Prerequisites

### 1. Start the AWS Sandbox
In a separate terminal, start the Amplify sandbox backend:
```bash
npx ampx sandbox
```
Wait for the success message before running tests.

### 2. Start the Dev Server
In another terminal:
```bash
npm run dev
```

### 3. Install Playwright Browsers (first time only)
```bash
npx playwright install --with-deps
```

## Running Tests

```bash
# Run all E2E tests
npm run test:e2e

# Open interactive Playwright UI
npm run test:e2e:ui

# Run with visible browser window
npm run test:e2e:headed

# Debug a specific test
npm run test:e2e:debug

# Run a single spec file
npx playwright test e2e/team-management.spec.ts
```

## Test Configuration

- **Browser**: Chromium (default)
- **Base URL**: `http://localhost:5173`
- **Timeout**: 3 minutes per test
- **Retries**: 2 on CI, 0 locally
- **Artifacts on failure**: screenshots, videos, traces (in `test-results/`)

## Viewing Results

```bash
# Open HTML report after a run
npx playwright show-report

# View a trace file
npx playwright show-trace test-results/<test-name>/trace.zip
```

## Test Data

Tests create their own data and are designed to be repeatable. The full-workflow test uses:
- **Team**: Thunder FC U10 (7 players, 25-minute halves)
- **Players**: 8 players (Alice through Hannah)
- **Positions**: GK, DEF, MID, FWD
- **Game**: vs Lightning FC (Home)

## Troubleshooting

**Login fails:**
- Ensure sandbox is running: `npx ampx sandbox`
- Confirm `amplify_outputs.json` is present in the project root

**Element not found / timeout:**
- Run in headed mode to watch the browser: `npm run test:e2e:headed`
- Check the HTML report and screenshots in `test-results/`
- Increase timeout in `e2e/playwright.config.ts` if network is slow

**Stale data from previous runs:**
- Delete the sandbox and recreate: `npx ampx sandbox delete` then `npx ampx sandbox`

## Adding New Tests

Create a new file in `e2e/`:
```typescript
import { test, expect } from '@playwright/test';

test('your test name', async ({ page }) => {
  await page.goto('/');
  // ...
});
```

Use the helper functions in `e2e/helpers.ts` (e.g., `fillInput`, `clickButton`) to keep tests consistent.

## CI/CD

```yaml
- name: Install Playwright
  run: npx playwright install --with-deps

- name: Run E2E tests
  run: npm run test:e2e
  env:
    CI: true
```
