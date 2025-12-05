import type { Schema } from "../../amplify/data/resource";

type LineupAssignment = Schema["LineupAssignment"]["type"];

/**
 * Checks if a player is already assigned to a position in the lineup
 */
export function isPlayerInLineup(playerId: string, assignments: LineupAssignment[]): boolean {
  return assignments.some(a => a.playerId === playerId);
}
