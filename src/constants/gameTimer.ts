/**
 * Game timer / clock-drift constants, shared between useGameTimer.ts and
 * useGameSubscriptions.ts so the two auto-trigger boundaries (auto-halftime,
 * auto-end) and the gap-detection heuristic never drift out of sync with
 * each other.
 */

/** Auto-end-game safety cap, in game-clock seconds (useGameTimer.ts). */
export const MAX_GAME_SECONDS = 7200;

/**
 * A resume gap at or above this many seconds is treated as "anomalous" —
 * eligible for the unrecorded-stoppage confirmation modal — unless it lands
 * on an auto-trigger boundary (auto-halftime, auto-end) that already handles
 * it silently. Conservative starting point; tune against real game data.
 */
export const ANOMALOUS_GAP_THRESHOLD_SECONDS = 600; // 10 minutes

/**
 * localStorage key recording that this specific device (browser/profile) has
 * had this specific game's timer running at least once, written whenever
 * useGameTimer's isRunning transitions to true. Its presence is the signal
 * useGameSubscriptions uses to distinguish "this device's timer was running
 * and then lost continuity" (crash/backgrounding — eligible for the gap
 * modal) from "this device is opening an already-running game for the first
 * time" (a second coach's device, or simply the first load this session —
 * always silent, matching pre-existing behavior). Scoped by user id, not
 * just game id, so a shared device signed into a different coach's account
 * doesn't inherit another coach's continuity signal.
 */
export function buildTimerHeartbeatStorageKey(userId: string, gameId: string): string {
  return `teamtrack:timerHeartbeat:${userId}:${gameId}`;
}
