/**
 * Tests for OnboardingContext.
 *
 * Behaviours covered:
 *  - Initial state reads from localStorage on mount
 *  - markWelcomed() sets welcomed=true and writes 'onboarding:welcomed'='1'
 *  - collapse() sets collapsed=true and writes 'onboarding:collapsed'='1'
 *  - expand() sets collapsed=false and removes 'onboarding:collapsed'
 *  - dismiss() sets dismissed=true, clears collapsed, writes 'onboarding:dismissed'='1'
 *  - resetOnboarding() clears all three flags from state and localStorage
 *  - useOnboarding() throws when used outside the provider
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { OnboardingProvider, useOnboarding } from './OnboardingContext';

// ---------------------------------------------------------------------------
// Test harness component — exposes all context actions as buttons
// ---------------------------------------------------------------------------
function Harness() {
  const { welcomed, collapsed, dismissed, markWelcomed, collapse, expand, dismiss, resetOnboarding } = useOnboarding();
  return (
    <div>
      <span data-testid="welcomed">{String(welcomed)}</span>
      <span data-testid="collapsed">{String(collapsed)}</span>
      <span data-testid="dismissed">{String(dismissed)}</span>
      <button onClick={markWelcomed}>markWelcomed</button>
      <button onClick={collapse}>collapse</button>
      <button onClick={expand}>expand</button>
      <button onClick={dismiss}>dismiss</button>
      <button onClick={resetOnboarding}>reset</button>
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

  it('reads welcomed=true when onboarding:welcomed=1 is already set', () => {
    localStorage.setItem('onboarding:welcomed', '1');
    renderWithProvider();
    expect(welcomed()).toBe('true');
  });

  it('reads collapsed=true when onboarding:collapsed=1 is already set', () => {
    localStorage.setItem('onboarding:collapsed', '1');
    renderWithProvider();
    expect(collapsed()).toBe('true');
  });

  it('reads dismissed=true when onboarding:dismissed=1 is already set', () => {
    localStorage.setItem('onboarding:dismissed', '1');
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

  it("writes '1' to localStorage key 'onboarding:welcomed'", async () => {
    renderWithProvider();
    await userEvent.click(screen.getByText('markWelcomed'));
    expect(localStorage.getItem('onboarding:welcomed')).toBe('1');
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

  it("writes '1' to 'onboarding:dismissed' and removes 'onboarding:collapsed'", async () => {
    renderWithProvider();
    await userEvent.click(screen.getByText('dismiss'));
    expect(localStorage.getItem('onboarding:dismissed')).toBe('1');
    expect(localStorage.getItem('onboarding:collapsed')).toBeNull();
  });
});

describe('OnboardingContext — resetOnboarding()', () => {
  beforeEach(() => {
    localStorage.setItem('onboarding:welcomed', '1');
    localStorage.setItem('onboarding:collapsed', '1');
    localStorage.setItem('onboarding:dismissed', '1');
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
    expect(localStorage.getItem('onboarding:welcomed')).toBeNull();
    expect(localStorage.getItem('onboarding:collapsed')).toBeNull();
    expect(localStorage.getItem('onboarding:dismissed')).toBeNull();
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
