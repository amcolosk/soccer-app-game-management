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
} = vi.hoisted(() => ({
  mockTeamGet: vi.fn(),
  mockTeamInvitationDelete: vi.fn(),
  mockGetCurrentUser: vi.fn(),
  mockTrackEvent: vi.fn(),
  mockSendTeamInvitation: vi.fn(),
  mockRevokeCoachAccess: vi.fn(),
  mockConfirm: vi.fn(),
  mockUseAmplifyQuery: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      Team: { get: (...args: unknown[]) => mockTeamGet(...args) },
      TeamInvitation: { delete: (...args: unknown[]) => mockTeamInvitationDelete(...args) },
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
});
