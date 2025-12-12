/**
 * Validates that a player number is within a reasonable range (1-99)
 */
export function isValidPlayerNumber(playerNumber: number | null | undefined): boolean {
  if (playerNumber === null || playerNumber === undefined) {
    return true; // Null/undefined are valid (optional)
  }
  
  return playerNumber >= 1 && playerNumber <= 99 && Number.isInteger(playerNumber);
}
