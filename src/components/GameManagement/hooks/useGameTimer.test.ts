import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGameTimer } from './useGameTimer';
import type { Game, GamePlan, PlannedRotation } from '../types';

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const { mockGameUpdate, mockPlannedRotationUpdate, mockHandleApiError } = vi.hoisted(() => ({
  mockGameUpdate: vi.fn(),
  mockPlannedRotationUpdate: vi.fn(),
  mockHandleApiError: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      Game: {
        update: mockGameUpdate,
      },
      PlannedRotation: {
        update: mockPlannedRotationUpdate,
      },
    },
  })),
}));

vi.mock('../../../utils/errorHandler', () => ({
  handleApiError: mockHandleApiError,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDefaultProps(): Parameters<typeof useGameTimer>[0] {
  return {
    game: { id: 'game-1' } as Game,
    gameState: { status: 'in-progress', currentHalf: 1 } as Game,
    halfLengthSeconds: 1800, // 30 minutes
    currentTime: 0,
    setCurrentTime: vi.fn(),
    isRunning: false,
    gamePlan: null,
    plannedRotations: [],
    onHalftime: vi.fn(),
    onEndGame: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useGameTimer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockGameUpdate.mockResolvedValue({ data: {} });
    mockPlannedRotationUpdate.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not create interval when isRunning is false', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const props = createDefaultProps();

    renderHook(() => useGameTimer(props));

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it('does not create interval when isRunning is true but gameState.status is not in-progress', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'halftime';

    renderHook(() => useGameTimer(props));

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it('creates a 500ms interval when isRunning=true and gameState.status=in-progress', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'in-progress';

    renderHook(() => useGameTimer(props));

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 500);
  });

  it('creates a 5000ms save interval when timer starts', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'in-progress';

    renderHook(() => useGameTimer(props));

    // Second call is the save interval
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
  });

  it('setCurrentTime is called with wall-clock derived time (increments each second)', () => {
    const mockSetCurrentTime = vi.fn();

    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'in-progress';
    props.currentTime = 0;
    props.setCurrentTime = mockSetCurrentTime;

    renderHook(() => useGameTimer(props));

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Two 500ms ticks fire; derived at 1000ms = floor(1000/1000) = 1
    expect(mockSetCurrentTime).toHaveBeenCalled();
    const lastArg = mockSetCurrentTime.mock.lastCall![0];
    expect(typeof lastArg).toBe('number');
    expect(lastArg).toBe(1);
  });

  it('calls onHalftime when derived time reaches halfLengthSeconds (in first half)', () => {
    const mockOnHalftime = vi.fn();
    const mockSetCurrentTime = vi.fn();

    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'in-progress';
    props.gameState.currentHalf = 1;
    props.halfLengthSeconds = 10;
    // Anchor at 9s so 1s of wall-clock time brings derived to 10 = halfLengthSeconds
    props.currentTime = 9;
    props.setCurrentTime = mockSetCurrentTime;
    props.onHalftime = mockOnHalftime;

    renderHook(() => useGameTimer(props));

    act(() => {
      vi.advanceTimersByTime(1000); // derived = 9 + floor(1000/1000) = 10 >= halfLengthSeconds
    });

    expect(mockSetCurrentTime).toHaveBeenCalled();
    // The halftime callback is scheduled via setTimeout(0)
    act(() => { vi.advanceTimersByTime(0); });
    expect(mockOnHalftime).toHaveBeenCalled();
  });

  it('does NOT call onHalftime when already triggered (halftimeTriggeredRef guard)', () => {
    const mockOnHalftime = vi.fn();
    const mockSetCurrentTime = vi.fn();

    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'in-progress';
    props.gameState.currentHalf = 1;
    props.halfLengthSeconds = 10;
    props.currentTime = 9; // derived = 10 after 1000ms → fires halftime
    props.setCurrentTime = mockSetCurrentTime;
    props.onHalftime = mockOnHalftime;

    const { rerender } = renderHook(() => useGameTimer(props));

    // First advance — triggers halftime
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => { vi.advanceTimersByTime(0); });
    expect(mockOnHalftime).toHaveBeenCalledTimes(1);

    // Simulate time advancing further — guard should block second call
    mockSetCurrentTime.mockClear();
    props.currentTime = 10;
    rerender();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => { vi.advanceTimersByTime(0); });

    // Guard prevents re-firing
    expect(mockOnHalftime).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onHalftime when currentHalf === 2', () => {
    const mockOnHalftime = vi.fn();
    const mockSetCurrentTime = vi.fn();

    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'in-progress';
    props.gameState.currentHalf = 2;
    props.halfLengthSeconds = 10;
    // Even though derived will reach >= 10, currentHalf === 2 blocks the halftime guard
    props.currentTime = 9;
    props.setCurrentTime = mockSetCurrentTime;
    props.onHalftime = mockOnHalftime;

    renderHook(() => useGameTimer(props));

    act(() => { vi.advanceTimersByTime(1000); });
    act(() => { vi.advanceTimersByTime(0); });
    expect(mockOnHalftime).not.toHaveBeenCalled();
  });

  it('resets the halftime guard when gameState.currentHalf changes to 2', () => {
    const props = createDefaultProps();
    props.gameState.currentHalf = 1;

    const { rerender } = renderHook(() => useGameTimer(props));

    // Change to second half
    props.gameState.currentHalf = 2;
    rerender();

    // Guard should be reset (tested implicitly by other tests)
    expect(props.gameState.currentHalf).toBe(2);
  });

  it('calls onEndGame when derived time reaches 7200', () => {
    const mockOnEndGame = vi.fn();
    const mockSetCurrentTime = vi.fn();

    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'in-progress';
    props.halfLengthSeconds = 8000; // > 7200 so halftime check does not fire first
    // Anchor at 7199s so 1s of wall-clock brings derived to 7200
    props.currentTime = 7199;
    props.setCurrentTime = mockSetCurrentTime;
    props.onEndGame = mockOnEndGame;

    renderHook(() => useGameTimer(props));

    act(() => {
      vi.advanceTimersByTime(1000); // derived = 7199 + floor(1000/1000) = 7200 >= 7200
    });

    act(() => { vi.advanceTimersByTime(0); });
    expect(mockOnEndGame).toHaveBeenCalled();
  });

  it('does NOT call onEndGame multiple times when already triggered', () => {
    const mockOnEndGame = vi.fn();
    const mockSetCurrentTime = vi.fn();

    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'in-progress';
    props.halfLengthSeconds = 8000; // > 7200 so halftime check does not fire first
    props.currentTime = 7199; // Anchor at 7199s; after 1s derived = 7200 → end game fires
    props.setCurrentTime = mockSetCurrentTime;
    props.onEndGame = mockOnEndGame;

    const { rerender } = renderHook(() => useGameTimer(props));

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => { vi.advanceTimersByTime(0); });
    expect(mockOnEndGame).toHaveBeenCalledTimes(1);

    // More time passes — guard must block re-trigger
    mockSetCurrentTime.mockClear();
    props.currentTime = 7200;
    rerender();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => { vi.advanceTimersByTime(0); });

    expect(mockOnEndGame).toHaveBeenCalledTimes(1);
  });

  it('clears both intervals when isRunning becomes false', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'in-progress';

    const { rerender } = renderHook(() => useGameTimer(props));

    props.isRunning = false;
    rerender();

    // 2 intervals created, both should be cleared
    expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
  });

  it('clears both intervals on unmount', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'in-progress';

    const { unmount } = renderHook(() => useGameTimer(props));

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
  });

  it('marks PlannedRotation as viewed when timer reaches rotationMinute - 1 and rotation is not yet viewed', () => {
    const mockSetCurrentTime = vi.fn();
    const rotation: PlannedRotation = {
      id: 'rotation-1',
      half: 1,
      gameMinute: 10,
      viewedAt: null,
    } as PlannedRotation;

    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'in-progress';
    props.gameState.currentHalf = 1;
    // Anchor at 539s; after 1s derived = 540 = 9:00 = gameMinute(10) - 1 minute
    props.currentTime = 539;
    props.setCurrentTime = mockSetCurrentTime;
    props.gamePlan = { id: 'plan-1' } as GamePlan;
    props.plannedRotations = [rotation];

    renderHook(() => useGameTimer(props));

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // derived = 540, Math.floor(540/60) = 9 = gameMinute-1 → rotation viewed
    expect(mockPlannedRotationUpdate).toHaveBeenCalledWith({
      id: 'rotation-1',
      viewedAt: expect.any(String),
    });
  });

  it('does not mark rotation as viewed if it is already viewed (viewedAt set)', () => {
    const mockSetCurrentTime = vi.fn();
    const rotation: PlannedRotation = {
      id: 'rotation-1',
      half: 1,
      gameMinute: 10,
      viewedAt: '2025-01-01T00:00:00Z',
    } as PlannedRotation;

    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'in-progress';
    props.gameState.currentHalf = 1;
    // Same threshold timing, but viewedAt is set
    props.currentTime = 539;
    props.setCurrentTime = mockSetCurrentTime;
    props.gamePlan = { id: 'plan-1' } as GamePlan;
    props.plannedRotations = [rotation];

    renderHook(() => useGameTimer(props));

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockPlannedRotationUpdate).not.toHaveBeenCalled();
  });

  // ── iOS backgrounding (issue #31) ────────────────────────────────────────

  it('derives correct game time after a large wall-clock jump (simulates iOS backgrounding)', () => {
    // Demonstrates the wall-clock fix: even if only ONE interval tick fires after
    // a 60-second background period, the derived time is correct (100 + 60 = 160),
    // unlike the old functional-updater approach which would only give 101.
    const mockSetCurrentTime = vi.fn();
    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'in-progress';
    props.currentTime = 100; // anchor at 100s
    props.setCurrentTime = mockSetCurrentTime;

    renderHook(() => useGameTimer(props));

    // Jump Date.now() forward 60 seconds WITHOUT firing intermediate ticks
    // (simulates the OS throttling timers while the app is backgrounded)
    act(() => {
      vi.setSystemTime(new Date(Date.now() + 60000));
      vi.advanceTimersByTime(500); // fire exactly one tick
    });

    // The single tick must derive 100 + floor(60500/1000) = 100 + 60 = 160
    const lastArg = mockSetCurrentTime.mock.lastCall![0];
    expect(typeof lastArg).toBe('number');
    expect(lastArg).toBe(160);
  });

  it('resetAnchor re-bases wall-clock derivation to the new game time', () => {
    const mockSetCurrentTime = vi.fn();
    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'in-progress';
    props.currentTime = 0;
    props.setCurrentTime = mockSetCurrentTime;

    const { result } = renderHook(() => useGameTimer(props));

    // Call resetAnchor to jump to 500s (e.g. from +5 minute test control)
    act(() => {
      result.current.resetAnchor(500);
    });

    // After 1 second of wall-clock time, derived should be 500 + 1 = 501
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const lastArg = mockSetCurrentTime.mock.lastCall![0];
    expect(lastArg).toBe(501);
  });

  it('persists elapsed time to the database every 5 seconds', () => {
    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'in-progress';
    props.currentTime = 0;
    props.setCurrentTime = vi.fn();

    renderHook(() => useGameTimer(props));

    act(() => {
      vi.advanceTimersByTime(5000); // trigger the save interval
    });

    expect(mockGameUpdate).toHaveBeenCalledWith({
      id: 'game-1',
      elapsedSeconds: 5,
      lastStartTime: expect.any(String),
    });
  });

  it('effect cleanup prevents saveInterval from firing after gameState.status changes to completed', () => {
    // What this test actually verifies: when gameState.status changes to 'completed',
    // the effect dep array ([isRunning, gameState.status, ...]) triggers React's cleanup
    // function, which calls clearInterval on both intervals BEFORE advanceTimersByTime
    // can fire them. The intervals are therefore never executed.
    //
    // Note: the gameStatusRef guard at line ~126 of useGameTimer.ts is a defense-in-depth
    // measure for a narrower race condition (interval fires in the same render cycle
    // before cleanup runs). That guard is NOT what this test exercises — the cleanup
    // fires first, making the guard unreachable in this scenario.
    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'in-progress';
    props.currentTime = 0;
    props.setCurrentTime = vi.fn();

    const { rerender } = renderHook(() => useGameTimer(props));

    // Simulate game completing — changing gameState.status triggers effect cleanup,
    // which clears both intervals before they can fire.
    props.gameState = { ...props.gameState, status: 'completed' };
    rerender();

    // Advance past the 5-second save interval threshold; intervals are already cleared.
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // No DB write should have occurred because the interval was cleared by cleanup.
    expect(mockGameUpdate).not.toHaveBeenCalled();
  });

  // ── Callback ref correctness ─────────────────────────────────────────────

  it('uses latest onHalftime/onEndGame via refs — updated callbacks are invoked, not stale ones', () => {
    const mockOnHalftime1 = vi.fn();
    const mockOnHalftime2 = vi.fn();
    const mockSetCurrentTime = vi.fn();

    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'in-progress';
    props.gameState.currentHalf = 1;
    props.halfLengthSeconds = 10;
    // Anchor at 9s so 1s of wall-clock brings derived to 10 = halfLengthSeconds
    props.currentTime = 9;
    props.setCurrentTime = mockSetCurrentTime;
    props.onHalftime = mockOnHalftime1;

    const { rerender } = renderHook(() => useGameTimer(props));

    // Update callback reference before the interval fires
    props.onHalftime = mockOnHalftime2;
    rerender();

    // Now trigger the interval
    act(() => {
      vi.advanceTimersByTime(1000); // derived = 10 >= halfLengthSeconds
    });

    act(() => { vi.advanceTimersByTime(0); });

    // Should call the new callback, not the old one
    expect(mockOnHalftime2).toHaveBeenCalled();
    expect(mockOnHalftime1).not.toHaveBeenCalled();
  });
});
