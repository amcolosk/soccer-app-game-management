import type { TeamRoster } from "../types/schema";

// ---------------------------------------------------------------------------
// Birth Year
// ---------------------------------------------------------------------------

export const BIRTH_YEAR_MIN = 1990;
export const BIRTH_YEAR_MAX_FN = () => new Date().getFullYear();

/**
 * Parses a raw birth year string.
 * Returns: the parsed year | undefined (blank input) | null (invalid input)
 */
export function parseBirthYear(raw: string): number | undefined | null {
  if (!raw.trim()) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < BIRTH_YEAR_MIN || n > BIRTH_YEAR_MAX_FN()) return null;
  return n;
}

// ---------------------------------------------------------------------------
// Team Form
// ---------------------------------------------------------------------------

export interface TeamFormValidationResult {
  maxPlayersNum: number;
  halfLengthNum: number;
}

/**
 * Validates team form data (pure, no side effects).
 * Returns { error } on failure or parsed numbers on success.
 */
export function validateTeamFormData(
  form: { name: string; maxPlayers: string; halfLength: string }
): { error: string } | TeamFormValidationResult {
  if (!form.name.trim()) return { error: 'Please enter team name' };
  const maxPlayersNum = parseInt(form.maxPlayers);
  if (isNaN(maxPlayersNum) || maxPlayersNum < 1) return { error: 'Please enter a valid number of players' };
  const halfLengthNum = parseInt(form.halfLength);
  if (isNaN(halfLengthNum) || halfLengthNum < 1) return { error: 'Please enter a valid half length' };
  return { maxPlayersNum, halfLengthNum };
}

// ---------------------------------------------------------------------------
// Formation Form
// ---------------------------------------------------------------------------

/**
 * Validates formation form data (pure, no side effects).
 * Returns { error } on failure or { count } on success.
 */
export function validateFormationFormData(form: {
  name: string;
  playerCount: string;
  positions: { positionName: string; abbreviation: string }[];
}): { error: string } | { count: number } {
  if (!form.name.trim() || !form.playerCount.trim()) {
    return { error: 'Please enter formation name and specify player count' };
  }
  const count = parseInt(form.playerCount);
  if (isNaN(count) || count < 1) return { error: 'Please enter a valid player count' };
  if (form.positions.length !== count) {
    return { error: `Expected ${count} positions but found ${form.positions.length}` };
  }
  const incomplete = form.positions.some(p => !p.positionName.trim() || !p.abbreviation.trim());
  if (incomplete) return { error: 'Please fill in the name and abbreviation for every position' };
  return { count };
}

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
