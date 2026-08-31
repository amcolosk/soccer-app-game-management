import { describe, expect, it } from 'vitest';
import { genericAdapter } from './generic';

const ctx = { calendar: {} };

describe('genericAdapter', () => {
  it('always detects (catch-all)', () => {
    expect(genericAdapter.detect({})).toBe(true);
  });

  it('derives opponent from SUMMARY', () => {
    const event = { properties: { UID: [{ value: 'e1', params: {} }], SUMMARY: [{ value: 'Practice vs Rivals', params: {} }] } };
    const record = genericAdapter.parseEvent(event, ctx)!;
    expect(record.opponent).toBe('Practice vs Rivals');
  });

  it('falls back to "Opponent TBD" plus a warning when SUMMARY is empty', () => {
    const event = { properties: { UID: [{ value: 'e2', params: {} }], SUMMARY: [{ value: '   ', params: {} }] } };
    const record = genericAdapter.parseEvent(event, ctx)!;
    expect(record.opponent).toBe('Opponent TBD');
    expect(record.warnings.some((w) => /SUMMARY/.test(w))).toBe(true);
  });

  it('always sets isHome: false and externalHomeAwayUnverified with a warning (no default to fall back to)', () => {
    const event = { properties: { UID: [{ value: 'e3', params: {} }], SUMMARY: [{ value: 'Some Game', params: {} }] } };
    const record = genericAdapter.parseEvent(event, ctx)!;
    expect(record.isHome).toBe(false);
    expect(record.homeAwayUnverified).toBe(true);
    expect(record.warnings.some((w) => /home\/away/i.test(w))).toBe(true);
  });

  it('maps LOCATION to locationName with no address', () => {
    const event = {
      properties: {
        UID: [{ value: 'e4', params: {} }],
        SUMMARY: [{ value: 'Game', params: {} }],
        LOCATION: [{ value: 'Some Park', params: {} }],
      },
    };
    const record = genericAdapter.parseEvent(event, ctx)!;
    expect(record.locationName).toBe('Some Park');
    expect(record.locationAddress).toBeNull();
  });

  it('resolves DTSTART with a Z suffix directly', () => {
    const event = {
      properties: {
        UID: [{ value: 'e5', params: {} }],
        SUMMARY: [{ value: 'Game', params: {} }],
        DTSTART: [{ value: '20260912T160000Z', params: {} }],
      },
    };
    const record = genericAdapter.parseEvent(event, ctx)!;
    expect(record.gameDate).toBe('2026-09-12T16:00:00.000Z');
  });

  it('flags STATUS:CANCELLED', () => {
    const event = {
      properties: {
        UID: [{ value: 'e6', params: {} }],
        SUMMARY: [{ value: 'Game', params: {} }],
        STATUS: [{ value: 'CANCELLED', params: {} }],
      },
    };
    const record = genericAdapter.parseEvent(event, ctx)!;
    expect(record.cancelled).toBe(true);
  });

  it('sets externalSource to "ics"', () => {
    const event = { properties: { UID: [{ value: 'e7', params: {} }], SUMMARY: [{ value: 'Game', params: {} }] } };
    const record = genericAdapter.parseEvent(event, ctx)!;
    expect(record.externalSource).toBe('ics');
  });

  it('returns null when UID is missing', () => {
    const event = { properties: { SUMMARY: [{ value: 'Game', params: {} }] } };
    expect(genericAdapter.parseEvent(event, ctx)).toBeNull();
  });
});
