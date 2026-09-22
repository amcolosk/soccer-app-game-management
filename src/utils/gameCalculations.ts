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
 * Derives the current score from Goal records. This is the single source of
 * truth for "what is the score right now" while a game is active — Game.ourScore/
 * opponentScore in the DB is NOT kept live; it's only written at game creation
 * (0/0) and at game completion (final snapshot, GameManagement.tsx's completed-
 * state reconciliation effect). Any live-score display (CommandBand, Fan Mode,
 * Sideline Stat Tracker) must derive from Goal records, not the Game row, while
 * status is 'in-progress' or 'halftime'.
 *
 * Mirrored by amplify/functions/shared/score.ts's Lambda-side twin (a Lambda
 * can't import from src/) — parity-tested in
 * amplify/functions/shared/score.test.ts. Keep both in sync on any change,
 * same convention as gameClock.ts/gameClock.test.ts and
 * goalkeeper.ts/goalkeeper.test.ts.
 */
export function computeScoreFromGoals(goals: Array<{ scoredByUs: boolean }>) {
  return {
    ourScore: goals.filter(g => g.scoredByUs).length,
    opponentScore: goals.filter(g => !g.scoredByUs).length,
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
