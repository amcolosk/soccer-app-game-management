/**
 * Smoke tests for the Management component.
 *
 * Reducer logic is tested exhaustively in managementReducers.test.ts.
 * These tests cover:
 *   - Initial render smoke (tab nav visible, default tab loads)
 *   - Tab switching sets helpContext to the correct key
 *   - helpContext is cleared on unmount
 *   - Sections render at least their heading/nav landmark so the
 *     component is not an empty page under test
 *
 * All Amplify data is mocked to return empty arrays so the component
 * mounts cleanly without real network calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockSetHelpContext, mockSetDebugContext } = vi.hoisted(() => ({
  mockSetHelpContext: vi.fn(),
  mockSetDebugContext: vi.fn(),
}));

const {
  mockDeleteTeamCascade,
  mockDeletePlayerCascade,
  mockDeleteFormationCascade,
  mockGetPlayerImpact,
  mockShowError,
} = vi.hoisted(() => ({
  mockDeleteTeamCascade: vi.fn(),
  mockDeletePlayerCascade: vi.fn(),
  mockDeleteFormationCascade: vi.fn(),
  mockGetPlayerImpact: vi.fn(),
  mockShowError: vi.fn(),
}));

const {
  mockTeamCreate,
  mockTeamUpdate,
  mockPlayerCreate,
  mockPlayerUpdate,
  mockTeamRosterCreate,
  mockTeamRosterUpdate,
  mockTeamRosterDelete,
  mockFormationCreate,
  mockFormationUpdate,
  mockFormationPositionCreate,
  mockFormationPositionUpdate,
  mockFormationPositionDelete,
  mockUseAmplifyQuery,
  mockHandleApiError,
  mockLogError,
} = vi.hoisted(() => ({
  mockTeamCreate: vi.fn(),
  mockTeamUpdate: vi.fn(),
  mockPlayerCreate: vi.fn(),
  mockPlayerUpdate: vi.fn(),
  mockTeamRosterCreate: vi.fn(),
  mockTeamRosterUpdate: vi.fn(),
  mockTeamRosterDelete: vi.fn(),
  mockFormationCreate: vi.fn(),
  mockFormationUpdate: vi.fn(),
  mockFormationPositionCreate: vi.fn(),
  mockFormationPositionUpdate: vi.fn(),
  mockFormationPositionDelete: vi.fn(),
  mockUseAmplifyQuery: vi.fn(),
  mockHandleApiError: vi.fn(),
  mockLogError: vi.fn(),
}));

vi.mock('../contexts/HelpFabContext', () => ({
  useHelpFab: () => ({
    setHelpContext: mockSetHelpContext,
    setDebugContext: mockSetDebugContext,
    helpContext: null,
    debugContext: null,
  }),
}));

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      Team: { create: mockTeamCreate, update: mockTeamUpdate, list: vi.fn().mockResolvedValue({ data: [] }) },
      Player: { create: mockPlayerCreate, update: mockPlayerUpdate },
      TeamRoster: {
        create: mockTeamRosterCreate,
        update: mockTeamRosterUpdate,
        delete: mockTeamRosterDelete,
        list: vi.fn().mockResolvedValue({ data: [] }),
      },
      Formation: { create: mockFormationCreate, update: mockFormationUpdate },
      FormationPosition: {
        create: mockFormationPositionCreate,
        update: mockFormationPositionUpdate,
        delete: mockFormationPositionDelete,
      },
    },
  })),
}));

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ userId: 'test-user-id' }),
}));

vi.mock('../hooks/useAmplifyQuery', () => ({
  useAmplifyQuery: mockUseAmplifyQuery,
}));

vi.mock('./ConfirmModal', () => ({
  useConfirm: vi.fn().mockReturnValue(vi.fn().mockResolvedValue(true)),
}));

vi.mock('../hooks/useSwipeDelete', () => ({
  useSwipeDelete: vi.fn().mockReturnValue({
    getSwipeProps: vi.fn().mockReturnValue({}),
    getSwipeStyle: vi.fn().mockReturnValue({}),
    close: vi.fn(),
    swipedItemId: null,
  }),
}));

vi.mock('./InvitationManagement', () => ({
  InvitationManagement: () => <div data-testid="invitation-management" />,
}));

vi.mock('../services/cascadeDeleteService', () => ({
  deleteTeamCascade: mockDeleteTeamCascade,
  deletePlayerCascade: mockDeletePlayerCascade,
  deleteFormationCascade: mockDeleteFormationCascade,
  getPlayerImpact: mockGetPlayerImpact,
}));

vi.mock('../services/demoDataService', () => ({
  removeDemoData: vi.fn(),
}));

vi.mock('../utils/debugUtils', () => ({
  buildFlatDebugSnapshot: vi.fn().mockReturnValue({}),
}));

vi.mock('../utils/analytics', () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: {
    PLAYER_ADDED_TO_ROSTER: { category: 'test', action: 'test' },
    PLAYER_DELETED: { category: 'test', action: 'test' },
    FORMATION_DELETED: { category: 'test', action: 'test' },
    TEAM_DELETED: { category: 'test', action: 'test' },
  },
}));

vi.mock('../utils/errorHandler', () => ({
  handleApiError: mockHandleApiError,
  logError: mockLogError,
}));

vi.mock('../utils/toast', () => ({
  showError: mockShowError,
  showWarning: vi.fn(),
  showSuccess: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Component under test (imported after mocks)
// ---------------------------------------------------------------------------

import { Management } from './Management';
import { useSwipeDelete } from '../hooks/useSwipeDelete';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Management', () => {
  const team = {
    id: 'team-1',
    name: 'Shared Team',
    formationId: null,
    maxPlayersOnField: 7,
    halfLengthMinutes: 25,
    coaches: ['owner-a', 'coach-b'],
  };

  const player = {
    id: 'player-1',
    firstName: 'Alex',
    lastName: 'Riley',
    birthYear: 2013,
    coaches: ['owner-a'],
  };

  const renderWithRosterData = () => {
    mockUseAmplifyQuery.mockImplementation((modelName: string) => {
      if (modelName === 'Team') return { data: [team] };
      if (modelName === 'Player') return { data: [player] };
      if (modelName === 'TeamRoster') return { data: [] };
      if (modelName === 'Formation') return { data: [] };
      if (modelName === 'FormationPosition') return { data: [] };
      return { data: [] };
    });

    return render(<Management />);
  };

  const triggerRosterAdd = async () => {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /show roster/i }));
    await user.click(screen.getByRole('button', { name: /\+ add player to roster/i }));

    const addSection = screen.getByText('Add Player to Roster').closest('div');
    if (!addSection) {
      throw new Error('Add player section not found');
    }

    await user.selectOptions(within(addSection).getByRole('combobox'), 'player-1');
    await user.type(within(addSection).getByPlaceholderText(/player number/i), '11');
    await user.click(within(addSection).getByRole('button', { name: /^add$/i }));
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockTeamRosterCreate.mockResolvedValue({ data: { id: 'roster-1' } });
    mockTeamRosterDelete.mockResolvedValue({});
    mockPlayerUpdate.mockResolvedValue({});

    mockUseAmplifyQuery.mockReturnValue({ data: [] });

    mockGetPlayerImpact.mockResolvedValue({ playTimeCount: 0, goalCount: 0, noteCount: 0 });
    mockDeleteFormationCascade.mockResolvedValue(undefined);
    mockDeletePlayerCascade.mockResolvedValue(undefined);
  });

  it('renders without crashing (smoke)', () => {
    render(<Management />);
    // Tab buttons are immediately visible (async ops don't affect initial render)
    expect(screen.getByRole('button', { name: /teams/i })).toBeInTheDocument();
  });

  it('sets helpContext to "manage-teams" on initial mount (default tab)', () => {
    render(<Management />);
    expect(mockSetHelpContext).toHaveBeenCalledWith('manage-teams');
  });

  it('clears helpContext on unmount', () => {
    const { unmount } = render(<Management />);
    unmount();
    expect(mockSetHelpContext).toHaveBeenCalledWith(null);
  });

  it('switching to Players tab sets helpContext to "manage-players"', async () => {
    const user = userEvent.setup();
    render(<Management />);
    await user.click(screen.getByRole('button', { name: /players/i }));
    expect(mockSetHelpContext).toHaveBeenCalledWith('manage-players');
  });

  it('switching to Formations tab sets helpContext to "manage-formations"', async () => {
    const user = userEvent.setup();
    render(<Management />);
    await user.click(screen.getByRole('button', { name: /formations/i }));
    expect(mockSetHelpContext).toHaveBeenCalledWith('manage-formations');
  });

  it('switching to Sharing tab sets helpContext to "manage-sharing"', async () => {
    const user = userEvent.setup();
    render(<Management />);
    await user.click(screen.getByRole('button', { name: /sharing/i }));
    expect(mockSetHelpContext).toHaveBeenCalledWith('manage-sharing');
  });

  it('switching to App tab sets helpContext to "manage-app"', async () => {
    const user = userEvent.setup();
    render(<Management />);
    await user.click(screen.getByRole('button', { name: /^app$/i }));
    expect(mockSetHelpContext).toHaveBeenCalledWith('manage-app');
  });

  it('does not update player coaches when roster creation fails', async () => {
    mockTeamRosterCreate.mockRejectedValueOnce(new Error('create failed'));
    renderWithRosterData();

    await triggerRosterAdd();

    await waitFor(() => {
      expect(mockTeamRosterCreate).toHaveBeenCalledTimes(1);
    });

    expect(mockPlayerUpdate).not.toHaveBeenCalled();
    expect(mockTeamRosterDelete).not.toHaveBeenCalled();
    expect(mockHandleApiError).toHaveBeenCalledWith(expect.any(Error), 'Failed to add player to roster');
  });

  it('rolls back roster creation when player coach update fails', async () => {
    mockTeamRosterCreate.mockResolvedValueOnce({ data: { id: 'roster-created' } });
    mockPlayerUpdate.mockRejectedValueOnce(new Error('player update failed'));
    renderWithRosterData();

    await triggerRosterAdd();

    await waitFor(() => {
      expect(mockPlayerUpdate).toHaveBeenCalledWith({
        id: 'player-1',
        coaches: ['owner-a', 'coach-b'],
      });
    });

    expect(mockTeamRosterDelete).toHaveBeenCalledWith({ id: 'roster-created' });
    expect(mockHandleApiError).toHaveBeenCalledWith(expect.any(Error), 'Failed to add player to roster');
  });

  describe('handleDeleteFormation', () => {
    it('blocks deletion when formation is used by a team', async () => {
      const formation = { id: 'form-1', name: '4-3-3', playerCount: 7, sport: 'Soccer', coaches: ['owner-a'] };
      const teamWithFormation = { ...team, formationId: 'form-1' };

      mockUseAmplifyQuery.mockImplementation((modelName: string) => {
        if (modelName === 'Team') return { data: [teamWithFormation] };
        if (modelName === 'Formation') return { data: [formation] };
        return { data: [] };
      });

      // Expose the delete button for the formation by setting swipedItemId
      vi.mocked(useSwipeDelete).mockReturnValue({
        getSwipeProps: vi.fn().mockReturnValue({}),
        getSwipeStyle: vi.fn().mockReturnValue({}),
        close: vi.fn(),
        swipedItemId: 'form-1',
      });

      const user = userEvent.setup();
      render(<Management />);
      await user.click(screen.getByRole('button', { name: /formations/i }));

      const deleteBtn = await screen.findByRole('button', { name: /delete formation/i });
      await user.click(deleteBtn);

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith(
          expect.stringContaining('Shared Team'),
        );
      });
      expect(mockDeleteFormationCascade).not.toHaveBeenCalled();
    });

    it('allows deletion when formation is not used by any team', async () => {
      // Use 'test-user-id' (matches getCurrentUser mock) so the formation passes the accessibleFormations filter
      const formation = { id: 'form-2', name: '3-4-3', playerCount: 7, sport: 'Soccer', coaches: ['test-user-id'] };

      mockUseAmplifyQuery.mockImplementation((modelName: string) => {
        if (modelName === 'Team') return { data: [{ ...team, formationId: null }] };
        if (modelName === 'Formation') return { data: [formation] };
        return { data: [] };
      });

      // Expose the delete button for the formation by setting swipedItemId
      vi.mocked(useSwipeDelete).mockReturnValue({
        getSwipeProps: vi.fn().mockReturnValue({}),
        getSwipeStyle: vi.fn().mockReturnValue({}),
        close: vi.fn(),
        swipedItemId: 'form-2',
      });

      const user = userEvent.setup();
      render(<Management />);
      await user.click(screen.getByRole('button', { name: /formations/i }));

      const deleteBtn = await screen.findByRole('button', { name: /delete formation/i });
      await user.click(deleteBtn);

      // No blocking error since no team uses this formation
      await waitFor(() => {
        expect(mockShowError).not.toHaveBeenCalled();
      });
      expect(mockDeleteFormationCascade).toHaveBeenCalledWith('form-2');
    });

    it('shows authoritative guard error when backend detects hidden team references', async () => {
      const formation = { id: 'form-3', name: '4-4-2', playerCount: 7, sport: 'Soccer', coaches: ['test-user-id'] };
      mockDeleteFormationCascade.mockRejectedValueOnce(
        new Error('Cannot delete formation: referenced by 1 team(s): Hidden Team. Reassign teams before deleting.'),
      );

      mockUseAmplifyQuery.mockImplementation((modelName: string) => {
        if (modelName === 'Team') return { data: [] };
        if (modelName === 'Formation') return { data: [formation] };
        return { data: [] };
      });

      vi.mocked(useSwipeDelete).mockReturnValue({
        getSwipeProps: vi.fn().mockReturnValue({}),
        getSwipeStyle: vi.fn().mockReturnValue({}),
        close: vi.fn(),
        swipedItemId: 'form-3',
      });

      const user = userEvent.setup();
      render(<Management />);
      await user.click(screen.getByRole('button', { name: /formations/i }));

      const deleteBtn = await screen.findByRole('button', { name: /delete formation/i });
      await user.click(deleteBtn);

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith(
          expect.stringContaining('referenced by 1 team'),
        );
      });
    });
  });

  describe('handleDeletePlayer', () => {
    it('shows warning variant when player has game history', async () => {
      mockGetPlayerImpact.mockResolvedValue({ playTimeCount: 3, goalCount: 1, noteCount: 2 });

      const mockConfirmFn = vi.fn().mockResolvedValue(false); // user cancels
      const { useConfirm } = await import('./ConfirmModal');
      vi.mocked(useConfirm).mockReturnValue(mockConfirmFn);

      mockUseAmplifyQuery.mockImplementation((modelName: string) => {
        if (modelName === 'Player') return { data: [player] };
        if (modelName === 'Team') return { data: [team] };
        if (modelName === 'TeamRoster') return { data: [{ id: 'r1', playerId: 'player-1', teamId: 'team-1', playerNumber: 10, coaches: [] }] };
        return { data: [] };
      });

      vi.mocked(useSwipeDelete).mockReturnValue({
        getSwipeProps: vi.fn().mockReturnValue({}),
        getSwipeStyle: vi.fn().mockReturnValue({}),
        close: vi.fn(),
        swipedItemId: 'player-1',
      });

      const user = userEvent.setup();
      render(<Management />);
      await user.click(screen.getByRole('button', { name: /players/i }));

      const deleteBtn = await screen.findByRole('button', { name: /delete player/i });
      await user.click(deleteBtn);

      await waitFor(() => {
        expect(mockGetPlayerImpact).toHaveBeenCalledWith('player-1');
      });

      expect(mockConfirmFn).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'warning', confirmText: 'Delete Anyway' }),
      );
    });

    it('shows error and returns when getPlayerImpact fails', async () => {
      mockGetPlayerImpact.mockRejectedValue(new Error('Network error'));

      // Use 'test-user-id' (matches getCurrentUser mock) so the player passes the accessiblePlayers filter
      const accessiblePlayer = { ...player, coaches: ['test-user-id'] };

      mockUseAmplifyQuery.mockImplementation((modelName: string) => {
        if (modelName === 'Player') return { data: [accessiblePlayer] };
        return { data: [] };
      });

      vi.mocked(useSwipeDelete).mockReturnValue({
        getSwipeProps: vi.fn().mockReturnValue({}),
        getSwipeStyle: vi.fn().mockReturnValue({}),
        close: vi.fn(),
        swipedItemId: 'player-1',
      });

      const user = userEvent.setup();
      render(<Management />);
      await user.click(screen.getByRole('button', { name: /players/i }));

      const deleteBtn = await screen.findByRole('button', { name: /delete player/i });
      await user.click(deleteBtn);

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalled();
      });
      expect(mockDeletePlayerCascade).not.toHaveBeenCalled();
    });
  });
});
