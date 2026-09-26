import { describe, it, expect } from 'vitest';
import { buildDeterministicStartPlayTimeRecordId } from './playTimeRecordId';

describe('buildDeterministicStartPlayTimeRecordId', () => {
  it('builds a stable id from its inputs', () => {
    expect(
      buildDeterministicStartPlayTimeRecordId({
        gameId: 'game-1',
        playerId: 'player-1',
        half: 1,
        startGameSeconds: 0,
      })
    ).toBe('ptr:game-1:player-1:h1:t0');
  });

  it('produces the same id for the same inputs (idempotent)', () => {
    const params = { gameId: 'g', playerId: 'p', half: 2 as const, startGameSeconds: 1800 };
    expect(buildDeterministicStartPlayTimeRecordId(params)).toBe(
      buildDeterministicStartPlayTimeRecordId(params)
    );
  });

  it('produces different ids for different players in the same game/half/time', () => {
    const a = buildDeterministicStartPlayTimeRecordId({ gameId: 'g', playerId: 'p1', half: 1, startGameSeconds: 0 });
    const b = buildDeterministicStartPlayTimeRecordId({ gameId: 'g', playerId: 'p2', half: 1, startGameSeconds: 0 });
    expect(a).not.toBe(b);
  });

  it('produces different ids for the same player subbed in twice at different times', () => {
    const a = buildDeterministicStartPlayTimeRecordId({ gameId: 'g', playerId: 'p', half: 1, startGameSeconds: 300 });
    const b = buildDeterministicStartPlayTimeRecordId({ gameId: 'g', playerId: 'p', half: 1, startGameSeconds: 900 });
    expect(a).not.toBe(b);
  });

  it('distinguishes half 1 from half 2', () => {
    const a = buildDeterministicStartPlayTimeRecordId({ gameId: 'g', playerId: 'p', half: 1, startGameSeconds: 0 });
    const b = buildDeterministicStartPlayTimeRecordId({ gameId: 'g', playerId: 'p', half: 2, startGameSeconds: 0 });
    expect(a).not.toBe(b);
  });
});
