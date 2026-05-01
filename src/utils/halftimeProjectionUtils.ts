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
 */
export function parseHalftimeLineup(
  jsonData: string | null | undefined
): Map<string, string> {
  if (!jsonData) return new Map();

  try {
    const entries = JSON.parse(jsonData) as HalftimeLineupEntry[];
    const result = new Map<string, string>();
    for (const entry of entries) {
      if (entry.playerId && entry.positionId) {
        result.set(entry.positionId, entry.playerId);
      }
    }
    return result;
  } catch (e) {
    console.error("[parseHalftimeLineup] Failed to parse:", e);
    return new Map();
  }
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
