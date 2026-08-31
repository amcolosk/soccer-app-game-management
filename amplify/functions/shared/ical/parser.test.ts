import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseICalendar,
  getProp,
  getPropParams,
  zonedWallTimeToUtc,
  resolveDateTimeToUtcIso,
  parseRawDateTime,
  ICalParseError,
  MAX_VEVENTS,
} from './parser';

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'playmetrics-sample.ics');
const fixture = readFileSync(FIXTURE_PATH, 'utf8');

describe('parseICalendar — real feed fixture', () => {
  it('extracts calendar-level metadata', () => {
    const { calendar } = parseICalendar(fixture);
    expect(calendar.prodId).toBe('-//PlayMetrics//EN');
    expect(calendar.calName).toBe('Iowa United FC U13 Boys Navy Games');
    expect(calendar.timezone).toBe('America/Chicago');
  });

  it('parses all 7 VEVENTs', () => {
    const { events } = parseICalendar(fixture);
    expect(events).toHaveLength(7);
  });

  it('unfolds the mid-name-fold DESCRIPTION in event 3 without corrupting the opponent name', () => {
    const { events } = parseICalendar(fixture);
    const event3 = events.find((e) => getProp(e, 'UID') === 'Game_4841731');
    expect(event3).toBeDefined();
    const description = getProp(event3!, 'DESCRIPTION');
    // Exactly one space between "Boys" and "Navy" — not zero (corrupted
    // concatenation) and not two (double space).
    expect(description).toContain('Iowa United FC U13 Boys Navy');
    expect(description).not.toContain('Boys  Navy');
    expect(description).not.toContain('BoysNavy');
  });

  it('unescapes \\n into real newlines and preserves 3 description lines where present', () => {
    const { events } = parseICalendar(fixture);
    const event1 = events.find((e) => getProp(e, 'UID') === 'Game_1000001');
    const description = getProp(event1!, 'DESCRIPTION')!;
    const lines = description.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('Iowa United FC U13 Boys Navy at BSC - MID-IOWA U13 BOYS');
    expect(lines[1]).toBe('Arrive by 9:15 AM');
    expect(lines[2]).toBe('Bondurant Recreational Sports Complex East 4');
  });

  it('unescapes commas in LOCATION (\\, -> ,)', () => {
    const { events } = parseICalendar(fixture);
    const event1 = events.find((e) => getProp(e, 'UID') === 'Game_1000001');
    expect(getProp(event1!, 'LOCATION')).toBe('5601 NE Hubbell Ave, Bondurant, IA 50035');
  });

  it('captures TZID as a parameter on DTSTART', () => {
    const { events } = parseICalendar(fixture);
    const event3 = events.find((e) => getProp(e, 'UID') === 'Game_4841731');
    expect(getPropParams(event3!, 'DTSTART').TZID).toBe('America/Chicago');
  });

  it('captures STATUS:CANCELLED on the cancelled event only', () => {
    const { events } = parseICalendar(fixture);
    const cancelled = events.find((e) => getProp(e, 'UID') === 'Game_1000004');
    expect(getProp(cancelled!, 'STATUS')).toBe('CANCELLED');
    const notCancelled = events.find((e) => getProp(e, 'UID') === 'Game_1000001');
    expect(getProp(notCancelled!, 'STATUS')).toBeUndefined();
  });

  it('warns on RRULE but still includes the event (v1: import every VEVENT)', () => {
    const { events, warnings } = parseICalendar(fixture);
    const withRrule = events.find((e) => getProp(e, 'UID') === 'Game_1000007');
    expect(withRrule).toBeDefined();
    expect(warnings.some((w) => /RRULE/i.test(w))).toBe(true);
  });

  it('events 6 and 7 have only two description lines, with the venue name in LOCATION and no third line', () => {
    const { events } = parseICalendar(fixture);
    const event6 = events.find((e) => getProp(e, 'UID') === 'Game_1000006');
    const description = getProp(event6!, 'DESCRIPTION')!;
    expect(description.split('\n')).toHaveLength(2);
    expect(getProp(event6!, 'LOCATION')).toBe('Tuma Soccer Complex 35');
  });
});

describe('parseICalendar — malformed input', () => {
  it('throws a clear error when BEGIN:VCALENDAR is missing', () => {
    expect(() => parseICalendar('BEGIN:VEVENT\nUID:x\nEND:VEVENT\n')).toThrow(ICalParseError);
  });

  it('returns zero events with a warning when there is no VEVENT block', () => {
    const { events, warnings } = parseICalendar('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR\n');
    expect(events).toHaveLength(0);
    expect(warnings.some((w) => /No VEVENT/i.test(w))).toBe(true);
  });

  it('handles CRLF line endings', () => {
    const text = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:abc\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const { events } = parseICalendar(text);
    expect(events).toHaveLength(1);
    expect(getProp(events[0], 'UID')).toBe('abc');
  });

  it('handles bare LF line endings (non-conformant producer)', () => {
    const text = 'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:abc\nEND:VEVENT\nEND:VCALENDAR\n';
    const { events } = parseICalendar(text);
    expect(events).toHaveLength(1);
  });

  it('strips a UTF-8 BOM before parsing', () => {
    const text = '﻿BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:abc\nEND:VEVENT\nEND:VCALENDAR\n';
    const { events } = parseICalendar(text);
    expect(events).toHaveLength(1);
  });

  it('falls back to the generic adapter path for an unknown PRODID (no throw — parsing itself is provider-agnostic)', () => {
    const text = 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//SomeOtherProvider//EN\nBEGIN:VEVENT\nUID:abc\nEND:VEVENT\nEND:VCALENDAR\n';
    const { calendar } = parseICalendar(text);
    expect(calendar.prodId).toBe('-//SomeOtherProvider//EN');
  });

  it('truncated file with no closing END:VCALENDAR still parses complete VEVENTs seen so far', () => {
    const text = 'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:abc\nEND:VEVENT\n';
    const { events } = parseICalendar(text);
    expect(events).toHaveLength(1);
  });

  it('rejects a feed with more than MAX_VEVENTS events', () => {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0'];
    for (let i = 0; i < MAX_VEVENTS + 1; i += 1) {
      lines.push('BEGIN:VEVENT', `UID:${i}`, 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    expect(() => parseICalendar(lines.join('\n'))).toThrow(ICalParseError);
  });
});

describe('zonedWallTimeToUtc', () => {
  it('resolves a CDT (summer, UTC-5) wall time correctly', () => {
    const iso = zonedWallTimeToUtc({ year: 2026, month: 9, day: 12, hour: 15, minute: 0, second: 0 }, 'America/Chicago');
    expect(iso).toBe('2026-09-12T20:00:00.000Z');
  });

  it('resolves a CST (winter, UTC-6) wall time correctly', () => {
    const iso = zonedWallTimeToUtc({ year: 2026, month: 1, day: 15, hour: 15, minute: 0, second: 0 }, 'America/Chicago');
    expect(iso).toBe('2026-01-15T21:00:00.000Z');
  });

  it('shifts a nonexistent spring-forward wall time forward by the gap', () => {
    // 2026-03-08 is the US spring-forward date (2am CST -> 3am CDT). 2:30am
    // does not exist; the documented rule is to shift forward by the gap,
    // landing on 3:30am CDT (UTC-5) = 08:30 UTC.
    const iso = zonedWallTimeToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 }, 'America/Chicago');
    expect(iso).toBe('2026-03-08T08:30:00.000Z');
  });

  it('resolves an ambiguous fall-back wall time using the earlier (pre-transition/DST) offset', () => {
    // 2026-11-01 is the US fall-back date (2am CDT -> 1am CST). 1:30am
    // occurs twice; the documented rule picks the earlier (CDT, UTC-5)
    // occurrence = 06:30 UTC, not the later (CST, UTC-6) 07:30 UTC.
    const iso = zonedWallTimeToUtc({ year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 }, 'America/Chicago');
    expect(iso).toBe('2026-11-01T06:30:00.000Z');
  });
});

describe('parseRawDateTime', () => {
  it('parses a Z-suffixed UTC value', () => {
    const wall = parseRawDateTime('20260912T160000Z');
    expect(wall).toEqual({ year: 2026, month: 9, day: 12, hour: 16, minute: 0, second: 0, isUtc: true });
  });

  it('parses a floating value with no suffix', () => {
    const wall = parseRawDateTime('20260912T110000');
    expect(wall).toEqual({ year: 2026, month: 9, day: 12, hour: 11, minute: 0, second: 0, isUtc: false });
  });

  it('returns null for a malformed value', () => {
    expect(parseRawDateTime('not-a-date')).toBeNull();
  });
});

describe('resolveDateTimeToUtcIso', () => {
  it('uses a Z-suffixed value directly', () => {
    expect(resolveDateTimeToUtcIso('20260912T160000Z', {}, undefined)).toBe('2026-09-12T16:00:00.000Z');
  });

  it('resolves via the TZID parameter when present', () => {
    expect(resolveDateTimeToUtcIso('20260912T110000', { TZID: 'America/Chicago' }, undefined))
      .toBe('2026-09-12T16:00:00.000Z');
  });

  it('falls back to the calendar X-WR-TIMEZONE for a floating value with no TZID', () => {
    expect(resolveDateTimeToUtcIso('20260912T110000', {}, 'America/Chicago'))
      .toBe('2026-09-12T16:00:00.000Z');
  });

  it('falls back to UTC for a floating value with no TZID and no calendar timezone', () => {
    expect(resolveDateTimeToUtcIso('20260912T110000', {}, undefined))
      .toBe('2026-09-12T11:00:00.000Z');
  });

  it('returns null for a malformed value', () => {
    expect(resolveDateTimeToUtcIso('garbage', {}, undefined)).toBeNull();
  });
});
