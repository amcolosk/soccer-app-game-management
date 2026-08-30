import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseICalendar, getProp } from '../parser';
import { playmetricsAdapter, detectPlaymetrics, deriveUsName } from './playmetrics';

const FIXTURE_PATH = join(__dirname, '..', '__fixtures__', 'playmetrics-sample.ics');
const fixture = readFileSync(FIXTURE_PATH, 'utf8');

describe('detectPlaymetrics', () => {
  it('detects the PlayMetrics PRODID', () => {
    expect(detectPlaymetrics('-//PlayMetrics//EN')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(detectPlaymetrics('-//playmetrics//en')).toBe(true);
  });

  it('rejects an unrelated PRODID', () => {
    expect(detectPlaymetrics('-//Google Inc//Google Calendar 70.9054//EN')).toBe(false);
  });

  it('rejects undefined', () => {
    expect(detectPlaymetrics(undefined)).toBe(false);
  });
});

describe('deriveUsName', () => {
  it('strips a trailing " Games"', () => {
    expect(deriveUsName('Iowa United FC U13 Boys Navy Games')).toBe('Iowa United FC U13 Boys Navy');
  });

  it('is case-insensitive on the suffix', () => {
    expect(deriveUsName('Some Team games')).toBe('Some Team');
  });

  it('returns the trimmed name unchanged when there is no " Games" suffix', () => {
    expect(deriveUsName('Some Team Schedule')).toBe('Some Team Schedule');
  });

  it('returns null for empty/undefined input', () => {
    expect(deriveUsName(undefined)).toBeNull();
    expect(deriveUsName('')).toBeNull();
  });
});

describe('playmetricsAdapter — real feed fixture', () => {
  const { calendar, events } = parseICalendar(fixture);
  const ctx = { calendar };
  const byUid = (uid: string) => events.find((e) => getProp(e, 'UID') === uid)!;

  it('detects the calendar as PlayMetrics', () => {
    expect(playmetricsAdapter.detect(calendar)).toBe(true);
  });

  it('event 1: away game, opponent from "<us> at <opponent>" prose, venue split across desc line 3 + LOCATION', () => {
    const record = playmetricsAdapter.parseEvent(byUid('Game_1000001'), ctx)!;
    expect(record.isHome).toBe(false);
    expect(record.opponent).toBe('BSC - MID-IOWA U13 BOYS');
    expect(record.locationName).toBe('Bondurant Recreational Sports Complex East 4');
    expect(record.locationAddress).toBe('5601 NE Hubbell Ave, Bondurant, IA 50035');
    expect(record.homeAwayUnverified).toBe(false);
    expect(record.cancelled).toBe(false);
    expect(record.externalSource).toBe('playmetrics');
    expect(record.gameDate).toBe('2026-09-06T15:00:00.000Z');
    expect(record.arriveByTime).toBe('2026-09-06T14:15:00.000Z');
  });

  it('event 2: Z-suffixed DTSTART, home game via "<opponent> at <us>" prose', () => {
    const record = playmetricsAdapter.parseEvent(byUid('Game_1000002'), ctx)!;
    expect(record.isHome).toBe(true);
    expect(record.opponent).toBe('West Des Moines Norsemen');
    expect(record.gameDate).toBe('2026-09-12T16:00:00.000Z');
  });

  it('event 3 (Game_4841731): fold trap — opponent name is not corrupted, home game, venue + address both present', () => {
    const record = playmetricsAdapter.parseEvent(byUid('Game_4841731'), ctx)!;
    expect(record.isHome).toBe(true);
    expect(record.opponent).toBe('DMSC - DMSC U13 Boys Blue');
    expect(record.locationName).toBe('Martin Field 1');
    expect(record.locationAddress).toBe('3740 86th St., Urbandale, IA 50322');
    expect(record.gameDate).toBe('2026-09-12T20:00:00.000Z');
    expect(record.arriveByTime).toBe('2026-09-12T19:45:00.000Z');
  });

  it('event 4: STATUS:CANCELLED is surfaced as cancelled: true', () => {
    const record = playmetricsAdapter.parseEvent(byUid('Game_1000004'), ctx)!;
    expect(record.cancelled).toBe(true);
    expect(record.opponent).toBe('Waukee Warriors');
  });

  it('event 5: floating DTSTART falls back to calendar X-WR-TIMEZONE', () => {
    const record = playmetricsAdapter.parseEvent(byUid('Game_1000005'), ctx)!;
    expect(record.isHome).toBe(true);
    expect(record.opponent).toBe('Ankeny SC');
    expect(record.gameDate).toBe('2026-09-26T14:30:00.000Z');
  });

  it('event 6: two-line description — venue name comes from LOCATION, no address', () => {
    const record = playmetricsAdapter.parseEvent(byUid('Game_1000006'), ctx)!;
    expect(record.locationName).toBe('Tuma Soccer Complex 35');
    expect(record.locationAddress).toBeNull();
    expect(record.isHome).toBe(false);
    expect(record.opponent).toBe('Tuma FC 15B');
  });

  it('event 7: two-line description with RRULE present — still parsed, venue from LOCATION only', () => {
    const record = playmetricsAdapter.parseEvent(byUid('Game_1000007'), ctx)!;
    expect(record.locationName).toBe('Tuma Soccer Complex 12');
    expect(record.locationAddress).toBeNull();
    expect(record.isHome).toBe(true);
    expect(record.opponent).toBe('West Liberty FC');
  });

  it('extracts UID as the dedupe key for every event', () => {
    for (const uid of ['Game_1000001', 'Game_1000002', 'Game_4841731', 'Game_1000004', 'Game_1000005', 'Game_1000006', 'Game_1000007']) {
      const record = playmetricsAdapter.parseEvent(byUid(uid), ctx)!;
      expect(record.externalUid).toBe(uid);
    }
  });

  it('returns null when UID is missing', () => {
    const record = playmetricsAdapter.parseEvent({ properties: {} }, ctx);
    expect(record).toBeNull();
  });
});

describe('playmetricsAdapter — home/away fallback', () => {
  it('flags homeAwayUnverified with a warning when the description does not match the "<us> at <them>" grammar', () => {
    const event = {
      properties: {
        UID: [{ value: 'Game_weird', params: {} }],
        DESCRIPTION: [{ value: 'Some completely unrelated text', params: {} }],
      },
    };
    const record = playmetricsAdapter.parseEvent(event, { calendar: { calName: 'Iowa United FC U13 Boys Navy Games' } })!;
    expect(record.homeAwayUnverified).toBe(true);
    expect(record.isHome).toBe(false);
    expect(record.warnings.length).toBeGreaterThan(0);
  });

  it('does not mistake a team name that itself contains " at " for the separator (does not naively split on first " at ")', () => {
    // "us" ends in "... at Home Field FC" style name should still resolve via
    // suffix/prefix matching against the full alias, not a naive split.
    const event = {
      properties: {
        UID: [{ value: 'Game_at_trap', params: {} }],
        DESCRIPTION: [{ value: 'Team A at Home at Iowa United FC U13 Boys Navy', params: {} }],
      },
    };
    const record = playmetricsAdapter.parseEvent(event, { calendar: { calName: 'Iowa United FC U13 Boys Navy Games' } })!;
    expect(record.isHome).toBe(true);
    expect(record.opponent).toBe('Team A at Home');
  });
});
