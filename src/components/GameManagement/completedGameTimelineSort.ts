/**
 * Shared jersey-number comparator for completed-state player sorting.
 * - Ascending jersey number order.
 * - null/undefined jersey numbers sort last.
 * - Deterministic tie-breaker by player id.
 *
 * Reused by CompletedPlayTimeSummary and CompletedGameTimeline.
 */
export function compareByJerseyNumber(
  a: { playerNumber?: number | null; id?: string },
  b: { playerNumber?: number | null; id?: string }
): number {
  const aNum = a.playerNumber ?? null;
  const bNum = b.playerNumber ?? null;

  if (aNum === null && bNum === null) {
    return (a.id ?? "").localeCompare(b.id ?? "");
  }
  if (aNum === null) return 1;
  if (bNum === null) return -1;
  if (aNum !== bNum) return aNum - bNum;
  return (a.id ?? "").localeCompare(b.id ?? "");
}
