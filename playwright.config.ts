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
      // Smoke lane is browser wiring confidence only.
      // Contract/static layers own deep semantics and payload policy assertions.
      // Target runtime: ≤10 minutes.
      //
      // Excluded from smoke (moved to full):
      //   data-isolation        — requires multi-user login cycling (~3–5 min)
      //   game-management-direct-note.mobile — heavy game-state seeding + mobile
      //                           viewport simulation (~8–12 min); UI wiring for
      //                           notes is covered by the direct-note tests in the
      //                           full suite; mutation semantics are covered by
      //                           offlineQueueService.test.ts and
      //                           PlayerNotesPanel.test.tsx (Vitest)
      testMatch: [
        '**/formation-management.spec.ts',
        '**/team-management.spec.ts',
        '**/player-management.spec.ts',
        '**/safe-deletes.spec.ts',
        // Wiring-only smoke checks; planner/note semantics owned by Vitest integration tests (Layer B)
        '**/game-planner.spec.ts',
      ],
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: '.auth/user1.json' },
    },
    {
      name: 'full',
      dependencies: ['setup'],
      testIgnore: [
        '**/game-planner.spec.ts',
        '**/auth.setup.ts',
        '**/formation-management.spec.ts',
        '**/team-management.spec.ts',
        '**/player-management.spec.ts',
        '**/safe-deletes.spec.ts',
      ],
      use: { ...devices['Desktop Chrome'], storageState: '.auth/user1.json' },
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
