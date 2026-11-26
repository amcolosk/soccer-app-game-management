import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { UIVersionProvider, useUIVersion } from './UIVersionContext';

function Consumer() {
  const { version, setVersion } = useUIVersion();
  return (
    <div>
      <div data-testid="version">{version}</div>
      <button onClick={() => setVersion('classic')}>classic</button>
      <button onClick={() => setVersion('new')}>new</button>
    </div>
  );
}

describe('UIVersionProvider', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to the "new" stored default when nothing is stored', () => {
    render(<UIVersionProvider><Consumer /></UIVersionProvider>);
    expect(screen.getByTestId('version').textContent).toBe('new');
  });

  it('persists an explicit choice to localStorage and restores it on next mount', () => {
    const { unmount } = render(<UIVersionProvider><Consumer /></UIVersionProvider>);

    act(() => {
      screen.getByText('classic').click();
    });

    expect(screen.getByTestId('version').textContent).toBe('classic');
    expect(localStorage.getItem('teamtrack-ui-version')).toBe('classic');
    unmount();

    render(<UIVersionProvider><Consumer /></UIVersionProvider>);
    expect(screen.getByTestId('version').textContent).toBe('classic');
  });

  it('falls back to "classic" (not a throw) when used outside a provider', () => {
    function Bare() {
      const { version } = useUIVersion();
      return <div data-testid="bare">{version}</div>;
    }
    render(<Bare />);
    expect(screen.getByTestId('bare').textContent).toBe('classic');
  });
});
