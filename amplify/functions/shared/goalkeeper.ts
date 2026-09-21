/**
 * Lambda-side twin of `src/utils/playTimeCalculations.ts`'s
 * `getCurrentGoalkeeperId` -- same signature shape, same semantics, kept in
 * sync per `goalkeeper.test.ts`'s parity table (mirrors `gameClock.ts` /
 * `gameClock.test.ts`'s existing pure-module parity-test precedent). A
 * Lambda can't import from `src/`, hence the separate copy.
 *
 * Ambiguity is judged on distinct PLAYERS, not distinct positions (one
 * player at two GOALKEEPER-role positions simultaneously is still
 * unambiguous). `endGameSeconds` is treated as "open" only when null or
 * undefined -- explicitly NOT a falsy check, since `endGameSeconds === 0`
 * (closed at kickoff) must count as closed, not open.
 *
 * PRECONDITION: `playTimeRecords` must already be scoped to a single game.
 * Safe by construction here -- the handler's caller queries PlayTimeRecord
 * via the gameId GSI before calling this.
 */

export interface PlayTimeRecordLike {
  playerId: string;
  positionId?: string | null;
  endGameSeconds?: number | null;
}

export interface PositionRoleLike {
  id: string;
  role?: string | null;
}

export function computeActiveGoalkeeperId(
  playTimeRecords: PlayTimeRecordLike[],
  positions: PositionRoleLike[],
): string | null {
  const goalkeeperPositionIds = new Set(
    positions.filter(p => p.role === 'GOALKEEPER').map(p => p.id)
  );
  if (goalkeeperPositionIds.size === 0) return null;

  const openGoalkeeperPlayerIds = new Set(
    playTimeRecords
      .filter(r =>
        (r.endGameSeconds === null || r.endGameSeconds === undefined) &&
        r.positionId != null &&
        goalkeeperPositionIds.has(r.positionId)
      )
      .map(r => r.playerId)
  );

  if (openGoalkeeperPlayerIds.size !== 1) return null;
  return [...openGoalkeeperPlayerIds][0];
}
