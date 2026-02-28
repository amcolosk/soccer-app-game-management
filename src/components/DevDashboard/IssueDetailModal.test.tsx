import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IssueDetailModal } from './IssueDetailModal';
import type { Issue } from '../../hooks/useBugReports';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetUrl = vi.fn();

vi.mock('aws-amplify/storage', () => ({
  getUrl: (...args: unknown[]) => mockGetUrl(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIssue(overrides: Partial<Record<string, unknown>> = {}): Issue {
  return {
    id: 'issue-id-1',
    issueNumber: 1,
    type: 'BUG',
    severity: 'medium',
    status: 'OPEN',
    description: 'App crashes on save',
    steps: null,
    systemInfo: null,
    screenshotKey: null,
    reporterEmail: 'coach@example.com',
    reporterUserId: 'user-123',
    resolution: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    closedAt: null,
    ...overrides,
  } as unknown as Issue;
}

function renderModal(overrides: Partial<Record<string, unknown>> = {}) {
  const onClose = vi.fn();
  const onUpdateStatus = vi.fn().mockResolvedValue(undefined);
  const result = render(
    <IssueDetailModal
      issue={makeIssue(overrides)}
      updating={false}
      onClose={onClose}
      onUpdateStatus={onUpdateStatus}
    />
  );
  return { onClose, onUpdateStatus, ...result };
}

// ---------------------------------------------------------------------------
// Screenshot display tests
// ---------------------------------------------------------------------------

describe('IssueDetailModal – screenshot display', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render the screenshot section when screenshotKey is absent', () => {
    renderModal({ screenshotKey: null });

    expect(screen.queryByText(/loading screenshot/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/screenshot no longer available/i)).not.toBeInTheDocument();
    expect(screen.queryByAltText(/bug report screenshot/i)).not.toBeInTheDocument();
    expect(mockGetUrl).not.toHaveBeenCalled();
  });

  it('shows "Loading screenshot…" while getUrl is pending', async () => {
    // Return a promise that stays pending for the duration of this test
    mockGetUrl.mockReturnValue(new Promise(() => {}));

    renderModal({ screenshotKey: 'bug-screenshots/us-east-1:abc/uuid.png' });

    expect(await screen.findByText(/loading screenshot/i)).toBeInTheDocument();
    expect(mockGetUrl).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'bug-screenshots/us-east-1:abc/uuid.png' })
    );
  });

  it('shows the screenshot image and link after getUrl resolves', async () => {
    const url = 'https://s3.example.com/presigned-screenshot.png';
    mockGetUrl.mockResolvedValue({ url: { toString: () => url } });

    renderModal({ screenshotKey: 'bug-screenshots/us-east-1:abc/uuid.png' });

    await waitFor(() => {
      expect(screen.getByAltText(/bug report screenshot/i)).toHaveAttribute('src', url);
    });
    expect(screen.getByRole('link', { name: /open full size/i })).toHaveAttribute('href', url);
  });

  it('shows "Screenshot no longer available" when getUrl rejects', async () => {
    mockGetUrl.mockRejectedValue(new Error('Access denied'));

    renderModal({ screenshotKey: 'bug-screenshots/us-east-1:abc/uuid.png' });

    await waitFor(() => {
      expect(screen.getByText(/screenshot no longer available/i)).toBeInTheDocument();
    });
    expect(screen.queryByAltText(/bug report screenshot/i)).not.toBeInTheDocument();
  });

  it('clears stale screenshot URL and shows loading when issue changes', async () => {
    const url1 = 'https://s3.example.com/shot1.png';
    mockGetUrl
      .mockResolvedValueOnce({ url: { toString: () => url1 } }) // first issue
      .mockReturnValueOnce(new Promise(() => {}));               // second issue (stays pending)

    const onClose = vi.fn();
    const onUpdateStatus = vi.fn().mockResolvedValue(undefined);

    const issue1 = makeIssue({ screenshotKey: 'bug-screenshots/us-east-1:abc/uuid1.png', issueNumber: 1 });
    const issue2 = makeIssue({ screenshotKey: 'bug-screenshots/us-east-1:abc/uuid2.png', issueNumber: 2 });

    const { rerender } = render(
      <IssueDetailModal issue={issue1} updating={false} onClose={onClose} onUpdateStatus={onUpdateStatus} />
    );

    // Wait for first issue screenshot to load
    await waitFor(() => expect(screen.getByAltText(/bug report screenshot/i)).toBeInTheDocument());

    // Switch to a different issue
    rerender(
      <IssueDetailModal issue={issue2} updating={false} onClose={onClose} onUpdateStatus={onUpdateStatus} />
    );

    // The old image should be gone and the loading state shown for the new issue
    await waitFor(() => expect(screen.getByText(/loading screenshot/i)).toBeInTheDocument());
    expect(screen.queryByAltText(/bug report screenshot/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Status update form tests
// ---------------------------------------------------------------------------

describe('IssueDetailModal – status update form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUrl.mockResolvedValue({ url: { toString: () => 'https://example.com/shot.png' } });
  });

  it('renders the status update form for an open issue', () => {
    renderModal({ status: 'OPEN' });
    expect(screen.getByRole('button', { name: /save status/i })).toBeInTheDocument();
  });

  it('shows "closed" notice instead of form for a closed issue', () => {
    renderModal({ status: 'CLOSED' });
    expect(screen.getByText(/this issue is closed/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save status/i })).not.toBeInTheDocument();
  });

  it('calls onUpdateStatus and onClose when Save Status is submitted', async () => {
    const user = userEvent.setup();
    const { onUpdateStatus, onClose } = renderModal({ status: 'OPEN', issueNumber: 7 });

    await user.click(screen.getByRole('button', { name: /save status/i }));

    await waitFor(() => expect(onUpdateStatus).toHaveBeenCalled());
    expect(onUpdateStatus).toHaveBeenCalledWith(7, expect.any(String), undefined);
    expect(onClose).toHaveBeenCalled();
  });

  it('disables the submit button while updating (shows "Saving…")', () => {
    const onClose = vi.fn();
    const onUpdateStatus = vi.fn();
    render(
      <IssueDetailModal
        issue={makeIssue({ status: 'OPEN' })}
        updating={true}
        onClose={onClose}
        onUpdateStatus={onUpdateStatus}
      />
    );
    // When updating=true the button renders as "Saving…" (not "Save Status")
    const btn = screen.getByRole('button', { name: /saving/i });
    expect(btn).toBeDisabled();
  });

  it('calls onClose when the close button is clicked', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.click(screen.getByRole('button', { name: /close modal/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('displays issue description', () => {
    renderModal({ description: 'Login button unresponsive' });
    expect(screen.getByText('Login button unresponsive')).toBeInTheDocument();
  });

  it('displays steps to reproduce when present', () => {
    renderModal({ steps: '1. Click login\n2. See nothing' });
    expect(screen.getByText(/click login/i)).toBeInTheDocument();
  });
});
