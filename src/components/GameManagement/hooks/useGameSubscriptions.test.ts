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

const { mockLineupList, mockLineupCreate } = vi.hoisted(() => ({
  mockLineupList: vi.fn().mockResolvedValue({ data: [] }),
  mockLineupCreate: vi.fn().mockResolvedValue({ data: {} }),
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
    mockUseAmplifyQuery.mockReturnValue({ data: [], isSynced: false });
    mockLineupList.mockResolvedValue({ data: [] });
    mockLineupCreate.mockResolvedValue({ data: {} });
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

  it('does not sync lineup from gamePlan when local lineup already exists', async () => {
    const game = createDefaultGame({ status: 'scheduled' });
    const props = createDefaultProps({ game });

    mockUseAmplifyQuery.mockImplementation((model: string) => {
      if (model === 'LineupAssignment') {
        return { data: [{ id: 'la-1', positionId: 'pos1', playerId: 'p1' }], isSynced: true };
      }
      return { data: [], isSynced: false };
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
      expect(mockLineupList).not.toHaveBeenCalled();
      expect(mockLineupCreate).not.toHaveBeenCalled();
    });
  });

  it('does not sync lineup from gamePlan when DB already has assignments', async () => {
    const game = createDefaultGame({ status: 'scheduled' });
    const props = createDefaultProps({ game });

    mockLineupList.mockResolvedValue({
      data: [{ id: 'la-existing', gameId: 'game-1', playerId: 'p1', positionId: 'pos1' }],
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
    });
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
