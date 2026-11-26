/**
 * Shared onboarding-completion logic.
 *
 * `computeOnboardingSignals()` is the single source of truth for the 7
 * raw onboarding-step completion booleans. Previously this derivation was
 * duplicated independently in `Home.tsx` (`checklistStepCompletion`) and
 * `QuickStartChecklist.tsx` (`step1Complete`..`step7Complete`) — both call
 * sites now call this pure function with data they already fetch.
 *
 * `isCoachProfileComplete()` extracts the "profile complete" rule
 * (`firstName.trim().length > 0`) so `Home.tsx` and `UserProfile.tsx` share
 * one definition instead of each having their own copy.
 *
 * The 7 raw signals (in this fixed order) are the ONLY persisted/canonical
 * shape (see `onboarding:lastCompletedSteps` in `Home.tsx` and
 * `docs/specs/UI-SPEC.md` §7.12) — any step-merging for display purposes
 * happens at render time in `QuickStartChecklist.tsx`, never here.
 */

export interface OnboardingSignalsTeam {
  id: string;
  formationId?: string | null;
}

export interface OnboardingSignalsRoster {
  teamId: string;
}

export interface OnboardingSignalsGame {
  status?: string;
}

export interface ComputeOnboardingSignalsInput {
  teams: OnboardingSignalsTeam[];
  games: OnboardingSignalsGame[];
  teamRosters: OnboardingSignalsRoster[];
  gamePlans: unknown[];
  profileComplete: boolean;
}

/** Number of raw onboarding signals / steps. Keep in sync with the array
 * returned by `computeOnboardingSignals()` and the persisted
 * `onboarding:lastCompletedSteps` snapshot shape. */
export const ONBOARDING_SIGNAL_COUNT = 7;

/**
 * Returns the 7 raw onboarding-step completion booleans, in this fixed
 * order:
 *   0: at least one team created
 *   1: coach profile complete
 *   2: at least one roster entry for a known team
 *   3: at least one team with a formation assigned
 *   4: at least one game scheduled
 *   5: at least one game plan created
 *   6: at least one game in-progress or completed
 */
export function computeOnboardingSignals(input: ComputeOnboardingSignalsInput): boolean[] {
  const { teams, games, teamRosters, gamePlans, profileComplete } = input;

  return [
    teams.length >= 1,
    profileComplete,
    teamRosters.some((r) => teams.some((t) => t.id === r.teamId)),
    teams.some((t) => t.formationId != null && t.formationId !== ''),
    games.length >= 1,
    gamePlans.length >= 1,
    games.some((g) => g.status === 'in-progress' || g.status === 'completed'),
  ];
}

/** Shared "profile complete" rule: a non-empty, trimmed first name. */
export function isCoachProfileComplete(firstName: string | null | undefined): boolean {
  return (firstName ?? '').trim().length > 0;
}

/**
 * Metadata for each raw onboarding step/signal, used by `OnboardingNudge`
 * (which can be mounted on any destination screen, not just Home) to render
 * a "Next: {title} →" link and navigate there. `route` is a simplified,
 * screen-agnostic destination — it intentionally doesn't replicate the
 * extra scroll/game-lookup behavior `Home.tsx`'s own
 * `handleNavigateFromChecklist` has for steps 5-7, since a nudge mounted
 * outside Home has no access to that screen's game list; it instead routes
 * back to Home, matching that handler's own fallback behavior.
 */
export interface OnboardingStepMeta {
  /** 1-based step id, matching `QuickStartChecklist`'s `onNavigate(stepId)` convention. */
  id: number;
  title: string;
  route: string;
}

export const ONBOARDING_STEPS: OnboardingStepMeta[] = [
  { id: 1, title: 'Create your team', route: '/manage?section=teams' },
  { id: 2, title: 'Complete your profile', route: '/profile' },
  { id: 3, title: 'Add players to your roster', route: '/manage?section=players' },
  { id: 4, title: 'Set your formation', route: '/manage?section=teams' },
  { id: 5, title: 'Schedule a game', route: '/' },
  { id: 6, title: 'Plan your rotations', route: '/' },
  { id: 7, title: 'Manage a live game', route: '/' },
];
