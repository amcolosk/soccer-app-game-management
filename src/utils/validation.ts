import type { Schema } from "../../amplify/data/resource";

type Player = Schema["Player"]["type"];

/**
 * Checks if a player number is unique within a team
 */
export function isPlayerNumberUnique(
  playerNumber: number | null | undefined,
  teamId: string,
  players: Player[],
  excludePlayerId?: string
): boolean {
  if (playerNumber === null || playerNumber === undefined) {
    return true; // Null/undefined numbers are allowed
  }
  
  const existingPlayer = players.find(
    p => p.teamId === teamId && 
         p.playerNumber === playerNumber && 
         p.id !== excludePlayerId
  );
  
  return !existingPlayer;
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
