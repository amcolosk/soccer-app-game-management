import { describe, expect, it } from 'vitest';
import { computeActiveGoalkeeperId as lambdaComputeActiveGoalkeeperId } from './goalkeeper';
import { getCurrentGoalkeeperId as clientGetCurrentGoalkeeperId } from '../../../src/utils/playTimeCalculations';

describe('goalkeeper.ts parity with src/utils/playTimeCalculations.ts', () => {
  const cases: Array<{
    name: string;
    playTimeRecords: Array<{ playerId: string; positionId?: string | null; endGameSeconds?: number | null }>;
    positions: Array<{ id: string; role?: string | null }>;
    expected: string | null;
  }> = [
    {
      name: 'no GOALKEEPER-role position at all',
      playTimeRecords: [{ playerId: 'p1', positionId: 'pos1', endGameSeconds: null }],
      positions: [{ id: 'pos1', role: 'DEFENDER' }],
      expected: null,
    },
    {
      name: 'exactly one open record at a GOALKEEPER-role position',
      playTimeRecords: [{ playerId: 'p1', positionId: 'gk-pos', endGameSeconds: null }],
      positions: [{ id: 'gk-pos', role: 'GOALKEEPER' }],
      expected: 'p1',
    },
    {
      name: 'two different players with open records at two different GOALKEEPER-role positions -> ambiguous',
      playTimeRecords: [
        { playerId: 'p1', positionId: 'gk-pos-1', endGameSeconds: null },
        { playerId: 'p2', positionId: 'gk-pos-2', endGameSeconds: null },
      ],
      positions: [
        { id: 'gk-pos-1', role: 'GOALKEEPER' },
        { id: 'gk-pos-2', role: 'GOALKEEPER' },
      ],
      expected: null,
    },
    {
      name: 'one player with open records at two different GOALKEEPER-role positions simultaneously -> still unambiguous',
      playTimeRecords: [
        { playerId: 'p1', positionId: 'gk-pos-1', endGameSeconds: null },
        { playerId: 'p1', positionId: 'gk-pos-2', endGameSeconds: null },
      ],
      positions: [
        { id: 'gk-pos-1', role: 'GOALKEEPER' },
        { id: 'gk-pos-2', role: 'GOALKEEPER' },
      ],
      expected: 'p1',
    },
    {
      name: 'a closed record (endGameSeconds set to a real number) at a GOALKEEPER-role position is excluded',
      playTimeRecords: [
        { playerId: 'p1', positionId: 'gk-pos', endGameSeconds: 1200 },
        { playerId: 'p2', positionId: 'gk-pos', endGameSeconds: null },
      ],
      positions: [{ id: 'gk-pos', role: 'GOALKEEPER' }],
      expected: 'p2',
    },
    {
      name: 'endGameSeconds === 0 is treated as closed, not open (not a falsy check)',
      playTimeRecords: [{ playerId: 'p1', positionId: 'gk-pos', endGameSeconds: 0 }],
      positions: [{ id: 'gk-pos', role: 'GOALKEEPER' }],
      expected: null,
    },
    {
      name: 'positionId null/undefined on a record -> excluded, does not crash',
      playTimeRecords: [
        { playerId: 'p1', positionId: null, endGameSeconds: null },
        { playerId: 'p2', endGameSeconds: null },
      ],
      positions: [{ id: 'gk-pos', role: 'GOALKEEPER' }],
      expected: null,
    },
    {
      name: 'empty playTimeRecords and positions -> null, does not crash',
      playTimeRecords: [],
      positions: [],
      expected: null,
    },
  ];

  it.each(cases)('$name', ({ playTimeRecords, positions, expected }) => {
    const lambdaResult = lambdaComputeActiveGoalkeeperId(playTimeRecords, positions);
    // `getCurrentGoalkeeperId` expects full `PlayTimeRecord` shapes; the
    // parity table only exercises the fields the derivation actually reads,
    // so a cast is used here rather than fabricating every unrelated
    // PlayTimeRecord field for each case.
    const clientResult = clientGetCurrentGoalkeeperId(
      playTimeRecords as Parameters<typeof clientGetCurrentGoalkeeperId>[0],
      positions
    );
    expect(lambdaResult).toBe(expected);
    expect(clientResult).toBe(expected);
    expect(lambdaResult).toBe(clientResult);
  });
});
