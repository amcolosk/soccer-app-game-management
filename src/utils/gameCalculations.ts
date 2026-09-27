import type { Goal, GameNote, Game, Shot, Save, PlayTimeRecord } from "../types/schema";
import { getGoalkeeperIdAtTime, type PositionRoleLookup } from "./playTimeCalculations";

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
 * Resolve which player gets credit for a save: the save's own explicit
 * playerId when present (never second-guessed by a fallback lookup, even if
 * that lookup would disagree or find nothing), else a time-window fallback
 * via getGoalkeeperIdAtTime. This is the single source of truth for save
 * attribution -- the team card, the per-player Saves column, and the player
 * drill-down's Saves list all consume calculateSavesByKeeper's output,
 * which calls this function once per save, rather than each re-resolving
 * independently.
 */
export function resolveSaveKeeperId(
  save: Pick<Save, 'playerId' | 'gameId' | 'gameSeconds'>,
  playTimeRecords: PlayTimeRecord[],
  positions: PositionRoleLookup[]
): string | null {
  if (save.playerId) return save.playerId;
  if (save.gameSeconds == null) return null;
  return getGoalkeeperIdAtTime(playTimeRecords, positions, save.gameId, save.gameSeconds);
}

/**
 * Team-wide single resolution pass for saves: resolves each save's keeper
 * exactly once via resolveSaveKeeperId, building both an aggregate count map
 * and a save-id -> keeper-id map. Callers (team summary card, per-player
 * column, player drill-down) must all reuse this single result rather than
 * re-resolving against a narrowed per-player record set, which is what
 * guarantees a save appears in exactly one player's drill-down.
 */
export function calculateSavesByKeeper(
  saves: Array<Pick<Save, 'id' | 'playerId' | 'gameId' | 'gameSeconds' | 'byUs'>>,
  playTimeRecords: PlayTimeRecord[],
  positions: PositionRoleLookup[]
): { byKeeper: Map<string, number>; byKeeperForSaveId: Map<string, string>; unattributedCount: number } {
  const byKeeper = new Map<string, number>();
  const byKeeperForSaveId = new Map<string, string>();
  let unattributedCount = 0;

  for (const save of saves) {
    if (save.byUs !== true) continue;
    const keeperId = resolveSaveKeeperId(save, playTimeRecords, positions);
    if (keeperId == null) {
      unattributedCount += 1;
      continue;
    }
    byKeeperForSaveId.set(save.id, keeperId);
    byKeeper.set(keeperId, (byKeeper.get(keeperId) ?? 0) + 1);
  }

  return { byKeeper, byKeeperForSaveId, unattributedCount };
}

/**
 * Shared shot-outcome tally: On Target = outcome GOAL or SAVED; Wide =
 * outcome WIDE; Blocked = outcome BLOCKED; outcome === null counts toward
 * shots only. Single source of truth for "on target" so calculatePlayerShotStats
 * and calculateTeamShotStats can't drift apart on the definition.
 */
function tallyShotOutcomes(
  shots: Array<Pick<Shot, 'outcome'>>
): { shots: number; onTarget: number; wide: number; blocked: number } {
  return {
    shots: shots.length,
    onTarget: shots.filter(s => s.outcome === 'GOAL' || s.outcome === 'SAVED').length,
    wide: shots.filter(s => s.outcome === 'WIDE').length,
    blocked: shots.filter(s => s.outcome === 'BLOCKED').length,
  };
}

/**
 * Per-player shot stats for shots WE took (takenByUs === true), attributed
 * via Shot.playerId (the shooter). See tallyShotOutcomes for the on
 * target/wide/blocked definitions.
 */
export function calculatePlayerShotStats(
  playerId: string,
  shots: Array<Pick<Shot, 'playerId' | 'takenByUs' | 'outcome'>>
): { shots: number; onTarget: number; wide: number; blocked: number } {
  return tallyShotOutcomes(shots.filter(s => s.takenByUs === true && s.playerId === playerId));
}

/**
 * Team-level shot stats for one side of a game (forUs true/false). Used for
 * the post-game "Shots on Goal" comparison, where a team-wide count is
 * needed rather than a single player's. See tallyShotOutcomes for the on
 * target/wide/blocked definitions.
 */
export function calculateTeamShotStats(
  forUs: boolean,
  shots: Array<Pick<Shot, 'takenByUs' | 'outcome'>>
): { shots: number; onTarget: number; wide: number; blocked: number } {
  return tallyShotOutcomes(shots.filter(s => s.takenByUs === forUs));
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
