import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { FanGameView } from './FanGameView';

const { mockGetFanGameView } = vi.hoisted(() => ({
  mockGetFanGameView: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ token: 'tok-1' }),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    queries: { getFanGameView: mockGetFanGameView },
  }),
}));

function result(data: Record<string, unknown> | null) {
  return { data, errors: [] };
}

function baseLiveData(overrides: Record<string, unknown> = {}) {
  return {
    state: 'LIVE',
    teamName: 'Eagles',
    opponentName: 'Lakeside FC',
    locationName: null,
    status: 'in-progress',
    currentHalf: 1,
    elapsedSeconds: 600,
    lastStartTime: null,
    halfLengthMinutes: 30,
    ourScore: 1,
    opponentScore: 0,
    gameDate: '2026-09-13T16:30:00.000Z',
    onFieldPlayers: [{ firstName: 'Sam', lastInitial: 'J.', positionName: 'Forward' }],
    recentEvents: [{ type: 'GOAL', playerName: 'Sam J.', minute: 5, half: 1 }],
    ...overrides,
  };
}

// Flushes pending microtasks (e.g. a resolved mock's `await`) without
// relying on RTL's findBy*/waitFor, which poll via setTimeout/setInterval —
// incompatible with fake timers unless manually advanced, which would
// deadlock an `await` that's already blocking on it.
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('FanGameView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the invalid-link state', async () => {
    mockGetFanGameView.mockResolvedValue(result({ state: 'INVALID_LINK' }));
    render(<FanGameView />);
    await flush();
    expect(screen.getByTestId('fan-state-invalid-link')).toBeInTheDocument();
  });

  it('renders the rate-limited state', async () => {
    mockGetFanGameView.mockResolvedValue(result({ state: 'RATE_LIMITED' }));
    render(<FanGameView />);
    await flush();
    expect(screen.getByTestId('fan-state-rate-limited')).toBeInTheDocument();
    expect(screen.getByText(/checking a bit too often/i)).toBeInTheDocument();
  });

  it('renders the no-games-yet state', async () => {
    mockGetFanGameView.mockResolvedValue(result({ state: 'NO_GAMES_YET', teamName: 'Eagles' }));
    render(<FanGameView />);
    await flush();
    expect(screen.getByTestId('fan-state-no-games-yet')).toBeInTheDocument();
    expect(screen.getByText(/no games yet/i)).toBeInTheDocument();
  });

  it('renders the no-game-right-now state, distinct from no-games-yet', async () => {
    mockGetFanGameView.mockResolvedValue(result({ state: 'NO_GAME_RIGHT_NOW', teamName: 'Eagles' }));
    render(<FanGameView />);
    await flush();
    expect(screen.getByTestId('fan-state-no-game-right-now')).toBeInTheDocument();
    expect(screen.getByText(/no game right now/i)).toBeInTheDocument();
  });

  it('renders the next-game state with the scheduled date', async () => {
    mockGetFanGameView.mockResolvedValue(result({
      state: 'NEXT_GAME',
      teamName: 'Eagles',
      opponentName: 'Riverside Rovers',
      gameDate: '2026-09-20T16:00:00.000Z',
    }));
    render(<FanGameView />);
    await flush();
    expect(screen.getByTestId('fan-state-next-game')).toBeInTheDocument();
    expect(screen.getByText(/riverside rovers/i)).toBeInTheDocument();
  });

  it('renders the finished-with-date state showing the final score and gameDate', async () => {
    mockGetFanGameView.mockResolvedValue(result({
      state: 'FINISHED',
      teamName: 'Eagles',
      opponentName: 'Lakeside FC',
      ourScore: 3,
      opponentScore: 2,
      gameDate: '2026-09-13T16:30:00.000Z',
      recentEvents: [],
    }));
    render(<FanGameView />);
    await flush();
    expect(screen.getByTestId('fan-state-finished')).toBeInTheDocument();
    expect(screen.getByText(/final/i)).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.className === 'fan-mode-score')).toHaveTextContent('3');
  });

  it('renders the live state with score, on-field lineup, and recent events', async () => {
    mockGetFanGameView.mockResolvedValue(result(baseLiveData()));
    render(<FanGameView />);
    await flush();

    expect(screen.getByTestId('fan-state-live')).toBeInTheDocument();
    expect(screen.getByText('On the Field')).toBeInTheDocument();
    expect(screen.getAllByText(/Sam J\./).length).toBeGreaterThan(0);
    expect(screen.getByText('Recent Events')).toBeInTheDocument();
  });

  it('renders a page-level h1 heading on the live state', async () => {
    mockGetFanGameView.mockResolvedValue(result(baseLiveData()));
    render(<FanGameView />);
    await flush();

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Eagles');
    expect(heading).toHaveTextContent('Lakeside FC');
  });

  it('shows a "Halftime" label instead of a half number when the game is at halftime', async () => {
    mockGetFanGameView.mockResolvedValue(result(baseLiveData({ status: 'halftime' })));
    render(<FanGameView />);
    await flush();

    expect(screen.getByText('Halftime')).toBeInTheDocument();
    expect(screen.queryByText('1st Half')).not.toBeInTheDocument();
  });

  it('calls getFanGameView with identityPool auth (guest access depends on this)', async () => {
    mockGetFanGameView.mockResolvedValue(result(baseLiveData()));
    render(<FanGameView />);
    await flush();

    expect(mockGetFanGameView).toHaveBeenCalledWith({ token: 'tok-1' }, { authMode: 'identityPool' });
  });

  it('keeps showing the last-known-good view (with a stale banner) when a later poll fails, instead of switching to invalid-link', async () => {
    mockGetFanGameView.mockResolvedValueOnce(result(baseLiveData()));
    render(<FanGameView />);
    await flush();
    expect(screen.getByTestId('fan-state-live')).toBeInTheDocument();

    mockGetFanGameView.mockRejectedValueOnce(new Error('network blip'));
    await act(async () => {
      vi.advanceTimersByTime(12000);
    });
    await flush();

    // Still the live view, not invalid-link -- a transient poll error after
    // a successful load must not discard the last-known-good data.
    expect(screen.getByTestId('fan-state-live')).toBeInTheDocument();
    expect(screen.queryByTestId('fan-state-invalid-link')).not.toBeInTheDocument();
    expect(screen.getByText(/having trouble refreshing/i)).toBeInTheDocument();
  });

  it('polls getFanGameView on the fixed interval', async () => {
    mockGetFanGameView.mockResolvedValue(result(baseLiveData()));
    render(<FanGameView />);
    await flush();

    expect(mockGetFanGameView).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(12000);
    });
    await flush();
    expect(mockGetFanGameView).toHaveBeenCalledTimes(2);
  });

  it('pauses polling while the page is hidden and re-polls immediately on resume', async () => {
    mockGetFanGameView.mockResolvedValue(result(baseLiveData()));
    render(<FanGameView />);
    await flush();
    expect(mockGetFanGameView).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();

    // While hidden, advancing well past the poll interval should NOT poll again.
    await act(async () => {
      vi.advanceTimersByTime(30000);
    });
    await flush();
    expect(mockGetFanGameView).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();

    expect(mockGetFanGameView).toHaveBeenCalledTimes(2);
  });

  it('advances the displayed clock locally on a 1-second tick while live', async () => {
    mockGetFanGameView.mockResolvedValue(result(baseLiveData({
      status: 'in-progress',
      elapsedSeconds: 600,
      lastStartTime: new Date().toISOString(),
    })));
    render(<FanGameView />);
    await flush();

    expect(screen.getByText(/10:0\d/)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    await flush();

    expect(screen.getByText(/10:0[5-9]/)).toBeInTheDocument();
  });
});
