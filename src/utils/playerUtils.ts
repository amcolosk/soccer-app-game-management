import type { Schema } from "../../amplify/data/resource";

type Player = Schema["Player"]["type"];

/**
 * Sorts players by their player number in ascending order
 */
export function sortPlayersByNumber(players: Player[]): Player[] {
  return [...players].sort((a, b) => (a.playerNumber ?? 0) - (b.playerNumber ?? 0));
}
