import { describe, expect, it } from 'vitest';
import { selectAdapter, playmetricsAdapter, genericAdapter } from './index';

describe('selectAdapter', () => {
  it('selects the PlayMetrics adapter when PRODID matches', () => {
    expect(selectAdapter({ prodId: '-//PlayMetrics//EN' })).toBe(playmetricsAdapter);
  });

  it('falls back to the generic adapter for an unknown PRODID', () => {
    expect(selectAdapter({ prodId: '-//Google Inc//Google Calendar 70.9054//EN' })).toBe(genericAdapter);
  });

  it('falls back to the generic adapter when PRODID is absent', () => {
    expect(selectAdapter({})).toBe(genericAdapter);
  });
});
