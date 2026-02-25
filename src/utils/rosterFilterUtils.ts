import type { Player } from '../types/schema';

/**
 * Returns a sorted array of unique birth years present among the given players.
 * Players with null/undefined birthYear are excluded.
 */
export function getAvailableBirthYears(players: Player[]): number[] {
  return [...new Set(players.map(p => p.birthYear).filter((y): y is number => y != null))].sort(
    (a, b) => a - b
  );
}

/**
 * Filters players by a set of selected birth years.
 * - If selectedYears is empty, all players are returned (no filter active).
 * - Players with null birthYear are excluded when any filter is active.
 */
export function filterPlayersByBirthYears(players: Player[], selectedYears: string[]): Player[] {
  if (selectedYears.length === 0) return players;
  return players.filter(p => p.birthYear != null && selectedYears.includes(String(p.birthYear)));
}
