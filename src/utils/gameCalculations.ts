import type { Goal, GameNote } from "../types/schema";

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
