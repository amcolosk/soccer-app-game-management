/**
 * Shared Play Time Calculation Utilities
 * 
 * This module provides a single source of truth for calculating player play time
 * from PlayTimeRecords. Used by both GameManagement and SeasonReport to ensure
 * consistent calculations across the application.
 */

import type { Schema } from "../../amplify/data/resource";

type PlayTimeRecord = Schema["PlayTimeRecord"]["type"];

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
  currentGameTime?: number
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
    r => r.playerId === playerId && (r.endGameSeconds === null || r.endGameSeconds === undefined)
  );
}
