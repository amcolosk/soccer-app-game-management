/**
 * Formats game time for display
 * @param seconds - Game time in seconds
 * @param half - Current half (1 or 2)
 * @returns Formatted string like "15' (1st Half)"
 */
export function formatGameTimeDisplay(seconds: number, half: number): string {
  const minutes = Math.floor(seconds / 60);
  const halfText = half === 1 ? '1st' : '2nd';
  return `${minutes}' (${halfText} Half)`;
}

/**
 * Formats seconds into MM:SS format
 * @param seconds - Total seconds
 * @returns Formatted string like "05:30"
 */
export function formatMinutesSeconds(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
