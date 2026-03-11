/**
 * Tests for WelcomeModal.
 *
 * Behaviours covered:
 *  - Renders heading, "How it works" section, "Load a sample team" button, primary CTA, skip link
 *  - ✕ close button calls onClose
 *  - "Skip setup" calls onClose and fires WELCOME_MODAL_SKIPPED analytics
 *  - "Let's Go →" calls onOpenQuickStart
 *  - "Load a sample team" calls onLoadDemoData and shows loading state
 *  - Escape key calls onClose
 *  - Focus moves to heading on open and is restored to trigger element on close
 *  - focus trap: Tab wraps from last to first focusable element
 *  - focus trap: Shift+Tab wraps from first to last focusable element
 *  - WELCOME_MODAL_OPENED analytics fired on mount
 *  - role="dialog" and aria-modal="true" are set
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const { mockTrackEvent } = vi.hoisted(() => ({ mockTrackEvent: vi.fn() }));

vi.mock('../../utils/analytics', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  AnalyticsEvents: {
    WELCOME_MODAL_OPENED: { category: 'Onboarding', action: 'Welcome Modal Opened' },
    WELCOME_MODAL_SKIPPED: { category: 'Onboarding', action: 'Welcome Modal Skipped' },
  },
}));

import { WelcomeModal } from './WelcomeModal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderModal(overrides: Partial<React.ComponentProps<typeof WelcomeModal>> = {}) {
  const props = {
    onClose: vi.fn(),
    onLoadDemoData: vi.fn().mockResolvedValue(undefined),
    onOpenQuickStart: vi.fn(),
    isDemoLoading: false,
    ...overrides,
  };
  return { ...props, ...render(<WelcomeModal {...props} />) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('WelcomeModal — rendering', () => {
  beforeEach(() => mockTrackEvent.mockClear());

  it('renders the "Welcome to TeamTrack" heading', () => {
    renderModal();
    expect(screen.getByRole('heading', { name: /welcome to teamtrack/i })).toBeInTheDocument();
  });

  it('renders the "How it works" section heading', () => {
    renderModal();
    expect(screen.getByText(/how it works/i)).toBeInTheDocument();
  });

  it('renders the "Load a sample team" button', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /load a sample team/i })).toBeInTheDocument();
  });

  it('renders the "Let\'s Go →" primary button', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /let's go/i })).toBeInTheDocument();
  });

  it('renders the "Skip setup" button', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /skip setup/i })).toBeInTheDocument();
  });

  it('renders with role="dialog" and aria-modal="true"', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('has aria-labelledby pointing at the heading id', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    const headingId = dialog.getAttribute('aria-labelledby');
    expect(document.getElementById(headingId!)).toBe(
      screen.getByRole('heading', { name: /welcome to teamtrack/i })
    );
  });

  it('fires WELCOME_MODAL_OPENED analytics on mount', () => {
    renderModal();
    expect(mockTrackEvent).toHaveBeenCalledWith('Onboarding', 'Welcome Modal Opened');
  });
});

describe('WelcomeModal — close button (✕)', () => {
  beforeEach(() => mockTrackEvent.mockClear());

  it('calls onClose when ✕ is clicked', async () => {
    const { onClose } = renderModal();
    await userEvent.click(screen.getByRole('button', { name: /close welcome/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('WelcomeModal — "Skip setup"', () => {
  beforeEach(() => mockTrackEvent.mockClear());

  it('calls onClose when "Skip setup" is clicked', async () => {
    const { onClose } = renderModal();
    await userEvent.click(screen.getByRole('button', { name: /skip setup/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fires WELCOME_MODAL_SKIPPED analytics when "Skip setup" is clicked', async () => {
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: /skip setup/i }));
    expect(mockTrackEvent).toHaveBeenCalledWith('Onboarding', 'Welcome Modal Skipped');
  });

  it('does NOT fire SKIPPED analytics when ✕ is clicked', async () => {
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: /close welcome/i }));
    expect(mockTrackEvent).not.toHaveBeenCalledWith('Onboarding', 'Welcome Modal Skipped');
  });
});

describe('WelcomeModal — "Let\'s Go →"', () => {
  it('calls onOpenQuickStart when clicked', async () => {
    const { onOpenQuickStart } = renderModal();
    await userEvent.click(screen.getByRole('button', { name: /let's go/i }));
    expect(onOpenQuickStart).toHaveBeenCalledTimes(1);
  });
});

describe('WelcomeModal — "Load a sample team"', () => {
  it('calls onLoadDemoData when clicked', async () => {
    const { onLoadDemoData } = renderModal();
    await userEvent.click(screen.getByRole('button', { name: /load a sample team/i }));
    expect(onLoadDemoData).toHaveBeenCalledTimes(1);
  });

  it('shows "Loading..." text and disables the button when isDemoLoading=true', () => {
    renderModal({ isDemoLoading: true });
    const btn = screen.getByRole('button', { name: /loading/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it('shows "Load a sample team" and is enabled when isDemoLoading=false', () => {
    renderModal({ isDemoLoading: false });
    const btn = screen.getByRole('button', { name: /load a sample team/i });
    expect(btn).not.toBeDisabled();
  });
});

describe('WelcomeModal — Escape key', () => {
  it('calls onClose when Escape is pressed', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onClose for other keys', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('WelcomeModal — focus management', () => {
  it('focuses the heading on mount', async () => {
    renderModal();
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: /welcome to teamtrack/i })
      );
    });
  });

  it('restores focus to the trigger element after close', async () => {
    // Create a trigger button and put focus on it before rendering the modal
    const trigger = document.createElement('button');
    trigger.textContent = 'Trigger';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = renderModal();
    // Simulate onClose → unmount
    unmount();

    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });

    document.body.removeChild(trigger);
  });
});

describe('WelcomeModal — focus trap', () => {
  it('wraps Tab from last focusable element back to first', async () => {
    renderModal();
    const user = userEvent.setup();

    // Tab through all focusable elements — after the last one, focus should wrap
    const focusable = screen
      .getByRole('dialog')
      .querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])'
      );
    const last = focusable[focusable.length - 1];
    const first = focusable[0];

    last.focus();
    expect(document.activeElement).toBe(last);

    await user.tab();
    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from first focusable element back to last', async () => {
    renderModal();
    const user = userEvent.setup();

    const focusable = screen
      .getByRole('dialog')
      .querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])'
      );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    first.focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);
  });
});
