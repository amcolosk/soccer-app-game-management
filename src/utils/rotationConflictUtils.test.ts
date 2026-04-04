import { describe, it, expect } from 'vitest';
import { isSubEffectivelyExecuted, isRotationFullyExecuted } from './rotationConflictUtils';
import type { LineupAssignment, PlannedSubstitution } from '../types/schema';

const makeLineupEntry = (playerId: string, isStarter = true): LineupAssignment =>
  ({
    id: `la-${playerId}`,
    gameId: 'game-1',
    playerId,
    positionId: 'pos-1',
    isStarter,
    coaches: [],
  }) as unknown as LineupAssignment;

const makeSub = (playerOutId: string, playerInId: string): PlannedSubstitution => ({
  playerOutId,
  playerInId,
  positionId: 'pos-1',
});

describe('isSubEffectivelyExecuted', () => {
  it('returns true when playerIn is a starter and playerOut is NOT in lineup', () => {
    const lineup = [makeLineupEntry('player-in')];
    const sub = makeSub('player-out', 'player-in');
    expect(isSubEffectivelyExecuted(sub, lineup)).toBe(true);
  });

  it('returns false when playerIn is NOT on field (rotation not yet executed)', () => {
    const lineup = [makeLineupEntry('player-out')];
    const sub = makeSub('player-out', 'player-in');
    expect(isSubEffectivelyExecuted(sub, lineup)).toBe(false);
  });

  it('returns false when both playerIn and playerOut are on field (true conflict)', () => {
    const lineup = [makeLineupEntry('player-out'), makeLineupEntry('player-in')];
    const sub = makeSub('player-out', 'player-in');
    expect(isSubEffectivelyExecuted(sub, lineup)).toBe(false);
  });

  it('returns false when neither playerIn nor playerOut is on field', () => {
    const lineup: LineupAssignment[] = [];
    const sub = makeSub('player-out', 'player-in');
    expect(isSubEffectivelyExecuted(sub, lineup)).toBe(false);
  });

  it('returns false when playerIn is in lineup but isStarter is false', () => {
    const lineup = [makeLineupEntry('player-in', false)];
    const sub = makeSub('player-out', 'player-in');
    expect(isSubEffectivelyExecuted(sub, lineup)).toBe(false);
  });
});

describe('isRotationFullyExecuted', () => {
  it('returns true when all substitutions are effectively executed', () => {
    const lineup = [makeLineupEntry('p-in-1'), makeLineupEntry('p-in-2')];
    const subs: PlannedSubstitution[] = [
      makeSub('p-out-1', 'p-in-1'),
      makeSub('p-out-2', 'p-in-2'),
    ];
    expect(isRotationFullyExecuted(JSON.stringify(subs), lineup)).toBe(true);
  });

  it('returns false when only some (not all) subs are effectively executed', () => {
    // p-in-1 is on field (executed), but p-out-2 is still on field (not executed)
    const lineup = [makeLineupEntry('p-in-1'), makeLineupEntry('p-out-2')];
    const subs: PlannedSubstitution[] = [
      makeSub('p-out-1', 'p-in-1'),
      makeSub('p-out-2', 'p-in-2'),
    ];
    expect(isRotationFullyExecuted(JSON.stringify(subs), lineup)).toBe(false);
  });

  it('returns false for an empty substitutions array (vacuous truth guard)', () => {
    const lineup = [makeLineupEntry('player-a')];
    expect(isRotationFullyExecuted(JSON.stringify([]), lineup)).toBe(false);
  });

  it('returns false when JSON is malformed (safe fallback)', () => {
    const lineup = [makeLineupEntry('player-a')];
    expect(isRotationFullyExecuted('not-valid-json', lineup)).toBe(false);
  });
});
