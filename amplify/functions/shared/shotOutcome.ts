/**
 * Lambda-side twin of `src/utils/shotOutcomeMapping.ts`'s
 * `deriveShotOutcomeWrites` -- same signature shape, same semantics, kept in
 * sync per `shotOutcome.test.ts`'s parity table (mirrors `gameClock.ts` /
 * `goalkeeper.ts` / `score.ts`'s existing pure-module parity-test
 * precedent). A Lambda can't import from `src/`, hence the separate copy.
 *
 * Every outcome always writes a Shot. GOAL additionally writes a Goal;
 * SAVED additionally writes a Save. BLOCKED/WIDE write only the Shot.
 */

export type ShotOutcome = 'GOAL' | 'SAVED' | 'BLOCKED' | 'WIDE';

export const VALID_OUTCOMES: readonly ShotOutcome[] = ['GOAL', 'SAVED', 'BLOCKED', 'WIDE'];

export function isValidOutcome(value: unknown): value is ShotOutcome {
  return typeof value === 'string' && (VALID_OUTCOMES as readonly string[]).includes(value);
}

export interface ShotOutcomeInput {
  forUs: boolean;
  outcome: ShotOutcome;
  playerId?: string | null; // shooter ("Us" only) -- also becomes Goal.scorerId on GOAL
  assistPlayerId?: string | null; // "Us" + GOAL only
  keeperPlayerId?: string | null; // "Them" + SAVED only -- our keeper
}

export interface DerivedShotWrites {
  shot: { takenByUs: boolean; outcome: ShotOutcome; playerId: string | null };
  goal: { scoredByUs: boolean; scorerId: string | null; assistId: string | null } | null;
  save: { byUs: boolean; playerId: string | null } | null;
}

/**
 * Derivations (verified against `Goal.scoredByUs`/`Save.byUs`'s existing
 * documented semantics -- easy to flip by accident, don't):
 * - `shot.takenByUs = forUs`; `shot.playerId = forUs ? (playerId ?? null) : null`.
 * - `goal` populated iff `outcome === 'GOAL'`: `scoredByUs = forUs` (an "Us"
 *   shot that goes in is our goal; a "Them" shot that goes in is their goal
 *   -- NOT inverted). `scorerId`/`assistId` only when `forUs`.
 * - `save` populated iff `outcome === 'SAVED'`: `byUs = !forUs` -- INVERTED
 *   relative to the shot's own side (a "Us" shot Saved means the opponent's
 *   keeper made it; a "Them" shot Saved means our keeper made it). `playerId`
 *   (keeper) only ever populated on the `!forUs` branch, from `keeperPlayerId`.
 */
export function deriveShotOutcomeWrites(input: ShotOutcomeInput): DerivedShotWrites {
  const { forUs, outcome, playerId, assistPlayerId, keeperPlayerId } = input;

  const shot = {
    takenByUs: forUs,
    outcome,
    playerId: forUs && playerId ? playerId : null,
  };

  const goal = outcome === 'GOAL'
    ? {
        scoredByUs: forUs,
        scorerId: forUs && playerId ? playerId : null,
        assistId: forUs && assistPlayerId ? assistPlayerId : null,
      }
    : null;

  const save = outcome === 'SAVED'
    ? {
        byUs: !forUs,
        playerId: !forUs && keeperPlayerId ? keeperPlayerId : null,
      }
    : null;

  return { shot, goal, save };
}
