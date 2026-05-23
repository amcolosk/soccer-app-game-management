/**
 * Shared Play Time Calculation Utilities
 * 
 * This module provides a single source of truth for calculating player play time
 * from PlayTimeRecords. Used by both GameManagement and SeasonReport to ensure
 * consistent calculations across the application.
 */

import type { Goal, PlayTimeRecord } from "../types/schema";

/**
 * Row shape for goals / assists attributed to a field position.
 */
export interface PositionGoalAssistRow {
  position: string;
  goals: number;
  assists: number;
}

/**
 * Calculate total play time for a player from their PlayTimeRecords
 * 
 * Now uses game time (elapsed seconds) instead of real-world timestamps.
 * This means player time automatically pauses when game is paused.
 * 
 * Logic:
 * 1. If record has endGameSeconds, duration = endGameSeconds - startGameSeconds
 * 2. If record is active (no endGameSeconds), duration = currentGameTime - startGameSeconds
 * 
 * @param playerId - The player's ID
 * @param playTimeRecords - Array of PlayTimeRecords to analyze
 * @param currentGameTime - Current game time in seconds (optional, for active records)
 * @returns Total play time in seconds
 */
export function calculatePlayerPlayTime(
  playerId: string,
  playTimeRecords: PlayTimeRecord[],
  currentGameTime?: number,
  halftimeOffsetSeconds?: number
): number {
  const playerRecords = playTimeRecords.filter(r => r.playerId === playerId);
  let totalSeconds = 0;

  playerRecords.forEach(record => {
    let recordDuration = 0;

    if (record.endGameSeconds !== null && record.endGameSeconds !== undefined) {
      // Record has an end time - calculate completed duration
      recordDuration = record.endGameSeconds - record.startGameSeconds;
    } else if (currentGameTime !== undefined) {
      // Record is active - calculate from start to current game time
      recordDuration = currentGameTime - record.startGameSeconds;
      // Deduct halftime pause for records that started before the halftime break occurred
      if (halftimeOffsetSeconds !== undefined && halftimeOffsetSeconds > 0 && record.startGameSeconds < halftimeOffsetSeconds) {
        recordDuration -= halftimeOffsetSeconds;
      }
    }
    // If no endGameSeconds and no currentGameTime provided, duration is 0

    totalSeconds += recordDuration;
  });

  return totalSeconds;
}

/**
 * Calculate play time grouped by position
 * 
 * @param playerId - The player's ID
 * @param playTimeRecords - Array of PlayTimeRecords
 * @param positions - Map of position IDs to position objects
 * @param currentGameTime - Current game time in seconds (optional, for active records)
 * @returns Map of position name to total seconds played
 */
export function calculatePlayTimeByPosition(
  playerId: string,
  playTimeRecords: PlayTimeRecord[],
  positions: Map<string, { positionName: string }>,
  currentGameTime?: number
): Map<string, number> {
  const playerRecords = playTimeRecords.filter(r => r.playerId === playerId);
  const playTimeByPosition = new Map<string, number>();

  playerRecords.forEach(record => {
    // Get position name
    const position = record.positionId ? positions.get(record.positionId) : null;
    const positionName = position?.positionName || 'Unknown';

    // Calculate duration using game time
    let recordDuration = 0;

    if (record.endGameSeconds !== null && record.endGameSeconds !== undefined) {
      recordDuration = record.endGameSeconds - record.startGameSeconds;
    } else if (currentGameTime !== undefined) {
      recordDuration = currentGameTime - record.startGameSeconds;
    }

    // Add to position total
    const currentTotal = playTimeByPosition.get(positionName) || 0;
    playTimeByPosition.set(positionName, currentTotal + recordDuration);
  });

  return playTimeByPosition;
}

/**
 * Format seconds into a readable time string
 * 
 * @param seconds - Total seconds
 * @param format - Output format: 'short' (MM:SS), 'long' (Hh MMm), 'verbose' (H hours M minutes)
 * @returns Formatted time string
 */
export function formatPlayTime(
  seconds: number,
  format: 'short' | 'long' | 'verbose' = 'short'
): string {
  const hours = Math.floor(seconds / 3600);
  const minutesInHour = Math.floor((seconds % 3600) / 60);
  const totalMinutes = Math.floor(seconds / 60);
  const secs = seconds % 60;

  switch (format) {
    case 'short':
      // MM:SS format (used in most places) - shows total minutes
      return `${totalMinutes}:${secs.toString().padStart(2, '0')}`;
    
    case 'long':
      // "1h 23m" format (compact but readable)
      if (hours > 0) {
        return `${hours}h ${minutesInHour}m`;
      }
      return `${totalMinutes}m`;
    
    case 'verbose': {
      // "1 hour 23 minutes" format (fully spelled out)
      const parts: string[] = [];
      if (hours > 0) {
        parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
      }
      if (minutesInHour > 0) {
        parts.push(`${minutesInHour} ${minutesInHour === 1 ? 'minute' : 'minutes'}`);
      }
      if (seconds < 60 || (hours === 0 && minutesInHour === 0)) {
        parts.push(`${secs} ${secs === 1 ? 'second' : 'seconds'}`);
      }
      return parts.join(' ');
    }
    
    default:
      return `${totalMinutes}:${secs.toString().padStart(2, '0')}`;
  }
}

/**
 * Count unique games a player has participated in
 * 
 * @param playerId - The player's ID
 * @param playTimeRecords - Array of PlayTimeRecords
 * @returns Number of unique games
 */
export function countGamesPlayed(
  playerId: string,
  playTimeRecords: PlayTimeRecord[]
): number {
  const playerRecords = playTimeRecords.filter(r => r.playerId === playerId);
  const uniqueGames = new Set(playerRecords.map(r => r.gameId));
  return uniqueGames.size;
}

/**
 * Verify if a player is currently on the field
 * 
 * @param playerId - The player's ID
 * @param playTimeRecords - Array of PlayTimeRecords
 * @returns True if player has an active (unclosed) record
 */
export function isPlayerCurrentlyPlaying(
  playerId: string,
  playTimeRecords: PlayTimeRecord[]
): boolean {
  return playTimeRecords.some(
    r => r.playerId === playerId && (r.endGameSeconds === null || r.endGameSeconds === undefined)
  );
}

/**
 * Normalize play-time records for a completed single game:
 * any record without an endGameSeconds is treated as ending at gameEndSeconds.
 *
 * This is the shared helper used by CompletedPlayTimeSummary and any other
 * caller that needs closed intervals for a single game.
 *
 * @param records - Raw PlayTimeRecords (may contain unclosed records)
 * @param gameEndSeconds - The game's final elapsed seconds
 * @returns New array where all records have a defined endGameSeconds
 */
export function normalizeCompletedRecords(
  records: PlayTimeRecord[],
  gameEndSeconds: number
): PlayTimeRecord[] {
  return records.map(r =>
    r.endGameSeconds == null ? { ...r, endGameSeconds: gameEndSeconds } : r
  );
}

function getAttributedPlayTimeRecord(
  playTimeRecords: PlayTimeRecord[],
  playerId: string,
  gameId: string,
  gameSeconds: number
): PlayTimeRecord | null {
  const candidates = playTimeRecords.filter(record => {
    if (record.playerId !== playerId || record.gameId !== gameId) {
      return false;
    }

    const recordEnd = record.endGameSeconds ?? Number.POSITIVE_INFINITY;
    return record.startGameSeconds <= gameSeconds && gameSeconds <= recordEnd;
  });

  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort((a, b) => {
    if (a.startGameSeconds !== b.startGameSeconds) {
      return b.startGameSeconds - a.startGameSeconds;
    }

    const aEnd = a.endGameSeconds ?? Number.POSITIVE_INFINITY;
    const bEnd = b.endGameSeconds ?? Number.POSITIVE_INFINITY;
    if (aEnd !== bEnd) {
      return aEnd - bEnd;
    }

    return a.id.localeCompare(b.id);
  })[0];
}

function resolvePositionName(
  record: PlayTimeRecord | null,
  positions: Map<string, { positionName: string }>
): string | null {
  if (!record?.positionId) {
    return null;
  }

  const position = positions.get(record.positionId);
  return position ? position.positionName : null;
}

/**
 * Calculate goals and assists attributed to field positions at the team level.
 *
 * Only goals where `scoredByUs === true` are counted.
 * Scorer and assister positions are resolved independently using the active
 * PlayTimeRecord at `goal.gameSeconds`. Records with null/undefined
 * `endGameSeconds` are treated as open-ended active intervals.
 *
 * If multiple records match the same player/game/second, the record with the
 * greatest `startGameSeconds` is chosen (deterministic overlap rule).
 *
 * Events with no matching PlayTimeRecord or an unmapped `positionId` are
 * silently omitted — no "Unknown" row is produced for this table.
 *
 * Rows are sorted by goals descending, then assists descending.
 *
 * @param goalEvents      - Goal records (all games / team-scoped)
 * @param playTimeRecords - All relevant PlayTimeRecords (team-scoped)
 * @param positions       - Map of positionId → { positionName }
 * @returns Sorted array of PositionGoalAssistRow
 */
export function calculateTeamGoalsAssistsByPosition(
  goalEvents: Array<{
    scoredByUs?: boolean | null;
    scorerId?: string | null;
    assistId?: string | null;
    gameSeconds?: number | null;
    gameId: string;
  }>,
  playTimeRecords: PlayTimeRecord[],
  positions: Map<string, { positionName: string }>
): PositionGoalAssistRow[] {
  // Only count goals scored by our team.
  const ourGoals = goalEvents.filter(g => g.scoredByUs === true);

  // Accumulator: positionName → { goals, assists }
  const rowMap = new Map<string, { goals: number; assists: number }>();

  for (const goal of ourGoals) {
    // Goals with no gameSeconds cannot be attributed to a position.
    if (goal.gameSeconds == null) continue;

    // Attribute the scorer.
    if (goal.scorerId) {
      const record = getAttributedPlayTimeRecord(
        playTimeRecords,
        goal.scorerId,
        goal.gameId,
        goal.gameSeconds
      );
      const posName = resolvePositionName(record, positions);
      if (posName !== null) {
        const row = rowMap.get(posName) ?? { goals: 0, assists: 0 };
        rowMap.set(posName, { goals: row.goals + 1, assists: row.assists });
      }
    }

    // Attribute the assister independently.
    if (goal.assistId) {
      const record = getAttributedPlayTimeRecord(
        playTimeRecords,
        goal.assistId,
        goal.gameId,
        goal.gameSeconds
      );
      const posName = resolvePositionName(record, positions);
      if (posName !== null) {
        const row = rowMap.get(posName) ?? { goals: 0, assists: 0 };
        rowMap.set(posName, { goals: row.goals, assists: row.assists + 1 });
      }
    }
  }

  // Sort by goals descending, then assists descending.
  return Array.from(rowMap.entries())
    .sort(([, dataA], [, dataB]) => {
      if (dataB.goals !== dataA.goals) return dataB.goals - dataA.goals;
      return dataB.assists - dataA.assists;
    })
    .map(([position, data]) => ({ position, goals: data.goals, assists: data.assists }));
}

/**
 * Attribute goals and assists to field positions using play-time intervals.
 *
 * For each goal / assist event the player was involved in, the function
 * finds the play-time record whose interval [startGameSeconds, endGameSeconds]
 * covers the event's gameSeconds and maps it to the recorded position name.
 * Events whose game-second falls outside any known interval (or whose
 * gameSeconds is null) are attributed to the sentinel "Unknown position".
 *
 * All positions that appear in the player's play-time records are included
 * in the result (with 0 goals / 0 assists where applicable) so the caller
 * always sees a stable, complete table.
 *
 * Rows are sorted by:
 *  1. sortOrder ascending (nulls after known orders)
 *  2. positionName ascending
 *  3. "Unknown position" always last
 *
 * @param playerId      - The player's ID
 * @param playTimeRecords - Normalized records (all endGameSeconds defined)
 * @param goalEvents    - Goal records to attribute
 * @param positions     - Map of positionId → { positionName, sortOrder }
 * @returns Sorted array of PositionGoalAssistRow
 */
export function calculateGoalsAssistsByPosition(
  playerId: string,
  playTimeRecords: PlayTimeRecord[],
  goalEvents: Array<{
    scorerId?: string | null;
    assistId?: string | null;
    gameSeconds?: number | null;
    gameId: string;
  }>,
  positions: Map<string, { positionName: string; sortOrder?: number | null }>
): PositionGoalAssistRow[] {
  const playerRecords = playTimeRecords.filter(r => r.playerId === playerId);

  // Accumulator: positionName → { goals, assists, sortOrder }
  const rowMap = new Map<string, { goals: number; assists: number; sortOrder: number | null }>();

  // Seed all positions from the player's play-time records so every
  // played position appears in the result even with 0 goals / 0 assists.
  playerRecords.forEach(r => {
    const pos = r.positionId ? positions.get(r.positionId) : null;
    const posName = pos?.positionName ?? 'Unknown position';
    if (!rowMap.has(posName)) {
      rowMap.set(posName, {
        goals: 0,
        assists: 0,
        sortOrder: pos?.sortOrder ?? null,
      });
    }
  });

  // Find the position name for a given (gameId, gameSeconds) pair.
  const findPosition = (gameId: string, gameSeconds: number | null | undefined): string => {
    if (gameSeconds == null) return 'Unknown position';
    const record = getAttributedPlayTimeRecord(playerRecords, playerId, gameId, gameSeconds);
    if (!record) return 'Unknown position';
    const pos = record.positionId ? positions.get(record.positionId) : null;
    return pos?.positionName ?? 'Unknown position';
  };

  // Attribute goals and assists.
  goalEvents.forEach(g => {
    if (g.scorerId === playerId) {
      const posName = findPosition(g.gameId, g.gameSeconds);
      const row = rowMap.get(posName) ?? { goals: 0, assists: 0, sortOrder: null };
      rowMap.set(posName, { ...row, goals: row.goals + 1 });
    }
    if (g.assistId === playerId) {
      const posName = findPosition(g.gameId, g.gameSeconds);
      const row = rowMap.get(posName) ?? { goals: 0, assists: 0, sortOrder: null };
      rowMap.set(posName, { ...row, assists: row.assists + 1 });
    }
  });

  // Sort and flatten.
  return Array.from(rowMap.entries())
    .sort(([nameA, dataA], [nameB, dataB]) => {
      const isUnknownA = nameA === 'Unknown position';
      const isUnknownB = nameB === 'Unknown position';
      if (isUnknownA && !isUnknownB) return 1;
      if (!isUnknownA && isUnknownB) return -1;
      const orderA = dataA.sortOrder != null ? dataA.sortOrder : Number.MAX_SAFE_INTEGER;
      const orderB = dataB.sortOrder != null ? dataB.sortOrder : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return nameA.localeCompare(nameB);
    })
    .map(([position, data]) => ({ position, goals: data.goals, assists: data.assists }));
}

export interface GoalsByPositionRow {
  positionId: string;
  positionName: string;
  goals: number;
  assists: number;
}

/**
 * Calculate goals grouped by field position using play-time interval attribution.
 *
 * Attribution rules:
 * - Count only goals where scoredByUs is true.
 * - Goal must have scorerId and gameSeconds.
 * - Match the scorer's play-time records by game and interval.
 * - If multiple records match, select deterministically by:
 *   1) latest startGameSeconds
 *   2) earliest endGameSeconds (null treated as Infinity)
 *   3) lexicographic record id
 * - Omit goals when no matching interval, no positionId, or unmapped positionId.
 *
 * Output is sorted deterministically by:
 * - goals desc
 * - assists desc
 * - positionName asc
 * - positionId asc
 */
export function calculateGoalsByPosition(
  goals: Goal[],
  playTimeRecords: PlayTimeRecord[],
  positions: Map<string, { positionName: string }>
): GoalsByPositionRow[] {
  const goalsByPosition = new Map<string, GoalsByPositionRow>();

  const attributeStatToPosition = (
    goal: Goal,
    playerId: string | null | undefined,
    statKey: 'goals' | 'assists'
  ) => {
    if (!playerId) {
      return;
    }

    const attributedRecord = getAttributedPlayTimeRecord(
      playTimeRecords,
      playerId,
      goal.gameId,
      goal.gameSeconds!
    );

    if (!attributedRecord?.positionId) {
      return;
    }

    const position = positions.get(attributedRecord.positionId);
    if (!position) {
      return;
    }

    const existing = goalsByPosition.get(attributedRecord.positionId);
    if (existing) {
      existing[statKey] += 1;
      return;
    }

    goalsByPosition.set(attributedRecord.positionId, {
      positionId: attributedRecord.positionId,
      positionName: position.positionName,
      goals: statKey === 'goals' ? 1 : 0,
      assists: statKey === 'assists' ? 1 : 0,
    });
  };

  goals.forEach(goal => {
    if (!goal.scoredByUs || !goal.scorerId || goal.gameSeconds === null || goal.gameSeconds === undefined) {
      return;
    }

    attributeStatToPosition(goal, goal.scorerId, 'goals');
    attributeStatToPosition(goal, goal.assistId, 'assists');
  });

  return Array.from(goalsByPosition.values()).sort((a, b) => {
    if (a.goals !== b.goals) {
      return b.goals - a.goals;
    }
    if (a.assists !== b.assists) {
      return b.assists - a.assists;
    }
    const byName = a.positionName.localeCompare(b.positionName);
    if (byName !== 0) {
      return byName;
    }
    return a.positionId.localeCompare(b.positionId);
  });
}
