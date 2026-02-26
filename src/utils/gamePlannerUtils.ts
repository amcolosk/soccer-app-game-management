import type { PlannedSubstitution } from '../services/rotationPlannerService';

/**
 * Pure function: compute the lineup at a given rotation number by applying
 * substitutions up to and including `targetRotNum`.
 * Unlike the cached getLineupAtRotation(), this has no side effects and uses no cache.
 * targetRotNum === 0 returns a copy of startingLineup unchanged.
 */
export function computeLineupAtRotation(
  startingLineup: Map<string, string>,
  rotations: Array<{ rotationNumber: number; plannedSubstitutions: string }>,
  targetRotNum: number
): Map<string, string> {
  const lineup = new Map(startingLineup);
  if (targetRotNum === 0) return lineup;

  for (let i = 0; i < rotations.length && rotations[i].rotationNumber <= targetRotNum; i++) {
    const rotation = rotations[i];
    let subs: PlannedSubstitution[] = [];
    try {
      subs = JSON.parse(rotation.plannedSubstitutions as string);
    } catch (e) {
      console.error('[computeLineupAtRotation] Failed to parse plannedSubstitutions for rotation', rotation.rotationNumber, e);
    }

    subs.forEach(sub => {
      const tempLineup = new Map<string, string>();
      for (const [posId, pId] of lineup.entries()) {
        if (pId === sub.playerInId && posId !== sub.positionId) continue;
        tempLineup.set(posId, pId);
      }
      tempLineup.set(sub.positionId, sub.playerInId);
      lineup.clear();
      tempLineup.forEach((pid, posId) => lineup.set(posId, pid));
    });
  }

  return lineup;
}

/**
 * Pure function: compute the substitution diff between two lineups.
 * Returns one entry per position where the player changed between `previousLineup` and `newLineup`.
 * Positions where `previousLineup` has no entry are silently skipped.
 */
export function computeLineupDiff(
  previousLineup: Map<string, string>,
  newLineup: Map<string, string>
): PlannedSubstitution[] {
  const subs: PlannedSubstitution[] = [];
  for (const [posId, newPid] of newLineup.entries()) {
    const oldPid = previousLineup.get(posId);
    if (oldPid && newPid && oldPid !== newPid) {
      subs.push({ playerOutId: oldPid, playerInId: newPid, positionId: posId });
    }
  }
  return subs;
}
