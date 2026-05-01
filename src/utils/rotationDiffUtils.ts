/**
 * Diff-based persistence for PlannedRotation records.
 * Computes create/update/delete operations using stable canonical keys.
 */

import type { PlannedRotation } from "../types/schema";
import {
  generateCanonicalKey,
  buildNormalizedRotationSet,
  type CanonicalRotationKey,
} from "./plannerKeyUtils";

export interface RotationDiffOperation {
  action: "create" | "update" | "delete";
  key: CanonicalRotationKey;
  current?: PlannedRotation;
  desired?: PlannedRotation;
}

/**
 * Build a diff of desired vs. stored rotation sets using canonical keys.
 * Returns operations sorted deterministically (deletes, updates, creates).
 */
export function computeRotationDiff(
  storedRotations: PlannedRotation[],
  desiredRotations: PlannedRotation[]
): {
  operations: RotationDiffOperation[];
  errors: string[];
} {
  const errors: string[] = [];

  // Normalize both sets to handle duplicates
  const { normalized: storedNorm, errors: storedErrors } = buildNormalizedRotationSet(storedRotations);
  const { normalized: desiredNorm, errors: desiredErrors } = buildNormalizedRotationSet(desiredRotations);

  errors.push(...storedErrors, ...desiredErrors);

  // Build key-indexed maps
  const storedByKey = new Map<CanonicalRotationKey, PlannedRotation>();
  const desiredByKey = new Map<CanonicalRotationKey, PlannedRotation>();

  for (const rot of storedNorm) {
    try {
      const key = generateCanonicalKey(rot.half, rot.gameMinute, false);
      storedByKey.set(key, rot);
    } catch (e) {
      errors.push(`Failed to key stored rotation: ${String(e)}`);
    }
  }

  for (const rot of desiredNorm) {
    try {
      const key = generateCanonicalKey(rot.half, rot.gameMinute, false);
      desiredByKey.set(key, rot);
    } catch (e) {
      errors.push(`Failed to key desired rotation: ${String(e)}`);
    }
  }

  // Collect all unique keys
  const allKeys = new Set([...storedByKey.keys(), ...desiredByKey.keys()]);

  // Build operations
  const operations: RotationDiffOperation[] = [];

  for (const key of allKeys) {
    const current = storedByKey.get(key);
    const desired = desiredByKey.get(key);

    if (!current && desired) {
      // Create
      operations.push({ action: "create", key, desired });
    } else if (current && !desired) {
      // Delete
      operations.push({ action: "delete", key, current });
    } else if (current && desired) {
      // Check if equal (by serialized payload)
      const currentPayload = JSON.stringify({
        half: current.half,
        gameMinute: current.gameMinute,
        plannedSubstitutions: current.plannedSubstitutions,
      });
      const desiredPayload = JSON.stringify({
        half: desired.half,
        gameMinute: desired.gameMinute,
        plannedSubstitutions: desired.plannedSubstitutions,
      });

      if (currentPayload !== desiredPayload) {
        // Update
        operations.push({ action: "update", key, current, desired });
      }
      // If equal, skip (no-op)
    }
  }

  // Sort operations deterministically: deletes, updates, creates
  operations.sort((a, b) => {
    const orderMap = { delete: 0, update: 1, create: 2 };
    const aOrder = orderMap[a.action];
    const bOrder = orderMap[b.action];
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.key.localeCompare(b.key);
  });

  return { operations, errors };
}

/**
 * Check if a diff represents a no-op (empty or all unchanged).
 */
export function isRotationDiffNoOp(operations: RotationDiffOperation[]): boolean {
  return operations.length === 0;
}

/**
 * Scoped delete filter: only include deletes for rotations with specified gameId.
 * Used to prevent deletes from affecting unrelated games.
 */
export function filterScopedDeletes(
  operations: RotationDiffOperation[],
  gamePlanId: string
): RotationDiffOperation[] {
  return operations.filter(op => {
    if (op.action !== "delete") return true;
    // Delete must have current rotation with matching gamePlanId
    if (!op.current) return false;
    return op.current.gamePlanId === gamePlanId;
  });
}

/**
 * Compute a composite revision fingerprint for dirty-draft detection.
 * Combines GamePlan hash and PlannedRotation set hash.
 */
export function computeRevisionFingerprint(
  gamePlanPayload: {
    startingLineup?: string | null;
    halftimeLineup?: string | null;
    rotationIntervalMinutes?: number | null;
  },
  plannedRotations: PlannedRotation[]
): string {
  // Hash GamePlan fields
  const gamePlanHash = JSON.stringify({
    startingLineup: gamePlanPayload.startingLineup || "",
    halftimeLineup: gamePlanPayload.halftimeLineup || "",
    rotationIntervalMinutes: gamePlanPayload.rotationIntervalMinutes || 0,
  });

  // Hash PlannedRotation set
  const sorted = [...plannedRotations].sort((a, b) => {
    const keyA = generateCanonicalKey(a.half, a.gameMinute, false);
    const keyB = generateCanonicalKey(b.half, b.gameMinute, false);
    return keyA.localeCompare(keyB);
  });

  const rotationPayloads = sorted.map(rot => ({
    half: rot.half,
    gameMinute: rot.gameMinute,
    plannedSubstitutions: rot.plannedSubstitutions,
  }));
  const rotationHash = JSON.stringify(rotationPayloads);

  // Combine: <gamePlanHash>:<rotationHash>:<itemCount>
  return `${btoa(gamePlanHash)}:${btoa(rotationHash)}:${plannedRotations.length}`;
}
