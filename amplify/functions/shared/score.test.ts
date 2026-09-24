import { describe, expect, it } from 'vitest';
import { computeScoreFromGoals as lambdaComputeScoreFromGoals, resolveScore } from './score';
import { computeScoreFromGoals as clientComputeScoreFromGoals } from '../../../src/utils/gameCalculations';

describe('score.ts parity with src/utils/gameCalculations.ts', () => {
  const cases: Array<{
    name: string;
    goals: Array<{ scoredByUs: boolean }>;
    expected: { ourScore: number; opponentScore: number };
  }> = [
    {
      name: 'empty goals',
      goals: [],
      expected: { ourScore: 0, opponentScore: 0 },
    },
    {
      name: 'all goals scored by us',
      goals: [{ scoredByUs: true }, { scoredByUs: true }],
      expected: { ourScore: 2, opponentScore: 0 },
    },
    {
      name: 'all goals scored by opponent',
      goals: [{ scoredByUs: false }, { scoredByUs: false }, { scoredByUs: false }],
      expected: { ourScore: 0, opponentScore: 3 },
    },
    {
      name: 'mixed goals',
      goals: [
        { scoredByUs: true },
        { scoredByUs: false },
        { scoredByUs: true },
        { scoredByUs: false },
        { scoredByUs: true },
      ],
      expected: { ourScore: 3, opponentScore: 2 },
    },
    {
      name: 'single goal',
      goals: [{ scoredByUs: true }],
      expected: { ourScore: 1, opponentScore: 0 },
    },
  ];

  it.each(cases)('$name', ({ goals, expected }) => {
    const lambdaResult = lambdaComputeScoreFromGoals(goals);
    const clientResult = clientComputeScoreFromGoals(goals);
    expect(lambdaResult).toEqual(expected);
    expect(clientResult).toEqual(expected);
    expect(lambdaResult).toEqual(clientResult);
  });
});

describe('resolveScore', () => {
  it('isLive: true ignores persisted and returns the goal-derived value', () => {
    const result = resolveScore(
      true,
      { ourScore: 9, opponentScore: 9 },
      [{ scoredByUs: true }, { scoredByUs: false }, { scoredByUs: true }],
    );
    expect(result).toEqual({ ourScore: 2, opponentScore: 1 });
  });

  it('isLive: false ignores goals and returns persisted values', () => {
    const result = resolveScore(
      false,
      { ourScore: 3, opponentScore: 1 },
      [{ scoredByUs: true }, { scoredByUs: true }, { scoredByUs: true }],
    );
    expect(result).toEqual({ ourScore: 3, opponentScore: 1 });
  });

  it('isLive: false with persisted: null returns { ourScore: null, opponentScore: null }', () => {
    const result = resolveScore(false, null, [{ scoredByUs: true }]);
    expect(result).toEqual({ ourScore: null, opponentScore: null });
  });
});
