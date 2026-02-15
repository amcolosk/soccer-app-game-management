import type { TeamRoster } from "../types/schema";

/**
 * Sorts team roster entries by their player number in ascending order
 */
export function sortRosterByNumber(roster: TeamRoster[]): TeamRoster[] {
  return [...roster].sort((a, b) => (a.playerNumber ?? 0) - (b.playerNumber ?? 0));
}
