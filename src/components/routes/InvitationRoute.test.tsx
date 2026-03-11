import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InvitationRoute } from './InvitationRoute';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useParams: vi.fn(),
  useNavigate: vi.fn(() => mockNavigate),
}));

vi.mock('../InvitationAcceptance', () => ({
  default: ({ invitationId, onComplete }: { invitationId: string; onComplete: () => void }) => (
    <div data-testid="invitation-acceptance">
      <span data-testid="invitation-id">{invitationId}</span>
      <button onClick={onComplete}>Complete</button>
    </div>
  ),
}));

vi.mock('../ConfirmModal', () => ({
  ConfirmProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { useParams } from 'react-router-dom';

const mockUseParams = vi.mocked(useParams);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InvitationRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders error state if invitationId URL param is missing', () => {
    mockUseParams.mockReturnValue({});

    render(<InvitationRoute />);

    expect(screen.getByText('Invalid invitation link.')).toBeInTheDocument();
  });

  it('renders InvitationAcceptance with the correct invitationId prop', () => {
    mockUseParams.mockReturnValue({ invitationId: 'inv-123' });

    render(<InvitationRoute />);

    expect(screen.getByTestId('invitation-acceptance')).toBeInTheDocument();
    expect(screen.getByTestId('invitation-id').textContent).toBe('inv-123');
  });

  it('onComplete navigates to /', async () => {
    mockUseParams.mockReturnValue({ invitationId: 'inv-123' });

    render(<InvitationRoute />);

    await userEvent.click(screen.getByRole('button', { name: 'Complete' }));

    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('renders the app header with TeamTrack branding', () => {
    mockUseParams.mockReturnValue({ invitationId: 'inv-456' });

    render(<InvitationRoute />);

    expect(screen.getByText('⚽ TeamTrack')).toBeInTheDocument();
    expect(screen.getByText('Game Management for Coaches')).toBeInTheDocument();
  });

  it('Go Home button navigates to / when invitationId is missing', async () => {
    mockUseParams.mockReturnValue({});

    render(<InvitationRoute />);

    await userEvent.click(screen.getByRole('button', { name: 'Go Home' }));

    expect(mockNavigate).toHaveBeenCalledWith('/');
  });
});
