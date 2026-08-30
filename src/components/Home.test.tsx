/**
 * Tests for the Home component auto-welcome behavior (issue #22).
 *
 * Scenario: coaches who had teams/players **before** the onboarding feature
 * was introduced never had `onboarding:welcomed` stored in localStorage.
 * Without the fix, they would see the WelcomeModal and could accidentally
 * load demo data they didn't want.
 *
 * Behaviours covered:
 *  - Existing user (teams synced, teams.length > 0): markWelcomed() called automatically
 *  - New user (teams synced, teams.length === 0): markWelcomed() NOT called; WelcomeModal shown
 *  - Data not yet synced (isSynced === false, teams.length > 0): markWelcomed() NOT called yet
 *  - Already welcomed: markWelcomed() NOT called redundantly
 *  - WelcomeModal not rendered while teams are still syncing (prevents flash)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Hoisted mock state — define before vi.mock factories run
// ---------------------------------------------------------------------------
const {
  mockMarkWelcomed,
  mockClearDismissed,
  mockSetHelpContext,
  mockSetDebugContext,
  mockNavigate,
  mockCreateGame,
  mockGameUpdate,
  mockGetCurrentUser,
  mockCoachProfileGet,
  mockConfirm,
  mockDeleteGameCascade,
  mockSyncTeamCalendar,
} = vi.hoisted(() => ({
  mockMarkWelcomed: vi.fn(),
  mockClearDismissed: vi.fn(),
  mockSetHelpContext: vi.fn(),
  mockSetDebugContext: vi.fn(),
  mockNavigate: vi.fn(),
  mockCreateGame: vi.fn(),
  mockGameUpdate: vi.fn(),
  mockGetCurrentUser: vi.fn(),
  mockCoachProfileGet: vi.fn(),
  mockConfirm: vi.fn(),
  mockDeleteGameCascade: vi.fn(),
  mockSyncTeamCalendar: vi.fn(),
}));

// Mutable query results — tests mutate these before rendering
const teamQueryResult: { data: object[]; isSynced: boolean } = { data: [], isSynced: false };
const gameQueryResult: { data: object[]; isSynced: boolean } = { data: [], isSynced: true };

// Mutable onboarding state — tests set `welcomed` before rendering
const onboardingState = {
  welcomed: false,
  dismissed: true, // suppress QuickStartChecklist in all tests
  collapsed: false,
};

// Mutable authenticator state — tests can override authStatus
const authState: { authStatus: string } = {
  authStatus: 'authenticated',
};

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../hooks/useAmplifyQuery', () => ({
  useAmplifyQuery: (modelName: string) => {
    if (modelName === 'Team') return teamQueryResult;
    if (modelName === 'Game') return gameQueryResult;
    return { data: [], isSynced: true };
  },
}));

vi.mock('../contexts/OnboardingContext', () => ({
  useOnboarding: () => ({
    ...onboardingState,
    markWelcomed: mockMarkWelcomed,
    clearDismissed: mockClearDismissed,
    expand: vi.fn(),
    dismiss: vi.fn(),
    collapse: vi.fn(),
  }),
}));

vi.mock('@aws-amplify/ui-react', () => ({
  useAuthenticator: () => ({ authStatus: authState.authStatus }),
}));

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: mockGetCurrentUser,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../contexts/HelpFabContext', () => ({
  useHelpFab: () => ({
    setHelpContext: mockSetHelpContext,
    setDebugContext: mockSetDebugContext,
  }),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      Game: { update: mockGameUpdate },
      CoachProfile: { get: mockCoachProfileGet },
    },
  }),
}));

vi.mock('../services/gameService', () => ({
  createGame: mockCreateGame,
}));

vi.mock('../services/calendarSyncService', () => ({
  syncTeamCalendar: mockSyncTeamCalendar,
}));

vi.mock('../services/demoDataService', () => ({
  createDemoTeam: vi.fn(),
  removeDemoData: vi.fn(),
}));

vi.mock('../utils/analytics', () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: {
    GAME_CREATED: { category: 'Game', action: 'Game Created' },
    GAME_UPDATED: { category: 'Game', action: 'Update Game' },
    GAME_DELETED: { category: 'Game', action: 'Delete Game' },
    GAME_OPENED: { category: 'Game', action: 'Open Game' },
    CALENDAR_IMPORT_APPLIED: { category: 'Game', action: 'Calendar Import Applied' },
    DEMO_TEAM_CREATED: { category: 'Onboarding', action: 'Demo Team Created' },
    DEMO_TEAM_REMOVED: { category: 'Onboarding', action: 'Demo Team Removed' },
  },
}));

vi.mock('../utils/errorHandler', () => ({
  handleApiError: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../utils/toast', () => ({
  showError: vi.fn(),
  showWarning: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock('../utils/debugUtils', () => ({
  buildFlatDebugSnapshot: () => 'debug',
}));

vi.mock('./Onboarding/WelcomeModal', () => ({
  WelcomeModal: () => <div data-testid="welcome-modal" />,
}));

vi.mock('./Onboarding/QuickStartChecklist', () => ({
  QuickStartChecklist: (props: unknown) => (
    <div
      data-testid="quick-start-checklist"
      data-teams={JSON.stringify((props as { teams: unknown[] }).teams)}
    />
  ),
}));

vi.mock('./ConfirmModal', () => ({
  useConfirm: () => mockConfirm,
}));

vi.mock('../services/cascadeDeleteService', () => ({
  deleteGameCascade: mockDeleteGameCascade,
}));

vi.mock('../utils/gameTimeUtils', () => ({
  isoToDatetimeLocal: vi.fn().mockReturnValue(''),
}));

// ---------------------------------------------------------------------------
// Import component after mocks are registered
// ---------------------------------------------------------------------------
import { Home } from './Home';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function resetState() {
  mockMarkWelcomed.mockClear();
  mockClearDismissed.mockClear();
  mockCreateGame.mockReset();
  mockGameUpdate.mockReset();
  mockGameUpdate.mockResolvedValue({ data: {} });
  mockGetCurrentUser.mockReset();
  mockGetCurrentUser.mockResolvedValue({ userId: 'test-user-id' });
  mockCoachProfileGet.mockReset();
  mockCoachProfileGet.mockResolvedValue({ data: { firstName: '' } });
  mockConfirm.mockReset();
  mockConfirm.mockResolvedValue(false);
  mockDeleteGameCascade.mockReset();
  mockDeleteGameCascade.mockResolvedValue(undefined);
  mockSyncTeamCalendar.mockReset();
  teamQueryResult.data = [];
  teamQueryResult.isSynced = false;
  gameQueryResult.data = [];
  gameQueryResult.isSynced = true;
  onboardingState.welcomed = false;
  onboardingState.dismissed = true;
  authState.authStatus = 'authenticated';
  localStorage.clear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Home — auto-welcome for existing users (issue #22)', () => {
  beforeEach(resetState);

  it('calls markWelcomed() when teams are synced and the user already has teams', async () => {
    teamQueryResult.data = [{ id: 'team-1', name: 'Eagles', coaches: ['test-user-id'] }];
    teamQueryResult.isSynced = true;
    onboardingState.welcomed = false;

    render(<Home />);

    await waitFor(() => {
      expect(mockMarkWelcomed).toHaveBeenCalledTimes(1);
    });
  });

  it('does NOT call markWelcomed() when teams are synced but the user has no teams (new user)', async () => {
    teamQueryResult.data = [];
    teamQueryResult.isSynced = true;
    onboardingState.welcomed = false;

    render(<Home />);

    // Give any potential effect time to fire
    await new Promise(r => setTimeout(r, 50));

    expect(mockMarkWelcomed).not.toHaveBeenCalled();
  });

  it('does NOT call markWelcomed() before teams have finished syncing', async () => {
    teamQueryResult.data = [{ id: 'team-1', name: 'Eagles', coaches: ['test-user-id'] }];
    teamQueryResult.isSynced = false; // still loading
    onboardingState.welcomed = false;

    render(<Home />);

    await new Promise(r => setTimeout(r, 50));

    expect(mockMarkWelcomed).not.toHaveBeenCalled();
  });

  it('does NOT call markWelcomed() when the user is already welcomed', async () => {
    teamQueryResult.data = [{ id: 'team-1', name: 'Eagles', coaches: ['test-user-id'] }];
    teamQueryResult.isSynced = true;
    onboardingState.welcomed = true; // already welcomed

    render(<Home />);

    await new Promise(r => setTimeout(r, 50));

    expect(mockMarkWelcomed).not.toHaveBeenCalled();
  });

  it('shows WelcomeModal for a new user once teams finish syncing with 0 results', async () => {
    teamQueryResult.data = [];
    teamQueryResult.isSynced = true;
    onboardingState.welcomed = false;

    render(<Home />);

    expect(screen.getByTestId('welcome-modal')).toBeInTheDocument();
  });

  it('does NOT show WelcomeModal while teams are still syncing (prevents flash)', () => {
    teamQueryResult.data = [];
    teamQueryResult.isSynced = false; // still syncing
    onboardingState.welcomed = false;

    render(<Home />);

    expect(screen.queryByTestId('welcome-modal')).not.toBeInTheDocument();
  });

  it('does NOT show WelcomeModal once the user is welcomed', () => {
    teamQueryResult.data = [{ id: 'team-1', name: 'Eagles', coaches: ['test-user-id'] }];
    teamQueryResult.isSynced = true;
    onboardingState.welcomed = true;

    render(<Home />);

    expect(screen.queryByTestId('welcome-modal')).not.toBeInTheDocument();
  });

  it('returns null when authStatus transitions to non-authenticated', () => {
    authState.authStatus = 'authenticated';
    const { rerender } = render(<Home />);

    expect(screen.getByRole('button', { name: /schedule new game/i })).toBeInTheDocument();

    authState.authStatus = 'unauthenticated';
    rerender(<Home />);

    expect(screen.queryByRole('button', { name: /schedule new game/i })).not.toBeInTheDocument();
  });

  it('renders Home content when authenticated without requiring useAuthenticator user object', () => {
    authState.authStatus = 'authenticated';

    render(<Home />);

    expect(screen.getByRole('button', { name: /schedule new game/i })).toBeInTheDocument();
  });

  it('does not call createGame when currentUserId is unresolved', async () => {
    let resolveUser: ((value: { userId: string }) => void) | undefined;
    mockGetCurrentUser.mockImplementation(
      () => new Promise<{ userId: string }>((resolve) => {
        resolveUser = resolve;
      })
    );

    teamQueryResult.data = [{ id: 'team-1', name: 'Eagles', coaches: ['test-user-id'] }];
    teamQueryResult.isSynced = true;

    render(<Home />);

    fireEvent.click(screen.getByRole('button', { name: /schedule new game/i }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'team-1' } });
    fireEvent.change(screen.getByPlaceholderText('Opponent Team Name *'), { target: { value: 'Rivals FC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(mockCreateGame).not.toHaveBeenCalled();
    });

    resolveUser?.({ userId: 'late-user-id' });
  });

  it('clears dismissed checklist flag when a previously completed step regresses', async () => {
    onboardingState.welcomed = true;
    onboardingState.dismissed = true;
    teamQueryResult.isSynced = true;
    teamQueryResult.data = [];
    localStorage.setItem('onboarding:lastCompletedSteps', JSON.stringify([true, true, true, true, true, true, true]));

    render(<Home />);

    await waitFor(() => {
      expect(mockClearDismissed).toHaveBeenCalledTimes(1);
    });
    expect(localStorage.getItem('onboarding:lastCompletedSteps')).toBeNull();
  });

  it('keeps checklist dismissed when no completed step regresses', async () => {
    onboardingState.welcomed = true;
    onboardingState.dismissed = true;
    teamQueryResult.isSynced = true;
    teamQueryResult.data = [{ id: 'team-1', name: 'Eagles', coaches: ['test-user-id'], formationId: 'f-1' }];
    localStorage.setItem('onboarding:lastCompletedSteps', JSON.stringify([true, false, false, true, false, false, false]));

    render(<Home />);

    await new Promise(r => setTimeout(r, 50));
    expect(mockClearDismissed).not.toHaveBeenCalled();
    expect(localStorage.getItem('onboarding:lastCompletedSteps')).toBe(
      JSON.stringify([true, false, false, true, false, false, false])
    );
  });

  it('does not clear dismissed state when snapshot is missing and checklist is incomplete', async () => {
    onboardingState.welcomed = true;
    onboardingState.dismissed = true;
    teamQueryResult.isSynced = true;
    teamQueryResult.data = [];

    render(<Home />);

    await new Promise(r => setTimeout(r, 50));
    expect(mockClearDismissed).not.toHaveBeenCalled();
    expect(localStorage.getItem('onboarding:lastCompletedSteps')).toBeNull();
  });

  it('does not clear dismissed state when snapshot is malformed JSON', async () => {
    onboardingState.welcomed = true;
    onboardingState.dismissed = true;
    teamQueryResult.isSynced = true;
    teamQueryResult.data = [];
    localStorage.setItem('onboarding:lastCompletedSteps', '{not-json');

    render(<Home />);

    await new Promise(r => setTimeout(r, 50));
    expect(mockClearDismissed).not.toHaveBeenCalled();
    expect(localStorage.getItem('onboarding:lastCompletedSteps')).toBe('{not-json');
  });

  it('does not clear dismissed state when snapshot has invalid length or non-boolean entries', async () => {
    onboardingState.welcomed = true;
    onboardingState.dismissed = true;
    teamQueryResult.isSynced = true;
    teamQueryResult.data = [];

    localStorage.setItem('onboarding:lastCompletedSteps', JSON.stringify([true, true]));
    const firstRender = render(<Home />);
    await new Promise(r => setTimeout(r, 50));
    expect(mockClearDismissed).not.toHaveBeenCalled();
    expect(localStorage.getItem('onboarding:lastCompletedSteps')).toBe(JSON.stringify([true, true]));
    firstRender.unmount();

    mockClearDismissed.mockClear();

    localStorage.setItem(
      'onboarding:lastCompletedSteps',
      JSON.stringify([true, true, true, true, true, true, 'no'])
    );
    render(<Home />);
    await new Promise(r => setTimeout(r, 50));
    expect(mockClearDismissed).not.toHaveBeenCalled();
    expect(localStorage.getItem('onboarding:lastCompletedSteps')).toBe(
      JSON.stringify([true, true, true, true, true, true, 'no'])
    );
  });

  it('does not clear dismissed state while profile completion is still loading', async () => {
    onboardingState.welcomed = true;
    onboardingState.dismissed = true;
    teamQueryResult.isSynced = true;
    teamQueryResult.data = [{ id: 'team-1', name: 'Eagles', coaches: ['test-user-id'] }];
    localStorage.setItem('onboarding:lastCompletedSteps', JSON.stringify([true, true, false, false, false, false, false]));

    let resolveProfileGet: ((value: { data: { firstName: string } }) => void) | undefined;
    mockCoachProfileGet.mockImplementation(
      () => new Promise<{ data: { firstName: string } }>((resolve) => {
        resolveProfileGet = resolve;
      })
    );

    render(<Home />);

    await new Promise(r => setTimeout(r, 50));
    expect(mockClearDismissed).not.toHaveBeenCalled();

    resolveProfileGet?.({ data: { firstName: 'Coach' } });

    await waitFor(() => {
      expect(mockClearDismissed).not.toHaveBeenCalled();
    });
  });

  it('does not clear dismissed state before onboarding source data is fully synced', async () => {
    onboardingState.welcomed = true;
    onboardingState.dismissed = true;
    teamQueryResult.isSynced = false;
    teamQueryResult.data = [];
    localStorage.setItem('onboarding:lastCompletedSteps', JSON.stringify([true, true, true, true, true, true, true]));
    mockCoachProfileGet.mockResolvedValue({ data: { firstName: '' } });

    render(<Home />);

    await new Promise(r => setTimeout(r, 50));

    expect(mockClearDismissed).not.toHaveBeenCalled();
    expect(localStorage.getItem('onboarding:lastCompletedSteps')).toBe(
      JSON.stringify([true, true, true, true, true, true, true])
    );
  });

  it('reopens dismissed checklist only after loaded profile data confirms regression', async () => {
    onboardingState.welcomed = true;
    onboardingState.dismissed = true;
    teamQueryResult.isSynced = true;
    teamQueryResult.data = [{ id: 'team-1', name: 'Eagles', coaches: ['test-user-id'] }];
    localStorage.setItem('onboarding:lastCompletedSteps', JSON.stringify([true, true, false, false, false, false, false]));

    let resolveProfileGet: ((value: { data: { firstName: string } }) => void) | undefined;
    mockCoachProfileGet.mockImplementation(
      () => new Promise<{ data: { firstName: string } }>((resolve) => {
        resolveProfileGet = resolve;
      })
    );

    render(<Home />);

    await new Promise(r => setTimeout(r, 50));
    expect(mockClearDismissed).not.toHaveBeenCalled();

    resolveProfileGet?.({ data: { firstName: '' } });

    await waitFor(() => {
      expect(mockClearDismissed).toHaveBeenCalledTimes(1);
    });
    expect(localStorage.getItem('onboarding:lastCompletedSteps')).toBeNull();
  });

  it('keeps dismissed checklist state when profile fetch fails and profile state is unresolved', async () => {
    onboardingState.welcomed = true;
    onboardingState.dismissed = true;
    teamQueryResult.isSynced = true;
    teamQueryResult.data = [{ id: 'team-1', name: 'Eagles', coaches: ['test-user-id'] }];
    localStorage.setItem('onboarding:lastCompletedSteps', JSON.stringify([true, true, false, false, false, false, false]));

    mockCoachProfileGet.mockRejectedValueOnce(new Error('network failure'));

    render(<Home />);

    await new Promise(r => setTimeout(r, 50));

    expect(mockClearDismissed).not.toHaveBeenCalled();
    expect(localStorage.getItem('onboarding:lastCompletedSteps')).toBe(
      JSON.stringify([true, true, false, false, false, false, false])
    );
  });
});

describe('Home — game status grouping (regression guard)', () => {
  beforeEach(resetState);

  it('shows a completed game in "Past Games", not "Active Games"', () => {
    teamQueryResult.data = [{ id: 't1', name: 'Eagles', coaches: ['test-user-id'] }];
    teamQueryResult.isSynced = true;
    gameQueryResult.data = [
      { id: 'g1', status: 'completed', teamId: 't1', opponent: 'Rivals FC', isHome: true },
    ];
    gameQueryResult.isSynced = true;

    render(<Home />);

    expect(screen.getByText('Past Games')).toBeInTheDocument();
    expect(screen.queryByText('Active Games')).not.toBeInTheDocument();
  });

  it('shows an in-progress game in "Active Games", not "Past Games"', () => {
    teamQueryResult.data = [{ id: 't1', name: 'Eagles', coaches: ['test-user-id'] }];
    teamQueryResult.isSynced = true;
    gameQueryResult.data = [
      { id: 'g1', status: 'in-progress', teamId: 't1', opponent: 'Rivals FC', isHome: true },
    ];
    gameQueryResult.isSynced = true;

    render(<Home />);

    expect(screen.getByText('Active Games')).toBeInTheDocument();
    expect(screen.queryByText('Past Games')).not.toBeInTheDocument();
  });
});

describe('Home — archived team filtering (Team Archive Step 5)', () => {
  beforeEach(resetState);

  it('keeps a completed game for an archived team visible in "Past Games" (getTeam intentionally searches the full team list)', () => {
    teamQueryResult.data = [
      { id: 't1', name: 'Active Eagles', coaches: ['test-user-id'], status: 'active' },
      { id: 't2', name: 'Archived Hawks', coaches: ['test-user-id'], status: 'archived' },
    ];
    teamQueryResult.isSynced = true;
    gameQueryResult.data = [
      { id: 'g1', status: 'completed', teamId: 't2', opponent: 'Rivals FC', isHome: true },
    ];
    gameQueryResult.isSynced = true;

    render(<Home />);

    expect(screen.getByText('Past Games')).toBeInTheDocument();
    expect(screen.getByText('Archived Hawks vs Rivals FC')).toBeInTheDocument();
  });

  it('lists only the active team in the Schedule Game team dropdown, excluding the archived one', () => {
    teamQueryResult.data = [
      { id: 't1', name: 'Active Eagles', coaches: ['test-user-id'], status: 'active' },
      { id: 't2', name: 'Archived Hawks', coaches: ['test-user-id'], status: 'archived' },
    ];
    teamQueryResult.isSynced = true;

    render(<Home />);

    fireEvent.click(screen.getByRole('button', { name: /schedule new game/i }));

    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toContain('Active Eagles');
    expect(options).not.toContain('Archived Hawks');
  });

  it('passes only active teams to QuickStartChecklist', () => {
    onboardingState.welcomed = true;
    onboardingState.dismissed = false;
    teamQueryResult.data = [
      { id: 't1', name: 'Active Eagles', coaches: ['test-user-id'], status: 'active' },
      { id: 't2', name: 'Archived Hawks', coaches: ['test-user-id'], status: 'archived' },
    ];
    teamQueryResult.isSynced = true;

    render(<Home />);

    const checklist = screen.getByTestId('quick-start-checklist');
    const passedTeams = JSON.parse(checklist.getAttribute('data-teams') ?? '[]');
    expect(passedTeams).toHaveLength(1);
    expect(passedTeams[0].id).toBe('t1');
  });

  it('reopens a dismissed checklist when archiving a coach\'s only active team regresses previously-complete steps', async () => {
    onboardingState.welcomed = true;
    onboardingState.dismissed = true;
    teamQueryResult.isSynced = true;
    // Only an archived team remains — activeTeams is empty, so checklistStepCompletion's
    // steps 1/3/4 regress from complete to incomplete. See docs/plans/
    // TEAM-ARCHIVE-STEP5-FRONTEND-UX.md, Decision (round 2, Minor 9).
    teamQueryResult.data = [
      { id: 't1', name: 'Archived Only FC', coaches: ['test-user-id'], status: 'archived', formationId: 'f-1' },
    ];
    localStorage.setItem('onboarding:lastCompletedSteps', JSON.stringify([true, true, true, true, true, true, true]));

    render(<Home />);

    await waitFor(() => {
      expect(mockClearDismissed).toHaveBeenCalledTimes(1);
    });
    expect(localStorage.getItem('onboarding:lastCompletedSteps')).toBeNull();
  });
});

describe('Home — Lambda-backed game creation (TEAM-ARCHIVE-STEP11 Part 1)', () => {
  beforeEach(resetState);

  function openCreateFormAndFillOpponent(opponent = 'Rivals FC') {
    fireEvent.click(screen.getByRole('button', { name: /schedule new game/i }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'team-1' } });
    fireEvent.change(screen.getByPlaceholderText('Opponent Team Name *'), { target: { value: opponent } });
  }

  it('adds the newly created game to the list immediately, without waiting for the Game query to refresh', async () => {
    // A matching team must be seeded — Home.tsx's game-card rendering does
    // `const team = getTeam(game.teamId); if (!team) return null;`.
    teamQueryResult.data = [{ id: 'team-1', name: 'Eagles', coaches: ['test-user-id'] }];
    teamQueryResult.isSynced = true;
    gameQueryResult.data = [];
    gameQueryResult.isSynced = true;

    mockCreateGame.mockResolvedValue({
      id: 'game-pending-1',
      teamId: 'team-1',
      opponent: 'Rivals FC',
      isHome: true,
      status: 'scheduled',
      gameDate: null,
    });

    render(<Home />);
    // Let getCurrentUser's mocked promise resolve so currentUserId is set
    // before we submit the form (handleCreateGame no-ops otherwise).
    await waitFor(() => expect(mockGetCurrentUser).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));

    openCreateFormAndFillOpponent();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(screen.getByText('Eagles vs Rivals FC')).toBeInTheDocument();
    });

    // The raw Game query was never advanced — proves the card rendered from
    // the Lambda's own returned Game, not from the query catching up.
    expect(gameQueryResult.data).toHaveLength(0);
  });

  it('stops showing a pending game once the Game query independently includes it', async () => {
    teamQueryResult.data = [{ id: 'team-1', name: 'Eagles', coaches: ['test-user-id'] }];
    teamQueryResult.isSynced = true;
    gameQueryResult.data = [];
    gameQueryResult.isSynced = true;

    const createdGame = {
      id: 'game-pending-2',
      teamId: 'team-1',
      opponent: 'Rivals FC',
      isHome: true,
      status: 'scheduled',
      gameDate: null,
    };
    mockCreateGame.mockResolvedValue(createdGame);

    const { rerender } = render(<Home />);
    await waitFor(() => expect(mockGetCurrentUser).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));

    openCreateFormAndFillOpponent();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(screen.getByText('Eagles vs Rivals FC')).toBeInTheDocument();
    });

    // Reassign (not mutate in place) so useEffect's `games` dependency sees a
    // new array identity — matches this file's established pattern and
    // production `useAmplifyQuery`'s own behavior.
    gameQueryResult.data = [{ ...createdGame }];

    rerender(<Home />);

    await waitFor(() => {
      expect(screen.getAllByText('Eagles vs Rivals FC')).toHaveLength(1);
    });
  });

  it('removes a pending game from the list when it is deleted before the raw Game query catches up', async () => {
    teamQueryResult.data = [{ id: 'team-1', name: 'Eagles', coaches: ['test-user-id'] }];
    teamQueryResult.isSynced = true;
    gameQueryResult.data = [];
    gameQueryResult.isSynced = true;

    mockCreateGame.mockResolvedValue({
      id: 'game-pending-3',
      teamId: 'team-1',
      opponent: 'Rivals FC',
      isHome: true,
      status: 'scheduled',
      gameDate: null,
    });
    // This file's ConfirmModal mock defaults to declining; this test needs
    // the confirmation to resolve true so the delete flow actually proceeds.
    mockConfirm.mockResolvedValueOnce(true);

    render(<Home />);
    await waitFor(() => expect(mockGetCurrentUser).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));

    openCreateFormAndFillOpponent();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(screen.getByText('Eagles vs Rivals FC')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => {
      expect(mockDeleteGameCascade).toHaveBeenCalledWith('game-pending-3');
    });

    // The raw Game query never contained this id, so without the explicit
    // pendingCreatedGames removal, the reconciliation effect could never
    // clear the phantom card on its own.
    await waitFor(() => {
      expect(screen.queryByText('Eagles vs Rivals FC')).not.toBeInTheDocument();
    });
  });

  it('disables the Create button while game creation is in flight and re-enables it after', async () => {
    teamQueryResult.data = [{ id: 'team-1', name: 'Eagles', coaches: ['test-user-id'] }];
    teamQueryResult.isSynced = true;

    let resolveCreate: ((value: unknown) => void) | undefined;
    mockCreateGame.mockImplementation(
      () => new Promise((resolve) => {
        resolveCreate = resolve;
      })
    );

    render(<Home />);
    await waitFor(() => expect(mockGetCurrentUser).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));

    openCreateFormAndFillOpponent();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /creating/i })).toBeDisabled();
    });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    resolveCreate?.({
      id: 'game-in-flight',
      teamId: 'team-1',
      opponent: 'Rivals FC',
      isHome: true,
      status: 'scheduled',
      gameDate: null,
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /creating/i })).not.toBeInTheDocument();
    });
  });
});

describe('Home — Calendar Feed Import (Phase 2, file-upload path)', () => {
  beforeEach(resetState);

  function makeIcsFile(name = 'schedule.ics', content = 'BEGIN:VCALENDAR\nEND:VCALENDAR\n') {
    return new File([content], name, { type: 'text/calendar' });
  }

  function seedOneActiveTeam() {
    teamQueryResult.data = [{ id: 'team-1', name: 'Eagles', coaches: ['test-user-id'] }];
    teamQueryResult.isSynced = true;
  }

  it('does not render the "Import from calendar" trigger when there are no active teams', () => {
    teamQueryResult.data = [];
    teamQueryResult.isSynced = true;

    render(<Home />);

    expect(screen.queryByRole('button', { name: /import from calendar/i })).not.toBeInTheDocument();
  });

  it('renders the "Import from calendar" trigger as a secondary action alongside "+ Schedule New Game"', () => {
    seedOneActiveTeam();

    render(<Home />);

    expect(screen.getByRole('button', { name: /schedule new game/i })).toBeInTheDocument();
    const importButton = screen.getByRole('button', { name: /import from calendar/i });
    expect(importButton).toBeInTheDocument();
    expect(importButton.className).not.toContain('btn-primary');
  });

  it('opens the import panel with a team select and file input', () => {
    seedOneActiveTeam();
    render(<Home />);

    fireEvent.click(screen.getByRole('button', { name: /import from calendar/i }));

    expect(screen.getByLabelText(/team to import games for/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/calendar \.ics file/i)).toBeInTheDocument();
  });

  it('runs a dryRun preview on file selection and shows a lightweight success toast with no modal for a no-op result', async () => {
    seedOneActiveTeam();
    mockSyncTeamCalendar.mockResolvedValue({
      createdGames: [], updatedGames: [], skippedCount: 3, cancelledCount: 0,
      adoptedCount: 0, protectedCount: 0, failedCount: 0, warnings: [],
    });
    const toast = await import('../utils/toast');

    render(<Home />);
    fireEvent.click(screen.getByRole('button', { name: /import from calendar/i }));
    fireEvent.change(screen.getByLabelText(/team to import games for/i), { target: { value: 'team-1' } });

    const file = makeIcsFile();
    fireEvent.change(screen.getByLabelText(/calendar \.ics file/i), { target: { files: [file] } });

    await waitFor(() => {
      expect(mockSyncTeamCalendar).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'team-1', dryRun: true }));
    });
    await waitFor(() => {
      expect(toast.showSuccess).toHaveBeenCalledWith(expect.stringMatching(/up to date/i));
    });
    expect(screen.queryByText(/import preview/i)).not.toBeInTheDocument();
  });

  it('shows the preview modal with counts and warnings for a non-empty dryRun result', async () => {
    seedOneActiveTeam();
    mockSyncTeamCalendar.mockResolvedValue({
      createdGames: [{ id: 'g1' }, { id: 'g2' }],
      updatedGames: [{ id: 'g3' }],
      skippedCount: 0, cancelledCount: 0, adoptedCount: 1, protectedCount: 0, failedCount: 0,
      warnings: ['Linked "Rivals FC" to an existing game you entered by hand.'],
    });

    render(<Home />);
    fireEvent.click(screen.getByRole('button', { name: /import from calendar/i }));
    fireEvent.change(screen.getByLabelText(/team to import games for/i), { target: { value: 'team-1' } });
    fireEvent.change(screen.getByLabelText(/calendar \.ics file/i), { target: { files: [makeIcsFile()] } });

    await waitFor(() => {
      expect(screen.getByText(/import preview/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/create 2 game/i)).toBeInTheDocument();
    expect(screen.getByText(/link 1 game/i)).toBeInTheDocument();
    expect(screen.getAllByText(/entered by hand/i).length).toBeGreaterThan(0);
  });

  it('Confirm re-runs the mutation without dryRun, absorbs created games, and closes the modal', async () => {
    seedOneActiveTeam();
    mockSyncTeamCalendar.mockResolvedValueOnce({
      createdGames: [], updatedGames: [], skippedCount: 0, cancelledCount: 0,
      adoptedCount: 0, protectedCount: 0, failedCount: 0, warnings: [],
    });
    // Force a non-no-op preview so the modal actually appears.
    mockSyncTeamCalendar.mockReset();
    mockSyncTeamCalendar.mockImplementation(async (args: { dryRun?: boolean }) => {
      if (args.dryRun) {
        return { createdGames: [{ id: 'g1' }], updatedGames: [], skippedCount: 0, cancelledCount: 0, adoptedCount: 0, protectedCount: 0, failedCount: 0, warnings: [] };
      }
      return {
        createdGames: [{ id: 'g1', teamId: 'team-1', opponent: 'Rivals FC', isHome: true, status: 'scheduled', gameDate: null }],
        updatedGames: [], skippedCount: 0, cancelledCount: 0, adoptedCount: 0, protectedCount: 0, failedCount: 0, warnings: [],
      };
    });

    render(<Home />);
    fireEvent.click(screen.getByRole('button', { name: /import from calendar/i }));
    fireEvent.change(screen.getByLabelText(/team to import games for/i), { target: { value: 'team-1' } });
    fireEvent.change(screen.getByLabelText(/calendar \.ics file/i), { target: { files: [makeIcsFile()] } });

    await waitFor(() => expect(screen.getByText(/import preview/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      expect(mockSyncTeamCalendar).toHaveBeenLastCalledWith(expect.objectContaining({ teamId: 'team-1', dryRun: false }));
    });
    await waitFor(() => {
      expect(screen.queryByText(/import preview/i)).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('Eagles vs Rivals FC')).toBeInTheDocument();
    });
  });

  it('Cancel closes the preview modal without calling the mutation again', async () => {
    seedOneActiveTeam();
    mockSyncTeamCalendar.mockResolvedValue({
      createdGames: [{ id: 'g1' }], updatedGames: [], skippedCount: 0, cancelledCount: 0,
      adoptedCount: 0, protectedCount: 0, failedCount: 0, warnings: [],
    });

    render(<Home />);
    fireEvent.click(screen.getByRole('button', { name: /import from calendar/i }));
    fireEvent.change(screen.getByLabelText(/team to import games for/i), { target: { value: 'team-1' } });
    fireEvent.change(screen.getByLabelText(/calendar \.ics file/i), { target: { files: [makeIcsFile()] } });

    await waitFor(() => expect(screen.getByText(/import preview/i)).toBeInTheDocument());
    const callsBeforeCancel = mockSyncTeamCalendar.mock.calls.length;

    fireEvent.click(screen.getAllByRole('button', { name: /^cancel$/i })[0]);

    expect(screen.queryByText(/import preview/i)).not.toBeInTheDocument();
    expect(mockSyncTeamCalendar).toHaveBeenCalledTimes(callsBeforeCancel);
  });

  it('shows an error toast and resets the busy state when the dryRun preview call fails', async () => {
    seedOneActiveTeam();
    mockSyncTeamCalendar.mockRejectedValue(new Error('Lambda timeout'));
    const toast = await import('../utils/toast');

    render(<Home />);
    fireEvent.click(screen.getByRole('button', { name: /import from calendar/i }));
    fireEvent.change(screen.getByLabelText(/team to import games for/i), { target: { value: 'team-1' } });
    fireEvent.change(screen.getByLabelText(/calendar \.ics file/i), { target: { files: [makeIcsFile()] } });

    await waitFor(() => {
      expect(toast.showError).toHaveBeenCalledWith('Lambda timeout');
    });
    expect(screen.queryByText(/import preview/i)).not.toBeInTheDocument();
    // Panel is still open and file input usable again (busy state cleared).
    expect(screen.getByLabelText(/calendar \.ics file/i)).not.toBeDisabled();
  });

  it('rejects an oversized file client-side without calling the mutation (advisory 512 KB cap)', async () => {
    seedOneActiveTeam();
    const toast = await import('../utils/toast');
    const bigContent = 'a'.repeat(600 * 1024);
    const bigFile = makeIcsFile('big.ics', bigContent);

    render(<Home />);
    fireEvent.click(screen.getByRole('button', { name: /import from calendar/i }));
    fireEvent.change(screen.getByLabelText(/team to import games for/i), { target: { value: 'team-1' } });
    fireEvent.change(screen.getByLabelText(/calendar \.ics file/i), { target: { files: [bigFile] } });

    await waitFor(() => {
      expect(toast.showError).toHaveBeenCalledWith(expect.stringMatching(/too large/i));
    });
    expect(mockSyncTeamCalendar).not.toHaveBeenCalled();
  });
});

describe('Home — Calendar Feed Import (Phase 3, "Sync now" relabeling)', () => {
  beforeEach(resetState);

  it('shows "Import from calendar" when no active team has a linked feed', () => {
    teamQueryResult.data = [{ id: 'team-1', name: 'Eagles', coaches: ['test-user-id'], calendarFeedHost: null }];
    teamQueryResult.isSynced = true;

    render(<Home />);

    expect(screen.getByRole('button', { name: /import from calendar/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^sync now$/i })).not.toBeInTheDocument();
  });

  it('shows "Sync now" when at least one active team has a linked feed', () => {
    teamQueryResult.data = [
      { id: 'team-1', name: 'Eagles', coaches: ['test-user-id'], calendarFeedHost: 'calendar.playmetrics.com' },
    ];
    teamQueryResult.isSynced = true;

    render(<Home />);

    expect(screen.getByRole('button', { name: /sync now/i })).toBeInTheDocument();
  });

  it('shows a "Sync now" action (not a file input) in the panel once a team with a linked feed is selected, plus an "upload a file instead" fallback', () => {
    teamQueryResult.data = [
      { id: 'team-1', name: 'Eagles', coaches: ['test-user-id'], calendarFeedHost: 'calendar.playmetrics.com' },
    ];
    teamQueryResult.isSynced = true;

    render(<Home />);
    fireEvent.click(screen.getByRole('button', { name: /sync now/i }));
    fireEvent.change(screen.getByLabelText(/team to import games for/i), { target: { value: 'team-1' } });

    expect(screen.queryByLabelText(/calendar \.ics file/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /or upload a file instead/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /or upload a file instead/i }));
    expect(screen.getByLabelText(/calendar \.ics file/i)).toBeInTheDocument();
  });

  it('"Sync now" calls syncTeamCalendar with no icsContent (re-syncs the saved feed)', async () => {
    teamQueryResult.data = [
      { id: 'team-1', name: 'Eagles', coaches: ['test-user-id'], calendarFeedHost: 'calendar.playmetrics.com' },
    ];
    teamQueryResult.isSynced = true;
    mockSyncTeamCalendar.mockResolvedValue({
      createdGames: [], updatedGames: [], skippedCount: 2, cancelledCount: 0,
      adoptedCount: 0, protectedCount: 0, failedCount: 0, warnings: [],
    });

    render(<Home />);
    fireEvent.click(screen.getByRole('button', { name: /sync now/i }));
    fireEvent.change(screen.getByLabelText(/team to import games for/i), { target: { value: 'team-1' } });

    // Panel's own "Sync now" action button, distinct from the outer trigger.
    const panelButtons = screen.getAllByRole('button', { name: /sync now/i });
    fireEvent.click(panelButtons[panelButtons.length - 1]);

    await waitFor(() => {
      expect(mockSyncTeamCalendar).toHaveBeenCalledWith({ teamId: 'team-1', dryRun: true });
    });
  });

  it('a team without a linked feed still shows the file input even when "Sync now" is the trigger label', () => {
    teamQueryResult.data = [
      { id: 'team-1', name: 'Eagles', coaches: ['test-user-id'], calendarFeedHost: 'calendar.playmetrics.com' },
      { id: 'team-2', name: 'Hawks', coaches: ['test-user-id'], calendarFeedHost: null },
    ];
    teamQueryResult.isSynced = true;

    render(<Home />);
    fireEvent.click(screen.getByRole('button', { name: /sync now/i }));
    fireEvent.change(screen.getByLabelText(/team to import games for/i), { target: { value: 'team-2' } });

    expect(screen.getByLabelText(/calendar \.ics file/i)).toBeInTheDocument();
  });
});

