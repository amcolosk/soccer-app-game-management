import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '../test/mockAmplifyClient';
import { Management } from './Management';
import { renderWithProviders } from '../test/renderWithProviders';
import {
  managementModelMocks,
  managementUiMocks,
  setConfirmResult,
} from '../test/mockAmplifyClient';
import {
  managementFixtures,
  teamFixture,
} from '../test/fixtures/managementFixtures';

describe('Management — team lifecycle (archive / restore / assign owner)', () => {
  it('renders the Active/Archived sub-toggle with correct counts, and switching hides + Create New Team', async () => {
    const user = userEvent.setup();
    const activeTeam = teamFixture({ id: 'team-active', name: 'Active FC', coaches: ['test-user-id'] });
    const archivedTeam = teamFixture({
      id: 'team-archived',
      name: 'Archived FC',
      status: 'archived',
      coaches: ['test-user-id'],
      ownerId: 'test-user-id',
    });

    renderWithProviders(<Management />, {
      queryData: managementFixtures({ Team: [activeTeam, archivedTeam] }),
    });

    expect(await screen.findByRole('button', { name: /active teams \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /archived teams \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\+ create new team/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /archived teams/i }));

    expect(screen.queryByRole('button', { name: /\+ create new team/i })).not.toBeInTheDocument();
    expect(screen.getByText('Archived FC')).toBeInTheDocument();
    expect(screen.queryByText('Active FC')).not.toBeInTheDocument();
  });

  it('shows Archive for the owner and archives the team, moving it into the Archived Teams list', async () => {
    const user = userEvent.setup();
    const team = teamFixture({ id: 'team-1', name: 'Owned FC', coaches: ['test-user-id'], ownerId: 'test-user-id' });

    renderWithProviders(<Management />, {
      queryData: managementFixtures({ Team: [team] }),
    });

    const archiveButton = await screen.findByRole('button', { name: 'Archive' });
    await user.click(archiveButton);

    await waitFor(() => {
      expect(managementUiMocks.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Archive Team' }),
      );
    });

    await waitFor(() => {
      expect(managementUiMocks.teamLifecycle.archiveTeam).toHaveBeenCalledWith('team-1');
    });

    // Rendered effect of teamLifecycleOverrides: card no longer in Active Teams.
    await waitFor(() => {
      expect(screen.queryByText('Owned FC')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /archived teams/i }));
    expect(screen.getByText('Owned FC')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
  });

  it('does not show Archive or Owner Unassigned for an active team owned by a different coach', async () => {
    const team = teamFixture({
      id: 'team-1',
      name: 'Other Owner FC',
      coaches: ['test-user-id', 'coach-b'],
      ownerId: 'coach-b',
    });

    renderWithProviders(<Management />, {
      queryData: managementFixtures({ Team: [team] }),
    });

    await screen.findByText('Other Owner FC');
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    expect(screen.queryByText('Owner Unassigned')).not.toBeInTheDocument();
  });

  it('shows Owner Unassigned + Assign Owner for an orphaned-owner active team, and assigning replaces it with Archive', async () => {
    const user = userEvent.setup();
    const team = teamFixture({
      id: 'team-1',
      name: 'Orphaned FC',
      coaches: ['test-user-id'],
      ownerId: 'someone-else', // not in coaches: orphaned
    });

    renderWithProviders(<Management />, {
      queryData: managementFixtures({ Team: [team] }),
    });

    await screen.findByText('Owner Unassigned');
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Assign Owner' }));

    await waitFor(() => {
      expect(managementUiMocks.teamLifecycle.assignTeamOwner).toHaveBeenCalledWith('team-1');
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    });
    expect(screen.queryByText('Owner Unassigned')).not.toBeInTheDocument();
  });

  it('gates Assign Owner behind a confirm dialog: cancelling does not call assignTeamOwner, confirming does', async () => {
    const user = userEvent.setup();
    const team = teamFixture({
      id: 'team-1',
      name: 'Confirm Gate FC',
      coaches: ['test-user-id'],
      ownerId: 'someone-else', // orphaned owner
    });

    renderWithProviders(<Management />, {
      queryData: managementFixtures({ Team: [team] }),
    });

    await screen.findByText('Owner Unassigned');

    setConfirmResult(false);
    await user.click(screen.getByRole('button', { name: 'Assign Owner' }));

    await waitFor(() => {
      expect(managementUiMocks.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Assign Team Owner',
          variant: 'warning',
          confirmText: 'Assign Owner',
        }),
      );
    });
    expect(managementUiMocks.teamLifecycle.assignTeamOwner).not.toHaveBeenCalled();

    setConfirmResult(true);
    await user.click(screen.getByRole('button', { name: 'Assign Owner' }));

    await waitFor(() => {
      expect(managementUiMocks.teamLifecycle.assignTeamOwner).toHaveBeenCalledWith('team-1');
    });
  });

  it('no longer wires swipe-to-delete on team cards, while Formation cards keep it', async () => {
    const team = teamFixture({ id: 'team-1', name: 'Swipe Test FC', coaches: ['test-user-id'] });

    renderWithProviders(<Management />, {
      queryData: managementFixtures({ Team: [team] }),
      swipedItemId: 'team-1',
    });

    await screen.findByText('Swipe Test FC');
    expect(screen.queryByLabelText('Delete team')).not.toBeInTheDocument();
    expect(document.querySelector('.btn-delete-swipe')).not.toBeInTheDocument();
  });

  it('archived card owned by the current user shows Archived badge, archivedAt, Restore Team + Delete Permanently, no Owner Unassigned', async () => {
    const user = userEvent.setup();
    const team = teamFixture({
      id: 'team-1',
      name: 'Restore Me FC',
      status: 'archived',
      coaches: ['test-user-id'],
      ownerId: 'test-user-id',
      archivedAt: '2026-08-19T12:00:00.000Z',
      archivedBy: 'test-user-id',
    });

    renderWithProviders(<Management />, {
      queryData: managementFixtures({ Team: [team] }),
    });

    await user.click(screen.getByRole('button', { name: /archived teams/i }));

    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.getByText(/Archived Aug 19, 2026/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore Team' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete team permanently' })).toBeInTheDocument();
    expect(screen.queryByText('Owner Unassigned')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Restore Team' }));

    await waitFor(() => {
      expect(managementUiMocks.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Restore Team', variant: 'default' }),
      );
    });
    await waitFor(() => {
      expect(managementUiMocks.teamLifecycle.restoreTeam).toHaveBeenCalledWith('team-1');
    });

    // Rendered effect: card moves back to Active Teams.
    await waitFor(() => {
      expect(screen.queryByText('Restore Me FC')).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /active teams/i }));
    expect(screen.getByText('Restore Me FC')).toBeInTheDocument();
  });

  it('archived card owned by a different coach shows only Delete Permanently', async () => {
    const user = userEvent.setup();
    const team = teamFixture({
      id: 'team-1',
      name: 'Other Owner Archived FC',
      status: 'archived',
      coaches: ['test-user-id', 'coach-b'],
      ownerId: 'coach-b',
    });

    renderWithProviders(<Management />, {
      queryData: managementFixtures({ Team: [team] }),
    });

    await user.click(screen.getByRole('button', { name: /archived teams/i }));

    expect(screen.queryByRole('button', { name: 'Restore Team' })).not.toBeInTheDocument();
    expect(screen.queryByText('Owner Unassigned')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete team permanently' })).toBeInTheDocument();
  });

  it('archived card with an orphaned owner shows Owner Unassigned + Assign Owner (no Restore Team) and Delete Permanently; assigning reveals Restore Team', async () => {
    const user = userEvent.setup();
    const team = teamFixture({
      id: 'team-1',
      name: 'Orphaned Archived FC',
      status: 'archived',
      coaches: ['test-user-id'],
      ownerId: 'someone-else',
    });

    managementUiMocks.teamLifecycle.assignTeamOwner.mockResolvedValueOnce({
      id: 'team-1',
      status: 'archived',
      ownerId: 'test-user-id',
      archivedAt: null,
      archivedBy: null,
    });

    renderWithProviders(<Management />, {
      queryData: managementFixtures({ Team: [team] }),
    });

    await user.click(screen.getByRole('button', { name: /archived teams/i }));

    expect(screen.queryByRole('button', { name: 'Restore Team' })).not.toBeInTheDocument();
    expect(screen.getByText('Owner Unassigned')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete team permanently' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Assign Owner' }));

    await waitFor(() => {
      expect(managementUiMocks.teamLifecycle.assignTeamOwner).toHaveBeenCalledWith('team-1');
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Restore Team' })).toBeInTheDocument();
    });
    expect(screen.queryByText('Owner Unassigned')).not.toBeInTheDocument();
  });

  it('opens a confirm with confirmText "Delete Permanently" and calls deleteTeamCascade on confirm', async () => {
    const user = userEvent.setup();
    const team = teamFixture({
      id: 'team-1',
      name: 'Delete Permanently FC',
      status: 'archived',
      coaches: ['test-user-id'],
      ownerId: 'test-user-id',
    });

    renderWithProviders(<Management />, {
      queryData: managementFixtures({ Team: [team] }),
    });

    await user.click(screen.getByRole('button', { name: /archived teams/i }));

    const deleteButton = screen.getByRole('button', { name: 'Delete team permanently' });
    expect(deleteButton).toHaveAttribute('aria-label', 'Delete team permanently');

    await user.click(deleteButton);

    await waitFor(() => {
      expect(managementUiMocks.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ confirmText: 'Delete Permanently' }),
      );
    });

    await waitFor(() => {
      expect(managementUiMocks.cascade.deleteTeamCascade).toHaveBeenCalledWith('team-1');
    });
  });

  it('surfaces the real server error message on archive failure instead of a generic fallback', async () => {
    const user = userEvent.setup();
    const team = teamFixture({ id: 'team-1', name: 'Fails FC', coaches: ['test-user-id'], ownerId: 'test-user-id' });

    managementUiMocks.teamLifecycle.archiveTeam.mockRejectedValueOnce(
      new Error('Access denied: only the team owner can archive this team'),
    );

    renderWithProviders(<Management />, {
      queryData: managementFixtures({ Team: [team] }),
    });

    await user.click(await screen.findByRole('button', { name: 'Archive' }));

    await waitFor(() => {
      expect(managementUiMocks.toast.showError).toHaveBeenCalledWith(
        'Access denied: only the team owner can archive this team',
      );
    });
  });

  it('passes ownerId: currentUserId when creating a team', async () => {
    const user = userEvent.setup();

    renderWithProviders(<Management />);

    await user.click(screen.getByRole('button', { name: /\+ create new team/i }));
    await user.type(screen.getByPlaceholderText(/enter team name/i), 'New Owned Team');
    await user.clear(screen.getByPlaceholderText(/enter max players/i));
    await user.type(screen.getByPlaceholderText(/enter max players/i), '7');
    await user.clear(screen.getByPlaceholderText(/enter half length/i));
    await user.type(screen.getByPlaceholderText(/enter half length/i), '25');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(managementModelMocks.Team.create).toHaveBeenCalledWith(
        expect.objectContaining({ ownerId: 'test-user-id' }),
      );
    });
  });

  describe('tab-switch dirty-check (discard confirmation)', () => {
    it('prompts to discard an in-progress edit, and cancel keeps the form open on Active Teams', async () => {
      const user = userEvent.setup();
      const team = teamFixture({ id: 'team-1', name: 'Editing FC', coaches: ['test-user-id'] });

      renderWithProviders(<Management />, {
        queryData: managementFixtures({ Team: [team] }),
      });

      await user.click(await screen.findByRole('button', { name: 'Edit team' }));
      expect(screen.getByRole('heading', { name: /edit team/i })).toBeInTheDocument();

      setConfirmResult(false);
      await user.click(screen.getByRole('button', { name: /archived teams/i }));

      await waitFor(() => {
        expect(managementUiMocks.confirm).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'Discard changes?', variant: 'warning' }),
        );
      });

      // Cancelled: still on Active Teams, edit form still open.
      expect(screen.getByRole('button', { name: /active teams/i })).toHaveClass('active');
      expect(screen.getByRole('heading', { name: /edit team/i })).toBeInTheDocument();
    });

    it('discards the in-progress edit and switches tabs when the coach confirms', async () => {
      const user = userEvent.setup();
      const team = teamFixture({ id: 'team-1', name: 'Editing FC', coaches: ['test-user-id'] });

      renderWithProviders(<Management />, {
        queryData: managementFixtures({ Team: [team] }),
      });

      await user.click(await screen.findByRole('button', { name: 'Edit team' }));
      expect(screen.getByRole('heading', { name: /edit team/i })).toBeInTheDocument();

      setConfirmResult(true);
      await user.click(screen.getByRole('button', { name: /archived teams/i }));

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /edit team/i })).not.toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /archived teams/i })).toHaveClass('active');

      await user.click(screen.getByRole('button', { name: /active teams/i }));
      expect(screen.queryByRole('heading', { name: /edit team/i })).not.toBeInTheDocument();
    });

    it('switches tabs with no confirmation when no form is open, or a freshly-opened create form is untouched', async () => {
      const user = userEvent.setup();
      const team = teamFixture({ id: 'team-1', name: 'Clean FC', coaches: ['test-user-id'] });

      renderWithProviders(<Management />, {
        queryData: managementFixtures({ Team: [team] }),
      });

      await screen.findByText('Clean FC');
      await user.click(screen.getByRole('button', { name: /archived teams/i }));
      expect(managementUiMocks.confirm).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /archived teams/i })).toHaveClass('active');

      await user.click(screen.getByRole('button', { name: /active teams/i }));
      await user.click(screen.getByRole('button', { name: /\+ create new team/i }));
      expect(screen.getByRole('heading', { name: /create new team/i })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /archived teams/i }));
      expect(managementUiMocks.confirm).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /archived teams/i })).toHaveClass('active');
    });
  });

  it('filters the Sharing tab team picker to active teams only', async () => {
    const user = userEvent.setup();
    const activeTeam = teamFixture({ id: 'team-active', name: 'Shareable FC', coaches: ['test-user-id'] });
    const archivedTeam = teamFixture({
      id: 'team-archived',
      name: 'Not Shareable FC',
      status: 'archived',
      coaches: ['test-user-id'],
    });

    renderWithProviders(<Management />, {
      queryData: managementFixtures({ Team: [activeTeam, archivedTeam] }),
    });

    await user.click(screen.getByRole('button', { name: /sharing/i }));

    const list = screen.getByText(/select a team to share/i).closest('div');
    if (!list) throw new Error('Expected sharing-selection container');

    expect(within(list).getByText('Shareable FC')).toBeInTheDocument();
    expect(within(list).queryByText('Not Shareable FC')).not.toBeInTheDocument();
  });
});
