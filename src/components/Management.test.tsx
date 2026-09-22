import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '../test/mockAmplifyClient';
import { Management } from './Management';
import { renderWithProviders } from '../test/renderWithProviders';
import { managementUiMocks } from '../test/mockAmplifyClient';
import { teamFixture } from '../test/fixtures/managementFixtures';

const mockSyncTeamCalendar = vi.hoisted(() => vi.fn());
vi.mock('../services/calendarSyncService', () => ({
  syncTeamCalendar: mockSyncTeamCalendar,
  unlinkTeamCalendar: vi.fn(),
}));

describe('Management', () => {
  beforeEach(() => {
    managementUiMocks.helpFab.setHelpContext.mockClear();
    mockSyncTeamCalendar.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders tab navigation (smoke)', () => {
    renderWithProviders(<Management />);
    expect(screen.getByRole('button', { name: /^teams/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /formations/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /players/i })).toBeInTheDocument();
  });

  it('updates help context when switching tabs', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Management />);

    await user.click(screen.getByRole('button', { name: /players/i }));
    await user.click(screen.getByRole('button', { name: /formations/i }));
    await user.click(screen.getByRole('button', { name: /sharing/i }));

    expect(managementUiMocks.helpFab.setHelpContext).toHaveBeenCalledWith('manage-teams');
    expect(managementUiMocks.helpFab.setHelpContext).toHaveBeenCalledWith('manage-players');
    expect(managementUiMocks.helpFab.setHelpContext).toHaveBeenCalledWith('manage-formations');
    expect(managementUiMocks.helpFab.setHelpContext).toHaveBeenCalledWith('manage-sharing');
  });

  it('clears help context on unmount', () => {
    const { unmount } = renderWithProviders(<Management />);
    unmount();
    expect(managementUiMocks.helpFab.setHelpContext).toHaveBeenCalledWith(null);
  });

  it('shows hash-bearing app version in the App section when VITE_APP_VERSION is set', async () => {
    vi.stubEnv('VITE_APP_VERSION', '1.1.0-42+abc123ef');
    const user = userEvent.setup();

    renderWithProviders(<Management />);
    await user.click(screen.getByRole('button', { name: /app/i }));

    expect(screen.getByText('1.1.0-42+abc123ef')).toBeInTheDocument();
  });

  it('preserves App section fallback when VITE_APP_VERSION is empty', async () => {
    vi.stubEnv('VITE_APP_VERSION', '');
    const user = userEvent.setup();

    renderWithProviders(<Management />);
    await user.click(screen.getByRole('button', { name: /app/i }));

    expect(screen.getByText('1.0.0')).toBeInTheDocument();
  });

  it('regression (#189): switching Edit to a different team clears an unsubmitted calendar feed URL instead of saving it under the new team', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Management />, {
      queryData: {
        Team: [
          teamFixture({ id: 'team-10u', name: '10U Sharks' }),
          teamFixture({ id: 'team-13u', name: '13U Sharks' }),
        ],
      },
    });
    mockSyncTeamCalendar.mockResolvedValue({
      createdGames: [], updatedGames: [], skippedCount: 0, cancelledCount: 0,
      adoptedCount: 0, protectedCount: 0, failedCount: 0, warnings: [],
    });

    // Start editing the 13U team and type a feed URL, but never submit it.
    const editButtons = screen.getAllByRole('button', { name: /edit team/i });
    await user.click(editButtons[1]); // 13U Sharks card
    const urlInput = screen.getByLabelText(/calendar feed url/i);
    await user.type(urlInput, 'https://calendar.playmetrics.com/13u.ics');
    expect(urlInput).toHaveValue('https://calendar.playmetrics.com/13u.ics');

    // Switch to editing the 10U team without closing the panel or clicking Link.
    await user.click(screen.getAllByRole('button', { name: /edit team/i })[0]); // 10U Sharks card

    // The URL field must reset — not carry the 13U team's unsaved text into
    // whatever gets submitted for 10U.
    const urlInputAfterSwitch = screen.getByLabelText(/calendar feed url/i);
    expect(urlInputAfterSwitch).toHaveValue('');

    await user.type(urlInputAfterSwitch, 'https://calendar.playmetrics.com/10u.ics');
    await user.click(screen.getByRole('button', { name: /^link$/i }));

    expect(mockSyncTeamCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 'team-10u', feedUrl: 'https://calendar.playmetrics.com/10u.ics' })
    );
  });
});
