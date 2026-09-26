import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import { StatTrackerView } from './StatTrackerView';
import { useWakeLock } from '../../hooks/useWakeLock';

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

vi.mock('../../hooks/useWakeLock', () => ({ useWakeLock: vi.fn() }));

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
      { id: 'p1', firstName: 'Sam', lastName: 'Jones', positionName: null, playerNumber: 7, position: null },
      { id: 'p2', firstName: 'Ana', lastName: 'Cruz', positionName: null, playerNumber: 23, position: null },
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

  it('shows the 2-target tap UI (Us / Them) when status is in-progress', async () => {
    mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
    render(<StatTrackerView />);
    await flush();
    expect(screen.getByRole('button', { name: /Log Shot – Us/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Log Shot – Lakeside FC/ })).toBeInTheDocument();
  });

  it('hides the tap UI (game-not-in-progress gate) during halftime, even though state is LIVE', async () => {
    mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ status: 'halftime' })));
    render(<StatTrackerView />);
    await flush();
    expect(screen.getByTestId('tracker-not-in-progress')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Log Shot/ })).not.toBeInTheDocument();
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
    it('Us Goal: player -> outcome -> assist -> confirm -> submit, with expectedGameId echoed', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Log Shot – Us/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: '#7 Sam Jones' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Goal' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'No assist' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: /Log Goal/ }));
      await flush();

      expect(mockSubmitStatEvent).toHaveBeenCalledWith(expect.objectContaining({
        token: 'tok-1',
        outcome: 'GOAL',
        forUs: true,
        playerId: 'p1',
        assistPlayerId: undefined,
        expectedGameId: 'game-1',
      }), { authMode: 'identityPool' });
    });

    it('Opponent Goal: outcome -> confirm submit, no player/assist picker', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Log Shot – Lakeside FC/ }));
      await flush();
      expect(screen.queryByRole('button', { name: '#7 Sam Jones' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Goal' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: /Log Goal/ }));
      await flush();

      expect(mockSubmitStatEvent).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'GOAL', forUs: false, playerId: undefined, assistPlayerId: undefined,
      }), { authMode: 'identityPool' });
    });

    it('Us Blocked shot: outcome tap submits immediately, no confirm step, skipped-player affordance honored', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Log Shot – Us/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: /Skip \/ unknown player/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Blocked' }));
      await flush();

      expect(mockSubmitStatEvent).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'BLOCKED', forUs: true, playerId: undefined,
      }), { authMode: 'identityPool' });
    });

    it('Opponent Wide shot: outcome step directly, immediate submit, no player picker', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Log Shot – Lakeside FC/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Wide' }));
      await flush();

      expect(mockSubmitStatEvent).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'WIDE', forUs: false,
      }), { authMode: 'identityPool' });
    });

    it('Us Saved: outcome -> confirm directly (no keeper attribution on our own side)', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Log Shot – Us/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: '#7 Sam Jones' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Saved' }));
      await flush();

      expect(screen.queryByText(/made the save\?/)).not.toBeInTheDocument();
      expect(screen.queryByText('Which keeper?')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Log Save/ }));
      await flush();

      expect(screen.getByRole('status')).toHaveTextContent(/logged/i);
      expect(mockSubmitStatEvent).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'SAVED', forUs: true, playerId: 'p1', keeperPlayerId: undefined,
      }), { authMode: 'identityPool' });
    });
  });

  describe('duplicate-tap guard', () => {
    it('a rapid double-tap on the confirm button produces one submission', async () => {
      let resolveSubmit: (value: unknown) => void = () => {};
      mockSubmitStatEvent.mockReturnValue(new Promise((resolve) => { resolveSubmit = resolve; }));

      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Log Shot – Lakeside FC/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Saved' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: '#7 Sam Jones' })); // keeper picker (no auto-prefill)
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

      fireEvent.click(screen.getByRole('button', { name: /Log Shot – Lakeside FC/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Saved' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: '#7 Sam Jones' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: /Log Save/ }));
      await flush();

      expect(screen.getByRole('alert')).toHaveTextContent(/no longer in progress/i);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      // Target re-enabled -- can retry.
      expect(screen.getByRole('button', { name: /Log Save/ })).not.toBeDisabled();
    });

    it('on a PARTIAL_WRITE result, shows retry-steering copy and keeps the SAME clientEventId across the retry tap', async () => {
      mockSubmitStatEvent.mockResolvedValueOnce(result({ ok: false, reason: 'PARTIAL_WRITE' }));
      mockSubmitStatEvent.mockResolvedValueOnce(result({ ok: true, reason: null }));
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Log Shot – Lakeside FC/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Saved' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: '#7 Sam Jones' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: /Log Save/ }));
      await flush();

      expect(screen.getByRole('alert')).toHaveTextContent(/almost done/i);
      // Sheet stays open at the same confirm step for a retry tap.
      const retryButton = screen.getByRole('button', { name: /Log Save/ });
      expect(retryButton).toBeInTheDocument();

      fireEvent.click(retryButton);
      await flush();

      expect(mockSubmitStatEvent).toHaveBeenCalledTimes(2);
      const [firstCallArgs] = mockSubmitStatEvent.mock.calls[0];
      const [secondCallArgs] = mockSubmitStatEvent.mock.calls[1];
      expect(secondCallArgs.clientEventId).toBe(firstCallArgs.clientEventId);
      expect(screen.getByRole('status')).toHaveTextContent(/logged/i);
    });
  });

  describe('Save Auto-Goalkeeper Attribution', () => {
    it('Them Saved with a known activeGoalkeeperId lands directly on the confirm-keeper step, and "Log Save" submits with that keeperPlayerId', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ activeGoalkeeperId: 'p1' })));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Log Shot – Lakeside FC/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Saved' }));
      await flush();

      expect(screen.queryByRole('button', { name: '#7 Sam Jones' })).not.toBeInTheDocument();
      expect(screen.getByText('Sam Jones made the save?')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Log Save/ }));
      await flush();

      expect(mockSubmitStatEvent).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'SAVED', forUs: false, keeperPlayerId: 'p1',
      }), { authMode: 'identityPool' });
    });

    it('"Not right? Pick another keeper" transitions to the full player picker, then a confirm step, and submits the chosen id', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ activeGoalkeeperId: 'p1' })));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Log Shot – Lakeside FC/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Saved' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: /Not right\? Pick another keeper/ }));
      await flush();

      expect(screen.getByText('Which keeper?')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '#23 Ana Cruz' }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: /Log Save/ }));
      await flush();

      expect(mockSubmitStatEvent).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'SAVED', forUs: false, keeperPlayerId: 'p2',
      }), { authMode: 'identityPool' });
    });

    it('activeGoalkeeperId absent/null -> unchanged existing behavior, full picker shown', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Log Shot – Lakeside FC/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Saved' }));
      await flush();

      expect(screen.getByText('Which keeper?')).toBeInTheDocument();
      expect(screen.queryByText(/made the save\?/)).not.toBeInTheDocument();
    });

    it('activeGoalkeeperId set to an id not present in roster -> falls back to the full picker', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ activeGoalkeeperId: 'not-on-roster' })));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Log Shot – Lakeside FC/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Saved' }));
      await flush();

      expect(screen.getByText('Which keeper?')).toBeInTheDocument();
      expect(screen.queryByText(/made the save\?/)).not.toBeInTheDocument();
    });

    it('Us-side Saved flow is unaffected by activeGoalkeeperId being set (still outcome -> confirm, no keeper step)', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ activeGoalkeeperId: 'p1' })));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Log Shot – Us/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: /Skip \/ unknown player/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Saved' }));
      await flush();

      expect(screen.queryByText(/made the save\?/)).not.toBeInTheDocument();
      expect(screen.queryByText('Which keeper?')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Log Save/ }));
      await flush();

      expect(mockSubmitStatEvent).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'SAVED', forUs: true, keeperPlayerId: undefined,
      }), { authMode: 'identityPool' });
    });

    it('GOAL flow is unaffected by activeGoalkeeperId being set (only "Them"+Saved branches on it)', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ activeGoalkeeperId: 'p1' })));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Log Shot – Us/ }));
      await flush();
      expect(screen.getByText('Who took the shot?')).toBeInTheDocument();
      expect(screen.queryByText(/made the save\?/)).not.toBeInTheDocument();
    });

    it('a mid-step poll that changes the active keeper does not retroactively alter an open confirm-keeper flow (regression)', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ activeGoalkeeperId: 'p1' })));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Log Shot – Lakeside FC/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Saved' }));
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

      fireEvent.click(screen.getByRole('button', { name: /Log Save/ }));
      await flush();

      expect(mockSubmitStatEvent).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'SAVED', forUs: false, keeperPlayerId: 'p1',
      }), { authMode: 'identityPool' });
    });

    it('a mid-step poll that makes the active keeper unresolvable does not empty out an open confirm-keeper flow (regression)', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ activeGoalkeeperId: 'p1' })));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Log Shot – Lakeside FC/ }));
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Saved' }));
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
      expect(screen.getByRole('button', { name: /Log Save/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Not right\? Pick another keeper/ })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Log Save/ }));
      await flush();

      expect(mockSubmitStatEvent).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'SAVED', forUs: false, keeperPlayerId: 'p1',
      }), { authMode: 'identityPool' });
    });
  });

  describe('mid-session revocation', () => {
    it('closes an in-flight tap flow and shows the invalid-link state when a later poll is revoked', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Log Shot – Us/ }));
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
    const onFieldPosition = { id: 'pos-fwd', positionName: 'Forward', abbreviation: 'FWD', role: 'FORWARD', sortOrder: 1, xPct: null, yPct: null };

    it('shows the on-field player\'s jersey number on the field, and never shows a player with position: null there', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({
        roster: [
          { id: 'p1', firstName: 'Sam', lastName: 'Jones', positionName: 'Forward', playerNumber: 9, position: onFieldPosition },
          { id: 'p2', firstName: 'Ana', lastName: 'Cruz', positionName: null, playerNumber: 23, position: null },
        ],
      })));
      render(<StatTrackerView />);
      await flush();

      expect(screen.getByRole('heading', { level: 2, name: 'On the Field' })).toBeInTheDocument();
      expect(screen.getByText('#9')).toBeInTheDocument();
      expect(screen.getByRole('group', { name: /Sam J, Forward/ })).toBeInTheDocument();
      // Ana Cruz has position: null (bench) -- must never appear in the field view.
      expect(screen.queryByText('#23')).not.toBeInTheDocument();
    });

    it('hides the on-field lineup section during halftime', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ status: 'halftime' })));
      render(<StatTrackerView />);
      await flush();

      expect(screen.queryByText('On the Field')).not.toBeInTheDocument();
    });
  });

  describe('Bench section', () => {
    const onFieldPosition = { id: 'pos-fwd', positionName: 'Forward', abbreviation: 'FWD', role: 'FORWARD' };

    it('renders a top-level Bench <h2> section (a sibling of On the Field, not nested under it) with bench players\' jersey numbers', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({
        roster: [
          { id: 'p1', firstName: 'Sam', lastName: 'Jones', positionName: 'Forward', playerNumber: 9, position: onFieldPosition },
          { id: 'p2', firstName: 'Ana', lastName: 'Cruz', positionName: null, playerNumber: 23, position: null },
        ],
      })));
      render(<StatTrackerView />);
      await flush();

      const benchHeading = screen.getByRole('heading', { level: 2, name: 'Bench' });
      const onFieldHeading = screen.getByRole('heading', { level: 2, name: 'On the Field' });
      const benchSection = benchHeading.closest('section');
      expect(benchSection).not.toBeNull();
      expect(benchSection).not.toBe(onFieldHeading.closest('section'));
      expect(within(benchSection as HTMLElement).getByText('#23 Ana Cruz')).toBeInTheDocument();
    });

    it('hides the Bench section during halftime (same tapUiUnlocked gate as On the Field)', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ status: 'halftime' })));
      render(<StatTrackerView />);
      await flush();

      expect(screen.queryByRole('heading', { level: 2, name: 'Bench' })).not.toBeInTheDocument();
    });

    it('does not render a Bench section when there are no bench players', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({
        roster: [
          { id: 'p1', firstName: 'Sam', lastName: 'Jones', positionName: 'Forward', playerNumber: 9, position: onFieldPosition },
        ],
      })));
      render(<StatTrackerView />);
      await flush();

      expect(screen.queryByRole('heading', { level: 2, name: 'Bench' })).not.toBeInTheDocument();
    });
  });

  describe('player picker jersey numbers', () => {
    it('shows jersey numbers on the player picker buttons', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Log Shot – Us/ }));
      await flush();

      expect(screen.getByRole('button', { name: '#7 Sam Jones' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '#23 Ana Cruz' })).toBeInTheDocument();
    });
  });

  describe('player picker ordering (on-field before bench)', () => {
    it('shows on-field players before bench players, with group labels when both are present', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({
        roster: [
          { id: 'p1', firstName: 'Bench', lastName: 'One', positionName: null, playerNumber: 5 },
          { id: 'p2', firstName: 'Field', lastName: 'Two', positionName: 'Midfielder', playerNumber: 11 },
        ],
      })));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Log Shot – Us/ }));
      await flush();

      // Scoped to the tap-flow sheet (role="dialog") -- the player-picker's
      // own "Bench" group label is distinct from the page-level Bench <h2>
      // section (see the 'Bench section' describe block above), and both can
      // legitimately coexist on screen at once.
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('On the field')).toBeInTheDocument();
      expect(within(dialog).getByText('Bench')).toBeInTheDocument();
      const names = screen.getAllByRole('button').map((b) => b.textContent);
      const fieldIndex = names.indexOf('#11 Field Two');
      const benchIndex = names.indexOf('#5 Bench One');
      expect(fieldIndex).toBeGreaterThan(-1);
      expect(benchIndex).toBeGreaterThan(fieldIndex);
    });

    it('shows no group labels when the roster is entirely bench (e.g. game not in-progress)', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: /Log Shot – Us/ }));
      await flush();

      // No group labels inside the picker sheet itself -- a fully-bench
      // roster gets no "On the field"/"Bench" sub-grouping. The page-level
      // Bench <h2> section (a fully separate concern) is intentionally not
      // asserted against here -- see the 'Bench section' describe block.
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).queryByText('On the field')).not.toBeInTheDocument();
      expect(within(dialog).queryByText('Bench')).not.toBeInTheDocument();
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

    it('disables the "Refresh now" button and shows "Refreshing…" while a fetch is in flight', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ status: 'halftime' })));
      render(<StatTrackerView />);
      await flush();

      let resolveFetch: (value: unknown) => void = () => {};
      mockGetStatTrackerView.mockReturnValueOnce(new Promise((resolve) => { resolveFetch = resolve; }));

      fireEvent.click(screen.getByRole('button', { name: /Refresh now/ }));
      await flush();

      const button = screen.getByRole('button', { name: /Refreshing…/ });
      expect(button).toBeDisabled();

      resolveFetch(result(baseLiveData({ status: 'halftime' })));
      await flush();

      expect(screen.getByRole('button', { name: /Refresh now/ })).not.toBeDisabled();
    });

    it('does not issue a second overlapping request when focus and visibilitychange both fire on one app resume', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ status: 'halftime' })));
      render(<StatTrackerView />);
      await flush();
      expect(mockGetStatTrackerView).toHaveBeenCalledTimes(1);

      let resolveFetch: (value: unknown) => void = () => {};
      mockGetStatTrackerView.mockReturnValueOnce(new Promise((resolve) => { resolveFetch = resolve; }));

      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
      });
      await flush();

      // Only one new request despite two independent triggers firing together.
      expect(mockGetStatTrackerView).toHaveBeenCalledTimes(2);

      resolveFetch(result(baseLiveData({ status: 'halftime' })));
      await flush();
    });
  });

  describe('transient RATE_LIMITED polls do not wipe a good live view', () => {
    it('keeps showing the live tap UI (not the full-page rate-limited screen) and shows an inline banner', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();
      expect(screen.getByRole('button', { name: /Log Shot – Us/ })).toBeInTheDocument();

      mockGetStatTrackerView.mockResolvedValue(result({ state: 'RATE_LIMITED' }));
      await act(async () => { vi.advanceTimersByTime(12000); });
      await flush();

      expect(screen.getByRole('button', { name: /Log Shot – Us/ })).toBeInTheDocument();
      expect(screen.queryByTestId('tracker-state-rate-limited')).not.toBeInTheDocument();
      expect(screen.getByText(/temporarily limited/i)).toBeInTheDocument();
    });

    it('clears the banner once a later poll returns a normal payload again', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      render(<StatTrackerView />);
      await flush();

      mockGetStatTrackerView.mockResolvedValue(result({ state: 'RATE_LIMITED' }));
      await act(async () => { vi.advanceTimersByTime(12000); });
      await flush();
      expect(screen.getByText(/temporarily limited/i)).toBeInTheDocument();

      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData()));
      await act(async () => { vi.advanceTimersByTime(12000); });
      await flush();
      expect(screen.queryByText(/temporarily limited/i)).not.toBeInTheDocument();
    });

    it('still shows the full-page rate-limited state on first load (no prior good data to fall back on)', async () => {
      mockGetStatTrackerView.mockResolvedValue(result({ state: 'RATE_LIMITED' }));
      render(<StatTrackerView />);
      await flush();

      expect(screen.getByTestId('tracker-state-rate-limited')).toBeInTheDocument();
    });
  });

  describe('upcoming games', () => {
    // NO_GAMES_YET (team has zero games at all) and NO_GAME_RIGHT_NOW
    // (no future-dated game exists) can never carry a non-empty
    // upcomingGames list by construction -- see selectUpcomingGames's doc
    // comment in shareLinkAccess.ts. These two just confirm the static
    // copy renders regardless of what upcomingGames says.
    it('always shows the generic message on NO_GAMES_YET (upcomingGames is structurally always empty there)', async () => {
      mockGetStatTrackerView.mockResolvedValue(result({ state: 'NO_GAMES_YET', teamName: 'Eagles', upcomingGames: [] }));
      render(<StatTrackerView />);
      await flush();

      expect(screen.getByText(/No games yet/)).toBeInTheDocument();
    });

    it('shows a list of upcoming games on FINISHED when the server provides one', async () => {
      mockGetStatTrackerView.mockResolvedValue(result({
        state: 'FINISHED',
        teamName: 'Eagles',
        upcomingGames: [
          { opponentName: 'Riverside', gameDate: '2026-10-01T18:00:00.000Z', locationName: 'Home Field' },
        ],
      }));
      render(<StatTrackerView />);
      await flush();

      expect(screen.getByText(/This game has ended/)).toBeInTheDocument();
      expect(screen.getByText(/vs Riverside/)).toBeInTheDocument();
    });

    it('shows only the ended-game message on FINISHED when no upcoming games are known', async () => {
      mockGetStatTrackerView.mockResolvedValue(result({ state: 'FINISHED', teamName: 'Eagles', upcomingGames: [] }));
      render(<StatTrackerView />);
      await flush();

      expect(screen.getByText(/This game has ended/)).toBeInTheDocument();
      expect(screen.queryByText(/Next up/)).not.toBeInTheDocument();
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

  describe('useWakeLock', () => {
    const mockUseWakeLock = vi.mocked(useWakeLock);

    beforeEach(() => {
      mockUseWakeLock.mockClear();
    });

    it('is called with true when viewState is LIVE and status is in-progress', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ status: 'in-progress' })));
      render(<StatTrackerView />);
      await flush();
      expect(mockUseWakeLock).toHaveBeenCalledWith(true);
    });

    it('is called with true when viewState is LIVE and status is halftime', async () => {
      mockGetStatTrackerView.mockResolvedValue(result(baseLiveData({ status: 'halftime' })));
      render(<StatTrackerView />);
      await flush();
      expect(mockUseWakeLock).toHaveBeenCalledWith(true);
    });

    it('is called with false on NEXT_GAME', async () => {
      mockGetStatTrackerView.mockResolvedValue(result({
        state: 'NEXT_GAME',
        teamName: 'Eagles',
        opponentName: 'Lakeside FC',
        upcomingGames: [],
      }));
      render(<StatTrackerView />);
      await flush();
      expect(mockUseWakeLock).toHaveBeenCalledWith(false);
    });

    it('is called with false on FINISHED', async () => {
      mockGetStatTrackerView.mockResolvedValue(result({ state: 'FINISHED', teamName: 'Eagles', upcomingGames: [] }));
      render(<StatTrackerView />);
      await flush();
      expect(mockUseWakeLock).toHaveBeenCalledWith(false);
    });

    it('is called with false on NO_GAMES_YET', async () => {
      mockGetStatTrackerView.mockResolvedValue(result({ state: 'NO_GAMES_YET', teamName: 'Eagles', upcomingGames: [] }));
      render(<StatTrackerView />);
      await flush();
      expect(mockUseWakeLock).toHaveBeenCalledWith(false);
    });

    it('is called with false on NO_GAME_RIGHT_NOW', async () => {
      mockGetStatTrackerView.mockResolvedValue(result({ state: 'NO_GAME_RIGHT_NOW', teamName: 'Eagles', upcomingGames: [] }));
      render(<StatTrackerView />);
      await flush();
      expect(mockUseWakeLock).toHaveBeenCalledWith(false);
    });

    it('is called with false on RATE_LIMITED', async () => {
      mockGetStatTrackerView.mockResolvedValue(result({ state: 'RATE_LIMITED' }));
      render(<StatTrackerView />);
      await flush();
      expect(mockUseWakeLock).toHaveBeenCalledWith(false);
    });

    it('is called with false on INVALID_LINK', async () => {
      mockGetStatTrackerView.mockResolvedValue(result({ state: 'INVALID_LINK' }));
      render(<StatTrackerView />);
      await flush();
      expect(mockUseWakeLock).toHaveBeenCalledWith(false);
    });

    it('is called with false while LOADING (before the first response resolves)', () => {
      mockGetStatTrackerView.mockReturnValue(new Promise(() => {})); // never resolves
      render(<StatTrackerView />);
      expect(mockUseWakeLock).toHaveBeenCalledWith(false);
    });
  });
});
