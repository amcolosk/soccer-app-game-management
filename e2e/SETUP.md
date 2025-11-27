# E2E Test Setup Guide

## Quick Start

### 1. Install Dependencies
```powershell
npm install
```

### 2. Start AWS Sandbox
In a separate terminal:
```powershell
npx ampx sandbox
```

Wait for the sandbox to fully deploy (you'll see a success message).

### 3. Configure Test Credentials
Copy the example environment file:
```powershell
Copy-Item .env.test.example .env.test
```

Edit `.env.test` to customize credentials if needed (optional):
```env
TEST_USER_EMAIL=test@example.com
TEST_USER_PASSWORD=TestPassword123!
```

### 4. Create Test User (Automated)
Run the setup script to automatically create the test user:
```powershell
npm run test:e2e:setup
```

This will:
- ✓ Check that sandbox is running
- ✓ Create test user in Cognito with verified email
- ✓ Set permanent password (no temp password needed)
- ✓ Ready to use immediately

**Alternative Manual Methods** (if automated setup fails):

<details>
<summary>Option A: Use AWS Console</summary>

1. Go to AWS Cognito in the AWS Console
2. Find your user pool (created by Amplify)
3. Create a new user with:
   - Email: `test@example.com`
   - Temporary password: `TempPass123!`
4. Login once to set permanent password: `TestPassword123!`
</details>

<details>
<summary>Option B: Use AWS CLI</summary>

```powershell
# Set your user pool ID (get from sandbox output)
$USER_POOL_ID = "your-user-pool-id"

# Create user
aws cognito-idp admin-create-user `
  --user-pool-id $USER_POOL_ID `
  --username "test@example.com" `
  --user-attributes Name=email,Value=test@example.com Name=email_verified,Value=true `
  --temporary-password "TempPass123!" `
  --message-action SUPPRESS

# Set permanent password
aws cognito-idp admin-set-user-password `
  --user-pool-id $USER_POOL_ID `
  --username "test@example.com" `
  --password "TestPassword123!" `
  --permanent
```
</details>
Create `.env.test` file:
```env
TEST_USER_EMAIL=test@example.com
TEST_USER_PASSWORD=TestPassword123!
```

### 5. Run Tests
Now you're ready to run the E2E tests!
```powershell
# Run all E2E tests
npm run test:e2e

# Or run with visible browser
npm run test:e2e:headed

# Or use interactive UI
npm run test:e2e:ui
```

## Test Flow

The full workflow test will:
1. ✓ Login to the application
2. ✓ Create a new season "Fall 2025"
3. ✓ Create a team "Thunder FC U10"
4. ✓ Create 4 positions (GK, DEF, MID, FWD)
5. ✓ Create 8 players
6. ✓ Create a game vs "Lightning FC"
7. ✓ Set up starting lineup (7 players)
8. ✓ Simulate full game:
   - Start game and timer
   - Record 2 goals
   - Record 1 assist
   - Record 1 gold star
   - Make 1 substitution
   - Complete first half
   - Play second half
   - End game
9. ✓ Verify season report matches game data

## Expected Test Duration
- Full workflow: ~2-3 minutes
- Auth tests: ~30 seconds each

## Troubleshooting

### "Cannot find user pool"
- Ensure sandbox is running
- Check AWS credentials are configured
- Run `aws configure sso` if needed

### "Timeout waiting for element"
- Increase timeout in playwright.config.ts
- Check if dev server is running on http://localhost:5173
- Run in headed mode to see what's happening

### "Login fails"
- Verify test user exists in Cognito
- Check credentials in .env.test
- Ensure email is verified

### "Test creates duplicate data"
- Clear sandbox data: `npx ampx sandbox delete`
- Restart sandbox: `npx ampx sandbox`
- Tests create new data each run

## Viewing Results

### HTML Report
```powershell
npm run test:e2e:report
```

### Screenshots/Videos
Located in `test-results/` directory after test runs.

### Traces
For failed tests, view trace:
```powershell
npx playwright show-trace test-results/path-to-trace.zip
```

## CI/CD Setup

For GitHub Actions:
```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Install Playwright
        run: npx playwright install --with-deps
      
      - name: Run E2E tests
        run: npm run test:e2e
        env:
          TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
          TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}
      
      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
```

## Next Steps

1. Run the test suite
2. Review the HTML report
3. Customize test data in `full-workflow.spec.ts`
4. Add more test scenarios as needed
5. Integrate into your CI/CD pipeline
