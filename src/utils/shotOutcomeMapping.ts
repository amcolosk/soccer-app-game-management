/**
 * Unified shot-outcome tracking: pure "outcome -> which records to write,
 * with what values" mapping, shared by the coach-side entry component
 * (`ShotOutcomeEntry.tsx`) and mirrored Lambda-side (a Lambda can't import
 * from `src/`) at `amplify/functions/shared/shotOutcome.ts` -- same
 * pure-module-plus-parity-test pattern as `gameClock.ts`/`goalkeeper.ts`/
 * `score.ts`. Keep both copies in sync on any change; see
 * `shotOutcome.test.ts` for the parity table.
 *
 * Every outcome always writes a Shot. GOAL additionally writes a Goal;
 * SAVED additionally writes a Save. BLOCKED/WIDE write only the Shot.
 */

export type ShotOutcome = 'GOAL' | 'SAVED' | 'BLOCKED' | 'WIDE';

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
 *   -- NOT inverted). `scorerId`/`assistId` only when `forUs` (opponent
 *   goals carry no scorer, matching today).
 * - `save` populated iff `outcome === 'SAVED'`: `byUs = !forUs` -- INVERTED
 *   relative to the shot's own side, because a "Us" shot being Saved means
 *   the *opponent's* keeper made the save (`byUs: false`), and a "Them"
 *   shot being Saved means *our* keeper made it (`byUs: true`). `playerId`
 *   (keeper) is only ever populated on the `!forUs` branch (our keeper),
 *   from `keeperPlayerId` -- never on the `forUs` branch, since there's no
 *   opponent roster to attribute to.
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
