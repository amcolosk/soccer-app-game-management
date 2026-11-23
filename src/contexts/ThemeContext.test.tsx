import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeContext';

function Consumer() {
  const { mode, resolvedTheme, setMode } = useTheme();
  return (
    <div>
      <div data-testid="mode">{mode}</div>
      <div data-testid="resolved">{resolvedTheme}</div>
      <button onClick={() => setMode('dark')}>dark</button>
      <button onClick={() => setMode('light')}>light</button>
      <button onClick={() => setMode('system')}>system</button>
    </div>
  );
}

function mockMatchMedia(prefersDark: boolean) {
  const listeners: Array<(e: MediaQueryListEvent) => void> = [];
  const mql = {
    matches: prefersDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.push(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql));
  return {
    fireChange: (matches: boolean) => {
      mql.matches = matches;
      listeners.forEach((cb) => cb({ matches } as MediaQueryListEvent));
    },
  };
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.head.innerHTML = '<meta name="theme-color" content="#1a472a" />';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to system preference when nothing is stored', () => {
    mockMatchMedia(true);
    render(<ThemeProvider><Consumer /></ThemeProvider>);
    expect(screen.getByTestId('mode').textContent).toBe('system');
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('resolves to light when system prefers light and mode is system', () => {
    mockMatchMedia(false);
    render(<ThemeProvider><Consumer /></ThemeProvider>);
    expect(screen.getByTestId('resolved').textContent).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('persists an explicit choice to localStorage and restores it on next mount', () => {
    mockMatchMedia(false);
    const { unmount } = render(<ThemeProvider><Consumer /></ThemeProvider>);

    act(() => {
      screen.getByText('dark').click();
    });

    expect(screen.getByTestId('mode').textContent).toBe('dark');
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    expect(localStorage.getItem('teamtrack-theme')).toBe('dark');
    unmount();

    render(<ThemeProvider><Consumer /></ThemeProvider>);
    expect(screen.getByTestId('mode').textContent).toBe('dark');
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
  });

  it('updates the data-theme attribute and meta theme-color when the theme changes', () => {
    mockMatchMedia(false);
    render(<ThemeProvider><Consumer /></ThemeProvider>);

    act(() => {
      screen.getByText('dark').click();
    });

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    const meta = document.querySelector('meta[name="theme-color"]');
    expect(meta?.getAttribute('content')).toBe('#0f1117');

    act(() => {
      screen.getByText('light').click();
    });

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(meta?.getAttribute('content')).toBe('#1a472a');
  });

  it('tracks a live OS theme change while mode is system', () => {
    const { fireChange } = mockMatchMedia(false);
    render(<ThemeProvider><Consumer /></ThemeProvider>);
    expect(screen.getByTestId('resolved').textContent).toBe('light');

    act(() => {
      fireChange(true);
    });

    expect(screen.getByTestId('resolved').textContent).toBe('dark');
  });

  it('falls back to the light theme (not a throw) when used outside a provider', () => {
    function Bare() {
      const { mode, resolvedTheme } = useTheme();
      return <div data-testid="bare">{mode}:{resolvedTheme}</div>;
    }
    render(<Bare />);
    expect(screen.getByTestId('bare').textContent).toBe('light:light');
  });
});
