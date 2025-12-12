import type { Schema } from "../../amplify/data/resource";

type Player = Schema["Player"]["type"];
type TeamRoster = Schema["TeamRoster"]["type"];

/**
 * Sorts team roster entries by their player number in ascending order
 */
export function sortRosterByNumber(roster: TeamRoster[]): TeamRoster[] {
  return [...roster].sort((a, b) => (a.playerNumber ?? 0) - (b.playerNumber ?? 0));
}

/**
 * @deprecated Use sortRosterByNumber instead. Players no longer have numbers directly.
 * This is kept for backwards compatibility but returns unsorted.
 */
export function sortPlayersByNumber(players: Player[]): Player[] {
  return [...players];
}
