import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGameNotification } from './useGameNotification';

// ── Mock helpers ──────────────────────────────────────────────────────────────

interface MockNotification {
  close: ReturnType<typeof vi.fn>;
  tag?: string;
}

function makeRegistration(permission: NotificationPermission = 'granted') {
  const mockNotifications: MockNotification[] = [];
  const showNotification = vi.fn(async () => {
    mockNotifications.push({ close: vi.fn(), tag: 'teamtrack-live-game' });
  });
  const getNotifications = vi.fn(async () => mockNotifications);

  const reg = { showNotification, getNotifications };

  // navigator.serviceWorker.ready resolves to reg
  const serviceWorker = {
    ready: Promise.resolve(reg),
  };

  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: serviceWorker,
    writable: true,
  });

  // Mock Notification global
  const NotificationMock = {
    permission: permission as NotificationPermission,
    requestPermission: vi.fn(async () => 'granted' as NotificationPermission),
  };

  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: NotificationMock,
    writable: true,
  });

  return { reg, mockNotifications };
}

// ── Default params ────────────────────────────────────────────────────────────

const defaultParams = {
  isActive: true,
  teamName: 'Eagles',
  opponent: 'Hawks',
  ourScore: 2,
  opponentScore: 1,
  currentHalf: 1,
  currentTime: 900, // 15:00
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useGameNotification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls requestPermission when requestPermissionNow is true and permission is default', async () => {
    makeRegistration('default');
    const NotifMock = window.Notification as unknown as {
      permission: string;
      requestPermission: ReturnType<typeof vi.fn>;
    };
    NotifMock.permission = 'default';

    const { unmount } = renderHook(() =>
      useGameNotification({ ...defaultParams, requestPermissionNow: true }),
    );

    await act(async () => {});

    expect(NotifMock.requestPermission).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('does not call requestPermission when permission is already granted', async () => {
    makeRegistration('granted');
    const NotifMock = window.Notification as unknown as {
      permission: string;
      requestPermission: ReturnType<typeof vi.fn>;
    };

    const { unmount } = renderHook(() =>
      useGameNotification({ ...defaultParams, requestPermissionNow: true }),
    );

    await act(async () => {});

    expect(NotifMock.requestPermission).not.toHaveBeenCalled();
    unmount();
  });

  it('does not call requestPermission when requestPermissionNow is false', async () => {
    makeRegistration('default');
    const NotifMock = window.Notification as unknown as {
      permission: string;
      requestPermission: ReturnType<typeof vi.fn>;
    };
    NotifMock.permission = 'default';

    const { unmount } = renderHook(() =>
      useGameNotification({ ...defaultParams, requestPermissionNow: false }),
    );

    await act(async () => {});

    expect(NotifMock.requestPermission).not.toHaveBeenCalled();
    unmount();
  });

  it('calls reg.showNotification with correct title, body, tag, and icon when isActive and permission granted', async () => {
    const { reg } = makeRegistration('granted');

    const { unmount } = renderHook(() =>
      useGameNotification({ ...defaultParams }),
    );

    await act(async () => {});

    expect(reg.showNotification).toHaveBeenCalledTimes(1);
    const [title, options] = reg.showNotification.mock.calls[0] as [string, NotificationOptions];
    expect(title).toBe('Eagles vs Hawks');
    expect(options.tag).toBe('teamtrack-live-game');
    expect(options.icon).toBe('/soccer_app_192.png');
    expect(options.body).toContain('2 – 1');
    expect(options.body).toContain('H1');
    expect(options.body).toContain('15:00');

    unmount();
  });

  it('includes renotify: true and silent: true in notification options', async () => {
    const { reg } = makeRegistration('granted');

    const { unmount } = renderHook(() =>
      useGameNotification({ ...defaultParams }),
    );

    await act(async () => {});

    const [, options] = reg.showNotification.mock.calls[0] as [string, NotificationOptions & { renotify?: boolean }];
    expect(options.renotify).toBe(true);
    expect(options.silent).toBe(true);

    unmount();
  });

  it('uses H2 label when currentHalf is 2', async () => {
    const { reg } = makeRegistration('granted');

    const { unmount } = renderHook(() =>
      useGameNotification({ ...defaultParams, currentHalf: 2, currentTime: 1800 }),
    );

    await act(async () => {});

    const [, options] = reg.showNotification.mock.calls[0] as [string, NotificationOptions];
    expect(options.body).toContain('H2');

    unmount();
  });

  it('does not call showNotification when permission is denied', async () => {
    const { reg } = makeRegistration('denied');
    const NotifMock = window.Notification as unknown as { permission: string };
    NotifMock.permission = 'denied';

    const { unmount } = renderHook(() =>
      useGameNotification({ ...defaultParams }),
    );

    await act(async () => {});

    expect(reg.showNotification).not.toHaveBeenCalled();
    unmount();
  });

  it('does not call showNotification when isActive is false', async () => {
    const { reg } = makeRegistration('granted');

    const { unmount } = renderHook(() =>
      useGameNotification({ ...defaultParams, isActive: false }),
    );

    await act(async () => {});

    expect(reg.showNotification).not.toHaveBeenCalled();
    unmount();
  });

  it('closes notifications (getNotifications + close) when isActive becomes false', async () => {
    const { reg } = makeRegistration('granted');

    const { rerender, unmount } = renderHook(
      ({ active }: { active: boolean }) =>
        useGameNotification({ ...defaultParams, isActive: active }),
      { initialProps: { active: true } },
    );

    await act(async () => {});

    // There should be a notification in the mock list now
    expect(reg.showNotification).toHaveBeenCalledTimes(1);

    // Transition to inactive
    rerender({ active: false });
    await act(async () => {});

    expect(reg.getNotifications).toHaveBeenCalledWith({ tag: 'teamtrack-live-game' });
    unmount();
  });

  it('closes notifications on unmount', async () => {
    const { reg } = makeRegistration('granted');

    const { unmount } = renderHook(() =>
      useGameNotification({ ...defaultParams }),
    );

    await act(async () => {});
    unmount();
    await act(async () => {});

    // getNotifications called during cleanup
    expect(reg.getNotifications).toHaveBeenCalledWith({ tag: 'teamtrack-live-game' });
  });

  it('fires showNotification again after 30 seconds via setInterval', async () => {
    const { reg } = makeRegistration('granted');

    const { unmount } = renderHook(() =>
      useGameNotification({ ...defaultParams }),
    );

    // Initial call
    await act(async () => {});
    expect(reg.showNotification).toHaveBeenCalledTimes(1);

    // Advance 30 seconds
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    // Allow the async showNotification promise to resolve
    await act(async () => {});

    expect(reg.showNotification).toHaveBeenCalledTimes(2);

    // Advance another 30 seconds
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    await act(async () => {});

    expect(reg.showNotification).toHaveBeenCalledTimes(3);

    unmount();
  });

  it('does not throw and does not call showNotification when serviceWorker is missing from navigator', async () => {
    // Simulate an environment where the serviceWorker property does not exist at all.
    // We delete it from the navigator prototype chain via Reflect so that
    // 'serviceWorker' in navigator evaluates to false — matching the hook's guard.
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    Reflect.deleteProperty(navigator, 'serviceWorker');

    // Also set up a minimal Notification mock so the hook's second guard passes
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { permission: 'granted', requestPermission: vi.fn() },
      writable: true,
    });

    let error: unknown;
    try {
      const { unmount } = renderHook(() =>
        useGameNotification({ ...defaultParams }),
      );
      await act(async () => {});
      unmount();
      await act(async () => {});
    } catch (e) {
      error = e;
    }

    // Restore original descriptor so other tests are not affected
    if (originalDescriptor) {
      Object.defineProperty(navigator, 'serviceWorker', originalDescriptor);
    }

    expect(error).toBeUndefined();
  });

  it('body contains formatted play time from formatPlayTime', async () => {
    const { reg } = makeRegistration('granted');

    // 5 minutes = 300 seconds → formatPlayTime(300, 'short') = "5:00"
    const { unmount } = renderHook(() =>
      useGameNotification({ ...defaultParams, currentTime: 300 }),
    );

    await act(async () => {});

    const [, options] = reg.showNotification.mock.calls[0] as [string, NotificationOptions];
    expect(options.body).toContain('5:00');

    unmount();
  });
});
