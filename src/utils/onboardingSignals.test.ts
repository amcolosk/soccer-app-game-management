/**
 * Tests for the shared onboarding-signals module.
 *
 * `computeOnboardingSignals()` replaces two previously-independent copies
 * of the same derivation (`Home.tsx`'s old `checklistStepCompletion` and
 * `QuickStartChecklist.tsx`'s old `step1Complete`..`step7Complete`) — these
 * tests assert parity against the exact values those two copies would have
 * produced for several input combinations.
 */
import { describe, it, expect } from 'vitest';
import { computeOnboardingSignals, isCoachProfileComplete, ONBOARDING_SIGNAL_COUNT, ONBOARDING_STEPS } from './onboardingSignals';

describe('computeOnboardingSignals', () => {
  it('returns all-false for completely empty inputs', () => {
    expect(computeOnboardingSignals({
      teams: [], games: [], teamRosters: [], gamePlans: [], profileComplete: false,
    })).toEqual([false, false, false, false, false, false, false]);
  });

  it('matches the old two-copy logic for a partially-complete coach', () => {
    const teams = [{ id: 'team-1', formationId: null }];
    const teamRosters = [{ teamId: 'team-1' }];
    const games = [{ id: 'g-1', status: 'scheduled' }];
    const gamePlans: unknown[] = [];

    expect(computeOnboardingSignals({ teams, games, teamRosters, gamePlans, profileComplete: true })).toEqual([
      true,  // step 1: team created
      true,  // step 2: profile complete
      true,  // step 3: roster has a matching team
      false, // step 4: no team has a formation
      true,  // step 5: a game is scheduled
      false, // step 6: no game plans
      false, // step 7: no in-progress/completed game
    ]);
  });

  it('treats an empty-string formationId as not set (step 4)', () => {
    const teams = [{ id: 'team-1', formationId: '' }];
    expect(computeOnboardingSignals({
      teams, games: [], teamRosters: [], gamePlans: [], profileComplete: false,
    })[3]).toBe(false);
  });

  it('treats a non-empty formationId as set (step 4)', () => {
    const teams = [{ id: 'team-1', formationId: 'f-1' }];
    expect(computeOnboardingSignals({
      teams, games: [], teamRosters: [], gamePlans: [], profileComplete: false,
    })[3]).toBe(true);
  });

  it('step 3 requires a roster entry matching a known team id, not just a non-empty roster list', () => {
    const teams = [{ id: 'team-1' }];
    const teamRosters = [{ teamId: 'other-team' }];
    expect(computeOnboardingSignals({
      teams, games: [], teamRosters, gamePlans: [], profileComplete: false,
    })[2]).toBe(false);
  });

  it('step 7 is true for either in-progress or completed games', () => {
    expect(computeOnboardingSignals({
      teams: [], teamRosters: [], gamePlans: [], profileComplete: false,
      games: [{ status: 'in-progress' }],
    })[6]).toBe(true);

    expect(computeOnboardingSignals({
      teams: [], teamRosters: [], gamePlans: [], profileComplete: false,
      games: [{ status: 'completed' }],
    })[6]).toBe(true);

    expect(computeOnboardingSignals({
      teams: [], teamRosters: [], gamePlans: [], profileComplete: false,
      games: [{ status: 'scheduled' }],
    })[6]).toBe(false);
  });

  it('returns an all-true array when every underlying condition is met', () => {
    const teams = [{ id: 'team-1', formationId: 'f-1' }];
    const teamRosters = [{ teamId: 'team-1' }];
    const games = [{ status: 'completed' }];
    const gamePlans = [{ id: 'gp-1' }];

    expect(computeOnboardingSignals({ teams, games, teamRosters, gamePlans, profileComplete: true }))
      .toEqual([true, true, true, true, true, true, true]);
  });

  it('result length always matches ONBOARDING_SIGNAL_COUNT', () => {
    expect(computeOnboardingSignals({
      teams: [], games: [], teamRosters: [], gamePlans: [], profileComplete: false,
    }).length).toBe(ONBOARDING_SIGNAL_COUNT);
    expect(ONBOARDING_SIGNAL_COUNT).toBe(7);
  });
});

describe('isCoachProfileComplete', () => {
  it('is false for null/undefined/empty/whitespace-only names', () => {
    expect(isCoachProfileComplete(null)).toBe(false);
    expect(isCoachProfileComplete(undefined)).toBe(false);
    expect(isCoachProfileComplete('')).toBe(false);
    expect(isCoachProfileComplete('   ')).toBe(false);
  });

  it('is true for a non-empty, trimmed name', () => {
    expect(isCoachProfileComplete('Alex')).toBe(true);
    expect(isCoachProfileComplete('  Alex  ')).toBe(true);
  });
});

describe('ONBOARDING_STEPS', () => {
  it('has one entry per signal, with 1-based ids matching index+1', () => {
    expect(ONBOARDING_STEPS).toHaveLength(ONBOARDING_SIGNAL_COUNT);
    ONBOARDING_STEPS.forEach((step, index) => {
      expect(step.id).toBe(index + 1);
    });
  });
});
