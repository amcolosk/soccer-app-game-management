import { useEffect, useRef } from 'react';
import { formatPlayTime } from '../utils/playTimeCalculations';

const NOTIFICATION_TAG = 'teamtrack-live-game';
const UPDATE_INTERVAL_MS = 30_000;

export interface UseGameNotificationParams {
  /** True when game status is 'in-progress' or 'halftime' */
  isActive: boolean;
  /** When true and permission is 'default', request permission immediately */
  requestPermissionNow?: boolean;
  teamName: string;
  opponent: string;
  ourScore: number;
  opponentScore: number;
  /** Current game half (1 or 2) */
  currentHalf: number;
  /** Elapsed game time in seconds */
  currentTime: number;
}

/**
 * Shows a persistent notification in the device notification shade
 * while a game is active, updated every 30 seconds with the latest
 * score and game time.
 *
 * Uses ServiceWorkerRegistration.showNotification() for cross-platform
 * PWA compatibility including iOS Safari 16.4+.
 *
 * Silently no-ops when notifications are not supported or permission
 * is denied.
 */
export function useGameNotification({
  isActive,
  requestPermissionNow = false,
  teamName,
  opponent,
  ourScore,
  opponentScore,
  currentHalf,
  currentTime,
}: UseGameNotificationParams): void {
  // Keep latest param values accessible inside setInterval closure
  // without needing to restart the interval on every render.
  const paramsRef = useRef({
    teamName, opponent, ourScore, opponentScore, currentHalf, currentTime,
  });
  paramsRef.current = { teamName, opponent, ourScore, opponentScore, currentHalf, currentTime };

  // Permission request effect — fires when requestPermissionNow becomes true
  useEffect(() => {
    if (!requestPermissionNow) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'default') return;
    void Notification.requestPermission();
  }, [requestPermissionNow]);

  // Main notification lifecycle effect
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (!('Notification' in window)) return;

    if (!isActive) {
      // Dismiss the live-game notification when game ends or component unmounts
      navigator.serviceWorker.ready
        .then((reg) => reg.getNotifications({ tag: NOTIFICATION_TAG }))
        .then((notifications) => notifications.forEach((n) => n.close()))
        .catch(() => { /* ignore */ });
      return;
    }

    const showNotification = async () => {
      if (Notification.permission !== 'granted') return;
      let reg: ServiceWorkerRegistration;
      try {
        reg = await navigator.serviceWorker.ready;
      } catch {
        return;
      }
      const { teamName: t, opponent: o, ourScore: us, opponentScore: them, currentHalf: half, currentTime: time } = paramsRef.current;
      const title = `${t} vs ${o}`;
      const halfLabel = half === 2 ? 'H2' : 'H1';
      const timeStr = formatPlayTime(time, 'short');
      const body = `${us} – ${them}  ·  ${halfLabel} ${timeStr}`;
      try {
        // Cast to unknown first because TypeScript's DOM typings do not yet
        // include `renotify` in NotificationOptions, but it is part of the
        // W3C Notifications spec and is required so the browser actually
        // replaces/refreshes the visible notification when the same tag is reused.
        const options = {
          tag: NOTIFICATION_TAG,
          body,
          icon: '/soccer_app_192.png',
          silent: true,
          renotify: true,
        } as unknown as NotificationOptions;
        await reg.showNotification(title, options);
      } catch {
        // Ignore — showNotification can fail if SW becomes inactive
      }
    };

    void showNotification();
    const interval = setInterval(() => { void showNotification(); }, UPDATE_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      // Dismiss notification on cleanup (guard against SW being unavailable at cleanup time)
      if (navigator.serviceWorker) {
        navigator.serviceWorker.ready
          .then((reg) => reg.getNotifications({ tag: NOTIFICATION_TAG }))
          .then((notifications) => notifications.forEach((n) => n.close()))
          .catch(() => { /* ignore */ });
      }
    };
  }, [isActive]); // paramsRef is updated every render; interval reads via ref, no stale closure
}
