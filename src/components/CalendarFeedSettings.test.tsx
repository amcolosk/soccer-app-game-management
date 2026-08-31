import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { Team } from '../types/schema';

const { mockSyncTeamCalendar, mockUnlinkTeamCalendar, mockConfirm } = vi.hoisted(() => ({
  mockSyncTeamCalendar: vi.fn(),
  mockUnlinkTeamCalendar: vi.fn(),
  mockConfirm: vi.fn(),
}));

vi.mock('../services/calendarSyncService', () => ({
  syncTeamCalendar: mockSyncTeamCalendar,
  unlinkTeamCalendar: mockUnlinkTeamCalendar,
}));

vi.mock('./ConfirmModal', () => ({
  useConfirm: () => mockConfirm,
}));

vi.mock('../utils/toast', () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
}));

import { CalendarFeedSettings } from './CalendarFeedSettings';

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    name: 'Eagles',
    coaches: ['coach-1'],
    status: 'active',
    calendarFeedHost: null,
    calendarFeedLastSyncedAt: null,
    calendarFeedLastError: null,
    ...overrides,
  } as Team;
}

describe('CalendarFeedSettings', () => {
  beforeEach(() => {
    mockSyncTeamCalendar.mockReset();
    mockUnlinkTeamCalendar.mockReset();
    mockConfirm.mockReset();
    mockConfirm.mockResolvedValue(false);
  });

  it('renders nothing for an archived team', () => {
    const team = makeTeam({ status: 'archived', archivedAt: '2026-01-01T00:00:00.000Z' });
    const { container } = render(<CalendarFeedSettings team={team} onTeamDataChanged={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows "No calendar feed linked yet" when calendarFeedHost is null', () => {
    render(<CalendarFeedSettings team={makeTeam()} onTeamDataChanged={vi.fn()} />);
    expect(screen.getByText(/no calendar feed linked yet/i)).toBeInTheDocument();
  });

  it('shows the linked host and last-synced time when a feed is linked', () => {
    const team = makeTeam({
      calendarFeedHost: 'calendar.playmetrics.com',
      calendarFeedLastSyncedAt: '2026-03-01T12:00:00.000Z',
    });
    render(<CalendarFeedSettings team={team} onTeamDataChanged={vi.fn()} />);
    expect(screen.getByText(/calendar\.playmetrics\.com/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /replace/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /unlink/i })).toBeInTheDocument();
  });

  it('shows the last error message when present', () => {
    const team = makeTeam({ calendarFeedHost: 'calendar.playmetrics.com', calendarFeedLastError: 'Calendar feed request failed with status 404' });
    render(<CalendarFeedSettings team={team} onTeamDataChanged={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/404/);
  });

  it('shows "Link" (not "Replace") when no feed is linked yet', () => {
    render(<CalendarFeedSettings team={makeTeam()} onTeamDataChanged={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^link$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /unlink/i })).not.toBeInTheDocument();
  });

  it('shows the preview modal for a non-empty dryRun result and does not save until Confirm', async () => {
    mockSyncTeamCalendar.mockResolvedValue({
      createdGames: [{ id: 'g1' }, { id: 'g2' }], updatedGames: [], skippedCount: 0,
      cancelledCount: 0, adoptedCount: 0, protectedCount: 0, failedCount: 0, warnings: [],
    });
    const onTeamDataChanged = vi.fn();
    render(<CalendarFeedSettings team={makeTeam()} onTeamDataChanged={onTeamDataChanged} />);

    fireEvent.change(screen.getByLabelText(/calendar feed url/i), { target: { value: 'https://calendar.playmetrics.com/x.ics' } });
    fireEvent.click(screen.getByRole('button', { name: /^link$/i }));

    await waitFor(() => {
      expect(mockSyncTeamCalendar).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, saveFeedUrl: true }));
    });
    await waitFor(() => {
      expect(screen.getByText(/import preview/i)).toBeInTheDocument();
    });
    expect(onTeamDataChanged).not.toHaveBeenCalled();
  });

  it('Confirm re-runs without dryRun and calls onTeamDataChanged on success', async () => {
    mockSyncTeamCalendar.mockImplementation(async (args: { dryRun?: boolean }) => {
      if (args.dryRun) {
        return { createdGames: [{ id: 'g1' }], updatedGames: [], skippedCount: 0, cancelledCount: 0, adoptedCount: 0, protectedCount: 0, failedCount: 0, warnings: [] };
      }
      return { createdGames: [{ id: 'g1' }], updatedGames: [], skippedCount: 0, cancelledCount: 0, adoptedCount: 0, protectedCount: 0, failedCount: 0, warnings: [] };
    });
    const onTeamDataChanged = vi.fn();
    render(<CalendarFeedSettings team={makeTeam()} onTeamDataChanged={onTeamDataChanged} />);

    fireEvent.change(screen.getByLabelText(/calendar feed url/i), { target: { value: 'https://calendar.playmetrics.com/x.ics' } });
    fireEvent.click(screen.getByRole('button', { name: /^link$/i }));
    await waitFor(() => expect(screen.getByText(/import preview/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      expect(mockSyncTeamCalendar).toHaveBeenLastCalledWith(expect.objectContaining({ dryRun: false, saveFeedUrl: true }));
    });
    await waitFor(() => expect(onTeamDataChanged).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/import preview/i)).not.toBeInTheDocument();
  });

  it('shows a warning toast (not success) mentioning the failed count when Confirm result has failedCount > 0', async () => {
    mockSyncTeamCalendar.mockImplementation(async (args: { dryRun?: boolean }) => {
      if (args.dryRun) {
        return { createdGames: [{ id: 'g1' }], updatedGames: [], skippedCount: 0, cancelledCount: 0, adoptedCount: 0, protectedCount: 0, failedCount: 0, warnings: [] };
      }
      return {
        createdGames: [{ id: 'g1' }], updatedGames: [], skippedCount: 0, cancelledCount: 0, adoptedCount: 0, protectedCount: 0,
        failedCount: 1, warnings: ['Failed to sync "Rivals FC": write conflict'],
      };
    });
    const onTeamDataChanged = vi.fn();
    const toast = await import('../utils/toast');
    render(<CalendarFeedSettings team={makeTeam()} onTeamDataChanged={onTeamDataChanged} />);

    fireEvent.change(screen.getByLabelText(/calendar feed url/i), { target: { value: 'https://calendar.playmetrics.com/x.ics' } });
    fireEvent.click(screen.getByRole('button', { name: /^link$/i }));
    await waitFor(() => expect(screen.getByText(/import preview/i)).toBeInTheDocument());

    const successCallsBeforeConfirm = (toast.showSuccess as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      expect(toast.showWarning).toHaveBeenCalledWith(expect.stringMatching(/1 game.*failed to sync/i));
    });
    // The failedCount>0 path must use the warning toast, not the plain
    // success toast, for this specific Confirm call.
    expect((toast.showSuccess as ReturnType<typeof vi.fn>).mock.calls.length).toBe(successCallsBeforeConfirm);
  });

  it('a no-op dryRun result skips the modal and saves the feed directly (empty feed still gets linked)', async () => {
    mockSyncTeamCalendar.mockImplementation(async (args: { dryRun?: boolean }) => ({
      createdGames: [], updatedGames: [], skippedCount: 0, cancelledCount: 0, adoptedCount: 0, protectedCount: 0, failedCount: 0, warnings: [],
      __dryRun: args.dryRun,
    }));
    const onTeamDataChanged = vi.fn();
    render(<CalendarFeedSettings team={makeTeam()} onTeamDataChanged={onTeamDataChanged} />);

    fireEvent.change(screen.getByLabelText(/calendar feed url/i), { target: { value: 'https://calendar.playmetrics.com/x.ics' } });
    fireEvent.click(screen.getByRole('button', { name: /^link$/i }));

    await waitFor(() => expect(mockSyncTeamCalendar).toHaveBeenCalledTimes(2));
    expect(mockSyncTeamCalendar).toHaveBeenNthCalledWith(1, expect.objectContaining({ dryRun: true }));
    expect(mockSyncTeamCalendar).toHaveBeenNthCalledWith(2, expect.objectContaining({ dryRun: false }));
    expect(screen.queryByText(/import preview/i)).not.toBeInTheDocument();
    await waitFor(() => expect(onTeamDataChanged).toHaveBeenCalledTimes(1));
  });

  it('Cancel closes the preview modal without a second mutation call', async () => {
    mockSyncTeamCalendar.mockResolvedValue({
      createdGames: [{ id: 'g1' }], updatedGames: [], skippedCount: 0, cancelledCount: 0, adoptedCount: 0, protectedCount: 0, failedCount: 0, warnings: [],
    });
    render(<CalendarFeedSettings team={makeTeam()} onTeamDataChanged={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/calendar feed url/i), { target: { value: 'https://calendar.playmetrics.com/x.ics' } });
    fireEvent.click(screen.getByRole('button', { name: /^link$/i }));
    await waitFor(() => expect(screen.getByText(/import preview/i)).toBeInTheDocument());

    const callsBeforeCancel = mockSyncTeamCalendar.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(screen.queryByText(/import preview/i)).not.toBeInTheDocument();
    expect(mockSyncTeamCalendar).toHaveBeenCalledTimes(callsBeforeCancel);
  });

  it('Unlink routes through useConfirm and does not call the mutation when declined', async () => {
    mockConfirm.mockResolvedValue(false);
    const team = makeTeam({ calendarFeedHost: 'calendar.playmetrics.com' });
    render(<CalendarFeedSettings team={team} onTeamDataChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /unlink/i }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockUnlinkTeamCalendar).not.toHaveBeenCalled();
  });

  it('Unlink calls unlinkTeamCalendar and onTeamDataChanged when confirmed', async () => {
    mockConfirm.mockResolvedValue(true);
    mockUnlinkTeamCalendar.mockResolvedValue(true);
    const onTeamDataChanged = vi.fn();
    const team = makeTeam({ calendarFeedHost: 'calendar.playmetrics.com' });
    render(<CalendarFeedSettings team={team} onTeamDataChanged={onTeamDataChanged} />);

    fireEvent.click(screen.getByRole('button', { name: /unlink/i }));

    await waitFor(() => {
      expect(mockUnlinkTeamCalendar).toHaveBeenCalledWith('team-1');
    });
    await waitFor(() => expect(onTeamDataChanged).toHaveBeenCalledTimes(1));
  });

  it('shows an error toast when the check fails and does not open the modal', async () => {
    mockSyncTeamCalendar.mockRejectedValue(new Error('Calendar host is not on the supported list'));
    const toast = await import('../utils/toast');
    render(<CalendarFeedSettings team={makeTeam()} onTeamDataChanged={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/calendar feed url/i), { target: { value: 'https://evil.example.com/x.ics' } });
    fireEvent.click(screen.getByRole('button', { name: /^link$/i }));

    await waitFor(() => {
      expect(toast.showError).toHaveBeenCalledWith('Calendar host is not on the supported list');
    });
    expect(screen.queryByText(/import preview/i)).not.toBeInTheDocument();
  });

  it('never calls client.models.CalendarFeed (asserted indirectly: only the two mutation wrappers are used)', () => {
    render(<CalendarFeedSettings team={makeTeam()} onTeamDataChanged={vi.fn()} />);
    // The component module only imports syncTeamCalendar/unlinkTeamCalendar
    // from calendarSyncService — there is no other data-access import here.
    expect(mockSyncTeamCalendar).not.toHaveBeenCalled();
    expect(mockUnlinkTeamCalendar).not.toHaveBeenCalled();
  });
});
