import type { PlannedSubstitution } from '../services/rotationPlannerService';

type RotationLike = {
  half: number;
  rotationNumber: number;
  plannedSubstitutions: unknown;
};

function parseSubstitutions(raw: unknown): PlannedSubstitution[] {
  try {
    const parsed = JSON.parse(typeof raw === 'string' ? raw : '[]');
    return Array.isArray(parsed) ? (parsed as PlannedSubstitution[]) : [];
  } catch {
    return [];
  }
}

function applySubstitutions(
  sourceLineup: Map<string, string>,
  substitutions: PlannedSubstitution[]
): Map<string, string> {
  const lineup = new Map(sourceLineup);

  substitutions.forEach((sub) => {
    const nextLineup = new Map<string, string>();
    for (const [posId, playerId] of lineup.entries()) {
      if (playerId === sub.playerInId && posId !== sub.positionId) {
        continue;
      }
      nextLineup.set(posId, playerId);
    }
    if (sub.playerInId) {
      nextLineup.set(sub.positionId, sub.playerInId);
    } else {
      nextLineup.delete(sub.positionId);
    }
    lineup.clear();
    nextLineup.forEach((playerId, posId) => lineup.set(posId, playerId));
  });

  return lineup;
}

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
      const parsed = JSON.parse(rotation.plannedSubstitutions as string);
      subs = Array.isArray(parsed) ? parsed as PlannedSubstitution[] : [];
    } catch (e) {
      console.error('[computeLineupAtRotation] Failed to parse plannedSubstitutions for rotation', rotation.rotationNumber, e);
    }

    subs.forEach(sub => {
      const tempLineup = new Map<string, string>();
      for (const [posId, pId] of lineup.entries()) {
        if (pId === sub.playerInId && posId !== sub.positionId) continue;
        tempLineup.set(posId, pId);
      }
      if (sub.playerInId) {
        tempLineup.set(sub.positionId, sub.playerInId);
      } else {
        tempLineup.delete(sub.positionId);
      }
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
  const allPositionIds = new Set<string>([
    ...previousLineup.keys(),
    ...newLineup.keys(),
  ]);

  for (const posId of allPositionIds) {
    const oldPid = previousLineup.get(posId) ?? "";
    const newPid = newLineup.get(posId) ?? "";
    if (oldPid !== newPid) {
      subs.push({ playerOutId: oldPid, playerInId: newPid, positionId: posId });
    }
  }
  return subs;
}

/**
 * Rewrites the edited rotation and downstream same-half rotations while preserving
 * halftime as a strict boundary. Later rotations keep their player-in targets, but
 * their player-out values are rebound to whoever is currently in each position.
 *
 * @param halftimeLineup - Optional halftime lineup override. When provided and the
 *   target rotation is in the second half, cascade is seeded from this lineup instead
 *   of computing forward from startingLineup + H1 rotations (H2 cascade correctness).
 */
export function applyRotationEditWithSameHalfCascade<T extends RotationLike>(
  startingLineup: Map<string, string>,
  rotations: T[],
  targetRotationNumber: number,
  editedSubstitutions: PlannedSubstitution[],
  halftimeLineup?: Map<string, string>,
): {
  rotations: T[];
  changedRotationNumbers: number[];
} {
  if (rotations.length === 0) {
    return { rotations: [], changedRotationNumbers: [] };
  }

  const sorted = [...rotations].sort((a, b) => a.rotationNumber - b.rotationNumber);
  const targetIndex = sorted.findIndex((rotation) => rotation.rotationNumber === targetRotationNumber);
  if (targetIndex === -1) {
    return { rotations: [...rotations], changedRotationNumbers: [] };
  }

  const targetHalf = sorted[targetIndex].half;
  let runningLineup: Map<string, string>;

  if (targetHalf === 2 && halftimeLineup && halftimeLineup.size > 0) {
    // Seed H2 cascade from the computed halftime lineup, ignoring H1 rotations.
    runningLineup = new Map(halftimeLineup);
    for (let index = 0; index < targetIndex; index += 1) {
      if (sorted[index].half !== 2) continue;
      const substitutions = parseSubstitutions(sorted[index].plannedSubstitutions);
      runningLineup = applySubstitutions(runningLineup, substitutions);
    }
  } else {
    runningLineup = new Map(startingLineup);
    for (let index = 0; index < targetIndex; index += 1) {
      const substitutions = parseSubstitutions(sorted[index].plannedSubstitutions);
      runningLineup = applySubstitutions(runningLineup, substitutions);
    }
  }

  const updatedByRotationNumber = new Map<number, T>();
  const changedRotationNumbers: number[] = [];

  const targetUpdated = {
    ...sorted[targetIndex],
    plannedSubstitutions: JSON.stringify(editedSubstitutions),
  };
  updatedByRotationNumber.set(targetUpdated.rotationNumber, targetUpdated);
  runningLineup = applySubstitutions(runningLineup, editedSubstitutions);
  changedRotationNumbers.push(targetUpdated.rotationNumber);

  for (let index = targetIndex + 1; index < sorted.length; index += 1) {
    const rotation = sorted[index];
    if (rotation.half !== targetHalf) {
      break;
    }

    const sourceSubs = parseSubstitutions(rotation.plannedSubstitutions);
    const reboundSubs = sourceSubs.map((sub) => ({
      ...sub,
      playerOutId: runningLineup.get(sub.positionId) ?? sub.playerOutId,
    }));

    const updatedRotation = {
      ...rotation,
      plannedSubstitutions: JSON.stringify(reboundSubs),
    };
    updatedByRotationNumber.set(updatedRotation.rotationNumber, updatedRotation);
    runningLineup = applySubstitutions(runningLineup, reboundSubs);
    changedRotationNumbers.push(updatedRotation.rotationNumber);
  }

  const updatedRotations = rotations.map((rotation) => {
    return updatedByRotationNumber.get(rotation.rotationNumber) ?? rotation;
  });

  return {
    rotations: updatedRotations,
    changedRotationNumbers,
  };
}
