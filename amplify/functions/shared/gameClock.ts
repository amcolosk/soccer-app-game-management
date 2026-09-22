/**
 * Lambda-side mirror of `src/utils/gameClock.ts`. A Lambda handler can't
 * import from `src/` (separate build/bundle root), so this is a deliberate,
 * parity-tested duplicate rather than a shared import — see
 * `gameClock.test.ts` in this directory for the parity test asserting
 * identical output to the client copy for the same inputs.
 *
 * Milestone B2's `submit-stat-event` handler is the first (and, as of this
 * milestone, only) consumer: `gameSeconds`/`half` for a helper's submitted
 * Goal/Shot/Save are derived server-side from the team's current `Game`
 * record, never trusted from the untrusted public client.
 *
 * Contract (unchanged from the client copy, keep both in sync on any
 * change):
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
