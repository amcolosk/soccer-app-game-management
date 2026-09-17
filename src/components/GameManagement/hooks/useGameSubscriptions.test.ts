import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGameSubscriptions } from './useGameSubscriptions';
import type { Game, Team } from '../types';

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

// Capture the `next` callback from Game.observeQuery so tests can fire events.
let capturedGameNext: ((data: { items: Partial<Game>[] }) => void) | null = null;

const { mockGameObserveQuery, mockGamePlanObserveQuery, mockPlannedRotationObserveQuery } =
  vi.hoisted(() => ({
    mockGameObserveQuery: vi.fn(),
    mockGamePlanObserveQuery: vi.fn(),
    mockPlannedRotationObserveQuery: vi.fn(),
  }));

const { mockPlannedRotationList } = vi.hoisted(() => ({
  mockPlannedRotationList: vi.fn().mockResolvedValue({ data: [] }),
}));

const { mockLineupList, mockLineupCreate, mockLineupDelete, mockLineupUpdate } = vi.hoisted(() => ({
  mockLineupList: vi.fn().mockResolvedValue({ data: [] }),
  mockLineupCreate: vi.fn().mockResolvedValue({ data: {} }),
  mockLineupDelete: vi.fn().mockResolvedValue({ data: {} }),
  mockLineupUpdate: vi.fn().mockResolvedValue({ data: {} }),
}));

const { mockUseAmplifyQuery } = vi.hoisted(() => ({
  mockUseAmplifyQuery: vi.fn(),
}));

const { mockHandleApiError } = vi.hoisted(() => ({
  mockHandleApiError: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      Game: {
        observeQuery: mockGameObserveQuery,
      },
      GamePlan: {
        observeQuery: mockGamePlanObserveQuery,
      },
      PlannedRotation: {
        observeQuery: mockPlannedRotationObserveQuery,
        list: mockPlannedRotationList,
      },
      LineupAssignment: {
        list: mockLineupList,
        create: mockLineupCreate,
        delete: mockLineupDelete,
        update: mockLineupUpdate,
      },
    },
  })),
}));

// Mock useAmplifyQuery so the secondary subscriptions (LineupAssignment,
// PlayTimeRecord, Goal, GameNote, PlayerAvailability) don't interfere.
vi.mock('../../../hooks/useAmplifyQuery', () => ({
  useAmplifyQuery: mockUseAmplifyQuery,
}));

vi.mock('../../../utils/errorHandler', () => ({
  handleApiError: (...args: unknown[]) => mockHandleApiError(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNoOpSub() {
  return { unsubscribe: vi.fn() };
}

function createDefaultGame(overrides: Partial<Game> = {}): Game {
  return {
    id: 'game-1',
    status: 'in-progress',
    elapsedSeconds: 0,
    lastStartTime: null,
    currentHalf: 1,
    ...overrides,
  } as Game;
}

function createDefaultTeam(): Team {
  return {
    id: 'team-1',
    coaches: [],
  } as unknown as Team;
}

function createDefaultProps(overrides: {
  isRunning?: boolean;
  setCurrentTime?: ReturnType<typeof vi.fn>;
  setIsRunning?: ReturnType<typeof vi.fn>;
  game?: Game;
  userId?: string;
} = {}) {
  return {
    game: overrides.game ?? createDefaultGame(),
    team: createDefaultTeam(),
    isRunning: overrides.isRunning ?? false,
    setCurrentTime: overrides.setCurrentTime ?? vi.fn(),
    setIsRunning: overrides.setIsRunning ?? vi.fn(),
    notesRefreshKey: 0,
    userId: overrides.userId ?? '',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useGameSubscriptions — Game observeQuery handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedGameNext = null;
    mockUseAmplifyQuery.mockReturnValue({ data: [], isSynced: false });
    mockLineupList.mockResolvedValue({ data: [] });
    mockLineupCreate.mockResolvedValue({ data: {} });
    mockLineupDelete.mockResolvedValue({ data: {} });
    mockLineupUpdate.mockResolvedValue({ data: {} });
    mockHandleApiError.mockReset();
    mockPlannedRotationList.mockResolvedValue({ data: [] });

    // Game.observeQuery captures the `next` callback so tests can trigger events.
    mockGameObserveQuery.mockReturnValue({
      subscribe: (handlers: { next: (data: { items: Partial<Game>[] }) => void }) => {
        capturedGameNext = handlers.next;
        return makeNoOpSub();
      },
    });

    // GamePlan and PlannedRotation subscriptions are no-ops for these tests.
    mockGamePlanObserveQuery.mockReturnValue({
      subscribe: () => makeNoOpSub(),
    });
    mockPlannedRotationObserveQuery.mockReturnValue({
      subscribe: () => makeNoOpSub(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('stops the timer when completed status arrives even if isRunning is true (primary bug fix)', () => {
    // Setup: isRunning = true — the timer was already running (e.g., due to
    // stale Amplify cache data that had status: 'in-progress').
    const setIsRunning = vi.fn();
    const setCurrentTime = vi.fn();
    const props = createDefaultProps({ isRunning: true, setIsRunning, setCurrentTime });

    renderHook(() => useGameSubscriptions(props));

    // Verify the subscription was set up and we captured the next callback.
    expect(capturedGameNext).not.toBeNull();

    // Fire the subscription with completed status — this is the live data arriving
    // AFTER stale cache had incorrectly shown the game as in-progress.
    act(() => {
      capturedGameNext!({
        items: [
          {
            id: 'game-1',
            status: 'completed',
            elapsedSeconds: 2700,
            lastStartTime: null,
          } as Partial<Game>,
        ],
      });
    });

    // The completed guard must fire BEFORE the `if (isRunning) return` guard.
    // setIsRunning(false) stops the erroneously-running timer.
    expect(setIsRunning).toHaveBeenCalledWith(false);
    // setCurrentTime is called with the authoritative final elapsed time.
    expect(setCurrentTime).toHaveBeenCalledWith(2700);
  });

  it('does not stop timer or update time when a non-completed update arrives while running', () => {
    // Setup: isRunning = true — the timer is correctly running.
    // A score update (or other data change) arrives via the subscription.
    // The `if (isRunning) return` guard must prevent time from being overwritten.
    const setIsRunning = vi.fn();
    const setCurrentTime = vi.fn();
    const props = createDefaultProps({ isRunning: true, setIsRunning, setCurrentTime });

    renderHook(() => useGameSubscriptions(props));

    expect(capturedGameNext).not.toBeNull();

    act(() => {
      capturedGameNext!({
        items: [
          {
            id: 'game-1',
            status: 'in-progress',
            elapsedSeconds: 1800,
            lastStartTime: new Date().toISOString(),
          } as Partial<Game>,
        ],
      });
    });

    // The isRunning guard should have blocked any state updates for the timer.
    expect(setIsRunning).not.toHaveBeenCalled();
    expect(setCurrentTime).not.toHaveBeenCalled();
  });

  it('auto-resumes timer when in-progress with lastStartTime arrives while not running', () => {
    vi.useFakeTimers();

    // Setup: isRunning = false (fresh load or after a pause that was not manual).
    const setIsRunning = vi.fn();
    const setCurrentTime = vi.fn();
    const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime });

    // Freeze time so the additionalSeconds calculation is deterministic.
    const now = Date.now();
    // lastStartTime is 30 seconds in the past.
    const lastStartTime = new Date(now - 30_000).toISOString();

    renderHook(() => useGameSubscriptions(props));

    expect(capturedGameNext).not.toBeNull();

    act(() => {
      capturedGameNext!({
        items: [
          {
            id: 'game-1',
            status: 'in-progress',
            elapsedSeconds: 1000,
            lastStartTime,
          } as Partial<Game>,
        ],
      });
    });

    // Timer should have been started.
    expect(setIsRunning).toHaveBeenCalledWith(true);

    // Time should have been set to elapsedSeconds + additionalSeconds (≈ 1030).
    expect(setCurrentTime).toHaveBeenCalledTimes(1);
    const setTimeArg = setCurrentTime.mock.calls[0][0] as number;
    // Allow ±1s tolerance for timing variance.
    expect(setTimeArg).toBeGreaterThanOrEqual(1029);
    expect(setTimeArg).toBeLessThanOrEqual(1031);
  });

  describe('timer gap confirmation (Issue B)', () => {
    const HEARTBEAT_KEY = 'teamtrack:timerHeartbeat:user-1:game-1';

    it('applies a large gap silently when this device has no continuity heartbeat (e.g. a second coach opening an already-running game)', () => {
      vi.useFakeTimers();
      const setIsRunning = vi.fn();
      const setCurrentTime = vi.fn();
      // No heartbeat written — userId set, but this device never ran this game's timer.
      const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime, userId: 'user-1' });

      const now = Date.now();
      const lastStartTime = new Date(now - 20 * 60_000).toISOString(); // 20 min gap — well past threshold

      renderHook(() => useGameSubscriptions(props));
      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 1, elapsedSeconds: 0, lastStartTime } as Partial<Game>],
        });
      });

      expect(setIsRunning).toHaveBeenCalledWith(true);
      expect(setCurrentTime).toHaveBeenCalled();
    });

    it('applies a large gap silently when userId has not loaded yet', () => {
      vi.useFakeTimers();
      const setIsRunning = vi.fn();
      const setCurrentTime = vi.fn();
      const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime, userId: '' });
      localStorage.setItem('teamtrack:timerHeartbeat::game-1', '1'); // can't happen for real, but prove userId is required

      const now = Date.now();
      const lastStartTime = new Date(now - 20 * 60_000).toISOString();

      renderHook(() => useGameSubscriptions(props));
      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 1, elapsedSeconds: 0, lastStartTime } as Partial<Game>],
        });
      });

      expect(setIsRunning).toHaveBeenCalledWith(true);
    });

    it('proposes a gap correction using the CURRENT userId even though it loaded after mount (regression: stale closure caught in review)', () => {
      // Mirrors GameManagement.tsx's real timeline: userId starts as '' (useState('')),
      // and is only populated later by an async getCurrentUser() effect — well after
      // this hook's Game.observeQuery subscription (deps: [game.id] only) has already
      // subscribed once. Without userIdRef, the subscription's `next` closure would
      // permanently see the mount-time '', making the gap-confirmation feature
      // silently inert for the entire session.
      vi.useFakeTimers();
      localStorage.setItem(HEARTBEAT_KEY, '1');
      const setIsRunning = vi.fn();
      const setCurrentTime = vi.fn();
      const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime, userId: '' });

      const now = Date.now();
      const lastStartTime = new Date(now - 15 * 60_000).toISOString();

      const { result, rerender } = renderHook((p) => useGameSubscriptions(p), { initialProps: props });

      // userId loads asynchronously, same game.id — the subscription effect does NOT re-run.
      rerender({ ...props, userId: 'user-1' });

      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 2, elapsedSeconds: 2000, lastStartTime } as Partial<Game>],
        });
      });

      expect(setIsRunning).not.toHaveBeenCalled();
      expect(setCurrentTime).not.toHaveBeenCalled();
      expect(result.current.pendingGapCorrection).not.toBeNull();
    });

    it('applies a small gap silently even with a continuity heartbeat present (below threshold)', () => {
      vi.useFakeTimers();
      localStorage.setItem(HEARTBEAT_KEY, '1');
      const setIsRunning = vi.fn();
      const setCurrentTime = vi.fn();
      const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime, userId: 'user-1' });

      const now = Date.now();
      const lastStartTime = new Date(now - 30_000).toISOString(); // 30s — below the 600s threshold

      renderHook(() => useGameSubscriptions(props));
      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 1, elapsedSeconds: 0, lastStartTime } as Partial<Game>],
        });
      });

      expect(setIsRunning).toHaveBeenCalledWith(true);
      expect(setCurrentTime).toHaveBeenCalled();
    });

    it('proposes a gap correction instead of auto-resuming when this device has continuity, the gap is anomalous, and no auto-trigger boundary is crossed', () => {
      vi.useFakeTimers();
      localStorage.setItem(HEARTBEAT_KEY, '1');
      const setIsRunning = vi.fn();
      const setCurrentTime = vi.fn();
      const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime, userId: 'user-1' });

      const now = Date.now();
      // Second half, elapsed already past the half-length boundary — a 15 min
      // gap here does NOT cross MAX_GAME_SECONDS (7200s), so it's eligible.
      const lastStartTime = new Date(now - 15 * 60_000).toISOString();

      const { result } = renderHook(() => useGameSubscriptions(props));
      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 2, elapsedSeconds: 2000, lastStartTime } as Partial<Game>],
        });
      });

      // Must NOT have auto-resumed.
      expect(setIsRunning).not.toHaveBeenCalled();
      expect(setCurrentTime).not.toHaveBeenCalled();
      // Must have proposed a correction instead.
      expect(result.current.pendingGapCorrection).not.toBeNull();
      expect(result.current.pendingGapCorrection?.priorElapsed).toBe(2000);
      expect(result.current.pendingGapCorrection?.gapSeconds).toBeGreaterThanOrEqual(899);
      expect(result.current.pendingGapCorrection?.gapSeconds).toBeLessThanOrEqual(901);
    });

    it('stays silent when the gap would cross the auto-halftime boundary in half 1', () => {
      vi.useFakeTimers();
      localStorage.setItem(HEARTBEAT_KEY, '1');
      const setIsRunning = vi.fn();
      const setCurrentTime = vi.fn();
      const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime, userId: 'user-1' });

      const now = Date.now();
      // elapsedSeconds=1700 + an ~11 min (>600s, anomalous) gap crosses the
      // 30-min (1800s) default half length.
      const lastStartTime = new Date(now - 11 * 60_000).toISOString();

      const { result } = renderHook(() => useGameSubscriptions(props));
      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 1, elapsedSeconds: 1700, lastStartTime } as Partial<Game>],
        });
      });

      expect(setIsRunning).toHaveBeenCalledWith(true);
      expect(setCurrentTime).toHaveBeenCalled();
      expect(result.current.pendingGapCorrection).toBeNull();
    });

    it('stays silent when the gap would cross the auto-end boundary, even in the second half', () => {
      vi.useFakeTimers();
      localStorage.setItem(HEARTBEAT_KEY, '1');
      const setIsRunning = vi.fn();
      const setCurrentTime = vi.fn();
      const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime, userId: 'user-1' });

      const now = Date.now();
      // elapsedSeconds already at 7000; a 15 min gap pushes past MAX_GAME_SECONDS (7200).
      const lastStartTime = new Date(now - 15 * 60_000).toISOString();

      const { result } = renderHook(() => useGameSubscriptions(props));
      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 2, elapsedSeconds: 7000, lastStartTime } as Partial<Game>],
        });
      });

      expect(setIsRunning).toHaveBeenCalledWith(true);
      expect(setCurrentTime).toHaveBeenCalled();
      expect(result.current.pendingGapCorrection).toBeNull();
    });

    it('does not propose a second pending correction — or silently apply the gap underneath the open dialog — while one is already awaiting an answer', () => {
      // Regression (caught in review): a naive if/else that falls through to
      // the silent-apply branch whenever the "propose" condition isn't met
      // would silently jump the clock and resume the timer out from under an
      // already-open "Was play stopped?" dialog on a second matching event.
      vi.useFakeTimers();
      localStorage.setItem(HEARTBEAT_KEY, '1');
      const setIsRunning = vi.fn();
      const setCurrentTime = vi.fn();
      const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime, userId: 'user-1' });

      const now = Date.now();
      const lastStartTime = new Date(now - 15 * 60_000).toISOString();

      const { result } = renderHook(() => useGameSubscriptions(props));
      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 2, elapsedSeconds: 2000, lastStartTime } as Partial<Game>],
        });
      });
      const firstPending = result.current.pendingGapCorrection;
      expect(firstPending).not.toBeNull();
      expect(setIsRunning).not.toHaveBeenCalled();
      expect(setCurrentTime).not.toHaveBeenCalled();

      // A second, slightly different event arrives while still pending.
      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 2, elapsedSeconds: 2000, lastStartTime } as Partial<Game>],
        });
      });

      expect(result.current.pendingGapCorrection).toBe(firstPending);
      // Must still not have silently applied the gap underneath the open dialog.
      expect(setIsRunning).not.toHaveBeenCalled();
      expect(setCurrentTime).not.toHaveBeenCalled();
    });

    it('resolveGapCorrection(true) applies the proposed elapsed time and resumes', () => {
      vi.useFakeTimers();
      localStorage.setItem(HEARTBEAT_KEY, '1');
      const setIsRunning = vi.fn();
      const setCurrentTime = vi.fn();
      const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime, userId: 'user-1' });

      const now = Date.now();
      const lastStartTime = new Date(now - 15 * 60_000).toISOString();

      const { result } = renderHook(() => useGameSubscriptions(props));
      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 2, elapsedSeconds: 2000, lastStartTime } as Partial<Game>],
        });
      });
      const proposed = result.current.pendingGapCorrection?.proposedElapsed;
      expect(proposed).toBeDefined();

      act(() => {
        result.current.resolveGapCorrection(true);
      });

      expect(setCurrentTime).toHaveBeenCalledWith(proposed);
      expect(setIsRunning).toHaveBeenCalledWith(true);
      expect(result.current.pendingGapCorrection).toBeNull();
    });

    it('resolveGapCorrection(false) leaves currentTime/isRunning untouched and sets manuallyPausedRef', () => {
      vi.useFakeTimers();
      localStorage.setItem(HEARTBEAT_KEY, '1');
      const setIsRunning = vi.fn();
      const setCurrentTime = vi.fn();
      const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime, userId: 'user-1' });

      const now = Date.now();
      const lastStartTime = new Date(now - 15 * 60_000).toISOString();

      const { result } = renderHook(() => useGameSubscriptions(props));
      act(() => {
        capturedGameNext!({
          items: [{ id: 'game-1', status: 'in-progress', currentHalf: 2, elapsedSeconds: 2000, lastStartTime } as Partial<Game>],
        });
      });
      expect(result.current.pendingGapCorrection).not.toBeNull();

      act(() => {
        result.current.resolveGapCorrection(false);
      });

      expect(setCurrentTime).not.toHaveBeenCalled();
      expect(setIsRunning).not.toHaveBeenCalled();
      expect(result.current.pendingGapCorrection).toBeNull();
      expect(result.current.manuallyPausedRef.current).toBe(true);
    });
  });

  it('does not fire setIsRunning or setCurrentTime when subscription data is empty', () => {
    const setIsRunning = vi.fn();
    const setCurrentTime = vi.fn();
    const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime });

    renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGameNext!({ items: [] });
    });

    expect(setIsRunning).not.toHaveBeenCalled();
    expect(setCurrentTime).not.toHaveBeenCalled();
  });

  it('does NOT auto-resume when a stale in-progress event arrives after game was completed (regression guard)', () => {
    // This tests the fix for: games persisting as in-progress on Home screen
    // after End Game was pressed.
    //
    // Scenario: the game is already completed in local state (coach pressed
    // End Game). A stale subscription notification from a prior timer-sync
    // write arrives late. Without the regression guard, this would call
    // setIsRunning(true) and re-start the saveInterval.
    const setIsRunning = vi.fn();
    const setCurrentTime = vi.fn();
    const completedGame = createDefaultGame({
      status: 'completed',
      elapsedSeconds: 2700,
      lastStartTime: null,
    });
    const props = createDefaultProps({ isRunning: false, setIsRunning, setCurrentTime, game: completedGame });

    renderHook(() => useGameSubscriptions(props));

    expect(capturedGameNext).not.toBeNull();

    // Fire a stale in-progress event — simulates a late DynamoDB subscription
    // notification from a timer-sync write that happened before End Game.
    act(() => {
      capturedGameNext!({
        items: [
          {
            id: 'game-1',
            status: 'in-progress',
            elapsedSeconds: 2695,
            lastStartTime: new Date(Date.now() - 5_000).toISOString(),
          } as Partial<Game>,
        ],
      });
    });

    // The regression guard must block auto-resume: timer should NOT restart.
    expect(setIsRunning).not.toHaveBeenCalledWith(true);
    // Time should NOT be updated (stays at 2700 from the completed state).
    expect(setCurrentTime).not.toHaveBeenCalled();
  });

  it('ignores stale scheduled events after local state has already advanced to in-progress', () => {
    const setIsRunning = vi.fn();
    const setCurrentTime = vi.fn();
    const liveGame = createDefaultGame({
      status: 'in-progress',
      elapsedSeconds: 300,
      lastStartTime: new Date(Date.now() - 5_000).toISOString(),
    });
    const props = createDefaultProps({
      isRunning: true,
      setIsRunning,
      setCurrentTime,
      game: liveGame,
    });

    const { result } = renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGameNext!({
        items: [
          {
            id: 'game-1',
            status: 'scheduled',
            elapsedSeconds: 0,
            lastStartTime: null,
            currentHalf: 1,
          } as Partial<Game>,
        ],
      });
    });

    expect(result.current.gameState.status).toBe('in-progress');
    expect(setIsRunning).not.toHaveBeenCalled();
    expect(setCurrentTime).not.toHaveBeenCalled();
  });

  it('blocks stale in-progress half-1 events while local state is halftime', () => {
    const setIsRunning = vi.fn();
    const setCurrentTime = vi.fn();
    const halftimeGame = createDefaultGame({
      status: 'halftime',
      currentHalf: 1,
      elapsedSeconds: 1800,
      lastStartTime: null,
    });
    const props = createDefaultProps({
      isRunning: false,
      setIsRunning,
      setCurrentTime,
      game: halftimeGame,
    });

    const { result } = renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGameNext!({
        items: [
          {
            id: 'game-1',
            status: 'in-progress',
            currentHalf: 1,
            elapsedSeconds: 1800,
            lastStartTime: new Date(Date.now() - 5_000).toISOString(),
          } as Partial<Game>,
        ],
      });
    });

    expect(result.current.gameState.status).toBe('halftime');
    expect(setIsRunning).not.toHaveBeenCalledWith(true);
    expect(setCurrentTime).not.toHaveBeenCalled();
  });

  it('accepts legitimate second-half in-progress events while local state is halftime', () => {
    const setIsRunning = vi.fn();
    const setCurrentTime = vi.fn();
    const halftimeGame = createDefaultGame({
      status: 'halftime',
      currentHalf: 1,
      elapsedSeconds: 1800,
      lastStartTime: null,
    });
    const props = createDefaultProps({
      isRunning: false,
      setIsRunning,
      setCurrentTime,
      game: halftimeGame,
    });

    const { result } = renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGameNext!({
        items: [
          {
            id: 'game-1',
            status: 'in-progress',
            currentHalf: 2,
            elapsedSeconds: 1800,
            lastStartTime: new Date(Date.now() - 5_000).toISOString(),
          } as Partial<Game>,
        ],
      });
    });

    expect(result.current.gameState.status).toBe('in-progress');
    expect(result.current.gameState.currentHalf).toBe(2);
    expect(setIsRunning).toHaveBeenCalledWith(true);
  });

  it('blocks stale in-progress half-1 events from regressing local in-progress second-half state', () => {
    const setIsRunning = vi.fn();
    const setCurrentTime = vi.fn();
    const secondHalfGame = createDefaultGame({
      status: 'in-progress',
      currentHalf: 2,
      elapsedSeconds: 2100,
      lastStartTime: null,
    });
    const props = createDefaultProps({
      isRunning: false,
      setIsRunning,
      setCurrentTime,
      game: secondHalfGame,
    });

    const { result } = renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGameNext!({
        items: [
          {
            id: 'game-1',
            status: 'in-progress',
            currentHalf: 1,
            elapsedSeconds: 2100,
            lastStartTime: new Date(Date.now() - 5_000).toISOString(),
          } as Partial<Game>,
        ],
      });
    });

    expect(result.current.gameState.status).toBe('in-progress');
    expect(result.current.gameState.currentHalf).toBe(2);
    expect(setIsRunning).not.toHaveBeenCalledWith(true);
  });

  // Reproduces issue #177: "Game scores are showing 0-0 at halftime".
  //
  // GameManagement derives ourScore/opponentScore locally from the `goals`
  // array during active play and never persists them to the Game record
  // (see docs/plans/GAME-SCORE-SNAPSHOT-CONCURRENCY-PLAN.md — active-state
  // score is goal-derived, no DB write). But any *other* Game field update
  // during active play (pause, resume, halftime transition, second-half
  // start, half-length edit, ...) round-trips through this hook's
  // Game.observeQuery subscription, whose fallback branch does
  // `return updatedGame` — replacing the whole local gameState wholesale
  // with the DB record, whose ourScore/opponentScore are still 0 because
  // they were never written. This clobbers the locally-derived score back
  // to 0-0 until the next goal is scored (which re-triggers the derivation
  // effect in GameManagement).
  it('does not clobber locally-derived score when an unrelated Game field update arrives (issue #177)', () => {
    const setIsRunning = vi.fn();
    const setCurrentTime = vi.fn();
    const liveGame = createDefaultGame({
      status: 'in-progress',
      currentHalf: 1,
      elapsedSeconds: 1200,
      lastStartTime: new Date().toISOString(),
      ourScore: 0,
      opponentScore: 0,
    });
    const props = createDefaultProps({
      isRunning: true,
      setIsRunning,
      setCurrentTime,
      game: liveGame,
    });

    const { result } = renderHook(() => useGameSubscriptions(props));

    // Simulate GameManagement's active-state score-derivation effect, which
    // computes the score from the subscribed `goals` array and writes it
    // into local gameState (no DB write) once goals have been recorded.
    act(() => {
      result.current.setGameState(prev => ({ ...prev, ourScore: 3, opponentScore: 2 }));
    });
    expect(result.current.gameState.ourScore).toBe(3);
    expect(result.current.gameState.opponentScore).toBe(2);

    // An unrelated Game update round-trips through the subscription — e.g. the
    // halftime transition write (status/elapsedSeconds/lastStartTime only).
    // Because score is never persisted during active play, the DB record
    // (and thus this event) still carries the stale ourScore/opponentScore: 0.
    act(() => {
      capturedGameNext!({
        items: [
          {
            id: 'game-1',
            status: 'halftime',
            currentHalf: 1,
            elapsedSeconds: 1500,
            lastStartTime: null,
            ourScore: 0,
            opponentScore: 0,
          } as Partial<Game>,
        ],
      });
    });

    // The goal-derived score must survive an unrelated field update — it
    // should still read 3-2, not be clobbered back to the stale DB 0-0.
    expect(result.current.gameState.ourScore).toBe(3);
    expect(result.current.gameState.opponentScore).toBe(2);
  });

  it('does NOT recreate the subscription when isRunning changes (isRunningRef fix)', () => {
    // This tests Bug Fix 1: isRunning was previously in the observeQuery useEffect
    // deps, causing the subscription to recreate on every timer tick. The new
    // isRunningRef pattern means subscribe is called only once regardless of how
    // many times isRunning changes.
    const subscribeSpy = vi.fn((handlers: { next: (data: { items: Partial<Game>[] }) => void }) => {
      capturedGameNext = handlers.next;
      return makeNoOpSub();
    });
    mockGameObserveQuery.mockReturnValue({ subscribe: subscribeSpy });

    // Start with isRunning = false
    const props = createDefaultProps({ isRunning: false });
    const { rerender } = renderHook(
      (p: ReturnType<typeof createDefaultProps>) => useGameSubscriptions(p),
      { initialProps: props }
    );

    // Subscription created once on mount
    expect(subscribeSpy).toHaveBeenCalledTimes(1);

    // Simulate isRunning changing to true (timer started)
    rerender(createDefaultProps({ isRunning: true }));
    // Subscription must NOT be recreated — still only 1 call
    expect(subscribeSpy).toHaveBeenCalledTimes(1);

    // Simulate isRunning changing back to false (timer paused/stopped)
    rerender(createDefaultProps({ isRunning: false }));
    // Still only 1 call — no subscription churn
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes from Game.observeQuery on unmount', () => {
    const unsubscribeSpy = vi.fn();
    mockGameObserveQuery.mockReturnValue({
      subscribe: (handlers: { next: (data: { items: Partial<Game>[] }) => void }) => {
        capturedGameNext = handlers.next;
        return { unsubscribe: unsubscribeSpy };
      },
    });

    const props = createDefaultProps();
    const { unmount } = renderHook(() => useGameSubscriptions(props));

    unmount();

    expect(unsubscribeSpy).toHaveBeenCalled();
  });

  it('syncs lineup from scheduled gamePlan when lineup is empty locally and in DB', async () => {
    const game = createDefaultGame({ status: 'scheduled' });
    const props = createDefaultProps({ game });

    let capturedGamePlanNext: ((data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void) | null = null;
    mockGamePlanObserveQuery.mockReturnValue({
      subscribe: (handlers: { next: (data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void }) => {
        capturedGamePlanNext = handlers.next;
        return makeNoOpSub();
      },
    });

    renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGamePlanNext?.({
        items: [{
          id: 'plan-1',
          startingLineup: JSON.stringify([
            { playerId: 'p1', positionId: 'pos1' },
            { playerId: 'p2', positionId: 'pos2' },
          ]),
        }],
      });
    });

    await waitFor(() => {
      expect(mockLineupList).toHaveBeenCalled();
      expect(mockLineupCreate).toHaveBeenCalledTimes(2);
    });
  });

  it('skips lineup writes when local lineup already exists and DB is aligned', async () => {
    const game = createDefaultGame({ status: 'scheduled' });
    const props = createDefaultProps({ game });

    mockUseAmplifyQuery.mockImplementation((model: string) => {
      if (model === 'LineupAssignment') {
        return { data: [{ id: 'la-1', positionId: 'pos1', playerId: 'p1', isStarter: true }], isSynced: true };
      }
      return { data: [], isSynced: false };
    });

    mockLineupList.mockResolvedValue({
      data: [{ id: 'la-1', gameId: 'game-1', playerId: 'p1', positionId: 'pos1', isStarter: true }],
    });

    let capturedGamePlanNext: ((data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void) | null = null;
    mockGamePlanObserveQuery.mockReturnValue({
      subscribe: (handlers: { next: (data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void }) => {
        capturedGamePlanNext = handlers.next;
        return makeNoOpSub();
      },
    });

    renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGamePlanNext?.({
        items: [{ id: 'plan-1', startingLineup: JSON.stringify([{ playerId: 'p1', positionId: 'pos1' }]) }],
      });
    });

    await waitFor(() => {
      expect(mockLineupList).toHaveBeenCalled();
      expect(mockLineupCreate).not.toHaveBeenCalled();
      expect(mockLineupUpdate).not.toHaveBeenCalled();
      expect(mockLineupDelete).not.toHaveBeenCalled();
    });
  });

  it('does not sync lineup from gamePlan when DB already has assignments', async () => {
    const game = createDefaultGame({ status: 'scheduled' });
    const props = createDefaultProps({ game });

    mockLineupList.mockResolvedValue({
      data: [{ id: 'la-existing', gameId: 'game-1', playerId: 'p1', positionId: 'pos1', isStarter: true }],
    });

    let capturedGamePlanNext: ((data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void) | null = null;
    mockGamePlanObserveQuery.mockReturnValue({
      subscribe: (handlers: { next: (data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void }) => {
        capturedGamePlanNext = handlers.next;
        return makeNoOpSub();
      },
    });

    renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGamePlanNext?.({
        items: [{ id: 'plan-1', startingLineup: JSON.stringify([{ playerId: 'p1', positionId: 'pos1' }]) }],
      });
    });

    await waitFor(() => {
      expect(mockLineupList).toHaveBeenCalled();
      expect(mockLineupCreate).not.toHaveBeenCalled();
      expect(mockLineupUpdate).not.toHaveBeenCalled();
      expect(mockLineupDelete).not.toHaveBeenCalled();
    });
  });

  it('fills missing starter assignments when DB lineup is only partially synced', async () => {
    const game = createDefaultGame({ status: 'scheduled' });
    const props = createDefaultProps({ game });

    mockUseAmplifyQuery.mockImplementation((model: string) => {
      if (model === 'LineupAssignment') {
        return {
          data: [{ id: 'la-1', positionId: 'pos1', playerId: 'p1', isStarter: true, createdAt: '2026-05-10T00:00:00.000Z' }],
          isSynced: true,
        };
      }
      return { data: [], isSynced: false };
    });

    mockLineupList
      .mockResolvedValueOnce({
        data: [{ id: 'la-1', gameId: 'game-1', playerId: 'p1', positionId: 'pos1', isStarter: true, createdAt: '2026-05-10T00:00:00.000Z' }],
      })
      .mockResolvedValue({
        data: [
          { id: 'la-1', gameId: 'game-1', playerId: 'p1', positionId: 'pos1', isStarter: true, createdAt: '2026-05-10T00:00:00.000Z' },
          { id: 'la-2', gameId: 'game-1', playerId: 'p2', positionId: 'pos2', isStarter: true, createdAt: '2026-05-10T00:00:01.000Z' },
        ],
      });

    let capturedGamePlanNext: ((data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void) | null = null;
    mockGamePlanObserveQuery.mockReturnValue({
      subscribe: (handlers: { next: (data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void }) => {
        capturedGamePlanNext = handlers.next;
        return makeNoOpSub();
      },
    });

    renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGamePlanNext?.({
        items: [{
          id: 'plan-1',
          startingLineup: JSON.stringify([
            { playerId: 'p1', positionId: 'pos1' },
            { playerId: 'p2', positionId: 'pos2' },
          ]),
        }],
      });
    });

    await waitFor(() => {
      expect(mockLineupList).toHaveBeenCalled();
      expect(mockLineupCreate).toHaveBeenCalledTimes(1);
    });

    expect(mockLineupCreate).toHaveBeenCalledWith({
      gameId: 'game-1',
      playerId: 'p2',
      positionId: 'pos2',
      isStarter: true,
      coaches: [],
    });
    expect(mockLineupUpdate).not.toHaveBeenCalled();
    expect(mockLineupDelete).not.toHaveBeenCalled();
  });

  it('cleans duplicate DB starter rows even when local lineup already matches the plan', async () => {
    const game = createDefaultGame({ status: 'scheduled' });
    const props = createDefaultProps({ game });

    mockUseAmplifyQuery.mockImplementation((model: string) => {
      if (model === 'LineupAssignment') {
        return {
          data: [{ id: 'la-1', positionId: 'pos1', playerId: 'p1', isStarter: true, createdAt: '2026-05-10T00:00:00.000Z' }],
          isSynced: true,
        };
      }
      return { data: [], isSynced: false };
    });

    mockLineupList.mockResolvedValue({
      data: [
        { id: 'la-old', gameId: 'game-1', playerId: 'p1', positionId: 'pos1', isStarter: true, createdAt: '2026-05-10T00:00:00.000Z' },
        { id: 'la-new', gameId: 'game-1', playerId: 'p1', positionId: 'pos1', isStarter: true, createdAt: '2026-05-10T00:00:01.000Z' },
      ],
    });

    let capturedGamePlanNext: ((data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void) | null = null;
    mockGamePlanObserveQuery.mockReturnValue({
      subscribe: (handlers: { next: (data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void }) => {
        capturedGamePlanNext = handlers.next;
        return makeNoOpSub();
      },
    });

    renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGamePlanNext?.({
        items: [{ id: 'plan-1', startingLineup: JSON.stringify([{ playerId: 'p1', positionId: 'pos1' }]) }],
      });
    });

    await waitFor(() => {
      expect(mockLineupList).toHaveBeenCalled();
      expect(mockLineupDelete).toHaveBeenCalledWith({ id: 'la-old' });
    });
    expect(mockLineupCreate).not.toHaveBeenCalled();
    expect(mockLineupUpdate).not.toHaveBeenCalled();
  });

  it('does not sync lineup from gamePlan when game is not scheduled', async () => {
    const game = createDefaultGame({ status: 'in-progress' });
    const props = createDefaultProps({ game });

    let capturedGamePlanNext: ((data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void) | null = null;
    mockGamePlanObserveQuery.mockReturnValue({
      subscribe: (handlers: { next: (data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void }) => {
        capturedGamePlanNext = handlers.next;
        return makeNoOpSub();
      },
    });

    renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGamePlanNext?.({
        items: [{ id: 'plan-1', startingLineup: JSON.stringify([{ playerId: 'p1', positionId: 'pos1' }]) }],
      });
    });

    await waitFor(() => {
      expect(mockLineupList).not.toHaveBeenCalled();
      expect(mockLineupCreate).not.toHaveBeenCalled();
    });
  });

  it('does not sync lineup when gamePlan has no startingLineup payload', async () => {
    const game = createDefaultGame({ status: 'scheduled' });
    const props = createDefaultProps({ game });

    let capturedGamePlanNext: ((data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void) | null = null;
    mockGamePlanObserveQuery.mockReturnValue({
      subscribe: (handlers: { next: (data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void }) => {
        capturedGamePlanNext = handlers.next;
        return makeNoOpSub();
      },
    });

    renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGamePlanNext?.({ items: [{ id: 'plan-1', startingLineup: null }] });
    });

    await waitFor(() => {
      expect(mockLineupList).not.toHaveBeenCalled();
      expect(mockLineupCreate).not.toHaveBeenCalled();
      expect(mockHandleApiError).not.toHaveBeenCalled();
    });
  });

  it('reports error when startingLineup is invalid JSON', async () => {
    const game = createDefaultGame({ status: 'scheduled' });
    const props = createDefaultProps({ game });

    let capturedGamePlanNext: ((data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void) | null = null;
    mockGamePlanObserveQuery.mockReturnValue({
      subscribe: (handlers: { next: (data: { items: Array<{ id: string; startingLineup?: string | null }> }) => void }) => {
        capturedGamePlanNext = handlers.next;
        return makeNoOpSub();
      },
    });

    renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGamePlanNext?.({
        items: [{ id: 'plan-1', startingLineup: '{bad-json' }],
      });
    });

    await waitFor(() => {
      expect(mockHandleApiError).toHaveBeenCalled();
      expect(mockLineupCreate).not.toHaveBeenCalled();
    });
  });

  it('keeps planned rotations sorted by rotationNumber from list', async () => {
    const props = createDefaultProps();

    let capturedGamePlanNext: ((data: { items: Array<{ id: string }> }) => void) | null = null;

    mockGamePlanObserveQuery.mockReturnValue({
      subscribe: (handlers: { next: (data: { items: Array<{ id: string }> }) => void }) => {
        capturedGamePlanNext = handlers.next;
        return makeNoOpSub();
      },
    });

    mockPlannedRotationList.mockResolvedValue({
      data: [
        { id: 'r2', gamePlanId: 'gp-1', rotationNumber: 2 },
        { id: 'r1', gamePlanId: 'gp-1', rotationNumber: 1 },
      ],
    });

    const { result } = renderHook(() => useGameSubscriptions(props));

    act(() => {
      capturedGamePlanNext?.({ items: [{ id: 'gp-1' }] });
    });

    await waitFor(() => {
      expect(result.current.plannedRotations.map(r => r.rotationNumber)).toEqual([1, 2]);
    });
  });
});
