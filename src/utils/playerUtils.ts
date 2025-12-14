import type { Schema } from "../../amplify/data/resource";

type TeamRoster = Schema["TeamRoster"]["type"];

/**
 * Sorts team roster entries by their player number in ascending order
 */
export function sortRosterByNumber(roster: TeamRoster[]): TeamRoster[] {
  return [...roster].sort((a, b) => (a.playerNumber ?? 0) - (b.playerNumber ?? 0));
}
