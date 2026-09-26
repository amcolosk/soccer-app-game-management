import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  // Hard cap suite runtime in CI to avoid hung jobs consuming the full workflow budget.
  globalTimeout: process.env.CI ? 45 * 60 * 1000 : 0,
  timeout: process.env.CI ? 90 * 1000 : 120 * 1000,
  expect: {
    timeout: process.env.CI ? 15 * 1000 : 20 * 1000,
  },
  /* Run tests in files in parallel */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  maxFailures: process.env.CI ? 5 : undefined,
  /* Opt out of parallel tests on CI. */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:5173',
    actionTimeout: process.env.CI ? 15 * 1000 : 20 * 1000,
    navigationTimeout: process.env.CI ? 30 * 1000 : 45 * 1000,
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    /* Screenshot on failure */
    screenshot: 'only-on-failure',
    /* Video on failure */
    video: 'retain-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'setup',
      testMatch: '**/auth.setup.ts',
    },
    {
      name: 'smoke',
      // Smoke lane is browser wiring confidence only (~10 min CI budget).
      // game-planner and game-management-direct-note.mobile are excluded: their deep
      // semantics are owned by Vitest integration tests (Layer B), and their full-workflow
      // seeding pushes the smoke suite well over the 10-minute target.
      testMatch: [
        '**/formation-management.spec.ts',
        '**/team-management.spec.ts',
        '**/player-management.spec.ts',
        '**/data-isolation.spec.ts',
        '**/safe-deletes.spec.ts',
      ],
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: '.auth/user1.json' },
    },
    {
      name: 'full',
      dependencies: ['setup'],
      testIgnore: [
        '**/auth.setup.ts',
        '**/data-isolation.spec.ts',
        '**/formation-management.spec.ts',
        '**/team-management.spec.ts',
        '**/player-management.spec.ts',
        '**/safe-deletes.spec.ts',
        // field-conditions-only specs (see that project below) — without this,
        // a new spec file silently auto-joins this per-commit, merge-gating
        // lane by default, defeating field-conditions' whole "pre-release
        // only, not a merge blocker" point.
        '**/offline-game-management.spec.ts',
        '**/concurrent-coaches.spec.ts',
        '**/timer-gap-confirmation.spec.ts',
      ],
      use: { ...devices['Desktop Chrome'], storageState: '.auth/user1.json' },
    },
    {
      // Pre-release field-conditions lane (not run on every push — see
      // .github/workflows/ci.yml). WebKit engine + mobile viewport via
      // devices['iPhone 13'] catches Safari-engine/touch-layout issues
      // ordinary Desktop-Chrome CI never exercises. Explicit testMatch
      // (not full's testIgnore) so this lane only ever runs the specs
      // that opt into it.
      name: 'field-conditions',
      dependencies: ['setup'],
      testMatch: [
        '**/offline-game-management.spec.ts',
        '**/concurrent-coaches.spec.ts',
        '**/timer-gap-confirmation.spec.ts',
      ],
      use: { ...devices['iPhone 13'], storageState: '.auth/user1.json' },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
