/**
 * Tests for OnboardingContext.
 *
 * Behaviours covered:
 *  - Initial state reads from localStorage on mount
 *  - markWelcomed() sets welcomed=true and writes 'welcomeModalDismissed'='1'
 *  - collapse() sets collapsed=true and writes 'onboarding:collapsed'='1'
 *  - expand() sets collapsed=false and removes 'onboarding:collapsed'
 *  - dismiss() sets dismissed=true, clears collapsed, writes 'quickStartChecklistDismissed'='1'
 *  - clearDismissed() clears only dismissed flag from state/localStorage
 *  - resetOnboarding() clears all three flags from state and localStorage
 *  - useOnboarding() throws when used outside the provider
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { OnboardingProvider, useOnboarding, useOnboardingOptional } from './OnboardingContext';

// ---------------------------------------------------------------------------
// Test harness component — exposes all context actions as buttons
// ---------------------------------------------------------------------------
function Harness() {
  const { welcomed, collapsed, dismissed, signals, markWelcomed, collapse, expand, dismiss, clearDismissed, resetOnboarding, setSignals, patchSignals } = useOnboarding();
  // Tracks how many times this component has rendered with a *new* signals
  // array reference, to catch an unconditional-set-inside-effect loop.
  const renderCountRef = React.useRef(0);
  renderCountRef.current += 1;

  return (
    <div>
      <span data-testid="welcomed">{String(welcomed)}</span>
      <span data-testid="collapsed">{String(collapsed)}</span>
      <span data-testid="dismissed">{String(dismissed)}</span>
      <span data-testid="signals">{signals ? JSON.stringify(signals) : 'null'}</span>
      <span data-testid="render-count">{renderCountRef.current}</span>
      <button onClick={markWelcomed}>markWelcomed</button>
      <button onClick={collapse}>collapse</button>
      <button onClick={expand}>expand</button>
      <button onClick={dismiss}>dismiss</button>
      <button onClick={clearDismissed}>clearDismissed</button>
      <button onClick={resetOnboarding}>reset</button>
      <button onClick={() => setSignals([true, false, false, false, false, false, false])}>
        setSignalsA
      </button>
      <button onClick={() => setSignals([true, false, false, false, false, false, false])}>
        setSignalsASame
      </button>
      <button onClick={() => setSignals([true, true, false, false, false, false, false])}>
        setSignalsB
      </button>
      <button onClick={() => patchSignals([2, 3], [true, true])}>patchSignals</button>
    </div>
  );
}

/** Harness that mirrors how Home.tsx is both a producer and consumer of
 * `signals`: it unconditionally calls `setSignals` with the same array
 * value on every render, relying on the context's equality guard (not its
 * own) to avoid looping. */
function ProducerConsumerHarness() {
  const { signals, setSignals } = useOnboarding();
  const renderCountRef = React.useRef(0);
  renderCountRef.current += 1;

  React.useEffect(() => {
    setSignals([true, false, false, false, false, false, false]);
  });

  return (
    <div>
      <span data-testid="signals">{signals ? JSON.stringify(signals) : 'null'}</span>
      <span data-testid="render-count">{renderCountRef.current}</span>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <OnboardingProvider>
      <Harness />
    </OnboardingProvider>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const welcomed = () => screen.getByTestId('welcomed').textContent;
const collapsed = () => screen.getByTestId('collapsed').textContent;
const dismissed = () => screen.getByTestId('dismissed').textContent;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('OnboardingContext — initial state from localStorage', () => {
  beforeEach(() => localStorage.clear());

  it('starts with all flags false when localStorage is empty', () => {
    renderWithProvider();
    expect(welcomed()).toBe('false');
    expect(collapsed()).toBe('false');
    expect(dismissed()).toBe('false');
  });

  it('reads welcomed=true when welcomeModalDismissed=1 is already set', () => {
    localStorage.setItem('welcomeModalDismissed', '1');
    renderWithProvider();
    expect(welcomed()).toBe('true');
  });

  it('reads collapsed=true when onboarding:collapsed=1 is already set', () => {
    localStorage.setItem('onboarding:collapsed', '1');
    renderWithProvider();
    expect(collapsed()).toBe('true');
  });

  it('reads dismissed=true when quickStartChecklistDismissed=1 is already set', () => {
    localStorage.setItem('quickStartChecklistDismissed', '1');
    renderWithProvider();
    expect(dismissed()).toBe('true');
  });
});

describe('OnboardingContext — markWelcomed()', () => {
  beforeEach(() => localStorage.clear());

  it('sets welcomed state to true', async () => {
    renderWithProvider();
    await userEvent.click(screen.getByText('markWelcomed'));
    expect(welcomed()).toBe('true');
  });

  it("writes '1' to localStorage key 'welcomeModalDismissed'", async () => {
    renderWithProvider();
    await userEvent.click(screen.getByText('markWelcomed'));
    expect(localStorage.getItem('welcomeModalDismissed')).toBe('1');
  });
});

describe('OnboardingContext — collapse()', () => {
  beforeEach(() => localStorage.clear());

  it('sets collapsed state to true', async () => {
    renderWithProvider();
    await userEvent.click(screen.getByText('collapse'));
    expect(collapsed()).toBe('true');
  });

  it("writes '1' to localStorage key 'onboarding:collapsed'", async () => {
    renderWithProvider();
    await userEvent.click(screen.getByText('collapse'));
    expect(localStorage.getItem('onboarding:collapsed')).toBe('1');
  });
});

describe('OnboardingContext — expand()', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('onboarding:collapsed', '1');
  });

  it('sets collapsed state to false', async () => {
    renderWithProvider();
    // starts collapsed=true due to localStorage seed
    expect(collapsed()).toBe('true');
    await userEvent.click(screen.getByText('expand'));
    expect(collapsed()).toBe('false');
  });

  it("removes 'onboarding:collapsed' from localStorage", async () => {
    renderWithProvider();
    await userEvent.click(screen.getByText('expand'));
    expect(localStorage.getItem('onboarding:collapsed')).toBeNull();
  });
});

describe('OnboardingContext — dismiss()', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('onboarding:collapsed', '1');
  });

  it('sets dismissed state to true', async () => {
    renderWithProvider();
    await userEvent.click(screen.getByText('dismiss'));
    expect(dismissed()).toBe('true');
  });

  it('also clears collapsed state', async () => {
    renderWithProvider();
    expect(collapsed()).toBe('true'); // pre-condition
    await userEvent.click(screen.getByText('dismiss'));
    expect(collapsed()).toBe('false');
  });

  it("writes '1' to 'quickStartChecklistDismissed' and removes 'onboarding:collapsed'", async () => {
    renderWithProvider();
    await userEvent.click(screen.getByText('dismiss'));
    expect(localStorage.getItem('quickStartChecklistDismissed')).toBe('1');
    expect(localStorage.getItem('onboarding:collapsed')).toBeNull();
  });
});

describe('OnboardingContext — resetOnboarding()', () => {
  beforeEach(() => {
    localStorage.setItem('welcomeModalDismissed', '1');
    localStorage.setItem('onboarding:collapsed', '1');
    localStorage.setItem('quickStartChecklistDismissed', '1');
  });

  it('clears all three state flags', async () => {
    renderWithProvider();
    await userEvent.click(screen.getByText('reset'));
    expect(welcomed()).toBe('false');
    expect(collapsed()).toBe('false');
    expect(dismissed()).toBe('false');
  });

  it('removes all three localStorage keys', async () => {
    renderWithProvider();
    await userEvent.click(screen.getByText('reset'));
    expect(localStorage.getItem('welcomeModalDismissed')).toBeNull();
    expect(localStorage.getItem('onboarding:collapsed')).toBeNull();
    expect(localStorage.getItem('quickStartChecklistDismissed')).toBeNull();
  });
});

describe('OnboardingContext — clearDismissed()', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('quickStartChecklistDismissed', '1');
    localStorage.setItem('onboarding:dismissed', '1');
  });

  it('clears dismissed state only', async () => {
    renderWithProvider();
    expect(dismissed()).toBe('true');

    await userEvent.click(screen.getByText('clearDismissed'));

    expect(dismissed()).toBe('false');
    expect(welcomed()).toBe('false');
    expect(collapsed()).toBe('false');
  });

  it('removes dismissal keys from localStorage', async () => {
    renderWithProvider();

    await userEvent.click(screen.getByText('clearDismissed'));

    expect(localStorage.getItem('quickStartChecklistDismissed')).toBeNull();
    expect(localStorage.getItem('onboarding:dismissed')).toBeNull();
  });
});

describe('OnboardingContext — signals / setSignals()', () => {
  beforeEach(() => localStorage.clear());

  it('starts with signals=null (no baseline)', () => {
    renderWithProvider();
    expect(screen.getByTestId('signals').textContent).toBe('null');
  });

  it('setSignals() sets the full 7-item array', async () => {
    renderWithProvider();
    await userEvent.click(screen.getByText('setSignalsA'));
    expect(screen.getByTestId('signals').textContent).toBe(
      JSON.stringify([true, false, false, false, false, false, false])
    );
  });

  it('resetOnboarding() clears signals back to null', async () => {
    renderWithProvider();
    await userEvent.click(screen.getByText('setSignalsA'));
    expect(screen.getByTestId('signals').textContent).not.toBe('null');

    await userEvent.click(screen.getByText('reset'));
    expect(screen.getByTestId('signals').textContent).toBe('null');
  });

  it('setSignals() with an unchanged-value array does not trigger a re-render', async () => {
    renderWithProvider();
    await userEvent.click(screen.getByText('setSignalsA'));
    const countAfterFirstSet = Number(screen.getByTestId('render-count').textContent);

    // Same values (new array reference) — the equality guard should skip
    // the state update entirely, so no re-render happens.
    await userEvent.click(screen.getByText('setSignalsASame'));
    expect(Number(screen.getByTestId('render-count').textContent)).toBe(countAfterFirstSet);
  });

  it('setSignals() with a genuinely different array does trigger a re-render', async () => {
    renderWithProvider();
    await userEvent.click(screen.getByText('setSignalsA'));
    const countAfterFirstSet = Number(screen.getByTestId('render-count').textContent);

    await userEvent.click(screen.getByText('setSignalsB'));
    expect(Number(screen.getByTestId('render-count').textContent)).toBeGreaterThan(countAfterFirstSet);
    expect(screen.getByTestId('signals').textContent).toBe(
      JSON.stringify([true, true, false, false, false, false, false])
    );
  });

  it('a Home-like producer/consumer that calls setSignals unconditionally on every render does not loop', async () => {
    render(
      <OnboardingProvider>
        <ProducerConsumerHarness />
      </OnboardingProvider>
    );

    // Allow any effect-triggered re-renders to settle.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.getByTestId('signals').textContent).toBe(
      JSON.stringify([true, false, false, false, false, false, false])
    );
    // Exactly one extra render from the initial-mount effect setting
    // signals for the first time; the equality guard must prevent any
    // further renders from the same effect re-running with identical values.
    expect(Number(screen.getByTestId('render-count').textContent)).toBeLessThanOrEqual(2);
  });
});

describe('OnboardingContext — patchSignals()', () => {
  beforeEach(() => localStorage.clear());

  it('no-ops (stays null) when there is no baseline yet', async () => {
    renderWithProvider();
    await userEvent.click(screen.getByText('patchSignals'));
    expect(screen.getByTestId('signals').textContent).toBe('null');
  });

  it('merges only the given indices on top of an existing baseline, leaving other indices untouched', async () => {
    renderWithProvider();
    await userEvent.click(screen.getByText('setSignalsA')); // [true, false, false, false, false, false, false]
    await userEvent.click(screen.getByText('patchSignals')); // sets indices 2,3 -> true,true

    expect(screen.getByTestId('signals').textContent).toBe(
      JSON.stringify([true, false, true, true, false, false, false])
    );
  });
});

describe('OnboardingContext — useOnboarding() guard', () => {
  it('throws when used outside OnboardingProvider', () => {
    // Suppress the React error boundary console output
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Harness />)).toThrow(
      'useOnboarding must be used within an OnboardingProvider'
    );
    spy.mockRestore();
  });
});

function OptionalHarness() {
  const ctx = useOnboardingOptional();
  return <span data-testid="optional-ctx">{ctx ? 'present' : 'null'}</span>;
}

describe('OnboardingContext — useOnboardingOptional()', () => {
  it('returns null (does not throw) outside an OnboardingProvider', () => {
    render(<OptionalHarness />);
    expect(screen.getByTestId('optional-ctx').textContent).toBe('null');
  });

  it('returns the context value inside an OnboardingProvider', () => {
    render(
      <OnboardingProvider>
        <OptionalHarness />
      </OnboardingProvider>
    );
    expect(screen.getByTestId('optional-ctx').textContent).toBe('present');
  });
});
