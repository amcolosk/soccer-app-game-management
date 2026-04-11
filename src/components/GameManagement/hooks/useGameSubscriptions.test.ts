import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
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
        list: vi.fn().mockResolvedValue({ data: [] }),
      },
      LineupAssignment: {
        list: vi.fn().mockResolvedValue({ data: [] }),
        create: vi.fn().mockResolvedValue({ data: {} }),
      },
    },
  })),
}));

// Mock useAmplifyQuery so the secondary subscriptions (LineupAssignment,
// PlayTimeRecord, Goal, GameNote, PlayerAvailability) don't interfere.
vi.mock('../../../hooks/useAmplifyQuery', () => ({
  useAmplifyQuery: vi.fn().mockReturnValue({ data: [], isSynced: false }),
}));

vi.mock('../../../utils/errorHandler', () => ({
  handleApiError: vi.fn(),
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
} = {}) {
  return {
    game: overrides.game ?? createDefaultGame(),
    team: createDefaultTeam(),
    isRunning: overrides.isRunning ?? false,
    setCurrentTime: overrides.setCurrentTime ?? vi.fn(),
    setIsRunning: overrides.setIsRunning ?? vi.fn(),
    notesRefreshKey: 0,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useGameSubscriptions — Game observeQuery handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedGameNext = null;

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
});
