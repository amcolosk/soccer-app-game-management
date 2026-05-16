/**
 * Halftime lineup projection and data contract utilities.
 * Handles conversion between halftime lineup data and PlannedRotation sentinel.
 */

import type { PlannedRotation, PlannedSubstitution } from "../types/schema";

export interface HalftimeLineupEntry {
  playerId: string;
  positionId: string;
}

/**
 * Project halftime lineup to a halftime PlannedRotation sentinel record.
 * Canonical key is always H2:M00:HT.
 * Substitutions are derived as the diff from starting lineup to halftime lineup.
 */
export function projectHalftimeRotation(
  startingLineup: Map<string, string>, // positionId -> playerId
  halftimeLineup: Map<string, string>  // positionId -> playerId
): Omit<PlannedRotation, "id" | "gamePlanId" | "coaches" | "createdAt" | "updatedAt" | "viewedAt" | "gamePlan"> {
  // Compute substitutions: positions where player changed
  const subs: PlannedSubstitution[] = [];
  
  for (const [posId, halftimePlayerId] of halftimeLineup.entries()) {
    const startingPlayerId = startingLineup.get(posId);
    if (startingPlayerId && startingPlayerId !== halftimePlayerId) {
      subs.push({
        playerOutId: startingPlayerId,
        playerInId: halftimePlayerId,
        positionId: posId,
      });
    }
  }

  return {
    half: 2,
    gameMinute: 0,
    rotationNumber: 0, // Halftime marker
    plannedSubstitutions: JSON.stringify(subs),
  };
}

/**
 * Repair/recover halftime lineup from a halftime PlannedRotation (fallback).
 * Only call if canonical halftime lineup is missing but rotation exists.
 * This reconstructs the projected halftime lineup from starting + halftime rotation.
 */
export function recoverHalftimeLineupFromRotation(
  startingLineup: Map<string, string>,
  halftimeRotation: PlannedRotation
): Map<string, string> {
  const recovered = new Map(startingLineup);

  try {
    const subs = JSON.parse(
      halftimeRotation.plannedSubstitutions as string
    ) as PlannedSubstitution[];

    for (const sub of subs) {
      recovered.set(sub.positionId, sub.playerInId);
    }
  } catch (e) {
    console.error("[recoverHalftimeLineupFromRotation] Failed to parse subs:", e);
  }

  return recovered;
}

/**
 * Parse halftime lineup JSON from GamePlan.halftimeLineup.
 * Returns Map<positionId, playerId>.
 * Empty/null input returns empty map.
 * Preserves empty-string playerId values as explicit clear sentinels.
 */
export function parseHalftimeLineup(
  jsonData: string | null | undefined
): Map<string, string> {
  if (!jsonData) return new Map();

  try {
    const entries = JSON.parse(jsonData) as HalftimeLineupEntry[];
    const result = new Map<string, string>();
    for (const entry of entries) {
      if (entry.positionId) {
        // Preserve empty string as explicit clear sentinel; filter only missing positionId.
        result.set(entry.positionId, entry.playerId ?? "");
      }
    }
    return result;
  } catch (e) {
    console.error("[parseHalftimeLineup] Failed to parse:", e);
    return new Map();
  }
}

/**
 * Merge end-of-H1 lineup with explicit halftime overrides into the effective halftime lineup.
 *
 * Explicit override contract:
 *   - missing key in overrides  => inherit end-of-H1 player
 *   - non-empty playerId        => explicit override with that player
 *   - empty string ("")         => explicit clear for that position
 */
export function mergeHalftimeLineup(
  endOfH1: Map<string, string>,
  explicitOverrides: Map<string, string>
): Map<string, string> {
  const merged = new Map(endOfH1);
  for (const [posId, playerId] of explicitOverrides.entries()) {
    if (playerId) {
      merged.set(posId, playerId);
    } else {
      merged.delete(posId);
    }
  }
  return merged;
}

/**
 * Derive the minimal explicit override map from an effective halftime lineup relative to
 * end-of-H1. Positions that match end-of-H1 are omitted (they will inherit naturally).
 * Positions cleared relative to end-of-H1 are recorded with empty-string sentinel ("").
 */
export function deriveExplicitOverrides(
  effectiveLineup: Map<string, string>,
  endOfH1: Map<string, string>
): Map<string, string> {
  const overrides = new Map<string, string>();
  // Record changed or new player assignments.
  for (const [posId, playerId] of effectiveLineup.entries()) {
    if (endOfH1.get(posId) !== playerId) {
      overrides.set(posId, playerId);
    }
  }
  // Record explicit clears: positions in end-of-H1 absent from the effective lineup.
  for (const posId of endOfH1.keys()) {
    if (!effectiveLineup.has(posId)) {
      overrides.set(posId, "");
    }
  }
  return overrides;
}

/**
 * Serialize halftime lineup Map to JSON for GamePlan.halftimeLineup.
 * Returns empty array if map is empty.
 */
export function serializeHalftimeLineup(
  lineup: Map<string, string>
): string {
  const entries: HalftimeLineupEntry[] = [];
  for (const [posId, playerId] of lineup.entries()) {
    if (playerId) {
      entries.push({ playerId, positionId: posId });
    } else {
      // Preserve unassigned slots
      entries.push({ playerId: "", positionId: posId });
    }
  }
  return JSON.stringify(entries);
}

/**
 * Structural equality check for halftime lineups.
 * Used for dirty-draft detection and no-op persistence.
 */
export function halftimeLineupsEqual(
  a: Map<string, string>,
  b: Map<string, string>
): boolean {
  if (a.size !== b.size) return false;
  for (const [posId, playerId] of a.entries()) {
    if (b.get(posId) !== playerId) return false;
  }
  return true;
}
