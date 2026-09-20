/**
 * Always-on ring buffer capturing recent console.warn/console.error calls,
 * so bug reports can carry evidence of silent/swallowed errors that led up
 * to a filed report. console.log is intentionally excluded — too noisy, and
 * would capture unrelated screens.
 */

export type ConsoleLogLevel = 'warn' | 'error';

export interface ConsoleLogEntry {
  level: ConsoleLogLevel;
  message: string;
  timestamp: string;
}

export const MAX_CONSOLE_LOG_ENTRIES = 50;

// Cap each recorded message so one large logged object can't blow out the
// combined bug-report payload (which has its own overall length limit).
const MAX_MESSAGE_LENGTH = 500;

const buffer: ConsoleLogEntry[] = [];
let installed = false;

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack ?? arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function truncate(message: string): string {
  return message.length > MAX_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…`
    : message;
}

function record(level: ConsoleLogLevel, args: unknown[]): void {
  buffer.push({
    level,
    message: truncate(args.map(formatArg).join(' ')),
    timestamp: new Date().toISOString(),
  });
  if (buffer.length > MAX_CONSOLE_LOG_ENTRIES) {
    buffer.shift();
  }
}

/**
 * Patches console.warn/console.error to also record entries into the ring
 * buffer, then forwards to the original implementation. Idempotent — safe
 * to call more than once (e.g. from a test that re-imports the module).
 */
export function installConsoleLogBuffer(): void {
  if (installed) return;
  installed = true;

  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.warn = (...args: unknown[]) => {
    record('warn', args);
    originalWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    record('error', args);
    originalError(...args);
  };
}

export function getConsoleLogEntries(): ConsoleLogEntry[] {
  return [...buffer];
}

/** Test-only: clears accumulated entries without un-patching console. */
export function resetConsoleLogBuffer(): void {
  buffer.length = 0;
}

/**
 * Formats the buffer into a human-readable snapshot suitable for inclusion
 * in bug reports. Returns null when nothing has been captured yet.
 */
export function buildConsoleLogSnapshot(): string | null {
  if (buffer.length === 0) return null;

  const lines = [
    '--- Recent Console Warnings/Errors ---',
    ...buffer.map(e => `[${e.timestamp}] ${e.level.toUpperCase()}: ${e.message}`),
    '-----------------------------------',
  ];
  return lines.join('\n');
}
