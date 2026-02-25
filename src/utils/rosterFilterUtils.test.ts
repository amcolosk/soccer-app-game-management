import { describe, it, expect } from 'vitest';
import { getAvailableBirthYears, filterPlayersByBirthYears } from './rosterFilterUtils';
import type { Player } from '../types/schema';

// Minimal mock player factory
function makePlayer(id: string, birthYear: number | null | undefined): Partial<Player> {
  return { id, birthYear: birthYear ?? undefined };
}

describe('getAvailableBirthYears', () => {
  it('returns empty array for empty player list', () => {
    expect(getAvailableBirthYears([])).toEqual([]);
  });

  it('returns empty array when all players have null birthYear', () => {
    const players = [makePlayer('p1', null), makePlayer('p2', null)] as Player[];
    expect(getAvailableBirthYears(players)).toEqual([]);
  });

  it('returns sorted deduplicated birth years', () => {
    const players = [
      makePlayer('p1', 2013),
      makePlayer('p2', 2012),
      makePlayer('p3', 2014),
      makePlayer('p4', 2013),
    ] as Player[];
    expect(getAvailableBirthYears(players)).toEqual([2012, 2013, 2014]);
  });

  it('excludes players with null or undefined birthYear', () => {
    const players = [
      makePlayer('p1', 2012),
      makePlayer('p2', null),
      makePlayer('p3', undefined),
      makePlayer('p4', 2015),
    ] as Player[];
    expect(getAvailableBirthYears(players)).toEqual([2012, 2015]);
  });
});

describe('filterPlayersByBirthYears', () => {
  const players = [
    makePlayer('p1', 2012),
    makePlayer('p2', 2013),
    makePlayer('p3', 2014),
    makePlayer('p4', null),
    makePlayer('p5', 2012),
  ] as Player[];

  it('returns all players when selectedYears is empty', () => {
    expect(filterPlayersByBirthYears(players, [])).toHaveLength(players.length);
  });

  it('returns only players matching the one selected year', () => {
    const result = filterPlayersByBirthYears(players, ['2012']);
    expect(result).toHaveLength(2);
    expect(result.every(p => p.birthYear === 2012)).toBe(true);
  });

  it('returns players matching any of multiple selected years', () => {
    const result = filterPlayersByBirthYears(players, ['2012', '2013']);
    expect(result).toHaveLength(3);
    const ids = result.map(p => p.id);
    expect(ids).toContain('p1');
    expect(ids).toContain('p2');
    expect(ids).toContain('p5');
  });

  it('excludes players with null birthYear when filter is active', () => {
    const result = filterPlayersByBirthYears(players, ['2012']);
    expect(result.some(p => p.id === 'p4')).toBe(false);
  });

  it('returns empty array when no players match selected year', () => {
    const result = filterPlayersByBirthYears(players, ['1999']);
    expect(result).toHaveLength(0);
  });
});
