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
  mockSetHelpContext,
  mockSetDebugContext,
  mockNavigate,
  mockGameCreate,
  mockGetCurrentUser,
} = vi.hoisted(() => ({
  mockMarkWelcomed: vi.fn(),
  mockSetHelpContext: vi.fn(),
  mockSetDebugContext: vi.fn(),
  mockNavigate: vi.fn(),
  mockGameCreate: vi.fn(),
  mockGetCurrentUser: vi.fn(),
}));

// Mutable query results — tests mutate these before rendering
const teamQueryResult: { data: object[]; isSynced: boolean } = { data: [], isSynced: false };

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
    return { data: [], isSynced: true };
  },
}));

vi.mock('../contexts/OnboardingContext', () => ({
  useOnboarding: () => ({
    ...onboardingState,
    markWelcomed: mockMarkWelcomed,
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
      Game: { create: mockGameCreate },
    },
  }),
}));

vi.mock('../services/demoDataService', () => ({
  createDemoTeam: vi.fn(),
  removeDemoData: vi.fn(),
}));

vi.mock('../utils/analytics', () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: {
    GAME_CREATED: { category: 'Game', action: 'Game Created' },
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
  QuickStartChecklist: () => <div data-testid="quick-start-checklist" />,
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
  mockGameCreate.mockReset();
  mockGetCurrentUser.mockReset();
  mockGetCurrentUser.mockResolvedValue({ userId: 'test-user-id' });
  teamQueryResult.data = [];
  teamQueryResult.isSynced = false;
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

  it('does not call Game.create when currentUserId is unresolved', async () => {
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
      expect(mockGameCreate).not.toHaveBeenCalled();
    });

    resolveUser?.({ userId: 'late-user-id' });
  });
});

