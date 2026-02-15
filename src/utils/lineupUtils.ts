import type { LineupAssignment } from "../types/schema";

/**
 * Checks if a player is already assigned to a position in the lineup
 */
export function isPlayerInLineup(playerId: string, assignments: LineupAssignment[]): boolean {
  return assignments.some(a => a.playerId === playerId);
}
