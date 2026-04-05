import type { LineupAssignment, PlannedSubstitution } from '../types/schema';

/**
 * Returns true when a planned sub has been physically performed:
 * the incoming player is now on the field and the outgoing player is no longer on the field.
 */
export function isSubEffectivelyExecuted(
  sub: PlannedSubstitution,
  lineup: LineupAssignment[]
): boolean {
  const playerInOnField = lineup.some(l => l.isStarter && l.playerId === sub.playerInId);
  const playerOutOnField = lineup.some(l => l.isStarter && l.playerId === sub.playerOutId);
  return playerInOnField && !playerOutOnField;
}

/**
 * Returns true when ALL planned substitutions in a rotation have been physically performed.
 * An empty substitutions array is never considered fully executed.
 */
export function isRotationFullyExecuted(
  plannedSubstitutionsJson: string,
  lineup: LineupAssignment[]
): boolean {
  try {
    const subs: PlannedSubstitution[] = JSON.parse(plannedSubstitutionsJson);
    if (subs.length === 0) return false;
    return subs.every(sub => isSubEffectivelyExecuted(sub, lineup));
  } catch {
    return false;
  }
}
