import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWakeLock } from './useWakeLock';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal WakeLockSentinel mock. */
function makeSentinel() {
  const sentinel = {
    released: false,
    release: vi.fn(async () => {
      sentinel.released = true;
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return sentinel;
}

/** Build a mock navigator.wakeLock with a controllable request function. */
function makeWakeLock(sentinel: ReturnType<typeof makeSentinel>) {
  return {
    request: vi.fn(async () => sentinel),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useWakeLock', () => {
  let sentinel: ReturnType<typeof makeSentinel>;
  let wakeLock: ReturnType<typeof makeWakeLock>;

  beforeEach(() => {
    sentinel = makeSentinel();
    wakeLock = makeWakeLock(sentinel);

    // Default: page is visible
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });

    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: wakeLock,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('acquires a sentinel when isActive is true and the API is available', async () => {
    const { unmount } = renderHook(() => useWakeLock(true));

    // Allow microtasks (async acquire) to flush
    await act(async () => {});

    expect(wakeLock.request).toHaveBeenCalledWith('screen');
    unmount();
  });

  it('does not acquire when isActive is false', async () => {
    const { unmount } = renderHook(() => useWakeLock(false));

    await act(async () => {});

    expect(wakeLock.request).not.toHaveBeenCalled();
    unmount();
  });

  it('releases the sentinel when isActive transitions from true to false', async () => {
    const { rerender, unmount } = renderHook(
      ({ active }: { active: boolean }) => useWakeLock(active),
      { initialProps: { active: true } },
    );

    await act(async () => {});
    expect(wakeLock.request).toHaveBeenCalledTimes(1);

    // Transition to inactive — the effect re-runs and calls release()
    rerender({ active: false });
    await act(async () => {});

    expect(sentinel.release).toHaveBeenCalled();
    unmount();
  });

  it('no-ops silently when navigator.wakeLock is undefined', async () => {
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: undefined,
      writable: true,
    });

    expect(() => {
      const { unmount } = renderHook(() => useWakeLock(true));
      unmount();
    }).not.toThrow();
  });

  it('re-acquires when visibilitychange fires to visible while isActive is true', async () => {
    const { unmount } = renderHook(() => useWakeLock(true));
    await act(async () => {});

    // Simulate the sentinel being released (e.g. OS reclaimed it)
    // Then fake the page becoming hidden and then visible again
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // After hidden: release should have been called
    expect(sentinel.release).toHaveBeenCalled();

    // The sentinel ref is now null (release sets it to null).
    // Make a new sentinel for the re-acquire.
    const sentinel2 = makeSentinel();
    wakeLock.request.mockResolvedValue(sentinel2);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Should have requested a new lock
    expect(wakeLock.request).toHaveBeenCalledTimes(2);

    unmount();
  });

  it('releases when visibilitychange fires to hidden', async () => {
    const { unmount } = renderHook(() => useWakeLock(true));
    await act(async () => {});

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(sentinel.release).toHaveBeenCalled();
    unmount();
  });

  it('releases the sentinel on unmount', async () => {
    const { unmount } = renderHook(() => useWakeLock(true));
    await act(async () => {});

    expect(sentinel.release).not.toHaveBeenCalled();
    unmount();
    await act(async () => {});

    expect(sentinel.release).toHaveBeenCalled();
  });

  it('does not attempt to acquire when page is hidden', async () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });

    const { unmount } = renderHook(() => useWakeLock(true));
    await act(async () => {});

    expect(wakeLock.request).not.toHaveBeenCalled();
    unmount();
  });
});
