/**
 * The union of value types accepted by buildFlatDebugSnapshot entries.
 */
export type FlatDebugValue = string | number | boolean | null | undefined | Record<string, number>;

/**
 * Formats a flat key-value debug context into a human-readable snapshot string.
 * Values of type Record<string, number> are serialized as "key1=N, key2=N".
 *
 * The generic parameter allows typed debug context objects to be passed directly
 * without requiring them to declare a string index signature.
 */
export function buildFlatDebugSnapshot<T extends Record<string, FlatDebugValue>>(
  title: string,
  entries: T
): string {
  const lines = [`--- ${title} ---`];
  for (const [key, value] of Object.entries(entries)) {
    if (value !== null && value !== undefined && typeof value === 'object') {
      // Record<string, number>
      const inner = Object.entries(value).map(([k, v]) => `${k}=${v}`).join(', ');
      lines.push(`${key}: ${inner || '(none)'}`);
    } else {
      lines.push(`${key}: ${value ?? '(null)'}`);
    }
  }
  lines.push('-----------------------------------');
  return lines.join('\n');
}
