import { useEffect, useRef } from 'react';

/**
 * Acquires a Screen Wake Lock while isActive is true, preventing the screen
 * from sleeping during an active game. Automatically releases on unmount,
 * when isActive becomes false, or when the page is hidden. Re-acquires when
 * the page becomes visible again if isActive is still true.
 *
 * Silently no-ops on browsers that do not support the Wake Lock API
 * (Firefox, iOS < 16.4, Safari desktop).
 */
export function useWakeLock(isActive: boolean): void {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const shouldHoldRef = useRef(false);

  useEffect(() => {
    if (!('wakeLock' in navigator)) return;

    shouldHoldRef.current = isActive;

    const acquire = async () => {
      if (!shouldHoldRef.current) return;
      if (sentinelRef.current !== null) return;
      if (document.visibilityState !== 'visible') return;
      try {
        sentinelRef.current = await navigator.wakeLock.request('screen');
        sentinelRef.current.addEventListener('release', () => {
          sentinelRef.current = null;
        });
      } catch {
        // Ignore — permission denied or page hidden race condition
      }
    };

    const release = async () => {
      if (sentinelRef.current) {
        try {
          await sentinelRef.current.release();
        } catch {
          // Ignore
        }
        sentinelRef.current = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void acquire();
      } else {
        void release();
      }
    };

    if (isActive) {
      void acquire();
      document.addEventListener('visibilitychange', onVisibilityChange);
    } else {
      void release();
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void release();
    };
  }, [isActive]);
}
