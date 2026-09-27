/**
 * Lambda-side twin of `src/utils/gameCalculations.ts`'s `computeScoreFromGoals`
 * -- IDENTICAL signature (both `{ scoredByUs: boolean }`, non-optional -- Goal.scoredByUs
 * is a.boolean().required() in the schema, so this isn't a defensive-optionality case;
 * callers cast raw Dynamo items at the call site, same as this handler already does for
 * other Goal fields) and semantics, kept in sync per `score.test.ts`'s parity table
 * (mirrors the gameClock.ts/goalkeeper.ts precedent). A Lambda can't import from `src/`,
 * hence the separate copy.
 */
export interface GoalLike {
  scoredByUs: boolean;
}

export function computeScoreFromGoals(goals: GoalLike[]): { ourScore: number; opponentScore: number } {
  return {
    ourScore: goals.filter(g => g.scoredByUs).length,
    opponentScore: goals.filter(g => !g.scoredByUs).length,
  };
}

/**
 * The shared "which score source wins" policy, single-sourced so
 * get-fan-game-view and get-stat-tracker-view can't silently diverge on it
 * (same reasoning as shareLinkAccess.ts's selectUpcomingGames reuse) --
 * LIVE branches derive live from Goal rows; every other branch (FINISHED
 * especially) reads the persisted Game-row snapshot, which is the
 * reconciled source of truth once a game is completed.
 */
export function resolveScore(
  isLive: boolean,
  persisted: { ourScore?: number | null; opponentScore?: number | null } | null,
  goals: GoalLike[],
): { ourScore: number | null; opponentScore: number | null } {
  if (isLive) return computeScoreFromGoals(goals);
  return { ourScore: persisted?.ourScore ?? null, opponentScore: persisted?.opponentScore ?? null };
}
