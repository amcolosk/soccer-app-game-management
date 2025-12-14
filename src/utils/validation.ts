import type { Schema } from "../../amplify/data/resource";

type TeamRoster = Schema["TeamRoster"]["type"];

/**
 * Checks if a player number is unique within a team roster
 */
export function isPlayerNumberUnique(
  playerNumber: number | null | undefined,
  teamId: string,
  rosters: TeamRoster[],
  excludeRosterId?: string
): boolean {
  // Null/undefined are always unique (optional numbers)
  if (playerNumber === null || playerNumber === undefined) {
    return true;
  }

  // Check if any other roster entry in the same team has this number
  return !rosters.some(
    (r) =>
      r.teamId === teamId &&
      r.playerNumber === playerNumber &&
      r.id !== excludeRosterId
  );
}

/**
 * Validates that a player number is within a reasonable range (1-99)
 */
export function isValidPlayerNumber(playerNumber: number | null | undefined): boolean {
  if (playerNumber === null || playerNumber === undefined) {
    return true; // Null/undefined are valid (optional)
  }
  
  return playerNumber >= 1 && playerNumber <= 99 && Number.isInteger(playerNumber);
}
