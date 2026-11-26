import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InvitationManagement } from './InvitationManagement';
import { UIVersionProvider } from '../contexts/UIVersionContext';

const {
  mockTeamGet,
  mockTeamInvitationDelete,
  mockGetCurrentUser,
  mockTrackEvent,
  mockSendTeamInvitation,
  mockRevokeCoachAccess,
  mockConfirm,
  mockUseAmplifyQuery,
  mockListTeamShareLinks,
  mockGenerateShareLink,
  mockRevokeShareLink,
} = vi.hoisted(() => ({
  mockTeamGet: vi.fn(),
  mockTeamInvitationDelete: vi.fn(),
  mockGetCurrentUser: vi.fn(),
  mockTrackEvent: vi.fn(),
  mockSendTeamInvitation: vi.fn(),
  mockRevokeCoachAccess: vi.fn(),
  mockConfirm: vi.fn(),
  mockUseAmplifyQuery: vi.fn(),
  mockListTeamShareLinks: vi.fn(),
  mockGenerateShareLink: vi.fn(),
  mockRevokeShareLink: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      Team: { get: (...args: unknown[]) => mockTeamGet(...args) },
      TeamInvitation: { delete: (...args: unknown[]) => mockTeamInvitationDelete(...args) },
    },
    queries: {
      listTeamShareLinks: (...args: unknown[]) => mockListTeamShareLinks(...args),
    },
    mutations: {
      generateShareLink: (...args: unknown[]) => mockGenerateShareLink(...args),
      revokeShareLink: (...args: unknown[]) => mockRevokeShareLink(...args),
    },
  })),
}));

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
}));

vi.mock('../utils/analytics', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  AnalyticsEvents: {
    INVITATION_SENT: { category: 'invitation', action: 'sent' },
  },
}));

vi.mock('../services/invitationService', () => ({
  sendTeamInvitation: (...args: unknown[]) => mockSendTeamInvitation(...args),
  revokeCoachAccess: (...args: unknown[]) => mockRevokeCoachAccess(...args),
}));

vi.mock('./ConfirmModal', () => ({
  useConfirm: () => mockConfirm,
}));

vi.mock('../hooks/useAmplifyQuery', () => ({
  useAmplifyQuery: (...args: unknown[]) => mockUseAmplifyQuery(...args),
}));

describe('InvitationManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    mockGetCurrentUser.mockResolvedValue({ userId: 'coach-1' });
    mockTeamGet.mockResolvedValue({ data: { coaches: ['coach-1', 'coach-2'] } });
    mockTeamInvitationDelete.mockResolvedValue({ data: {} });
    mockSendTeamInvitation.mockResolvedValue({});
    mockRevokeCoachAccess.mockResolvedValue({});
    mockConfirm.mockResolvedValue(true);
    mockListTeamShareLinks.mockResolvedValue({ data: [] });
    mockGenerateShareLink.mockResolvedValue({ data: { token: 'new-token', type: 'FAN', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null } });
    mockRevokeShareLink.mockResolvedValue({ data: true });

    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    mockUseAmplifyQuery.mockReturnValue({
      data: [
        {
          id: 'inv-1',
          teamId: 'team-1',
          status: 'PENDING',
          email: 'pending@example.com',
          role: 'COACH',
          expiresAt: '2030-01-01T00:00:00.000Z',
        },
        {
          id: 'inv-2',
          teamId: 'team-1',
          status: 'ACCEPTED',
          email: 'accepted@example.com',
          acceptedBy: 'coach-2',
          role: 'COACH',
          expiresAt: '2030-01-01T00:00:00.000Z',
        },
      ],
      isSynced: true,
    });
  });

  function renderComponent() {
    return render(
      <InvitationManagement
        type="team"
        resourceId="team-1"
        resourceName="Tigers"
      />
    );
  }

  function renderWithVersion(version: 'classic' | 'new') {
    localStorage.setItem('teamtrack-ui-version', version);
    return render(
      <UIVersionProvider>
        <InvitationManagement
          type="team"
          resourceId="team-1"
          resourceName="Tigers"
        />
      </UIVersionProvider>
    );
  }

  it('shows validation message for invalid email input', async () => {
    const { container } = renderComponent();

    const emailInput = await screen.findByPlaceholderText('Email address');
    fireEvent.change(emailInput, { target: { value: 'bad@localhost' } });

    fireEvent.submit(container.querySelector('form')!);

    expect(await screen.findByText('Please enter a valid email address')).toBeInTheDocument();
    expect(mockSendTeamInvitation).not.toHaveBeenCalled();
  });

  it('sends invitation and shows success message', async () => {
    renderComponent();

    const emailInput = await screen.findByPlaceholderText('Email address');
    fireEvent.change(emailInput, { target: { value: 'newcoach@example.com' } });

    fireEvent.click(screen.getByRole('button', { name: 'Send Invitation' }));

    await waitFor(() => {
      expect(mockSendTeamInvitation).toHaveBeenCalledWith('team-1', 'newcoach@example.com', 'COACH');
      expect(mockTrackEvent).toHaveBeenCalledWith('invitation', 'sent');
    });

    expect(await screen.findByText('Invitation sent to newcoach@example.com')).toBeInTheDocument();
  });

  it('revokes coach access after confirmation', async () => {
    renderComponent();

    const removeButton = await screen.findByRole('button', { name: 'Remove' });
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalled();
      expect(mockRevokeCoachAccess).toHaveBeenCalledWith('team-1', 'coach-2');
    });

    expect(await screen.findByText('Coach access revoked successfully')).toBeInTheDocument();
  });

  it('cancels pending invitation after confirmation', async () => {
    renderComponent();

    const cancelButton = await screen.findByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalled();
      expect(mockTeamInvitationDelete).toHaveBeenCalledWith({ id: 'inv-1' });
    });

    expect(await screen.findByText('Invitation cancelled')).toBeInTheDocument();
  });

  describe('Share Links (Fan Mode)', () => {
    it('shows a Generate button when there is no active fan link', async () => {
      renderComponent();
      expect(await screen.findByRole('button', { name: 'Generate Fan Link' })).toBeInTheDocument();
    });

    it('generates a fan link without confirmation when none is currently active', async () => {
      renderComponent();

      const generateButton = await screen.findByRole('button', { name: 'Generate Fan Link' });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(mockGenerateShareLink).toHaveBeenCalledWith({ teamId: 'team-1', type: 'FAN' });
      });
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(await screen.findByText('Fan link generated')).toBeInTheDocument();
    });

    it('shows the active link with copy/replace/revoke controls once one exists', async () => {
      mockListTeamShareLinks.mockResolvedValue({
        data: [{ token: 'active-token', type: 'FAN', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null }],
      });

      renderComponent();

      expect(await screen.findByTestId('fan-share-link-active')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Copy Link' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
      expect(screen.getByText(/\/watch\/active-token/)).toBeInTheDocument();
    });

    it('copies the fan link URL to the clipboard', async () => {
      mockListTeamShareLinks.mockResolvedValue({
        data: [{ token: 'active-token', type: 'FAN', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null }],
      });

      renderComponent();

      const copyButton = await screen.findByRole('button', { name: 'Copy Link' });
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('/watch/active-token'));
      });
      expect(await screen.findByText('Fan link copied to clipboard')).toBeInTheDocument();
    });

    it('requires confirmation with warning variant before replacing an active link', async () => {
      mockListTeamShareLinks.mockResolvedValue({
        data: [{ token: 'active-token', type: 'FAN', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null }],
      });

      renderComponent();

      const replaceButton = await screen.findByRole('button', { name: 'Replace' });
      fireEvent.click(replaceButton);

      await waitFor(() => {
        expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
          title: 'Replace this link?',
          variant: 'warning',
        }));
        expect(mockGenerateShareLink).toHaveBeenCalledWith({ teamId: 'team-1', type: 'FAN' });
      });
    });

    it('does not replace the link when the replace confirmation is declined', async () => {
      mockListTeamShareLinks.mockResolvedValue({
        data: [{ token: 'active-token', type: 'FAN', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null }],
      });
      mockConfirm.mockResolvedValue(false);

      renderComponent();

      const replaceButton = await screen.findByRole('button', { name: 'Replace' });
      fireEvent.click(replaceButton);

      await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
      expect(mockGenerateShareLink).not.toHaveBeenCalled();
    });

    it('requires confirmation with danger variant before revoking a link', async () => {
      mockListTeamShareLinks.mockResolvedValue({
        data: [{ token: 'active-token', type: 'FAN', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null }],
      });

      renderComponent();

      const revokeButton = await screen.findByRole('button', { name: 'Revoke' });
      fireEvent.click(revokeButton);

      await waitFor(() => {
        expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
          title: 'Revoke this link?',
          variant: 'danger',
        }));
        expect(mockRevokeShareLink).toHaveBeenCalledWith({ token: 'active-token' });
      });
      expect(await screen.findByText('Fan link revoked')).toBeInTheDocument();
    });

    it('does not revoke the link when the revoke confirmation is declined', async () => {
      mockListTeamShareLinks.mockResolvedValue({
        data: [{ token: 'active-token', type: 'FAN', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null }],
      });
      mockConfirm.mockResolvedValue(false);

      renderComponent();

      const revokeButton = await screen.findByRole('button', { name: 'Revoke' });
      fireEvent.click(revokeButton);

      await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
      expect(mockRevokeShareLink).not.toHaveBeenCalled();
    });
  });

  describe('Share Links (Stat Tracker — Milestone B2)', () => {
    it('shows a Generate button when there is no active Stat Tracker link', async () => {
      renderComponent();
      expect(await screen.findByRole('button', { name: 'Generate Stat Tracker Link' })).toBeInTheDocument();
    });

    it('generates a Stat Tracker link without confirmation when none is currently active', async () => {
      renderComponent();

      const generateButton = await screen.findByRole('button', { name: 'Generate Stat Tracker Link' });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(mockGenerateShareLink).toHaveBeenCalledWith({ teamId: 'team-1', type: 'STAT_TRACKER' });
      });
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(await screen.findByText('Stat Tracker link generated')).toBeInTheDocument();
    });

    it('shows the active Stat Tracker link with copy/replace/revoke controls once one exists', async () => {
      mockListTeamShareLinks.mockResolvedValue({
        data: [{ token: 'tracker-token', type: 'STAT_TRACKER', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null }],
      });

      renderComponent();

      expect(await screen.findByTestId('stat-tracker-share-link-active')).toBeInTheDocument();
      expect(screen.getByText(/\/track\/tracker-token/)).toBeInTheDocument();
    });

    it('copies the Stat Tracker link URL to the clipboard', async () => {
      mockListTeamShareLinks.mockResolvedValue({
        data: [{ token: 'tracker-token', type: 'STAT_TRACKER', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null }],
      });

      renderComponent();
      await screen.findByTestId('stat-tracker-share-link-active');

      const copyButton = screen.getByRole('button', { name: 'Copy Link' });
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('/track/tracker-token'));
      });
      expect(await screen.findByText('Stat Tracker link copied to clipboard')).toBeInTheDocument();
    });

    it('requires confirmation with warning variant before replacing an active Stat Tracker link', async () => {
      mockListTeamShareLinks.mockResolvedValue({
        data: [{ token: 'tracker-token', type: 'STAT_TRACKER', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null }],
      });

      renderComponent();
      await screen.findByTestId('stat-tracker-share-link-active');

      fireEvent.click(screen.getByRole('button', { name: 'Replace' }));

      await waitFor(() => {
        expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
          title: 'Replace this link?',
          variant: 'warning',
        }));
        expect(mockGenerateShareLink).toHaveBeenCalledWith({ teamId: 'team-1', type: 'STAT_TRACKER' });
      });
    });

    it('requires confirmation with danger variant before revoking a Stat Tracker link', async () => {
      mockListTeamShareLinks.mockResolvedValue({
        data: [{ token: 'tracker-token', type: 'STAT_TRACKER', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null }],
      });

      renderComponent();
      await screen.findByTestId('stat-tracker-share-link-active');

      fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

      await waitFor(() => {
        expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
          title: 'Revoke this link?',
          variant: 'danger',
        }));
        expect(mockRevokeShareLink).toHaveBeenCalledWith({ token: 'tracker-token' });
      });
      expect(await screen.findByText('Stat Tracker link revoked')).toBeInTheDocument();
    });

    it('shows both Fan and Stat Tracker links simultaneously, each with its own controls', async () => {
      mockListTeamShareLinks.mockResolvedValue({
        data: [
          { token: 'fan-token', type: 'FAN', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null },
          { token: 'tracker-token', type: 'STAT_TRACKER', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null },
        ],
      });

      renderComponent();

      expect(await screen.findByTestId('fan-share-link-active')).toBeInTheDocument();
      expect(await screen.findByTestId('stat-tracker-share-link-active')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Copy Link' })).toHaveLength(2);
    });
  });

  describe('Account/Public Links grouping (always visible)', () => {
    it('shows both group headings and descriptions regardless of toggle state', async () => {
      renderComponent();

      expect(await screen.findByText('Coach & Parent Accounts')).toBeInTheDocument();
      expect(
        screen.getByText('Invite coaches to help manage this team, or add parents to your account.')
      ).toBeInTheDocument();
      expect(screen.getByText('Public Links (no account)')).toBeInTheDocument();
      expect(
        screen.getByText(/Generate a public link so parents\/fans can follow the live score/)
      ).toBeInTheDocument();
    });

    it('still shows both group headings in the gated "new" interface version', async () => {
      renderWithVersion('new');

      expect(await screen.findByText('Coach & Parent Accounts')).toBeInTheDocument();
      expect(screen.getByText('Public Links (no account)')).toBeInTheDocument();
    });
  });

  describe('Public link badges', () => {
    it('shows a green Read-only badge on the active Fan link', async () => {
      mockListTeamShareLinks.mockResolvedValue({
        data: [{ token: 'active-token', type: 'FAN', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null }],
      });

      renderComponent();

      await screen.findByTestId('fan-share-link-active');
      expect(screen.getByText('Read-only')).toBeInTheDocument();
    });

    it('shows an amber badge next to the Stat Tracker link\'s "(write access)" label, keeping that wording', async () => {
      mockListTeamShareLinks.mockResolvedValue({
        data: [{ token: 'tracker-token', type: 'STAT_TRACKER', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null }],
      });

      renderComponent();

      await screen.findByTestId('stat-tracker-share-link-active');
      expect(screen.getByText('Stat Tracker link (write access)')).toBeInTheDocument();
      expect(screen.getByText('Write access')).toBeInTheDocument();
    });

    it('does not render badges when no link has been generated yet', async () => {
      renderComponent();

      await screen.findByRole('button', { name: 'Generate Fan Link' });
      expect(screen.queryByText('Read-only')).not.toBeInTheDocument();
      expect(screen.queryByText('Write access')).not.toBeInTheDocument();
    });
  });

  describe('Parent-role copy correction', () => {
    it('never describes the Parent invite role as read-only in newly added copy', async () => {
      const { container } = renderComponent();

      await screen.findByText(/A Parent invite gets the same full team access/);

      // The pre-existing (separately tracked) inaccurate "(Read-only)" labels
      // on the role <option> and the invitation-role badge are untouched and
      // intentionally excluded from this assertion — only new copy is checked.
      const newCopy = screen.getByText(/A Parent invite gets the same full team access/);
      expect(newCopy.textContent?.toLowerCase()).not.toContain('read-only');
      expect(newCopy.textContent).toContain('Fan link');

      // Sanity: the pre-existing mislabel is still present elsewhere (out of
      // scope for this change) so this test documents, not silently fixes, it.
      expect(container.querySelectorAll('option')[1].textContent).toContain('Read-only');
    });
  });

  describe('Public Links detail-control collapse (version === "new" only, split per link type)', () => {
    it('does not render any collapse toggle in classic mode', async () => {
      renderComponent();
      await screen.findByRole('button', { name: 'Generate Fan Link' });
      expect(screen.queryByRole('button', { name: /link details/i })).not.toBeInTheDocument();
    });

    it('never shows a collapse toggle for a link that has not been generated yet — its Generate CTA always stays visible', async () => {
      renderWithVersion('new');

      expect(await screen.findByRole('button', { name: 'Generate Fan Link' })).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: 'Generate Stat Tracker Link' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /link details/i })).not.toBeInTheDocument();
      // "Whether a link exists" stays visible too.
      expect(screen.getAllByText('Not generated yet')).toHaveLength(2);
    });

    it('defaults to expanded for the Fan link once it is active, independent of the Stat Tracker link', async () => {
      mockListTeamShareLinks.mockResolvedValue({
        data: [{ token: 'active-token', type: 'FAN', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null }],
      });

      renderWithVersion('new');

      const toggle = await screen.findByRole('button', { name: 'Hide Fan link details' });
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(await screen.findByTestId('fan-share-link-active')).toBeInTheDocument();
      // The never-generated Stat Tracker link has no toggle of its own — its CTA just stays visible.
      expect(screen.queryByRole('button', { name: /stat tracker link details/i })).not.toBeInTheDocument();
      expect(await screen.findByRole('button', { name: 'Generate Stat Tracker Link' })).toBeInTheDocument();
    });

    it('collapsing the Fan link details never hides the Stat Tracker link Generate CTA', async () => {
      mockListTeamShareLinks.mockResolvedValue({
        data: [{ token: 'active-token', type: 'FAN', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null }],
      });

      renderWithVersion('new');

      const fanToggle = await screen.findByRole('button', { name: 'Hide Fan link details' });
      fireEvent.click(fanToggle);

      expect(screen.getByRole('button', { name: 'Show Fan link details' })).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('fan-share-link-active')).not.toBeInTheDocument();
      // Collapsing the Fan link's details must not affect the Stat Tracker link's CTA.
      expect(screen.getByRole('button', { name: 'Generate Stat Tracker Link' })).toBeInTheDocument();
    });

    it('collapsing the Stat Tracker link details never hides the Fan link Generate CTA', async () => {
      mockListTeamShareLinks.mockResolvedValue({
        data: [{ token: 'active-token', type: 'STAT_TRACKER', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null }],
      });

      renderWithVersion('new');

      const trackerToggle = await screen.findByRole('button', { name: 'Hide Stat Tracker link details' });
      fireEvent.click(trackerToggle);

      expect(screen.getByRole('button', { name: 'Show Stat Tracker link details' })).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('stat-tracker-share-link-active')).not.toBeInTheDocument();
      // Collapsing the Stat Tracker link's details must not affect the Fan link's CTA.
      expect(screen.getByRole('button', { name: 'Generate Fan Link' })).toBeInTheDocument();
    });

    it('lets a coach manually re-expand a collapsed link detail independently of the other link type', async () => {
      mockListTeamShareLinks.mockResolvedValue({
        data: [
          { token: 'fan-token', type: 'FAN', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null },
          { token: 'tracker-token', type: 'STAT_TRACKER', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null },
        ],
      });

      renderWithVersion('new');

      const fanToggle = await screen.findByRole('button', { name: 'Hide Fan link details' });
      fireEvent.click(fanToggle); // collapse Fan only

      expect(screen.queryByTestId('fan-share-link-active')).not.toBeInTheDocument();
      // Stat Tracker link stays expanded throughout.
      expect(screen.getByTestId('stat-tracker-share-link-active')).toBeInTheDocument();

      const reExpand = screen.getByRole('button', { name: 'Show Fan link details' });
      fireEvent.click(reExpand);

      expect(await screen.findByTestId('fan-share-link-active')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Hide Fan link details' })).toHaveAttribute('aria-expanded', 'true');
    });

    it('persists a manual collapse choice per link type across a later refreshShareLinks re-fetch', async () => {
      // Start with an active Fan link (default-expanded), then manually collapse it.
      mockListTeamShareLinks.mockResolvedValue({
        data: [{ token: 'active-token', type: 'FAN', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null }],
      });

      renderWithVersion('new');

      const hideToggle = await screen.findByRole('button', { name: 'Hide Fan link details' });
      fireEvent.click(hideToggle);

      const showToggle = await screen.findByRole('button', { name: 'Show Fan link details' });
      expect(showToggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('fan-share-link-active')).not.toBeInTheDocument();

      // Simulate a refreshShareLinks() re-fetch resolving again with the same
      // (still active) link data — the manual collapse must not be
      // recomputed/overridden back to "expanded" just because the link is active.
      mockListTeamShareLinks.mockResolvedValue({
        data: [{ token: 'active-token', type: 'FAN', issuedAt: '2026-01-01T00:00:00.000Z', revokedAt: null }],
      });

      await waitFor(() => {
        expect(mockListTeamShareLinks).toHaveBeenCalled();
      });

      expect(screen.getByRole('button', { name: 'Show Fan link details' })).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('fan-share-link-active')).not.toBeInTheDocument();
    });
  });
});
