import type { TeamRoster } from "../types/schema";

/** Sort key used wherever a missing jersey number must order after numbered players. */
export const NO_JERSEY_SORT_VALUE = 999;

/**
 * Sorts team roster entries by their player number in ascending order.
 * Entries without a number (e.g. guest players) sort last.
 */
export function sortRosterByNumber(roster: TeamRoster[]): TeamRoster[] {
  return [...roster].sort(
    (a, b) => (a.playerNumber ?? NO_JERSEY_SORT_VALUE) - (b.playerNumber ?? NO_JERSEY_SORT_VALUE)
  );
}

/** "#7" for a numbered player, "" when the player has no jersey number. */
export function formatJerseyNumber(playerNumber: number | null | undefined): string {
  return playerNumber != null ? `#${playerNumber}` : "";
}

/** "#7 " (trailing space) for a numbered player, "" otherwise — prefix for a name. */
export function formatJerseyPrefix(playerNumber: number | null | undefined): string {
  return playerNumber != null ? `#${playerNumber} ` : "";
}
