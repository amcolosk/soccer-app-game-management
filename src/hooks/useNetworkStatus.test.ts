import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNetworkStatus } from './useNetworkStatus';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

function fireOffline() {
  window.dispatchEvent(new Event('offline'));
}

function fireOnline() {
  window.dispatchEvent(new Event('online'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useNetworkStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setNavigatorOnline(true);
  });

  it('initialises isOnline to true when navigator.onLine is true', () => {
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(true);
  });

  it('initialises isOnline to false when navigator.onLine is false', () => {
    setNavigatorOnline(false);
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(false);
  });

  it('sets isOnline to false when the offline event fires', () => {
    const { result } = renderHook(() => useNetworkStatus());
    act(() => fireOffline());
    expect(result.current.isOnline).toBe(false);
  });

  it('sets isOnline to true when the online event fires', () => {
    setNavigatorOnline(false);
    const { result } = renderHook(() => useNetworkStatus());
    act(() => fireOnline());
    expect(result.current.isOnline).toBe(true);
  });

  it('does NOT call onReconnect on initial mount when already online', () => {
    const onReconnect = vi.fn();
    renderHook(() => useNetworkStatus({ onReconnect }));
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it('does NOT call onReconnect for an online event without a prior offline event', () => {
    const onReconnect = vi.fn();
    renderHook(() => useNetworkStatus({ onReconnect }));
    act(() => fireOnline());
    act(() => fireOnline());
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it('calls onReconnect exactly once on an offline → online transition', () => {
    const onReconnect = vi.fn();
    renderHook(() => useNetworkStatus({ onReconnect }));
    act(() => fireOffline());
    expect(onReconnect).not.toHaveBeenCalled();
    act(() => fireOnline());
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('calls onReconnect once per offline → online cycle (multiple cycles)', () => {
    const onReconnect = vi.fn();
    renderHook(() => useNetworkStatus({ onReconnect }));
    act(() => { fireOffline(); });
    act(() => { fireOnline(); });
    act(() => { fireOffline(); });
    act(() => { fireOnline(); });
    expect(onReconnect).toHaveBeenCalledTimes(2);
  });

  it('invokes the latest onReconnect callback (ref-update pattern)', () => {
    const stale = vi.fn();
    const fresh = vi.fn();
    let current = stale;
    // Use a closure that reads `current` so rerender picks up changes
    const { rerender } = renderHook(() => useNetworkStatus({ onReconnect: current }));
    act(() => fireOffline());
    current = fresh;
    rerender();
    act(() => fireOnline());
    expect(stale).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it('removes both event listeners on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useNetworkStatus());
    unmount();
    const removedEvents = removeSpy.mock.calls.map(c => c[0]);
    expect(removedEvents).toContain('online');
    expect(removedEvents).toContain('offline');
    removeSpy.mockRestore();
  });
});
