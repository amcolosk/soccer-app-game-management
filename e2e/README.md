# E2E Test Suite

This directory contains end-to-end tests for the Soccer App Game Management application using Playwright.

## Overview

The test suite validates the complete user workflow:
1. **Login** - Authenticate with AWS Cognito
2. **Create Season** - Set up a new season
3. **Create Team** - Add a team to the season
4. **Create Positions** - Define field positions (GK, DEF, MID, FWD)
5. **Create Players** - Add players with preferred positions
6. **Create Game** - Schedule a match
7. **Run Game** - Simulate a full game with:
   - Starting lineup
   - Timer management
   - Goal recording
   - Substitutions
   - Notes/gold stars
   - Halftime transition
8. **Verify Season Report** - Confirm all statistics match

## Prerequisites

1. **AWS Sandbox Running**: The tests connect to your local AWS Amplify sandbox
   ```powershell
   npx ampx sandbox
   ```

2. **Test User**: Automatically created with the setup script
   ```powershell
   npm run test:e2e:setup
   ```

3. **Clean Database**: Tests create new data, so start with a fresh sandbox for best results

## Running Tests

### Run all E2E tests
```powershell
npm run test:e2e
```

### Run tests with UI (interactive mode)
```powershell
npm run test:e2e:ui
```

### Run tests in headed mode (see the browser)
```powershell
npm run test:e2e:headed
```

### Debug a specific test
```powershell
npm run test:e2e:debug
```

## Test Configuration

- **Browser**: Chromium (can be extended to Firefox/Safari in `playwright.config.ts`)
- **Base URL**: `http://localhost:5173` (Vite dev server)
- **Timeout**: 3 minutes per test (configurable)
- **Retries**: 2 on CI, 0 locally
- **Screenshots**: Captured on failure
- **Videos**: Recorded on failure
- **Trace**: Generated on first retry

## Test Data

The test uses predefined data:
- **Season**: Fall 2025
- **Team**: Thunder FC U10 (7 players, 25-minute halves)
- **Players**: 8 players (Alice through Hannah)
- **Positions**: GK, DEF, MID, FWD
- **Game**: vs Lightning FC (Home game)

## Customizing Tests

### Adjusting Test Data
Edit the `TEST_DATA` object in `full-workflow.spec.ts`:
```typescript
const TEST_DATA = {
  season: { name: 'Your Season', year: '2025' },
  team: { name: 'Your Team', halfLength: '30', maxPlayers: '11' },
  // ... etc
};
```

### Authentication
The test assumes email/password authentication. Update the `login()` function if you use:
- Social providers (Google, Facebook)
- Custom authentication flow
- Different credential storage

### Selectors
If your UI changes, update the selectors in helper functions to match your component structure.

## Troubleshooting

### Test fails at login
- Ensure sandbox is running: `npx ampx sandbox`
- Verify test user credentials exist in Cognito
- Check the authentication UI selectors match your setup

### Timeout errors
- Increase timeout in `playwright.config.ts`
- Check network speed (sandbox database operations)
- Ensure dev server is running properly

### Element not found
- Run in headed mode to see the browser: `npm run test:e2e:headed`
- Check console logs for component errors
- Verify CSS classes and text content match expectations

### Data persistence issues
- Clear sandbox data: `npx ampx sandbox delete` then `npx ampx sandbox`
- Check AWS credentials are configured
- Verify amplify_outputs.json is present

## Reports

After running tests:
- **HTML Report**: `npx playwright show-report`
- **Screenshots**: `test-results/` directory
- **Videos**: `test-results/` directory (on failure)
- **Traces**: View with `npx playwright show-trace`

## CI/CD Integration

To run tests in CI:
```yaml
- name: Install Playwright
  run: npx playwright install --with-deps

- name: Run E2E tests
  run: npm run test:e2e
  env:
    CI: true
```

## Best Practices

1. **Run tests in order**: Tests are not parallel to avoid data conflicts
2. **Clean state**: Start each test run with a fresh sandbox
3. **Explicit waits**: Use `waitForPageLoad()` and `waitForTimeout()` for stability
4. **Descriptive logs**: Console logs help debug issues
5. **Visual verification**: Check screenshots/videos when tests fail

## Adding New Tests

Create a new test file in `e2e/`:
```typescript
import { test, expect } from '@playwright/test';
import { waitForPageLoad, clickButton } from './helpers';

test('your test name', async ({ page }) => {
  // Your test code
});
```

Run specific test file:
```powershell
npx playwright test e2e/your-test.spec.ts
```
