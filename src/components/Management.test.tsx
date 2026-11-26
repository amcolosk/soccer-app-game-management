import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import '../test/mockAmplifyClient';
import { Management } from './Management';
import { renderWithProviders } from '../test/renderWithProviders';
import {
  managementUiMocks,
  resetManagementHarness,
  setAmplifyQueryData,
  setConfirmResult,
  setSwipedItemId,
} from '../test/mockAmplifyClient';
import { teamFixture, formationFixture } from '../test/fixtures/managementFixtures';
import type { ManagementQueryFixtures } from '../test/fixtures/managementFixtures';
import { OnboardingProvider, useOnboarding } from '../contexts/OnboardingContext';
import { UIVersionProvider, useUIVersion } from '../contexts/UIVersionContext';

/** Seeds an OnboardingContext.signals baseline (or leaves it null) and
 * Interface Mode version before Management mounts underneath. */
function OnboardingSeed({ baseline, children }: { baseline: boolean[] | null; children: React.ReactNode }) {
  const { setSignals } = useOnboarding();
  const { setVersion } = useUIVersion();

  React.useEffect(() => {
    setVersion('new');
    if (baseline) {
      setSignals(baseline);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}

function renderManagementWithOnboarding(baseline: boolean[] | null, queryData: Partial<ManagementQueryFixtures> = {}) {
  resetManagementHarness();
  setAmplifyQueryData(queryData);
  setConfirmResult(true);
  setSwipedItemId(null);

  return render(
    <MemoryRouter>
      <UIVersionProvider>
        <OnboardingProvider>
          <OnboardingSeed baseline={baseline}>
            <Management />
          </OnboardingSeed>
        </OnboardingProvider>
      </UIVersionProvider>
    </MemoryRouter>
  );
}

const mockSyncTeamCalendar = vi.hoisted(() => vi.fn());
vi.mock('../services/calendarSyncService', () => ({
  syncTeamCalendar: mockSyncTeamCalendar,
  unlinkTeamCalendar: vi.fn(),
}));

// jsdom doesn't implement scrollIntoView; the formation cross-link scrolls
// to the target row after switching tabs.
Element.prototype.scrollIntoView = vi.fn();

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
    expect(screen.getByRole('button', { name: /^🛡 teams/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /formations/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /players/i })).toBeInTheDocument();
  });

  it('shows an icon on every tab pill', () => {
    renderWithProviders(<Management />);
    expect(screen.getByRole('button', { name: /^🛡 Teams/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^📐 Formations/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^👤 Players/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^🔗 Sharing/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^⚙️ App/ })).toBeInTheDocument();
  });

  it('shows the formation cross-link only when a team has a formation assigned', () => {
    renderWithProviders(<Management />, {
      queryData: {
        Team: [
          teamFixture({ id: 'team-with-formation', name: 'Thunder FC', formationId: 'formation-1' }),
          teamFixture({ id: 'team-no-formation', name: 'Lightning FC', formationId: null }),
        ],
        Formation: [formationFixture({ id: 'formation-1', name: '4-3-3' })],
      },
    });

    expect(screen.getByRole('button', { name: /uses formation: 4-3-3 · edit/i })).toBeInTheDocument();
    // Only one cross-link should render (for the team with a formation).
    expect(screen.getAllByRole('button', { name: /uses formation/i })).toHaveLength(1);
  });

  it('clicking the formation cross-link switches to the Formations tab and scrolls to the target row', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Management />, {
      queryData: {
        Team: [
          teamFixture({ id: 'team-with-formation', name: 'Thunder FC', formationId: 'formation-1' }),
        ],
        Formation: [formationFixture({ id: 'formation-1', name: '4-3-3' })],
      },
    });

    await user.click(screen.getByRole('button', { name: /uses formation: 4-3-3 · edit/i }));

    // Landed on the Formations tab.
    expect(screen.getByRole('button', { name: /^📐 Formations/ })).toHaveClass('active');

    // The target row is reachable and was scrolled into view.
    const row = document.getElementById('formation-row-formation-1');
    expect(row).not.toBeNull();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
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

describe('Management — OnboardingNudge (§7-8 local signal push)', () => {
  it('advances the nudge from locally-available signals, without a round-trip through Home', async () => {
    // Baseline as if Home had already run: profile complete (index 1),
    // everything else (including team/roster/formation) still incomplete.
    const baseline = [false, true, false, false, false, false, false];

    renderManagementWithOnboarding(baseline, {
      Team: [teamFixture({ id: 'team-1', formationId: 'formation-1' })],
      TeamRoster: [{ id: 'roster-1', teamId: 'team-1', playerId: 'player-1' } as never],
    });

    // Management supplies signals 1 (team created), 3 (roster has
    // players), 4 (formation assigned) itself — all now true from the
    // query data above — merged onto the baseline's already-true profile
    // signal. Next incomplete is step 5 (schedule a game).
    expect(await screen.findByText(/next: schedule a game/i)).toBeInTheDocument();
  });

  it('renders no nudge on a cold load with no context baseline at all', () => {
    renderManagementWithOnboarding(null, {
      Team: [teamFixture({ id: 'team-1', formationId: 'formation-1' })],
      TeamRoster: [{ id: 'roster-1', teamId: 'team-1', playerId: 'player-1' } as never],
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
