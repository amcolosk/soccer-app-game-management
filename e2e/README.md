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
# Fast local feedback (Vitest only, no browser)
npm run test:fast

# Run smoke E2E lane (management smoke matrix)
npm run test:e2e:smoke

# Run full E2E lane (all browser regression specs)
npm run test:e2e:full

# Legacy full E2E alias
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

## Lane Mapping

- `npm run test:fast`: local fast lane, Vitest-only integration/unit feedback.
- `npm run test:e2e:smoke`: local smoke lane aligned to CI smoke intent.
- `npm run test:e2e:full`: local full lane aligned to CI full regression intent.
- `npm run gate:commit`: local commit gate (lint -> test:run -> build), unchanged.

Increment 1 keeps CI workflow ownership unchanged. The script mapping above is for local lane parity.

## Assertion Ownership

Use this matrix to decide where a test belongs:

| Layer | Owns | Avoids |
|---|---|---|
| Policy/static (`amplify/data/resource.safe-delete-policy.test.ts`) | Source-level safe-delete policy declarations and authoritative mutation presence | Runtime request/response mapping, auth semantics, UI behavior |
| Service contracts (`src/services/contracts/*.contract.test.ts`) | Service/client boundary request shape, response mapping, auth/error semantics | UI rendering/selectors and duplicated source-text policy checks |
| Browser smoke (`e2e/*.spec.ts` in smoke project) | Minimal browser wiring confidence only | Business-rule matrixes and deep contract semantics |

### Data Isolation: Do/Don't

- Do in contracts: verify list/get request shape and unauthorized cross-owner error semantics.
- Do in smoke: one user-switch path proving owner-scoped visibility wiring is surfaced.
- Don't in smoke: broad data-isolation matrix assertions.

### Safe Deletes: Do/Don't

- Do in static/contract layers: policy declaration ownership plus runtime mutation response/auth semantics.
- Do in smoke: guard surfaced and confirm/cancel wiring checks.
- Don't in smoke: duplicate safe-delete payload semantics or policy-source assertions.

## Test Configuration

- **Browser**: Chromium (default)
- **Base URL**: `http://localhost:5173`
- **Timeout**: 90 seconds per test (CI) / 120 seconds locally
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
- Increase timeout in `playwright.config.ts` if network is slow

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

### `navigateToApp` vs `loginUser`

| Helper | When to use |
|---|---|
| `navigateToApp(page)` | Smoke specs where the user is already logged in via project storageState (user1). Navigates to `/`, waits for networkidle, dismisses prompts, asserts `.bottom-nav` visible. |
| `loginUser(page, email, password)` | When you need to perform a real credential-backed login — e.g., mid-test user switches, tests that verify the auth flow itself, or the `auth.setup.ts` setup fixture. |

### Adding a new spec to the smoke lane
1. Add the spec filename to the `smoke` project's `testMatch` array in `playwright.config.ts`.
2. Use `navigateToApp(page)` (not `loginUser`) at the start of each test or `beforeEach` — the smoke project provides `storageState: '.auth/user1.json'` automatically.
3. If your spec tests authentication flows (sign-in, sign-out, wrong credentials), add `test.use({ storageState: { cookies: [], origins: [] } })` inside your `test.describe` block to opt out of the project-level storage state.

## Storage-State Reuse

The smoke lane uses Playwright's [storage state](https://playwright.dev/docs/auth) feature to skip re-logging in for every test.

**How it works:**
1. `e2e/auth.setup.ts` (the `setup` project) runs first. It logs in as user1 and user2 using `loginUser`, then saves browser cookies/localStorage to `.auth/user1.json` and `.auth/user2.json`.
2. The `smoke` project declares `dependencies: ['setup']`, so the setup project always runs before any smoke test.
3. Each smoke spec's browser context starts already authenticated as user1 via `storageState: '.auth/user1.json'`.

**The `.auth/` directory** is gitignored (never committed). It is created at runtime by `auth.setup.ts`.

**Opt-out pattern:** Tests that need a real login flow (e.g., `auth.spec.ts`) add this inside their `test.describe` block:
```typescript
test.use({ storageState: { cookies: [], origins: [] } });
```

## CI Cadence

| Trigger | Smoke E2E | Full E2E |
|---|---|---|
| Trusted PR (risk paths changed) | ✓ | — |
| Trusted PR with `run-smoke-e2e` label | ✓ | — |
| Trusted PR with `run-full-e2e` label | ✓ | ✓ |
| Push to `main` | — | ✓ |
| Merge group | — | ✓ |
| `workflow_dispatch` | — | ✓ |
| Nightly schedule (3 AM UTC) | — | ✓ |

**Smoke lane** (`--project=smoke`): runs the `testMatch` list from `playwright.config.ts` — management specs, data-isolation, safe-deletes, game-planner, mobile-note.
**Full lane** (`--project=full`): runs everything except `auth.setup.ts` and the two specs owned by the smoke-only lane.

## CI/CD

Trusted and untrusted pull requests are handled differently in CI:
- Trusted same-repo PRs can run smoke E2E when risk paths change (or a smoke label is applied).
- Full E2E with AWS-backed config is never allowed for fork PRs or pull_request_target contexts.
- On trusted contexts (merge queue, push to main, or labeled trusted PR), full E2E fetches `amplify_outputs.json` at runtime from AWS SSM SecureString via OIDC, and does not commit environment-specific Amplify outputs to the repo.

```yaml
- name: Install Playwright
  run: npx playwright install --with-deps

- name: Run E2E tests
  run: npm run test:e2e
  env:
    CI: true
```
