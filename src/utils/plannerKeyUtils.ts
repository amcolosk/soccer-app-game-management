/**
 * Canonical key generation and normalization for PlannedRotation records.
 * Implements stable identity contracts for idempotent persistence.
 */

import type { PlannedRotation } from "../types/schema";

/**
 * Canonical key format: H<half>:M<minute>:<slotType>
 * - <half>: 1 or 2
 * - <minute>: zero-padded integer 00-99
 * - <slotType>: ROT for rotation, HT for halftime sentinel
 */
export type CanonicalRotationKey = string;

/**
 * Generate canonical key for a planned rotation.
 * Normalizes whitespace and validates components.
 * @throws Error if components are invalid
 */
export function generateCanonicalKey(
  half: number,
  gameMinute: number,
  isHalftime: boolean
): CanonicalRotationKey {
  // Validate inputs
  if (![1, 2].includes(half)) {
    throw new Error(`Invalid half: ${half}. Must be 1 or 2.`);
  }
  if (!Number.isInteger(gameMinute) || gameMinute < 0 || gameMinute > 99) {
    throw new Error(`Invalid gameMinute: ${gameMinute}. Must be integer 0-99.`);
  }

  const paddedMinute = String(gameMinute).padStart(2, "0");
  const slotType = isHalftime ? "HT" : "ROT";
  return `H${half}:M${paddedMinute}:${slotType}`;
}

/**
 * Halftime sentinel key: always H2:M00:HT
 */
export function getHalftimeSentinelKey(): CanonicalRotationKey {
  return "H2:M00:HT";
}

/**
 * Parse canonical key to extract components.
 * Throws if key format is invalid.
 */
export function parseCanonicalKey(key: string): {
  half: 1 | 2;
  gameMinute: number;
  slotType: "ROT" | "HT";
} {
  const match = key.match(/^H(\d):M(\d{2}):([A-Z]{2,3})$/);
  if (!match) {
    throw new Error(`Invalid canonical key format: ${key}`);
  }

  const half = parseInt(match[1], 10) as 1 | 2;
  const gameMinute = parseInt(match[2], 10);
  const slotType = match[3];

  if (![1, 2].includes(half)) {
    throw new Error(`Invalid half in key: ${key}`);
  }
  if (slotType !== "ROT" && slotType !== "HT") {
    throw new Error(`Invalid slotType in key: ${key}`);
  }

  return { half, gameMinute, slotType };
}

/**
 * Determine if a key is the halftime sentinel.
 */
export function isHaltimeSentinel(key: CanonicalRotationKey): boolean {
  return key === getHalftimeSentinelKey();
}

/**
 * Normalize a key for comparison (trim whitespace, validate format).
 */
export function normalizeKey(key: string): CanonicalRotationKey {
  const trimmed = key.trim();
  parseCanonicalKey(trimmed); // Validate
  return trimmed;
}

/**
 * Deterministic duplicate resolution policy:
 * When multiple candidates map to same canonical key, pick winner using:
 * 1. Highest updatedAt timestamp wins
 * 2. If tied, lexicographically greatest id wins
 * 3. If still tied, lexicographically greatest JSON payload wins
 */
export function resolveDuplicateWinner(
  candidates: PlannedRotation[]
): PlannedRotation | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  let winner = candidates[0];

  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i];

    // Compare updatedAt timestamps
    const winnerTime = new Date(winner.updatedAt || 0).getTime();
    const candidateTime = new Date(candidate.updatedAt || 0).getTime();

    if (candidateTime > winnerTime) {
      winner = candidate;
      continue;
    }
    if (candidateTime < winnerTime) {
      continue;
    }

    // Timestamps tied; compare ids
    const winnerId = winner.id || "";
    const candidateId = candidate.id || "";
    if (candidateId > winnerId) {
      winner = candidate;
      continue;
    }
    if (candidateId < winnerId) {
      continue;
    }

    // Ids tied; compare JSON payloads
    const winnerJson = JSON.stringify(winner);
    const candidateJson = JSON.stringify(candidate);
    if (candidateJson > winnerJson) {
      winner = candidate;
    }
  }

  return winner;
}

/**
 * Build a normalized rotation set from candidates, deduplicating by canonical key.
 * Returns (normalized set, conflict count).
 */
export function buildNormalizedRotationSet(
  candidates: PlannedRotation[]
): {
  normalized: PlannedRotation[];
  conflictCount: number;
  errors: string[];
} {
  const errors: string[] = [];
  const byKey = new Map<CanonicalRotationKey, PlannedRotation[]>();

  // Group candidates by canonical key
  for (const rot of candidates) {
    try {
      const key = generateCanonicalKey(rot.half, rot.gameMinute, false);
      if (!byKey.has(key)) {
        byKey.set(key, []);
      }
      byKey.get(key)!.push(rot);
    } catch (e) {
      errors.push(`Failed to normalize rotation ${rot.id}: ${String(e)}`);
    }
  }

  // Resolve duplicates and build normalized set
  const normalized: PlannedRotation[] = [];
  let conflictCount = 0;

  for (const [, group] of byKey) {
    if (group.length > 1) {
      conflictCount += group.length - 1;
    }

    const winner = resolveDuplicateWinner(group);
    if (winner) {
      normalized.push(winner);
    }
  }

  return { normalized, conflictCount, errors };
}

/**
 * Compute a stable hash of a rotation set for fingerprinting.
 * Normalized set must be sorted by canonical key first.
 */
export function hashRotationSet(
  rotations: PlannedRotation[]
): string {
  const sorted = [...rotations].sort((a, b) => {
    const keyA = generateCanonicalKey(a.half, a.gameMinute, false);
    const keyB = generateCanonicalKey(b.half, b.gameMinute, false);
    return keyA.localeCompare(keyB);
  });

  const payloads = sorted.map(rot => ({
    half: rot.half,
    gameMinute: rot.gameMinute,
    plannedSubstitutions: rot.plannedSubstitutions,
  }));

  return JSON.stringify(payloads);
}
