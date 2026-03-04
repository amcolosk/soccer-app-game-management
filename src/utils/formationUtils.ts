/**
 * Formation Update Utilities
 *
 * Pure helpers for computing in-place formation position diffs.
 * Using in-place updates (rather than delete + recreate) preserves
 * FormationPosition IDs, which are referenced by TeamRoster.preferredPositions.
 */

export interface ExistingFormationPosition {
  id: string;
  positionName: string;
  abbreviation: string;
  sortOrder?: number | null;
}

export interface NewPositionFormData {
  positionName: string;
  abbreviation: string;
}

export interface FormationPositionUpdate {
  id: string;
  positionName: string;
  abbreviation: string;
  sortOrder: number;
}

export interface FormationPositionCreate {
  positionName: string;
  abbreviation: string;
  sortOrder: number;
}

export interface FormationPositionDiff {
  /** Existing positions to update in-place — IDs are preserved. */
  toUpdate: FormationPositionUpdate[];
  /** New positions to create (count increased). */
  toCreate: FormationPositionCreate[];
  /** IDs of positions to delete (count decreased). These must also be scrubbed
   *  from any TeamRoster.preferredPositions that reference them. */
  toDeleteIds: string[];
}

/**
 * Compute the minimal set of changes needed to reconcile an existing set of
 * formation positions with a new set from the edit form.
 *
 * Positions are matched by index after sorting existing records by sortOrder.
 * - Positions that still exist at that index are updated in-place (ID preserved).
 * - Extra positions (new count > old count) are returned as creates.
 * - Surplus positions (old count > new count) are returned as deletes.
 *
 * Preserving IDs is critical: TeamRoster.preferredPositions stores a
 * comma-separated list of FormationPosition IDs. If IDs change, all player
 * position preferences for every team using this formation are silently lost.
 */
export function computeFormationPositionDiff(
  existingPositions: ExistingFormationPosition[],
  newPositions: NewPositionFormData[],
): FormationPositionDiff {
  // Sort existing by sortOrder so index-based matching is deterministic.
  // Use id as a tiebreaker to guarantee stable ordering when multiple positions
  // share the same sortOrder (e.g. null/0), preventing non-deterministic ID assignment.
  const sorted = [...existingPositions].sort((a, b) => {
    const diff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  const minLen = Math.min(sorted.length, newPositions.length);

  const toUpdate: FormationPositionUpdate[] = [];
  for (let i = 0; i < minLen; i++) {
    toUpdate.push({
      id: sorted[i].id,
      positionName: newPositions[i].positionName,
      abbreviation: newPositions[i].abbreviation,
      sortOrder: i + 1,
    });
  }

  const toCreate: FormationPositionCreate[] = [];
  for (let i = sorted.length; i < newPositions.length; i++) {
    toCreate.push({
      positionName: newPositions[i].positionName,
      abbreviation: newPositions[i].abbreviation,
      sortOrder: i + 1,
    });
  }

  const toDeleteIds: string[] = sorted.slice(newPositions.length).map(p => p.id);

  return { toUpdate, toCreate, toDeleteIds };
}

/**
 * Given a comma-separated preferred-positions string and a set of deleted
 * position IDs, return the cleaned string (null if empty after scrubbing).
 */
export function scrubDeletedPositionPreferences(
  preferredPositions: string | null | undefined,
  deletedIds: Set<string>,
): string | null {
  if (!preferredPositions) return null;
  const remaining = preferredPositions
    .split(',')
    .map(s => s.trim())
    .filter(id => id.length > 0 && !deletedIds.has(id));
  return remaining.length > 0 ? remaining.join(', ') : null;
}
