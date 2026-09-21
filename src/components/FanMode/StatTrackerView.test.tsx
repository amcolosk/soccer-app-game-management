import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { StatTrackerView } from './StatTrackerView';

const { mockGetStatTrackerView, mockSubmitStatEvent } = vi.hoisted(() => ({
  mockGetStatTrackerView: vi.fn(),
  mockSubmitStatEvent: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ token: 'tok-1' }),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    queries: { getStatTrackerView: mockGetStatTrackerView },
    mutations: { submitStatEvent: mockSubmitStatEvent },
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
    status: 'in-progress',
    currentHalf: 1,
    gameId: 'game-1',
    roster: [
      { id: 'p1', firstName: 'Sam', lastName: 'Jones', positionName: null },
      { id: 'p2', firstName: 'Ana', lastName: 'Cruz', positionName: null },
    ],
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('StatTrackerView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockSubmitStatEvent.mockResolvedValue(result({ ok: true, reason: null }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the invalid-link state', async () => {
    mockGetStatTrackerView.mockResolvedValue(result({ state: 'INVALID_LINK' }));
    render(<StatTrackerView />);
    await flush();
    expect(screen.getByTestId('tracker-state-invalid-link')).toBeInTheDocument();
  });

  it('renders the rate-limited state', async () => {
    mockGetStatTrackerView.mockResolvedValue(result({ state: 'RATE_LIMITED' }));
    render(<StatTrackerView />);
    await flush();
    expect(screen.getByTestId('tracker-state-rate-limited')).toBeInTheDocument();
  });

  it('renders a page-level h1 heading on the live state', async () => {
    mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
    render(<StatTrackerView />);
    await flush();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Eagles');
    expect(heading).toHaveTextContent('Lakeside FC');
  });

  it('shows the tap UI when status is in-progress', async () => {
    mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
    render(<StatTrackerView />);
    await flush();
    expect(screen.getByRole('button', { name: /Goal/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Shot/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save/ })).toBeInTheDocument();
  });

  it('hides the tap UI (game-not-in-progress gate) during halftime, even though state is LIVE', async () => {
    mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ status: 'halftime' })));
    render(<StatTrackerView />);
    await flush();
    expect(screen.getByTestId('tracker-not-in-progress')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Goal/ })).not.toBeInTheDocument();
  });

  it('calls getStatTrackerView with identityPool auth', async () => {
    mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
    render(<StatTrackerView />);
    await flush();
    expect(mockGetStatTrackerView).toHaveBeenCalledWith({ token: 'tok-1' }, { authMode: 'identityPool' });
  });

  it('polls on the fixed interval, pauses while hidden, and re-polls on resume', async () => {
    mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
    render(<StatTrackerView />);
    await flush();
    expect(mockGetStatTrackerView).toHaveBeenCalledTimes(1);

    await act(async () => { vi.advanceTimersByTime(12000); });
    await flush();
    expect(mockGetStatTrackerView).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await flush();

    await act(async () => { vi.advanceTimersByTime(30000); });
    await flush();
    expect(mockGetStatTrackerView).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await flush();
    expect(mockGetStatTrackerView).toHaveBeenCalledTimes(3);
  });

  describe('tap-to-submit flow', () => {
    it('Us Goal: side -> player -> assist -> submit, with expectedGameId echoed', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Goal/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Us' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Sam Jones' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'No assist' }));
      await flush();

      expect(mockSubmitStatEvent).toHaveBeenCalledWith(expect.objectContaining({
        token: 'tok-1',
        eventType: 'GOAL',
        forUs: true,
        playerId: 'p1',
        assistPlayerId: undefined,
        expectedGameId: 'game-1',
      }), { authMode: 'identityPool' });
    });

    it('Opponent Goal: side -> confirm submit, no player picker', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Goal/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Lakeside FC' }));
      await flush();
      expect(screen.queryByRole('button', { name: 'Sam Jones' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Log Goal/ }));
      await flush();

      expect(mockSubmitStatEvent).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'GOAL', forUs: false, playerId: undefined, assistPlayerId: undefined,
      }), { authMode: 'identityPool' });
    });

    it('Us Shot with no player selected (skip affordance) still requires an on-target step', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Shot/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Us' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: /Skip \/ unknown player/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'On target' }));
      await flush();

      expect(mockSubmitStatEvent).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'SHOT', forUs: true, playerId: undefined, onTarget: true,
      }), { authMode: 'identityPool' });
    });

    it('Opponent Shot: on-target step directly, no player picker', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Shot/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Lakeside FC' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Off target' }));
      await flush();

      expect(mockSubmitStatEvent).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'SHOT', forUs: false, onTarget: false,
      }), { authMode: 'identityPool' });
    });

    it('shows a "logged!" confirmation on success', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Save/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Us' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Sam Jones' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: /Log Save/ }));
      await flush();

      expect(screen.getByRole('status')).toHaveTextContent(/logged/i);
    });
  });

  describe('duplicate-tap guard', () => {
    it('a rapid double-tap on the confirm button produces one submission', async () => {
      let resolveSubmit: (value: unknown) => void = () => {};
      mockSubmitStatEvent.mockReturnValue(new Promise((resolve) => { resolveSubmit = resolve; }));

      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Save/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Lakeside FC' }));
      await flush();
      const confirmButton = screen.getByRole('button', { name: /Log Save/ });
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton); // second tap while the first is in flight
      await flush();

      expect(mockSubmitStatEvent).toHaveBeenCalledTimes(1);
      resolveSubmit(result({ ok: true, reason: null }));
      await flush();
    });

    it('on a genuine failure, re-enables the target and shows a visible inline error, WITHOUT a false-positive "logged!"', async () => {
      mockSubmitStatEvent.mockResolvedValue(result({ ok: false, reason: 'GAME_NOT_LIVE' }));
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Save/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Lakeside FC' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: /Log Save/ }));
      await flush();

      expect(screen.getByRole('alert')).toHaveTextContent(/no longer in progress/i);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      // Target re-enabled -- can retry.
      expect(screen.getByRole('button', { name: /Log Save/ })).not.toBeDisabled();
    });
  });

  describe('Save Auto-Goalkeeper Attribution', () => {
    it('Us Save with a known activeGoalkeeperId lands directly on the confirm-keeper step, and "Yes, log it" submits with that playerId', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ activeGoalkeeperId: 'p1' })));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Save/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Us' }));
      await flush();

      expect(screen.queryByRole('button', { name: 'Sam Jones' })).not.toBeInTheDocument();
      expect(screen.getByText('Sam Jones made the save?')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Yes, log it/ }));
      await flush();

      expect(mockSubmitStatEvent).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'SAVE', forUs: true, playerId: 'p1',
      }), { authMode: 'identityPool' });
    });

    it('"Not right? Pick another keeper" transitions to the full player picker, and choosing a different player submits that id', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ activeGoalkeeperId: 'p1' })));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Save/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Us' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: /Not right\? Pick another keeper/ }));
      await flush();

      expect(screen.getByText('Which keeper?')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Ana Cruz' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: /Log Save/ }));
      await flush();

      expect(mockSubmitStatEvent).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'SAVE', forUs: true, playerId: 'p2',
      }), { authMode: 'identityPool' });
    });

    it('activeGoalkeeperId absent/null -> unchanged existing behavior, full picker shown', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Save/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Us' }));
      await flush();

      expect(screen.getByText('Which keeper?')).toBeInTheDocument();
      expect(screen.queryByText(/made the save\?/)).not.toBeInTheDocument();
    });

    it('activeGoalkeeperId set to an id not present in roster -> falls back to the full picker', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ activeGoalkeeperId: 'not-on-roster' })));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Save/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Us' }));
      await flush();

      expect(screen.getByText('Which keeper?')).toBeInTheDocument();
      expect(screen.queryByText(/made the save\?/)).not.toBeInTheDocument();
    });

    it('Opponent-side Save flow is unaffected by activeGoalkeeperId being set (still side -> confirm, no player step)', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ activeGoalkeeperId: 'p1' })));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Save/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Lakeside FC' }));
      await flush();

      expect(screen.queryByText(/made the save\?/)).not.toBeInTheDocument();
      expect(screen.queryByText('Which keeper?')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Log Save/ }));
      await flush();

      expect(mockSubmitStatEvent).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'SAVE', forUs: false, playerId: undefined,
      }), { authMode: 'identityPool' });
    });

    it('GOAL and SHOT flows are unaffected by activeGoalkeeperId being set (only SAVE\'s Us path branches on it)', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ activeGoalkeeperId: 'p1' })));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Goal/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Us' }));
      await flush();
      expect(screen.getByText('Who scored?')).toBeInTheDocument();
      expect(screen.queryByText(/made the save\?/)).not.toBeInTheDocument();
    });

    it('a mid-step poll that changes the active keeper does not retroactively alter an open confirm-keeper flow (regression)', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ activeGoalkeeperId: 'p1' })));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Save/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Us' }));
      await flush();

      expect(screen.getByText('Sam Jones made the save?')).toBeInTheDocument();

      // Coach subs the keeper server-side; the next poll (before the helper
      // taps anything) now reports a different active goalkeeper.
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ activeGoalkeeperId: 'p2' })));
      await act(async () => { vi.advanceTimersByTime(12000); });
      await flush();

      // The already-open confirm step must keep showing the originally
      // frozen player, not silently swap to the newly-polled one.
      expect(screen.getByText('Sam Jones made the save?')).toBeInTheDocument();
      expect(screen.queryByText('Ana Cruz made the save?')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Yes, log it/ }));
      await flush();

      expect(mockSubmitStatEvent).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'SAVE', forUs: true, playerId: 'p1',
      }), { authMode: 'identityPool' });
    });

    it('a mid-step poll that makes the active keeper unresolvable does not empty out an open confirm-keeper flow (regression)', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ activeGoalkeeperId: 'p1' })));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Save/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Us' }));
      await flush();

      expect(screen.getByText('Sam Jones made the save?')).toBeInTheDocument();

      // Next poll clears the active goalkeeper entirely (e.g. sub-out with
      // no immediate replacement resolved server-side).
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ activeGoalkeeperId: null })));
      await act(async () => { vi.advanceTimersByTime(12000); });
      await flush();

      // The step must not collapse to a dead end (just heading + Cancel) --
      // it keeps showing the frozen confirm content with both actions.
      expect(screen.getByText('Sam Jones made the save?')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Yes, log it/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Not right\? Pick another keeper/ })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Yes, log it/ }));
      await flush();

      expect(mockSubmitStatEvent).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'SAVE', forUs: true, playerId: 'p1',
      }), { authMode: 'identityPool' });
    });
  });

  describe('mid-session revocation', () => {
    it('closes an in-flight tap flow and shows the invalid-link state when a later poll is revoked', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Goal/ }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      mockGetStatTrackerView.mockResolvedValue(result({ state: 'INVALID_LINK' }));
      await act(async () => { vi.advanceTimersByTime(12000); });
      await flush();

      expect(screen.getByTestId('tracker-state-invalid-link')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('scoreboard and game clock', () => {
    it('shows the current score and elapsed time during LIVE in-progress', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ ourScore: 2, opponentScore: 1, elapsedSeconds: 605 })));
      const { container } = render(<StatTrackerView />);
      await flush();

      expect(container.querySelector('.fan-mode-score__value')?.textContent).toContain('2');
      expect(container.querySelector('.fan-mode-score__value')?.textContent).toContain('1');
      expect(container.querySelector('.fan-mode-timer__value')?.textContent).toBe('10:05');
    });
  });

  describe('on-field lineup', () => {
    it('lists on-field players with their positions while in-progress, and excludes bench players', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({
        roster: [
          { id: 'p1', firstName: 'Sam', lastName: 'Jones', positionName: 'Forward' },
          { id: 'p2', firstName: 'Ana', lastName: 'Cruz', positionName: null },
        ],
      })));
      render(<StatTrackerView />);
      await flush();

      expect(screen.getByText('On the Field')).toBeInTheDocument();
      expect(screen.getByText('Sam Jones')).toBeInTheDocument();
      expect(screen.getByText('Forward')).toBeInTheDocument();
      expect(screen.queryByText('Ana Cruz')).not.toBeInTheDocument();
    });

    it('hides the on-field lineup section during halftime', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ status: 'halftime' })));
      render(<StatTrackerView />);
      await flush();

      expect(screen.queryByText('On the Field')).not.toBeInTheDocument();
    });
  });

  describe('player picker ordering (on-field before bench)', () => {
    it('shows on-field players before bench players, with group labels when both are present', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({
        roster: [
          { id: 'p1', firstName: 'Bench', lastName: 'One', positionName: null },
          { id: 'p2', firstName: 'Field', lastName: 'Two', positionName: 'Midfielder' },
        ],
      })));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Goal/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Us' }));
      await flush();

      expect(screen.getByText('On the field')).toBeInTheDocument();
      expect(screen.getByText('Bench')).toBeInTheDocument();
      const names = screen.getAllByRole('button').map((b) => b.textContent);
      const fieldIndex = names.indexOf('Field Two');
      const benchIndex = names.indexOf('Bench One');
      expect(fieldIndex).toBeGreaterThan(-1);
      expect(benchIndex).toBeGreaterThan(fieldIndex);
    });

    it('shows no group labels when the roster is entirely bench (e.g. game not in-progress)', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Goal/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Us' }));
      await flush();

      expect(screen.queryByText('On the field')).not.toBeInTheDocument();
      expect(screen.queryByText('Bench')).not.toBeInTheDocument();
    });
  });

  describe('halftime auto-resync', () => {
    it('polls faster while the tap UI is paused (halftime) than the normal in-progress cadence', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ status: 'halftime' })));
      render(<StatTrackerView />);
      await flush();
      expect(mockGetStatTrackerView).toHaveBeenCalledTimes(1);

      await act(async () => { vi.advanceTimersByTime(5000); });
      await flush();
      expect(mockGetStatTrackerView).toHaveBeenCalledTimes(2);
    });

    it('offers a manual "Refresh now" button while paused', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ status: 'halftime' })));
      render(<StatTrackerView />);
      await flush();
      expect(mockGetStatTrackerView).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: /Refresh now/ }));
      await flush();
      expect(mockGetStatTrackerView).toHaveBeenCalledTimes(2);
    });

    it('does not run the faster paused-poll while the tap UI is unlocked (in-progress)', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();
      expect(mockGetStatTrackerView).toHaveBeenCalledTimes(1);

      await act(async () => { vi.advanceTimersByTime(5000); });
      await flush();
      expect(mockGetStatTrackerView).toHaveBeenCalledTimes(1);
    });
  });

  describe('upcoming games', () => {
    it('shows a list of upcoming games on NO_GAMES_YET when the server provides one', async () => {
      mockGetStatTrackerView.mockResolvedValue(result({
        state: 'NO_GAMES_YET',
        teamName: 'Eagles',
        upcomingGames: [
          { opponentName: 'Riverside', gameDate: '2026-10-01T18:00:00.000Z', locationName: 'Home Field' },
        ],
      }));
      render(<StatTrackerView />);
      await flush();

      expect(screen.getByText(/vs Riverside/)).toBeInTheDocument();
    });

    it('falls back to the generic message on NO_GAMES_YET when no upcoming games are known', async () => {
      mockGetStatTrackerView.mockResolvedValue(result({ state: 'NO_GAMES_YET', teamName: 'Eagles', upcomingGames: [] }));
      render(<StatTrackerView />);
      await flush();

      expect(screen.getByText(/No games yet/)).toBeInTheDocument();
    });

    it('shows every upcoming game on NEXT_GAME rather than only the single next opponent', async () => {
      mockGetStatTrackerView.mockResolvedValue(result({
        state: 'NEXT_GAME',
        teamName: 'Eagles',
        opponentName: 'Lakeside FC',
        upcomingGames: [
          { opponentName: 'Lakeside FC', gameDate: '2026-10-01T18:00:00.000Z', locationName: null },
          { opponentName: 'Riverside', gameDate: '2026-10-08T18:00:00.000Z', locationName: null },
        ],
      }));
      render(<StatTrackerView />);
      await flush();

      expect(screen.getByText(/vs Lakeside FC/)).toBeInTheDocument();
      expect(screen.getByText(/vs Riverside/)).toBeInTheDocument();
    });
  });
});
