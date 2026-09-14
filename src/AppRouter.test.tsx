import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppRouter } from './AppRouter';

// Regression guard for the bug an architect-review round caught: without a
// Suspense ancestor around the lazy-loaded AppRoot chunk, React throws "A
// component suspended while rendering, but no fallback UI was specified" on
// every cold load of the authenticated shell — i.e. for every existing user,
// on every first visit. This confirms the fallback actually renders during
// the lazy chunk load, not just that the final content eventually shows.
vi.mock('./AppRoot', () => ({
  default: () => <div>App Root Loaded</div>,
}));

vi.mock('./components/FanMode/FanGameView', () => ({
  FanGameView: () => <div>Fan Game View</div>,
}));

describe('AppRouter', () => {
  it('renders the Suspense "Loading..." fallback before the lazy AppRoot chunk resolves, then the real content', async () => {
    render(<AppRouter />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();

    expect(await screen.findByText('App Root Loaded')).toBeInTheDocument();
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });
});
