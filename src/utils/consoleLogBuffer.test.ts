/**
 * Tests for the always-on console.warn/console.error ring buffer.
 *
 * Each test dynamically imports a fresh module instance (via vi.resetModules)
 * so installConsoleLogBuffer's idempotency guard and the module-scoped
 * buffer don't leak state between tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('consoleLogBuffer', () => {
  let originalWarn: typeof console.warn;
  let originalError: typeof console.error;
  let originalLog: typeof console.log;

  beforeEach(() => {
    vi.resetModules();
    originalWarn = console.warn;
    originalError = console.error;
    originalLog = console.log;
  });

  afterEach(() => {
    console.warn = originalWarn;
    console.error = originalError;
    console.log = originalLog;
  });

  it('starts with an empty buffer before installation', async () => {
    const { getConsoleLogEntries } = await import('./consoleLogBuffer');
    expect(getConsoleLogEntries()).toEqual([]);
  });

  it('records console.warn calls after installation', async () => {
    const { installConsoleLogBuffer, getConsoleLogEntries } = await import('./consoleLogBuffer');
    installConsoleLogBuffer();

    console.warn('something odd');

    const entries = getConsoleLogEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('warn');
    expect(entries[0].message).toBe('something odd');
    expect(entries[0].timestamp).toEqual(expect.any(String));
  });

  it('records console.error calls after installation', async () => {
    const { installConsoleLogBuffer, getConsoleLogEntries } = await import('./consoleLogBuffer');
    installConsoleLogBuffer();

    console.error('boom');

    const entries = getConsoleLogEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('error');
    expect(entries[0].message).toBe('boom');
  });

  it('does not capture console.log', async () => {
    const { installConsoleLogBuffer, getConsoleLogEntries } = await import('./consoleLogBuffer');
    installConsoleLogBuffer();

    console.log('just info');

    expect(getConsoleLogEntries()).toEqual([]);
  });

  it('still forwards calls to the original console implementation', async () => {
    const { installConsoleLogBuffer } = await import('./consoleLogBuffer');
    const spy = vi.fn();
    console.warn = spy;

    installConsoleLogBuffer();
    console.warn('forwarded');

    expect(spy).toHaveBeenCalledWith('forwarded');
  });

  it('serializes Error instances using their stack', async () => {
    const { installConsoleLogBuffer, getConsoleLogEntries } = await import('./consoleLogBuffer');
    installConsoleLogBuffer();

    console.error(new Error('kaboom'));

    expect(getConsoleLogEntries()[0].message).toContain('kaboom');
  });

  it('joins multiple args and serializes non-string, non-Error args as JSON', async () => {
    const { installConsoleLogBuffer, getConsoleLogEntries } = await import('./consoleLogBuffer');
    installConsoleLogBuffer();

    console.warn('context:', { foo: 'bar' });

    expect(getConsoleLogEntries()[0].message).toBe('context: {"foo":"bar"}');
  });

  it('truncates a single very long message', async () => {
    const { installConsoleLogBuffer, getConsoleLogEntries } = await import('./consoleLogBuffer');
    installConsoleLogBuffer();

    console.warn('x'.repeat(1000));

    const message = getConsoleLogEntries()[0].message;
    expect(message.length).toBeLessThan(1000);
    expect(message.endsWith('…')).toBe(true);
  });

  it('caps the buffer at MAX_CONSOLE_LOG_ENTRIES, evicting the oldest entries first', async () => {
    const { installConsoleLogBuffer, getConsoleLogEntries, MAX_CONSOLE_LOG_ENTRIES } = await import('./consoleLogBuffer');
    installConsoleLogBuffer();

    for (let i = 0; i < MAX_CONSOLE_LOG_ENTRIES + 5; i++) {
      console.warn(`entry ${i}`);
    }

    const entries = getConsoleLogEntries();
    expect(entries).toHaveLength(MAX_CONSOLE_LOG_ENTRIES);
    expect(entries[0].message).toBe('entry 5');
    expect(entries[entries.length - 1].message).toBe(`entry ${MAX_CONSOLE_LOG_ENTRIES + 4}`);
  });

  it('is idempotent — calling installConsoleLogBuffer twice does not double-record', async () => {
    const { installConsoleLogBuffer, getConsoleLogEntries } = await import('./consoleLogBuffer');
    installConsoleLogBuffer();
    installConsoleLogBuffer();

    console.warn('once');

    expect(getConsoleLogEntries()).toHaveLength(1);
  });

  it('resetConsoleLogBuffer clears entries without un-patching console', async () => {
    const { installConsoleLogBuffer, getConsoleLogEntries, resetConsoleLogBuffer } = await import('./consoleLogBuffer');
    installConsoleLogBuffer();
    console.warn('one');

    resetConsoleLogBuffer();
    expect(getConsoleLogEntries()).toEqual([]);

    console.warn('two');
    expect(getConsoleLogEntries()).toHaveLength(1);
  });
});

describe('buildConsoleLogSnapshot', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns null when the buffer is empty', async () => {
    const { buildConsoleLogSnapshot } = await import('./consoleLogBuffer');
    expect(buildConsoleLogSnapshot()).toBeNull();
  });

  it('formats entries with level, timestamp and message', async () => {
    const { installConsoleLogBuffer, buildConsoleLogSnapshot } = await import('./consoleLogBuffer');
    installConsoleLogBuffer();

    console.warn('careful');
    console.error('uh oh');

    const snapshot = buildConsoleLogSnapshot();
    expect(snapshot).toContain('--- Recent Console Warnings/Errors ---');
    expect(snapshot).toContain('WARN: careful');
    expect(snapshot).toContain('ERROR: uh oh');
  });
});
