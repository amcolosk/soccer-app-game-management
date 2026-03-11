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
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockSetHelpContext, mockSetDebugContext } = vi.hoisted(() => ({
  mockSetHelpContext: vi.fn(),
  mockSetDebugContext: vi.fn(),
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
      Team: { create: vi.fn(), update: vi.fn(), list: vi.fn().mockResolvedValue({ data: [] }) },
      Player: { create: vi.fn(), update: vi.fn() },
      TeamRoster: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), list: vi.fn().mockResolvedValue({ data: [] }) },
      Formation: { create: vi.fn(), update: vi.fn() },
      FormationPosition: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    },
  })),
}));

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ userId: 'test-user-id' }),
}));

vi.mock('../hooks/useAmplifyQuery', () => ({
  useAmplifyQuery: vi.fn().mockReturnValue({ data: [] }),
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
  deleteTeamCascade: vi.fn(),
  deletePlayerCascade: vi.fn(),
  deleteFormationCascade: vi.fn(),
}));

vi.mock('../services/demoDataService', () => ({
  removeDemoData: vi.fn(),
}));

vi.mock('../utils/debugUtils', () => ({
  buildFlatDebugSnapshot: vi.fn().mockReturnValue({}),
}));

// ---------------------------------------------------------------------------
// Component under test (imported after mocks)
// ---------------------------------------------------------------------------

import { Management } from './Management';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
