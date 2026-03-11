/**
 * Tests for QuickStartChecklist.
 *
 * Behaviours covered:
 *  Step completion logic (the core business rules):
 *    - step 1: teams.length >= 1
 *    - step 2: at least one TeamRoster whose teamId matches a team in the teams list
 *    - step 3: at least one team with a non-null, non-empty formationId
 *    - step 4: games.length >= 1
 *    - step 5: gamePlans.length >= 1
 *    - step 6: at least one game with status 'in-progress' or 'completed'
 *
 *  Progress bar & label
 *    - shows correct "N of 6 steps complete" count
 *    - progressbar aria-valuenow reflects completion count
 *
 *  Collapsed state
 *    - renders resume banner (not the full card) when collapsed=true and not all complete
 *    - resume banner includes correct step count
 *    - clicking the banner calls onExpand
 *
 *  Dismiss button
 *    - ✕ button calls onDismiss
 *    - fires QUICK_START_DISMISSED analytics
 *
 *  Step navigation
 *    - clicking an incomplete step calls onNavigate with the step's id
 *
 *  Demo data indicator
 *    - "🧪 Using demo data" indicator shown only when demoTeamId is non-null
 *
 *  Completion state
 *    - renders completion card (🎉) when all 6 steps are complete
 *    - auto-dismiss timer fires onDismiss after 4 seconds
 *    - "Done — remove demo data" shown when demoTeamId set + onRemoveDemoData provided
 *    - clicking "Done — remove demo data" calls onRemoveDemoData then onDismiss
 *    - "Keep demo data" shown alongside remove button; clicking it calls onDismiss
 *    - "Got it" shown (no demo) in completion card; clicking calls onDismiss
 *
 *  Analytics
 *    - ONBOARDING_STEP_COMPLETE fired when a step transitions from incomplete to complete
 *    - QUICK_START_OPENED fired when collapsed transitions from true → false
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const { mockTrackEvent } = vi.hoisted(() => ({ mockTrackEvent: vi.fn() }));

vi.mock('../../utils/analytics', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  AnalyticsEvents: {
    ONBOARDING_STEP_COMPLETE: { category: 'Onboarding', action: 'Step Complete' },
    QUICK_START_OPENED: { category: 'Onboarding', action: 'Quick Start Opened' },
    QUICK_START_DISMISSED: { category: 'Onboarding', action: 'Quick Start Dismissed' },
  },
}));

import { QuickStartChecklist } from './QuickStartChecklist';
import type React_ from 'react';

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------
const team1 = { id: 'team-1', formationId: null };
const team1WithFormation = { id: 'team-1', formationId: 'f-1' };
const roster1 = { teamId: 'team-1' };
const scheduledGame = { id: 'g-1', status: 'scheduled' };
const inProgressGame = { id: 'g-2', status: 'in-progress' };
const completedGame = { id: 'g-3', status: 'completed' };
const gamePlan1 = { id: 'gp-1' };

// ---------------------------------------------------------------------------
// Default props (all steps incomplete)
// ---------------------------------------------------------------------------
const defaultProps: React_.ComponentProps<typeof QuickStartChecklist> = {
  teams: [],
  games: [],
  teamRosters: [],
  gamePlans: [],
  collapsed: false,
  demoTeamId: null,
  onDismiss: vi.fn(),
  onExpand: vi.fn(),
  onNavigate: vi.fn(),
  onRemoveDemoData: undefined,
};

function renderChecklist(overrides: Partial<typeof defaultProps> = {}) {
  const props = { ...defaultProps, ...overrides, onDismiss: vi.fn(), onExpand: vi.fn(), onNavigate: vi.fn() };
  return { ...props, ...render(<QuickStartChecklist {...props} />) };
}

// ---------------------------------------------------------------------------
// Step completion logic
// ---------------------------------------------------------------------------
describe('QuickStartChecklist — step 1: Create your team', () => {
  beforeEach(() => mockTrackEvent.mockClear());

  it('shows step 1 as incomplete when teams=[]', () => {
    renderChecklist({ teams: [] });
    const step = screen.getByText('Create your team').closest('button');
    expect(step).toHaveAttribute('data-state', 'active');
  });

  it('shows step 1 as complete when teams has 1 entry', () => {
    renderChecklist({ teams: [team1] });
    const step = screen.getByText('Create your team').closest('button');
    expect(step).toHaveAttribute('data-state', 'completed');
  });
});

describe('QuickStartChecklist — step 2: Add players to your roster', () => {
  it('shows step 2 as incomplete when no roster entries match a team', () => {
    renderChecklist({ teams: [team1], teamRosters: [{ teamId: 'other-team' }] });
    const step = screen.getByText('Add players to your roster').closest('button');
    expect(step).toHaveAttribute('data-state', 'active');
  });

  it('shows step 2 as complete when a roster entry matches a team id', () => {
    renderChecklist({ teams: [team1], teamRosters: [roster1] });
    const step = screen.getByText('Add players to your roster').closest('button');
    expect(step).toHaveAttribute('data-state', 'completed');
  });
});

describe('QuickStartChecklist — step 3: Set your formation', () => {
  it('shows step 3 as incomplete when no team has a formationId', () => {
    renderChecklist({ teams: [team1] });
    const step = screen.getByText('Set your formation').closest('button');
    expect(step).toHaveAttribute('data-state', 'active');
  });

  it('shows step 3 as incomplete when formationId is empty string', () => {
    renderChecklist({ teams: [{ id: 'team-1', formationId: '' }] });
    const step = screen.getByText('Set your formation').closest('button');
    expect(step).toHaveAttribute('data-state', 'active');
  });

  it('shows step 3 as complete when at least one team has a non-empty formationId', () => {
    renderChecklist({ teams: [team1WithFormation] });
    const step = screen.getByText('Set your formation').closest('button');
    expect(step).toHaveAttribute('data-state', 'completed');
  });
});

describe('QuickStartChecklist — step 4: Schedule a game', () => {
  it('shows step 4 as incomplete when games=[]', () => {
    renderChecklist({ games: [] });
    const step = screen.getByText('Schedule a game').closest('button');
    expect(step).toHaveAttribute('data-state', 'active');
  });

  it('shows step 4 as complete when games has 1 entry', () => {
    renderChecklist({ games: [scheduledGame] });
    const step = screen.getByText('Schedule a game').closest('button');
    expect(step).toHaveAttribute('data-state', 'completed');
  });
});

describe('QuickStartChecklist — step 5: Plan your rotations', () => {
  it('shows step 5 as incomplete when gamePlans=[]', () => {
    renderChecklist({ gamePlans: [] });
    const step = screen.getByText('Plan your rotations').closest('button');
    expect(step).toHaveAttribute('data-state', 'active');
  });

  it('shows step 5 as complete when gamePlans has 1 entry', () => {
    renderChecklist({ gamePlans: [gamePlan1] });
    const step = screen.getByText('Plan your rotations').closest('button');
    expect(step).toHaveAttribute('data-state', 'completed');
  });
});

describe('QuickStartChecklist — step 6: Manage a live game', () => {
  it('shows step 6 as incomplete when no game is in-progress or completed', () => {
    renderChecklist({ games: [scheduledGame] });
    const step = screen.getByText('Manage a live game').closest('button');
    expect(step).toHaveAttribute('data-state', 'active');
  });

  it('shows step 6 as complete when a game has status=in-progress', () => {
    renderChecklist({ games: [inProgressGame] });
    const step = screen.getByText('Manage a live game').closest('button');
    expect(step).toHaveAttribute('data-state', 'completed');
  });

  it('shows step 6 as complete when a game has status=completed', () => {
    renderChecklist({ games: [completedGame] });
    const step = screen.getByText('Manage a live game').closest('button');
    expect(step).toHaveAttribute('data-state', 'completed');
  });
});

// ---------------------------------------------------------------------------
// Progress bar & label
// ---------------------------------------------------------------------------
describe('QuickStartChecklist — progress', () => {
  it('shows "0 of 6 steps complete" when no steps are done', () => {
    renderChecklist();
    expect(screen.getByText('0 of 6 steps complete')).toBeInTheDocument();
  });

  it('shows "3 of 6 steps complete" when 3 steps are complete', () => {
    renderChecklist({
      teams: [team1WithFormation],  // steps 1 + 3
      games: [scheduledGame],        // step 4
    });
    expect(screen.getByText('3 of 6 steps complete')).toBeInTheDocument();
  });

  it('progressbar aria-valuenow reflects the correct count', () => {
    renderChecklist({ teams: [team1] }); // step 1
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  });
});

// ---------------------------------------------------------------------------
// Collapsed state (resume banner)
// ---------------------------------------------------------------------------
describe('QuickStartChecklist — collapsed / resume banner', () => {
  it('shows the resume banner when collapsed=true and not all steps complete', () => {
    renderChecklist({ collapsed: true });
    expect(screen.getByText(/setup:.*of 6 complete/i)).toBeInTheDocument();
  });

  it('does NOT render the full checklist card when collapsed', () => {
    renderChecklist({ collapsed: true });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('resume banner shows the correct completed count', () => {
    renderChecklist({ collapsed: true, teams: [team1] }); // 1 step done
    expect(screen.getByText(/1 of 6 complete/i)).toBeInTheDocument();
  });

  it('clicking the resume banner calls onExpand', async () => {
    const { onExpand } = renderChecklist({ collapsed: true });
    await userEvent.click(screen.getByText(/setup:.*of 6 complete/i).closest('div')!);
    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Dismiss button
// ---------------------------------------------------------------------------
describe('QuickStartChecklist — dismiss', () => {
  beforeEach(() => mockTrackEvent.mockClear());

  it('calls onDismiss when ✕ is clicked', async () => {
    const { onDismiss } = renderChecklist();
    await userEvent.click(screen.getByRole('button', { name: /dismiss checklist/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('fires QUICK_START_DISMISSED analytics when ✕ is clicked', async () => {
    renderChecklist();
    await userEvent.click(screen.getByRole('button', { name: /dismiss checklist/i }));
    expect(mockTrackEvent).toHaveBeenCalledWith('Onboarding', 'Quick Start Dismissed');
  });
});

// ---------------------------------------------------------------------------
// Step navigation
// ---------------------------------------------------------------------------
describe('QuickStartChecklist — step navigation', () => {
  it('calls onNavigate(1) when step 1 is clicked', async () => {
    const { onNavigate } = renderChecklist();
    await userEvent.click(screen.getByText('Create your team').closest('button')!);
    expect(onNavigate).toHaveBeenCalledWith(1);
  });

  it('calls onNavigate(6) when step 6 is clicked', async () => {
    const { onNavigate } = renderChecklist();
    await userEvent.click(screen.getByText('Manage a live game').closest('button')!);
    expect(onNavigate).toHaveBeenCalledWith(6);
  });
});

// ---------------------------------------------------------------------------
// Demo data indicator
// ---------------------------------------------------------------------------
describe('QuickStartChecklist — demo data indicator', () => {
  it('shows "🧪 Using demo data" when demoTeamId is set', () => {
    renderChecklist({ demoTeamId: 'demo-123' });
    expect(screen.getByText(/using demo data/i)).toBeInTheDocument();
  });

  it('does NOT show demo indicator when demoTeamId is null', () => {
    renderChecklist({ demoTeamId: null });
    expect(screen.queryByText(/using demo data/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Completion state
// ---------------------------------------------------------------------------
const allCompleteProps = {
  teams: [team1WithFormation],
  teamRosters: [roster1],
  games: [completedGame],
  gamePlans: [gamePlan1],
};

describe('QuickStartChecklist — completion state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockTrackEvent.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('renders the completion card (🎉 "You\'re ready!") when all 6 steps complete', () => {
    renderChecklist(allCompleteProps);
    expect(screen.getByText("You're ready!")).toBeInTheDocument();
  });

  it('auto-dismisses after 4 seconds when all steps complete', async () => {
    const { onDismiss } = renderChecklist(allCompleteProps);
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(4000); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does NOT auto-dismiss before 4 seconds', () => {
    const { onDismiss } = renderChecklist(allCompleteProps);
    act(() => vi.advanceTimersByTime(3999));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('shows "Got it" button (no demo) in completion card; clicking calls onDismiss', async () => {
    vi.useRealTimers();
    const { onDismiss } = renderChecklist(allCompleteProps);
    await userEvent.click(screen.getByRole('button', { name: /got it/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows "Done — remove demo data" when demoTeamId + onRemoveDemoData provided', () => {
    renderChecklist({ ...allCompleteProps, demoTeamId: 'demo-1', onRemoveDemoData: vi.fn().mockResolvedValue(undefined) });
    expect(screen.getByRole('button', { name: /done — remove demo data/i })).toBeInTheDocument();
  });

  it('"Done — remove demo data" calls onRemoveDemoData then onDismiss', async () => {
    vi.useRealTimers();
    const onRemoveDemoData = vi.fn().mockResolvedValue(undefined);
    const { onDismiss } = renderChecklist({ ...allCompleteProps, demoTeamId: 'demo-1', onRemoveDemoData });
    await userEvent.click(screen.getByRole('button', { name: /done — remove demo data/i }));
    await waitFor(() => expect(onRemoveDemoData).toHaveBeenCalledTimes(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows "Keep demo data" alongside remove button; clicking calls onDismiss', async () => {
    vi.useRealTimers();
    const { onDismiss } = renderChecklist({
      ...allCompleteProps,
      demoTeamId: 'demo-1',
      onRemoveDemoData: vi.fn().mockResolvedValue(undefined),
    });
    await userEvent.click(screen.getByRole('button', { name: /keep demo data/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------
describe('QuickStartChecklist — analytics', () => {
  beforeEach(() => mockTrackEvent.mockClear());

  it('fires ONBOARDING_STEP_COMPLETE when step 1 transitions from incomplete to complete', () => {
    const { rerender } = renderChecklist({ teams: [] });
    expect(mockTrackEvent).not.toHaveBeenCalledWith('Onboarding', 'Step Complete', expect.anything());

    rerender(
      <QuickStartChecklist {...defaultProps} onDismiss={vi.fn()} onExpand={vi.fn()} onNavigate={vi.fn()} teams={[team1]} />
    );
    expect(mockTrackEvent).toHaveBeenCalledWith('Onboarding', 'Step Complete', 'Step 1: Create your team');
  });

  it('does NOT fire ONBOARDING_STEP_COMPLETE on initial render when a step is already complete', () => {
    renderChecklist({ teams: [team1] }); // step 1 complete from the start
    expect(mockTrackEvent).not.toHaveBeenCalledWith('Onboarding', 'Step Complete', expect.anything());
  });

  it('fires QUICK_START_OPENED when collapsed transitions from true to false', () => {
    const { rerender } = renderChecklist({ collapsed: true });
    expect(mockTrackEvent).not.toHaveBeenCalledWith('Onboarding', 'Quick Start Opened');

    rerender(
      <QuickStartChecklist {...defaultProps} onDismiss={vi.fn()} onExpand={vi.fn()} onNavigate={vi.fn()} collapsed={false} />
    );
    expect(mockTrackEvent).toHaveBeenCalledWith('Onboarding', 'Quick Start Opened');
  });

  it('does NOT fire QUICK_START_OPENED on initial render with collapsed=false', () => {
    renderChecklist({ collapsed: false });
    expect(mockTrackEvent).not.toHaveBeenCalledWith('Onboarding', 'Quick Start Opened');
  });
});
