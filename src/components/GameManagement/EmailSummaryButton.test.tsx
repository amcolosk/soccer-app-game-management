import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const { mockEmailGameSummary, mockShowError, mockShowSuccess } = vi.hoisted(() => ({
  mockEmailGameSummary: vi.fn(),
  mockShowError: vi.fn(),
  mockShowSuccess: vi.fn(),
}));

vi.mock('../../services/gameService', () => ({
  emailGameSummary: mockEmailGameSummary,
}));

vi.mock('../../utils/toast', () => ({
  showError: mockShowError,
  showSuccess: mockShowSuccess,
}));

import { EmailSummaryButton } from './EmailSummaryButton';

describe('EmailSummaryButton', () => {
  beforeEach(() => {
    mockEmailGameSummary.mockReset();
    mockShowError.mockReset();
    mockShowSuccess.mockReset();
  });

  it('renders "Email Game Summary" button, not disabled initially', () => {
    render(<EmailSummaryButton gameId="game-1" />);
    const button = screen.getByRole('button', { name: 'Email Game Summary' });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });

  it('shows "Sending…" and disables the button while the send is pending', async () => {
    let resolveSend: (value: { success: boolean; sentTo: string | null }) => void = () => {};
    mockEmailGameSummary.mockReturnValue(
      new Promise((resolve) => {
        resolveSend = resolve;
      })
    );

    render(<EmailSummaryButton gameId="game-1" />);
    const button = screen.getByRole('button', { name: 'Email Game Summary' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    });

    resolveSend({ success: true, sentTo: 'coach@example.com' });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Email Game Summary' })).not.toBeDisabled();
    });
  });

  it('shows a success toast containing the resolved email and re-enables the button', async () => {
    mockEmailGameSummary.mockResolvedValue({ success: true, sentTo: 'coach@example.com' });

    render(<EmailSummaryButton gameId="game-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Email Game Summary' }));

    await waitFor(() => {
      expect(mockShowSuccess).toHaveBeenCalledWith('Summary sent to coach@example.com');
    });
    expect(screen.getByRole('button', { name: 'Email Game Summary' })).not.toBeDisabled();
  });

  it('shows an error toast with the Error message on rejection, and re-enables the button', async () => {
    mockEmailGameSummary.mockRejectedValue(new Error('Access denied: caller is not a coach on this game'));

    render(<EmailSummaryButton gameId="game-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Email Game Summary' }));

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Access denied: caller is not a coach on this game');
    });
    expect(screen.getByRole('button', { name: 'Email Game Summary' })).not.toBeDisabled();
  });

  it('shows the generic fallback error message when a non-Error value is thrown', async () => {
    mockEmailGameSummary.mockRejectedValue('some string rejection');

    render(<EmailSummaryButton gameId="game-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Email Game Summary' }));

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('Failed to send summary email');
    });
    expect(screen.getByRole('button', { name: 'Email Game Summary' })).not.toBeDisabled();
  });
});
