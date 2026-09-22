/**
 * Pure game-clock arithmetic, extracted from
 * `src/components/GameManagement/hooks/useGameSubscriptions.ts` (Milestone
 * B1 — Fan Mode is the first consumer of this formula outside that hook, so
 * doing the extraction here avoids a guaranteed-to-diverge inline
 * reimplementation on the new `FanGameView` page).
 *
 * NOT `gameTimeUtils.ts` — that file is display-formatting only
 * (`formatGameTimeDisplay`/`formatMinutesSeconds`/`isoToDatetimeLocal`), no
 * clock arithmetic. This is the actual conversion logic CLAUDE.md's
 * "Game timer is client-side, synced periodically" section refers to.
 *
 * Contract (unchanged from the original inline formula):
 * - Running (`status === 'in-progress'` and `lastStartTime` set): current
 *   game seconds = `elapsedSeconds + floor((now - lastStartTime) / 1000)`.
 * - Otherwise (paused, halftime, scheduled, completed, or `lastStartTime`
 *   absent): current game seconds = `elapsedSeconds` as-is, frozen.
 */

export interface GameClockInput {
  status?: string | null;
  elapsedSeconds?: number | null;
  lastStartTime?: string | null;
}

/**
 * Returns the current in-game elapsed seconds for the given clock state.
 * `now` defaults to `Date.now()` but is accepted as a parameter so callers
 * (and tests) can seed a deterministic value.
 */
export function computeCurrentGameSeconds(input: GameClockInput, now: number = Date.now()): number {
  const elapsedSeconds = input.elapsedSeconds ?? 0;

  if (input.status === 'in-progress' && input.lastStartTime) {
    const lastStart = new Date(input.lastStartTime).getTime();
    if (Number.isNaN(lastStart)) {
      return elapsedSeconds;
    }
    const additionalSeconds = Math.floor((now - lastStart) / 1000);
    return elapsedSeconds + additionalSeconds;
  }

  return elapsedSeconds;
}
