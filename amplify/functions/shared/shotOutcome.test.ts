import { describe, expect, it } from 'vitest';
import { deriveShotOutcomeWrites as lambdaDerive, type ShotOutcome } from './shotOutcome';
import { deriveShotOutcomeWrites as clientDerive } from '../../../src/utils/shotOutcomeMapping';

describe('shotOutcome.ts parity with src/utils/shotOutcomeMapping.ts', () => {
  const cases: Array<{
    name: string;
    input: {
      forUs: boolean;
      outcome: ShotOutcome;
      playerId?: string | null;
      assistPlayerId?: string | null;
      keeperPlayerId?: string | null;
    };
  }> = [
    { name: 'Us + GOAL, with scorer and assist', input: { forUs: true, outcome: 'GOAL', playerId: 'p1', assistPlayerId: 'p2' } },
    { name: 'Us + GOAL, no scorer (skipped shooter)', input: { forUs: true, outcome: 'GOAL' } },
    { name: 'Us + GOAL, scorer but no assist', input: { forUs: true, outcome: 'GOAL', playerId: 'p1' } },
    { name: 'Us + SAVED (opponent keeper saved it -- no attribution possible)', input: { forUs: true, outcome: 'SAVED', playerId: 'p1' } },
    { name: 'Us + BLOCKED, with shooter', input: { forUs: true, outcome: 'BLOCKED', playerId: 'p1' } },
    { name: 'Us + BLOCKED, no shooter (skipped)', input: { forUs: true, outcome: 'BLOCKED' } },
    { name: 'Us + WIDE, with shooter', input: { forUs: true, outcome: 'WIDE', playerId: 'p1' } },
    { name: 'Us + WIDE, no shooter', input: { forUs: true, outcome: 'WIDE' } },
    { name: 'Them + GOAL (opponent goal, no scorer)', input: { forUs: false, outcome: 'GOAL' } },
    { name: 'Them + SAVED, our keeper attributed', input: { forUs: false, outcome: 'SAVED', keeperPlayerId: 'gk1' } },
    { name: 'Them + SAVED, no keeper known', input: { forUs: false, outcome: 'SAVED' } },
    { name: 'Them + BLOCKED', input: { forUs: false, outcome: 'BLOCKED' } },
    { name: 'Them + WIDE', input: { forUs: false, outcome: 'WIDE' } },
    // Misuse-shaped inputs (the handler is responsible for rejecting these
    // before calling this module -- this module itself must not silently
    // promote a misplaced field into a write, on EITHER side).
    { name: 'Us + SAVED with a stray keeperPlayerId (must not leak into save.playerId)', input: { forUs: true, outcome: 'SAVED', keeperPlayerId: 'gk1' } },
    { name: 'Them + GOAL with a stray playerId/assistPlayerId (must not leak into goal fields)', input: { forUs: false, outcome: 'GOAL', playerId: 'p1', assistPlayerId: 'p2' } },
  ];

  it.each(cases)('$name', ({ input }) => {
    const lambdaResult = lambdaDerive(input);
    const clientResult = clientDerive(input);
    expect(lambdaResult).toEqual(clientResult);
  });

  it('shot.takenByUs = forUs (not inverted) on both sides', () => {
    expect(lambdaDerive({ forUs: true, outcome: 'WIDE' }).shot.takenByUs).toBe(true);
    expect(lambdaDerive({ forUs: false, outcome: 'WIDE' }).shot.takenByUs).toBe(false);
    expect(clientDerive({ forUs: true, outcome: 'WIDE' }).shot.takenByUs).toBe(true);
    expect(clientDerive({ forUs: false, outcome: 'WIDE' }).shot.takenByUs).toBe(false);
  });

  it('goal.scoredByUs = forUs (NOT inverted) -- an "Us" shot that goes in is our goal', () => {
    expect(lambdaDerive({ forUs: true, outcome: 'GOAL' }).goal).toEqual({ scoredByUs: true, scorerId: null, assistId: null });
    expect(lambdaDerive({ forUs: false, outcome: 'GOAL' }).goal).toEqual({ scoredByUs: false, scorerId: null, assistId: null });
  });

  it('save.byUs = !forUs -- INVERTED relative to the shot\'s own side', () => {
    expect(lambdaDerive({ forUs: true, outcome: 'SAVED' }).save).toEqual({ byUs: false, playerId: null });
    expect(lambdaDerive({ forUs: false, outcome: 'SAVED', keeperPlayerId: 'gk1' }).save).toEqual({ byUs: true, playerId: 'gk1' });
  });

  it('BLOCKED/WIDE never populate goal or save on either side', () => {
    for (const outcome of ['BLOCKED', 'WIDE'] as const) {
      for (const forUs of [true, false]) {
        expect(lambdaDerive({ forUs, outcome }).goal).toBeNull();
        expect(lambdaDerive({ forUs, outcome }).save).toBeNull();
        expect(clientDerive({ forUs, outcome }).goal).toBeNull();
        expect(clientDerive({ forUs, outcome }).save).toBeNull();
      }
    }
  });
});
