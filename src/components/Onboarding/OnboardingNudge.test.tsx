/**
 * Tests for OnboardingNudge.
 *
 * Behaviours covered:
 *  - Renders nothing when version='classic' (even with a baseline present)
 *  - Renders nothing when there is no signals baseline in context
 *  - Renders nothing when onboarding is fully complete
 *  - Renders "Next: {title} ->" for the first incomplete signal, in version='new'
 *  - Clicking the link navigates to that step's route
 *  - Dismiss button hides the banner
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { OnboardingNudge } from './OnboardingNudge';
import { OnboardingProvider, useOnboarding } from '../../contexts/OnboardingContext';
import { UIVersionProvider, useUIVersion } from '../../contexts/UIVersionContext';

const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

/** Seeds the onboarding baseline/version before children render. */
function Harness({ signals, version }: { signals: boolean[] | null; version: 'classic' | 'new' }) {
  const { setSignals } = useOnboarding();
  const { setVersion } = useUIVersion();

  React.useEffect(() => {
    setVersion(version);
    if (signals) {
      setSignals(signals);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <OnboardingNudge />;
}

function renderNudge(signals: boolean[] | null, version: 'classic' | 'new' = 'new') {
  return render(
    <UIVersionProvider>
      <OnboardingProvider>
        <Harness signals={signals} version={version} />
      </OnboardingProvider>
    </UIVersionProvider>
  );
}

const allIncomplete = [false, false, false, false, false, false, false];
const firstThreeComplete = [true, true, true, false, false, false, false];
const allComplete = [true, true, true, true, true, true, true];

beforeEach(() => {
  mockNavigate.mockClear();
});

describe('OnboardingNudge — gating', () => {
  it('renders nothing when version is classic, even with a baseline', () => {
    renderNudge(allIncomplete, 'classic');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders nothing when there is no baseline (cold load) in version new', () => {
    renderNudge(null, 'new');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders nothing when onboarding is fully complete', () => {
    renderNudge(allComplete, 'new');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders nothing outside any OnboardingProvider', () => {
    render(
      <UIVersionProvider>
        <OnboardingNudge />
      </UIVersionProvider>
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('OnboardingNudge — content and navigation', () => {
  it('shows "Next: {title} ->" for the first incomplete step', () => {
    renderNudge(allIncomplete, 'new');
    expect(screen.getByText(/next: create your team/i)).toBeInTheDocument();
  });

  it('advances to the next incomplete step once earlier ones are complete', () => {
    renderNudge(firstThreeComplete, 'new');
    expect(screen.getByText(/next: set your formation/i)).toBeInTheDocument();
  });

  it('navigates to the step\'s route when the link is clicked', async () => {
    renderNudge(allIncomplete, 'new');
    await userEvent.click(screen.getByText(/next: create your team/i));
    expect(mockNavigate).toHaveBeenCalledWith('/manage?section=teams');
  });
});

describe('OnboardingNudge — dismiss', () => {
  it('hides the banner after the dismiss button is clicked', async () => {
    renderNudge(allIncomplete, 'new');
    expect(screen.getByRole('status')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('OnboardingNudge — controlled dismiss (dismissed/onDismiss props)', () => {
  /** Same harness as renderNudge, but renders a controlled OnboardingNudge instead. */
  function ControlledHarness({
    signals,
    version,
    dismissed,
    onDismiss,
  }: {
    signals: boolean[] | null;
    version: 'classic' | 'new';
    dismissed: boolean;
    onDismiss: () => void;
  }) {
    const { setSignals } = useOnboarding();
    const { setVersion } = useUIVersion();

    React.useEffect(() => {
      setVersion(version);
      if (signals) {
        setSignals(signals);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return <OnboardingNudge dismissed={dismissed} onDismiss={onDismiss} />;
  }

  function renderControlled(dismissed: boolean, onDismiss: () => void) {
    return render(
      <UIVersionProvider>
        <OnboardingProvider>
          <ControlledHarness signals={allIncomplete} version="new" dismissed={dismissed} onDismiss={onDismiss} />
        </OnboardingProvider>
      </UIVersionProvider>
    );
  }

  it('calls onDismiss instead of managing dismissal internally when controlled', async () => {
    const onDismiss = vi.fn();
    renderControlled(false, onDismiss);

    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    // Controlled: parent hasn't flipped `dismissed` yet, so it's still visible.
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('stays hidden across a remount when the controlling parent keeps dismissed=true', () => {
    const onDismiss = vi.fn();
    const { rerender } = renderControlled(true, onDismiss);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    // Simulate a parent remount (e.g. UserProfile.tsx swapping render branches)
    // while the hoisted dismiss flag is still true — the banner must stay hidden.
    rerender(
      <UIVersionProvider>
        <OnboardingProvider>
          <ControlledHarness signals={allIncomplete} version="new" dismissed={true} onDismiss={onDismiss} />
        </OnboardingProvider>
      </UIVersionProvider>
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
