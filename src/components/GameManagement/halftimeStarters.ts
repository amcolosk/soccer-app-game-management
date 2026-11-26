import type { FormationPosition, LineupAssignment } from "./types";

export type StarterSelection = {
  playerId: string;
  positionId: string;
};

export interface ResolveSecondHalfStartersParams {
  lineup: LineupAssignment[];
  positions: FormationPosition[];
  pendingRemovalIds: Set<string>;
  maxPlayersOnField: number;
}

export interface ResolveSecondHalfStartersResult {
  starters: StarterSelection[];
  expectedCount: number;
  emptyPositionIds: string[];
}

/**
 * Resolves the set of starters that should open the second half from the live
 * `lineup` subscription prop, excluding any assignment whose removal is
 * in-flight (or queued offline) per `pendingRemovalIds` — a lineage of
 * `LineupPanel`'s own optimistic-hide state, lifted so both the halftime
 * summary and `handleStartSecondHalf` agree on "what's actually starting".
 *
 * `emptyPositionIds` is every `FormationPosition` with no resolved starter —
 * used by `HalftimeLineupSummary` to flag specific gaps, not just a count.
 */
export function resolveSecondHalfStarters({
  lineup,
  positions,
  pendingRemovalIds,
  maxPlayersOnField,
}: ResolveSecondHalfStartersParams): ResolveSecondHalfStartersResult {
  const resolvedStarters = lineup.filter(
    (l): l is typeof l & { playerId: string; positionId: string } =>
      l.isStarter
      && !!l.playerId
      && !!l.positionId
      && !(l.id ? pendingRemovalIds.has(l.id) : false)
  );

  const starters: StarterSelection[] = resolvedStarters.map((starter) => ({
    playerId: starter.playerId,
    positionId: starter.positionId,
  }));

  const expectedCount = maxPlayersOnField ?? starters.length;

  const filledPositionIds = new Set(resolvedStarters.map((starter) => starter.positionId));
  const emptyPositionIds = positions
    .filter((position) => !filledPositionIds.has(position.id))
    .map((position) => position.id);

  return { starters, expectedCount, emptyPositionIds };
}
