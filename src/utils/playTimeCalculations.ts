/**
 * Shared Play Time Calculation Utilities
 * 
 * This module provides a single source of truth for calculating player play time
 * from PlayTimeRecords. Used by both GameManagement and SeasonReport to ensure
 * consistent calculations across the application.
 */

import type { Schema } from "../../amplify/data/resource";

type PlayTimeRecord = Schema["PlayTimeRecord"]["type"];
type Game = Schema["Game"]["type"];

/**
 * Calculate total play time for a player from their PlayTimeRecords
 * 
 * Logic:
 * 1. If record has durationSeconds, use it (most reliable)
 * 2. If record has startTime and endTime but no duration, calculate it
 * 3. If record has startTime but no endTime (active record):
 *    - Only count if the game is currently in-progress
 *    - Calculate from startTime to now
 * 
 * @param playerId - The player's ID
 * @param playTimeRecords - Array of PlayTimeRecords to analyze
 * @param games - Optional map of games by ID (for checking game status on active records)
 * @returns Total play time in seconds
 */
export function calculatePlayerPlayTime(
  playerId: string,
  playTimeRecords: PlayTimeRecord[],
  games?: Map<string, Game>
): number {
  const playerRecords = playTimeRecords.filter(r => r.playerId === playerId);
  let totalSeconds = 0;

  playerRecords.forEach(record => {
    let recordDuration = 0;

    if (record.durationSeconds) {
      // Stored duration is most reliable
      recordDuration = record.durationSeconds;
    } else if (record.startTime && record.endTime) {
      // Has start and end time but no stored duration - calculate it
      const startTime = new Date(record.startTime).getTime();
      const endTime = new Date(record.endTime).getTime();
      recordDuration = Math.floor((endTime - startTime) / 1000);
    } else if (record.startTime && !record.endTime) {
      // No end time - only calculate if game is actually in progress
      if (games && record.gameId) {
        const game = games.get(record.gameId);
        if (game && game.status === 'in-progress') {
          // Game is actively running - calculate from start to now
          const startTime = new Date(record.startTime).getTime();
          const now = Date.now();
          recordDuration = Math.floor((now - startTime) / 1000);
        }
        // If game is not in-progress (halftime, completed, etc), skip this record
      } else {
        // No game context provided - assume record is active and calculate
        // This is used by GameManagement which doesn't need game status check
        const startTime = new Date(record.startTime).getTime();
        const now = Date.now();
        recordDuration = Math.floor((now - startTime) / 1000);
      }
    }

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
 * @param games - Optional map of games by ID
 * @returns Map of position name to total seconds played
 */
export function calculatePlayTimeByPosition(
  playerId: string,
  playTimeRecords: PlayTimeRecord[],
  positions: Map<string, { positionName: string }>,
  games?: Map<string, Game>
): Map<string, number> {
  const playerRecords = playTimeRecords.filter(r => r.playerId === playerId);
  const playTimeByPosition = new Map<string, number>();

  playerRecords.forEach(record => {
    // Get position name
    const position = record.positionId ? positions.get(record.positionId) : null;
    const positionName = position?.positionName || 'Unknown';

    // Calculate duration using same logic as calculatePlayerPlayTime
    let recordDuration = 0;

    if (record.durationSeconds) {
      recordDuration = record.durationSeconds;
    } else if (record.startTime && record.endTime) {
      const startTime = new Date(record.startTime).getTime();
      const endTime = new Date(record.endTime).getTime();
      recordDuration = Math.floor((endTime - startTime) / 1000);
    } else if (record.startTime && !record.endTime) {
      if (games && record.gameId) {
        const game = games.get(record.gameId);
        if (game && game.status === 'in-progress') {
          const startTime = new Date(record.startTime).getTime();
          const now = Date.now();
          recordDuration = Math.floor((now - startTime) / 1000);
        }
      } else {
        const startTime = new Date(record.startTime).getTime();
        const now = Date.now();
        recordDuration = Math.floor((now - startTime) / 1000);
      }
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
    
    case 'verbose':
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
    r => r.playerId === playerId && r.startTime && !r.endTime
  );
}
