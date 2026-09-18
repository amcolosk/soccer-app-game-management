import { describe, expect, it } from 'vitest';
import { computeCurrentGameSeconds as lambdaComputeCurrentGameSeconds } from './gameClock';
import { computeCurrentGameSeconds as clientComputeCurrentGameSeconds } from '../../../src/utils/gameClock';

describe('gameClock.ts — Lambda mirror', () => {
  it('returns elapsedSeconds + additional running seconds when in-progress with a lastStartTime', () => {
    const now = Date.parse('2026-09-13T17:00:30.000Z');
    const lastStartTime = '2026-09-13T17:00:00.000Z';
    const result = lambdaComputeCurrentGameSeconds({ status: 'in-progress', elapsedSeconds: 1000, lastStartTime }, now);
    expect(result).toBe(1030);
  });

  it('returns elapsedSeconds unchanged when paused (lastStartTime null)', () => {
    const result = lambdaComputeCurrentGameSeconds({ status: 'in-progress', elapsedSeconds: 1000, lastStartTime: null });
    expect(result).toBe(1000);
  });

  it('returns elapsedSeconds unchanged during halftime', () => {
    const result = lambdaComputeCurrentGameSeconds({ status: 'halftime', elapsedSeconds: 1800, lastStartTime: null });
    expect(result).toBe(1800);
  });

  it('falls back to frozen elapsedSeconds when lastStartTime is an invalid date string', () => {
    const result = lambdaComputeCurrentGameSeconds({ status: 'in-progress', elapsedSeconds: 500, lastStartTime: 'not-a-date' });
    expect(result).toBe(500);
  });
});

describe('gameClock.ts parity with src/utils/gameClock.ts', () => {
  const cases: Array<{ name: string; input: Parameters<typeof lambdaComputeCurrentGameSeconds>[0]; now?: number }> = [
    { name: 'running, mid-first-half', input: { status: 'in-progress', elapsedSeconds: 600, lastStartTime: '2026-09-13T17:00:00.000Z' }, now: Date.parse('2026-09-13T17:05:00.000Z') },
    { name: 'running, accumulated elapsedSeconds carried into second half', input: { status: 'in-progress', elapsedSeconds: 1800, lastStartTime: '2026-09-13T17:30:00.000Z' }, now: Date.parse('2026-09-13T17:35:30.000Z') },
    { name: 'paused mid-game (lastStartTime null, status still in-progress)', input: { status: 'in-progress', elapsedSeconds: 900, lastStartTime: null } },
    { name: 'halftime', input: { status: 'halftime', elapsedSeconds: 1800, lastStartTime: null } },
    { name: 'scheduled', input: { status: 'scheduled', elapsedSeconds: 0, lastStartTime: null } },
    { name: 'completed, stale lastStartTime present', input: { status: 'completed', elapsedSeconds: 2700, lastStartTime: '2026-09-13T16:00:00.000Z' }, now: Date.parse('2026-09-13T18:00:00.000Z') },
    { name: 'invalid lastStartTime string', input: { status: 'in-progress', elapsedSeconds: 500, lastStartTime: 'not-a-date' } },
    { name: 'null/undefined elapsedSeconds', input: { status: 'scheduled', elapsedSeconds: null, lastStartTime: null } },
  ];

  it.each(cases)('$name — identical output from both copies', ({ input, now }) => {
    const lambdaResult = now !== undefined
      ? lambdaComputeCurrentGameSeconds(input, now)
      : lambdaComputeCurrentGameSeconds(input);
    const clientResult = now !== undefined
      ? clientComputeCurrentGameSeconds(input, now)
      : clientComputeCurrentGameSeconds(input);
    expect(lambdaResult).toBe(clientResult);
  });
});
