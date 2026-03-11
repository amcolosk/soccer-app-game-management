import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelpFab } from './HelpFab';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockNavigate, mockTrackEvent, mockExpand } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockTrackEvent: vi.fn(),
  mockExpand: vi.fn(),
}));

let mockHelpContext: string | null = 'home';
let mockDismissed: boolean = false;
let mockWelcomed: boolean = true;
const mockDebugContext: null = null;

vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(() => mockNavigate),
}));

vi.mock('../contexts/HelpFabContext', () => ({
  useHelpFab: () => ({
    helpContext: mockHelpContext,
    debugContext: mockDebugContext,
  }),
}));

vi.mock('../contexts/OnboardingContext', () => ({
  useOnboarding: () => ({
    welcomed: mockWelcomed,
    dismissed: mockDismissed,
    expand: mockExpand,
  }),
}));

vi.mock('../utils/analytics', () => ({
  trackEvent: mockTrackEvent,
  AnalyticsEvents: {
    BUG_REPORT_OPENED: { category: 'help', action: 'bug_report_opened' },
    HELP_OPENED: { category: 'help', action: 'help_opened' },
  },
}));

vi.mock('./BugReport', () => ({
  BugReport: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="bug-report">
      <button onClick={onClose}>Close Bug Report</button>
    </div>
  ),
}));

vi.mock('./HelpModal', () => ({
  HelpModal: ({ helpContext, onClose }: { helpContext: string; onClose: () => void }) => (
    <div data-testid="help-modal" data-context={helpContext}>
      <button onClick={onClose}>Close Help</button>
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Tests
// All userEvent interactions use the userEvent.setup() API (required in
// userEvent v14 + React 19 to avoid event-loop hangs from pending timers).
//
// Tests that need the 300 ms closeSheet animation to complete use
// vi.useFakeTimers({ shouldAdvanceTime: true }) so React's internal
// act() scheduler (setTimeout 0) still auto-advances while we can also
// manually skip ahead with vi.advanceTimersByTime().
// ---------------------------------------------------------------------------

describe('HelpFab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHelpContext = 'home';
    mockDismissed = false;
    mockWelcomed = true;
  });

  it('renders the FAB button with accessible label', () => {
    render(<HelpFab />);
    expect(screen.getByRole('button', { name: 'Help and bug report' })).toBeInTheDocument();
  });

  it('FAB click opens the bottom sheet', async () => {
    const user = userEvent.setup();
    render(<HelpFab />);
    await user.click(screen.getByRole('button', { name: 'Help and bug report' }));
    expect(screen.getByRole('menu', { name: 'Help menu' })).toBeInTheDocument();
  });

  it('sheet contains Report a Bug, Get Help, and Quick Start options', async () => {
    const user = userEvent.setup();
    render(<HelpFab />);
    await user.click(screen.getByRole('button', { name: 'Help and bug report' }));
    expect(screen.getByRole('menuitem', { name: /Report a Bug/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Get Help/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Quick Start Guide/i })).toBeInTheDocument();
  });

  it('backdrop click closes the sheet', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<HelpFab />);
    await user.click(screen.getByRole('button', { name: 'Help and bug report' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    const backdrop = document.querySelector('.help-fab-backdrop') as HTMLElement;
    await user.click(backdrop);

    await act(async () => { vi.advanceTimersByTime(400); });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('Escape key closes the sheet', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<HelpFab />);
    await user.click(screen.getByRole('button', { name: 'Help and bug report' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await act(async () => { vi.advanceTimersByTime(400); });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('"Report a Bug" click closes sheet then opens BugReport modal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<HelpFab />);
    await user.click(screen.getByRole('button', { name: 'Help and bug report' }));
    await user.click(screen.getByRole('menuitem', { name: /Report a Bug/i }));

    // Sheet starts closing (isClosing=true) — BugReport not visible yet
    expect(screen.queryByTestId('bug-report')).not.toBeInTheDocument();

    // Advance past the 300 ms fallback close timeout
    await act(async () => { vi.advanceTimersByTime(400); });

    expect(screen.getByTestId('bug-report')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('"Get Help" button is enabled when helpContext is set', async () => {
    const user = userEvent.setup();
    mockHelpContext = 'home';
    render(<HelpFab />);
    await user.click(screen.getByRole('button', { name: 'Help and bug report' }));
    expect(screen.getByRole('menuitem', { name: /Get Help/i })).not.toBeDisabled();
  });

  it('"Get Help" button is disabled when helpContext is null', async () => {
    const user = userEvent.setup();
    mockHelpContext = null;
    render(<HelpFab />);
    await user.click(screen.getByRole('button', { name: 'Help and bug report' }));
    expect(screen.getByRole('menuitem', { name: /Get Help/i })).toBeDisabled();
  });

  it('"Get Help" shows "Coming soon" subtitle when helpContext is null', async () => {
    const user = userEvent.setup();
    mockHelpContext = null;
    render(<HelpFab />);
    await user.click(screen.getByRole('button', { name: 'Help and bug report' }));
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });

  it('"Get Help" click closes sheet then opens HelpModal with correct context', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockHelpContext = 'home';
    render(<HelpFab />);
    await user.click(screen.getByRole('button', { name: 'Help and bug report' }));
    await user.click(screen.getByRole('menuitem', { name: /Get Help/i }));

    await act(async () => { vi.advanceTimersByTime(400); });

    expect(screen.getByTestId('help-modal')).toBeInTheDocument();
    expect(screen.getByTestId('help-modal').dataset.context).toBe('home');
    vi.useRealTimers();
  });

  it('"Quick Start Guide" click calls expand() and navigates to /', async () => {
    const user = userEvent.setup();
    render(<HelpFab />);
    await user.click(screen.getByRole('button', { name: 'Help and bug report' }));
    await user.click(screen.getByRole('menuitem', { name: /Quick Start Guide/i }));

    expect(mockExpand).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('Quick Start button shows completion state when dismissed is true', async () => {
    const user = userEvent.setup();
    mockDismissed = true;
    render(<HelpFab />);
    await user.click(screen.getByRole('button', { name: 'Help and bug report' }));
    expect(screen.getByText('Quick Start — complete')).toBeInTheDocument();
    expect(screen.getByText('All done!')).toBeInTheDocument();
  });

  it('tracks analytics when "Report a Bug" is clicked', async () => {
    const user = userEvent.setup();
    render(<HelpFab />);
    await user.click(screen.getByRole('button', { name: 'Help and bug report' }));
    await user.click(screen.getByRole('menuitem', { name: /Report a Bug/i }));

    expect(mockTrackEvent).toHaveBeenCalledWith('help', 'bug_report_opened');
  });

  it('tracks analytics when "Get Help" is clicked', async () => {
    const user = userEvent.setup();
    render(<HelpFab />);
    await user.click(screen.getByRole('button', { name: 'Help and bug report' }));
    await user.click(screen.getByRole('menuitem', { name: /Get Help/i }));

    expect(mockTrackEvent).toHaveBeenCalledWith('help', 'help_opened', 'home');
  });
});
