import type { Goal, GameNote, Game } from "../types/schema";

/**
 * Calculates total goals scored by a player
 */
export function calculatePlayerGoals(playerId: string, goals: Goal[]): number {
  return goals.filter(g => g.scorerId === playerId).length;
}

/**
 * Calculates total assists by a player
 */
export function calculatePlayerAssists(playerId: string, goals: Goal[]): number {
  return goals.filter(g => g.assistId === playerId).length;
}

/**
 * Calculates gold stars for a player
 */
export function calculatePlayerGoldStars(playerId: string, notes: GameNote[]): number {
  return notes.filter(n => n.playerId === playerId && n.noteType === 'gold-star').length;
}

/**
 * Calculates yellow cards for a player
 */
export function calculatePlayerYellowCards(playerId: string, notes: GameNote[]): number {
  return notes.filter(n => n.playerId === playerId && n.noteType === 'yellow-card').length;
}

/**
 * Calculates red cards for a player
 */
export function calculatePlayerRedCards(playerId: string, notes: GameNote[]): number {
  return notes.filter(n => n.playerId === playerId && n.noteType === 'red-card').length;
}

/**
 * Calculates win/loss/tie record from completed games.
 */
export function calculateRecord(games: Pick<Game, 'status' | 'ourScore' | 'opponentScore'>[]): { wins: number; losses: number; ties: number } {
  const completed = games.filter(g => g.status === 'completed');
  return {
    wins: completed.filter(g => (g.ourScore ?? 0) > (g.opponentScore ?? 0)).length,
    losses: completed.filter(g => (g.ourScore ?? 0) < (g.opponentScore ?? 0)).length,
    ties: completed.filter(g => (g.ourScore ?? 0) === (g.opponentScore ?? 0)).length,
  };
}

/**
 * Toggles a position ID in a comma-separated preferredPositions string.
 * Returns the updated string, or undefined if empty.
 */
export function togglePreferredPosition(
  preferredPositions: string | null | undefined,
  positionId: string,
  add: boolean,
): string | undefined {
  const current = preferredPositions
    ? preferredPositions.split(', ').filter(Boolean)
    : [];

  const updated = add
    ? current.includes(positionId) ? current : [...current, positionId]
    : current.filter(id => id !== positionId);

  return updated.length > 0 ? updated.join(', ') : undefined;
}
