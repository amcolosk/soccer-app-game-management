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

/**
 * Converts an ISO 8601 UTC datetime string to the format expected by
 * <input type="datetime-local"> (yyyy-MM-ddTHH:mm in local time).
 * Returns "" for nullish input.
 */
export function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
