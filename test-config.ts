/**
 * Shared test configuration for E2E tests and seed data
 * Centralizes test user credentials and configuration
 */

export const TEST_USERS = {
  user1: {
    email: process.env.TEST_USER_EMAIL || 'test@example.com',
    password: process.env.TEST_USER_PASSWORD || 'TestPassword123!',
  },
  user2: {
    email: process.env.TEST_USER_EMAIL_2 || 'coach@example.com',
    password: process.env.TEST_USER_PASSWORD_2 || 'CoachPassword123!',
  },
} as const;

export const TEST_CONFIG = {
  timeout: {
    short: 30000,    // 30 seconds
    medium: 60000,   // 1 minute
    long: 400000,    // 6 minutes 40 seconds for full workflow
  },
} as const;
