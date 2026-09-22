import { describe, expect, it } from 'vitest';
import { computeCurrentGameSeconds } from './gameClock';

describe('computeCurrentGameSeconds', () => {
  it('returns elapsedSeconds + additional running seconds when in-progress with a lastStartTime', () => {
    const now = Date.parse('2026-09-13T17:00:30.000Z');
    const lastStartTime = '2026-09-13T17:00:00.000Z'; // started 30s ago
    const result = computeCurrentGameSeconds({ status: 'in-progress', elapsedSeconds: 1000, lastStartTime }, now);
    expect(result).toBe(1030);
  });

  it('returns elapsedSeconds unchanged when paused (lastStartTime null)', () => {
    const result = computeCurrentGameSeconds({ status: 'in-progress', elapsedSeconds: 1000, lastStartTime: null });
    expect(result).toBe(1000);
  });

  it('returns elapsedSeconds unchanged during halftime', () => {
    const result = computeCurrentGameSeconds({ status: 'halftime', elapsedSeconds: 1800, lastStartTime: null });
    expect(result).toBe(1800);
  });

  it('returns elapsedSeconds unchanged when scheduled', () => {
    const result = computeCurrentGameSeconds({ status: 'scheduled', elapsedSeconds: 0, lastStartTime: null });
    expect(result).toBe(0);
  });

  it('returns elapsedSeconds unchanged when completed, even if lastStartTime is stale/present', () => {
    const result = computeCurrentGameSeconds({ status: 'completed', elapsedSeconds: 2700, lastStartTime: '2026-09-13T16:00:00.000Z' }, Date.parse('2026-09-13T17:00:00.000Z'));
    expect(result).toBe(2700);
  });

  it('defaults elapsedSeconds to 0 when null/undefined', () => {
    expect(computeCurrentGameSeconds({ status: 'scheduled', elapsedSeconds: null, lastStartTime: null })).toBe(0);
    expect(computeCurrentGameSeconds({ status: 'scheduled', lastStartTime: null })).toBe(0);
  });

  it('falls back to frozen elapsedSeconds when lastStartTime is an invalid date string', () => {
    const result = computeCurrentGameSeconds({ status: 'in-progress', elapsedSeconds: 500, lastStartTime: 'not-a-date' });
    expect(result).toBe(500);
  });

  it('uses Date.now() by default when now is not supplied', () => {
    const lastStartTime = new Date(Date.now() - 10_000).toISOString();
    const result = computeCurrentGameSeconds({ status: 'in-progress', elapsedSeconds: 0, lastStartTime });
    expect(result).toBeGreaterThanOrEqual(9);
    expect(result).toBeLessThanOrEqual(11);
  });
});
