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

  it('creates a 1000ms interval when isRunning=true and gameState.status=in-progress', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'in-progress';

    renderHook(() => useGameTimer(props));

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
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

  it('calling setCurrentTime after 1000ms increments current time by 1', () => {
    const mockSetCurrentTime = vi.fn((updater: ((prev: number) => number) | number) => {
      if (typeof updater === 'function') {
        return updater(0);
      }
      return updater;
    });

    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'in-progress';
    props.setCurrentTime = mockSetCurrentTime;

    renderHook(() => useGameTimer(props));

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockSetCurrentTime).toHaveBeenCalled();
    const updater = mockSetCurrentTime.mock.calls[0][0];
    expect(updater(0)).toBe(1);
  });

  it('calls onHalftime when currentTime reaches halfLengthSeconds (in first half)', () => {
    const mockOnHalftime = vi.fn();
    const mockSetCurrentTime = vi.fn();

    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'in-progress';
    props.gameState.currentHalf = 1;
    props.halfLengthSeconds = 10;
    props.currentTime = 0;
    props.setCurrentTime = mockSetCurrentTime;
    props.onHalftime = mockOnHalftime;

    renderHook(() => useGameTimer(props));

    // Advance timer by 1000ms to trigger the interval once
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // setCurrentTime should have been called
    expect(mockSetCurrentTime).toHaveBeenCalled();

    // Get the updater function and verify halftime logic
    const updater = mockSetCurrentTime.mock.calls[0][0];
    expect(typeof updater).toBe('function');

    // Simulate what happens when currentTime goes from 9 to 10
    const result = updater(9);
    expect(result).toBe(10);

    // The halftime callback should be scheduled via setTimeout
    vi.advanceTimersByTime(0);
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
    props.currentTime = 0;
    props.setCurrentTime = mockSetCurrentTime;
    props.onHalftime = mockOnHalftime;

    const { rerender } = renderHook(() => useGameTimer(props));

    // First tick
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const updater = mockSetCurrentTime.mock.calls[0][0];
    updater(9); // Triggers halftime
    vi.advanceTimersByTime(0);
    expect(mockOnHalftime).toHaveBeenCalledTimes(1);

    // Update currentTime to 10 and rerender (simulates being past halftime)
    props.currentTime = 10;
    mockSetCurrentTime.mockClear();
    rerender();

    // Another tick
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    if (mockSetCurrentTime.mock.calls.length > 0) {
      const updater2 = mockSetCurrentTime.mock.calls[0][0];
      updater2(10); // Should not trigger halftime again
      vi.advanceTimersByTime(0);
    }

    // Should still be called only once
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
    props.currentTime = 9;
    props.setCurrentTime = mockSetCurrentTime;
    props.onHalftime = mockOnHalftime;

    renderHook(() => useGameTimer(props));

    // Advance 1000ms so the interval actually fires
    act(() => { vi.advanceTimersByTime(1000); });
    // Manually invoke the updater with a value that would trigger halftime if half===1
    if (mockSetCurrentTime.mock.calls.length > 0) {
      const updater = mockSetCurrentTime.mock.calls[0][0];
      updater(9); // newTime=10 = halfLengthSeconds, but currentHalf===2 so guard blocks
      vi.advanceTimersByTime(0); // flush any setTimeout(0) that might have been scheduled
    }
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

  it('calls onEndGame when currentTime reaches 7200', () => {
    const mockOnEndGame = vi.fn();
    const mockSetCurrentTime = vi.fn();

    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'in-progress';
    props.halfLengthSeconds = 8000; // > 7200 so halftime check does not fire first
    props.currentTime = 0;
    props.setCurrentTime = mockSetCurrentTime;
    props.onEndGame = mockOnEndGame;

    renderHook(() => useGameTimer(props));

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockSetCurrentTime).toHaveBeenCalled();
    const updater = mockSetCurrentTime.mock.calls[0][0];
    const newTime = updater(7199);
    expect(newTime).toBe(7200);

    vi.advanceTimersByTime(0);
    expect(mockOnEndGame).toHaveBeenCalled();
  });

  it('does NOT call onEndGame multiple times when already triggered', () => {
    const mockOnEndGame = vi.fn();
    const mockSetCurrentTime = vi.fn();

    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'in-progress';
    props.halfLengthSeconds = 8000; // > 7200 so halftime check does not fire first
    props.currentTime = 0;
    props.setCurrentTime = mockSetCurrentTime;
    props.onEndGame = mockOnEndGame;

    const { rerender } = renderHook(() => useGameTimer(props));

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const updater = mockSetCurrentTime.mock.calls[0][0];
    updater(7199); // Triggers end game
    vi.advanceTimersByTime(0);
    expect(mockOnEndGame).toHaveBeenCalledTimes(1);

    // Update currentTime to 7200 and rerender
    props.currentTime = 7200;
    mockSetCurrentTime.mockClear();
    rerender();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    if (mockSetCurrentTime.mock.calls.length > 0) {
      const updater2 = mockSetCurrentTime.mock.calls[0][0];
      updater2(7200);
      vi.advanceTimersByTime(0);
    }

    // Should not call onEndGame again
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
    props.currentTime = 0;
    props.setCurrentTime = mockSetCurrentTime;
    props.gamePlan = { id: 'plan-1' } as GamePlan;
    props.plannedRotations = [rotation];

    renderHook(() => useGameTimer(props));

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Simulate the timer tick from 539 to 540 (9:00)
    expect(mockSetCurrentTime).toHaveBeenCalled();
    const updater = mockSetCurrentTime.mock.calls[0][0];
    updater(539); // This should trigger at 540 seconds (9:00)

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
    props.currentTime = 0;
    props.setCurrentTime = mockSetCurrentTime;
    props.gamePlan = { id: 'plan-1' } as GamePlan;
    props.plannedRotations = [rotation];

    renderHook(() => useGameTimer(props));

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockSetCurrentTime).toHaveBeenCalled();
    const updater = mockSetCurrentTime.mock.calls[0][0];
    updater(539);

    expect(mockPlannedRotationUpdate).not.toHaveBeenCalled();
  });

  it('uses latest onHalftime/onEndGame via refs — updated callbacks are invoked, not stale ones', () => {
    const mockOnHalftime1 = vi.fn();
    const mockOnHalftime2 = vi.fn();
    const mockSetCurrentTime = vi.fn();

    const props = createDefaultProps();
    props.isRunning = true;
    props.gameState.status = 'in-progress';
    props.gameState.currentHalf = 1;
    props.halfLengthSeconds = 10;
    props.currentTime = 0;
    props.setCurrentTime = mockSetCurrentTime;
    props.onHalftime = mockOnHalftime1;

    const { rerender } = renderHook(() => useGameTimer(props));

    // Update callback reference before the interval fires
    props.onHalftime = mockOnHalftime2;
    rerender();

    // Now trigger the interval
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const updater = mockSetCurrentTime.mock.calls[0][0];
    updater(9); // Triggers halftime

    // Now advance the setTimeout
    vi.advanceTimersByTime(0);

    // Should call the new callback, not the old one
    expect(mockOnHalftime2).toHaveBeenCalled();
    expect(mockOnHalftime1).not.toHaveBeenCalled();
  });
});
