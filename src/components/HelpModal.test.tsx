/**
 * Tests for HelpModal component.
 *
 * Strategy:
 * - Mock the help module so tests are not coupled to real content
 * - Test rendering, accessibility attributes, focus, close behavior, and fallback
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mock the help module with controlled test content
// ---------------------------------------------------------------------------
vi.mock('../help', () => ({
  HELP_CONTENT: {
    'home': {
      screenTitle: 'Games List',
      overview: 'This is the home screen.',
      tasks: [
        { title: 'Schedule a game', steps: ['Tap the button.', 'Fill the form.'] },
      ],
      tips: [{ text: 'Active games appear first.' }],
      relatedScreens: ['game-scheduled'],
    },
    'game-scheduled': {
      screenTitle: 'Game — Pre-Game',
      overview: 'Pre-game screen.',
      tasks: [{ title: 'Mark availability', steps: ['Tap a player.'] }],
      tips: [{ text: 'Set availability before kick-off.' }],
      relatedScreens: undefined,
    },
    'game-in-progress': {
      screenTitle: 'Game — In Progress',
      overview: 'Live game screen.',
      tasks: [{ title: 'Make a substitution', steps: ['Tap lineup.'] }],
      tips: [{ text: 'Pause timer during stoppages.' }],
    },
    'game-halftime': {
      screenTitle: 'Game — Halftime',
      overview: 'Halftime screen.',
      tasks: [{ title: 'Adjust lineup', steps: ['Tap a position.'] }],
      tips: [{ text: 'Changes do not affect first-half records.' }],
    },
    'game-completed': {
      screenTitle: 'Game — Completed',
      overview: 'Completed game screen.',
      tasks: [{ title: 'View play time', steps: ['Check the summary.'] }],
      tips: [{ text: 'Data feeds Season Report.' }],
    },
    'game-planner': {
      screenTitle: 'Game Planner',
      overview: 'Plan rotations.',
      tasks: [{ title: 'Set lineup', steps: ['Drag players.'] }],
      tips: [{ text: 'Rotation interval controls swap frequency.' }],
    },
    'season-reports': {
      screenTitle: 'Season Reports',
      overview: 'Season stats.',
      tasks: [{ title: 'Read stats', steps: ['Find the row.'] }],
      tips: [{ text: 'Only completed games are included.' }],
    },
    'manage-teams': {
      screenTitle: 'Management — Teams',
      overview: 'Manage teams.',
      tasks: [{ title: 'Add team', steps: ['Tap add.'] }],
      tips: [{ text: 'Half length affects planner.' }],
    },
    'manage-players': {
      screenTitle: 'Management — Players',
      overview: 'Manage players.',
      tasks: [{ title: 'Add player', steps: ['Tap add.'] }],
      tips: [{ text: 'Jersey numbers sort players.' }],
    },
    'manage-formations': {
      screenTitle: 'Management — Formations',
      overview: 'Manage formations.',
      tasks: [{ title: 'Add formation', steps: ['Tap add.'] }],
      tips: [{ text: 'Formations define positions.' }],
    },
    'manage-sharing': {
      screenTitle: 'Management — Sharing & Permissions',
      overview: 'Share teams.',
      tasks: [{ title: 'Invite coach', steps: ['Tap invite.'] }],
      tips: [{ text: 'Invitations expire after 7 days.' }],
    },
    'manage-app': {
      screenTitle: 'Management — App Settings',
      overview: 'App settings.',
      tasks: [{ title: 'View version', steps: ['Check bottom.'] }],
      tips: [{ text: 'Settings affect all teams.' }],
    },
    'profile': {
      screenTitle: 'Profile',
      overview: 'Manage account.',
      tasks: [{ title: 'Sign out', steps: ['Tap Sign Out.'] }],
      tips: [{ text: 'Invitations appear here.' }],
    },
  },
}));

import { HelpModal } from './HelpModal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderHelpModal({
  helpContext = 'home' as const,
  onClose = vi.fn(),
  onNavigate = undefined as ((key: string) => void) | undefined,
} = {}) {
  return render(
    <HelpModal
      helpContext={helpContext as any}
      onClose={onClose}
      onNavigate={onNavigate as any}
    />
  );
}

describe('HelpModal — rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the screenTitle as the modal heading', () => {
    renderHelpModal({ helpContext: 'home' as any });
    expect(screen.getByRole('heading', { level: 2, name: 'Games List' })).toBeInTheDocument();
  });

  it('renders the overview text', () => {
    renderHelpModal({ helpContext: 'home' as any });
    expect(screen.getByText('This is the home screen.')).toBeInTheDocument();
  });

  it('renders the task title', () => {
    renderHelpModal({ helpContext: 'home' as any });
    expect(screen.getByText('Schedule a game')).toBeInTheDocument();
  });

  it('renders task steps', () => {
    renderHelpModal({ helpContext: 'home' as any });
    expect(screen.getByText('Tap the button.')).toBeInTheDocument();
    expect(screen.getByText('Fill the form.')).toBeInTheDocument();
  });

  it('renders tip text', () => {
    renderHelpModal({ helpContext: 'home' as any });
    expect(screen.getByText('Active games appear first.')).toBeInTheDocument();
  });

  it('renders a related screen pill button', () => {
    renderHelpModal({ helpContext: 'home' as any });
    // Related screen key 'game-scheduled' → screenTitle 'Game — Pre-Game'
    expect(screen.getByRole('button', { name: 'Game — Pre-Game' })).toBeInTheDocument();
  });

  it('does not render "You might also need" when relatedScreens is undefined', () => {
    renderHelpModal({ helpContext: 'game-scheduled' as any });
    expect(screen.queryByText('You might also need')).not.toBeInTheDocument();
  });

  it('renders the "How to…" section heading', () => {
    renderHelpModal({ helpContext: 'home' as any });
    expect(screen.getByText('How to…')).toBeInTheDocument();
  });

  it('renders the "Tips" section heading', () => {
    renderHelpModal({ helpContext: 'home' as any });
    expect(screen.getByText('Tips')).toBeInTheDocument();
  });
});

describe('HelpModal — accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has role="dialog"', () => {
    renderHelpModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('has aria-modal="true"', () => {
    renderHelpModal();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('has aria-labelledby="help-modal-title" on the dialog', () => {
    renderHelpModal();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', 'help-modal-title');
  });

  it('h2 has id="help-modal-title"', () => {
    renderHelpModal();
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveAttribute('id', 'help-modal-title');
  });

  it('h2 has tabIndex={-1}', () => {
    renderHelpModal();
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveAttribute('tabindex', '-1');
  });

  it('moves focus to the heading on mount', () => {
    renderHelpModal();
    const heading = screen.getByRole('heading', { level: 2 });
    expect(document.activeElement).toBe(heading);
  });
});

describe('HelpModal — close behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls onClose when the close button (✕) is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderHelpModal({ onClose });
    await user.click(screen.getByRole('button', { name: 'Close help' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = renderHelpModal({ onClose });
    // The overlay is the first child of the container
    const overlay = container.firstChild as HTMLElement;
    await user.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onClose when the modal card itself is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderHelpModal({ onClose });
    await user.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderHelpModal({ onClose });
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('HelpModal — related screens navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls onNavigate with the related key when a pill is clicked and onNavigate is provided', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    renderHelpModal({ helpContext: 'home' as any, onClose, onNavigate });
    await user.click(screen.getByRole('button', { name: 'Game — Pre-Game' }));
    expect(onNavigate).toHaveBeenCalledWith('game-scheduled');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose (not onNavigate) when a pill is clicked and onNavigate is NOT provided', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderHelpModal({ helpContext: 'home' as any, onClose, onNavigate: undefined });
    await user.click(screen.getByRole('button', { name: 'Game — Pre-Game' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('HelpModal — defensive fallback', () => {
  it('renders fallback message when content is missing for a key', () => {
    // Pass a key that is not present in the mock HELP_CONTENT object.
    // HELP_CONTENT['unknown-key'] → undefined → triggers the defensive fallback branch.
    const onClose = vi.fn();
    render(
      <HelpModal
        helpContext={'unknown-key' as any}
        onClose={onClose}
      />
    );
    expect(screen.getByText('Help content is not available for this screen yet.')).toBeInTheDocument();
  });
});

describe('HelpModal — focus restoration', () => {
  it('restores focus to the previously focused element on unmount', () => {
    // Create a button outside the modal and focus it
    const triggerButton = document.createElement('button');
    triggerButton.setAttribute('data-testid', 'trigger');
    document.body.appendChild(triggerButton);
    triggerButton.focus();
    expect(document.activeElement).toBe(triggerButton);

    const onClose = vi.fn();
    const { unmount } = renderHelpModal({ onClose });

    // After unmount, focus should return to the trigger button
    unmount();
    expect(document.activeElement).toBe(triggerButton);

    document.body.removeChild(triggerButton);
  });
});
