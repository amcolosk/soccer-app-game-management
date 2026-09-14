import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InvitationManagement } from './InvitationManagement';

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
});
