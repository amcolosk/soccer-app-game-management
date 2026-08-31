import { describe, expect, it } from 'vitest';
import { computeContentHash, deriveDeterministicGameId } from './contentHash';

describe('computeContentHash', () => {
  it('produces a stable hash for identical import-owned fields', () => {
    const input = {
      opponent: 'BSC - MID-IOWA U13 BOYS',
      isHome: false,
      gameDate: '2026-09-06T15:00:00.000Z',
      locationName: 'Bondurant Recreational Sports Complex East 4',
      locationAddress: '5601 NE Hubbell Ave, Bondurant, IA 50035',
      arriveByTime: '2026-09-06T14:15:00.000Z',
    };
    expect(computeContentHash(input)).toBe(computeContentHash({ ...input }));
  });

  it('changes when any import-owned field changes', () => {
    const base = {
      opponent: 'BSC - MID-IOWA U13 BOYS',
      isHome: false,
      gameDate: '2026-09-06T15:00:00.000Z',
      locationName: null,
      locationAddress: null,
      arriveByTime: null,
    };
    const changedOpponent = computeContentHash({ ...base, opponent: 'Different Opponent' });
    const changedIsHome = computeContentHash({ ...base, isHome: true });
    const changedDate = computeContentHash({ ...base, gameDate: '2026-09-07T15:00:00.000Z' });
    const original = computeContentHash(base);

    expect(changedOpponent).not.toBe(original);
    expect(changedIsHome).not.toBe(original);
    expect(changedDate).not.toBe(original);
  });

  it('treats undefined and null the same for optional fields', () => {
    const withUndefined = computeContentHash({
      opponent: 'X', isHome: true, gameDate: null,
    });
    const withNull = computeContentHash({
      opponent: 'X', isHome: true, gameDate: null, locationName: null, locationAddress: null, arriveByTime: null,
    });
    expect(withUndefined).toBe(withNull);
  });
});

describe('deriveDeterministicGameId — golden test (round-2 Minor 2)', () => {
  // Pinned: sha256('team-golden-1|playmetrics|Game_4841731') formatted per
  // the exact recipe in the plan's Schema Changes section. If this
  // assertion ever needs to change, the recipe changed — which orphans
  // every previously-imported game. Treat any diff here as a Major finding,
  // not a routine test update.
  it('produces the exact pinned id for a fixed input triple', () => {
    const id = deriveDeterministicGameId('team-golden-1', 'playmetrics', 'Game_4841731');
    expect(id).toBe('c7de4ea1-cf33-4998-bda5-8439a672d353');
  });

  it('is deterministic across repeated calls with the same inputs (idempotent creates)', () => {
    const a = deriveDeterministicGameId('team-1', 'playmetrics', 'Game_42');
    const b = deriveDeterministicGameId('team-1', 'playmetrics', 'Game_42');
    expect(a).toBe(b);
  });

  it('differs when any input differs', () => {
    const base = deriveDeterministicGameId('team-1', 'playmetrics', 'Game_42');
    expect(deriveDeterministicGameId('team-2', 'playmetrics', 'Game_42')).not.toBe(base);
    expect(deriveDeterministicGameId('team-1', 'ics', 'Game_42')).not.toBe(base);
    expect(deriveDeterministicGameId('team-1', 'playmetrics', 'Game_43')).not.toBe(base);
  });

  it('produces a valid-looking UUIDv4 shape (version 4, variant 8-b)', () => {
    const id = deriveDeterministicGameId('team-1', 'playmetrics', 'Game_42');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
