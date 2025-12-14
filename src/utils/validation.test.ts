import { describe, it, expect } from 'vitest';
import {
  isPlayerNumberUnique,
  isValidPlayerNumber,
} from './validation';
import type { Schema } from "../../amplify/data/resource";

type TeamRoster = Schema["TeamRoster"]["type"];

describe('Player Number Uniqueness', () => {
  const rosters: Partial<TeamRoster>[] = [
    {
      id: 'roster-1',
      teamId: 'team-1',
      playerId: 'player-1',
      playerNumber: 10,
    },
    {
      id: 'roster-2',
      teamId: 'team-1',
      playerId: 'player-2',
      playerNumber: 7,
    },
    {
      id: 'roster-3',
      teamId: 'team-2',
      playerId: 'player-3',
      playerNumber: 10,
    },
  ];

  it('should return true when player number is unique in team', () => {
    expect(isPlayerNumberUnique(5, 'team-1', rosters as TeamRoster[])).toBe(true);
  });

  it('should return false when player number already exists in team', () => {
    expect(isPlayerNumberUnique(10, 'team-1', rosters as TeamRoster[])).toBe(false);
  });

  it('should return true when same number exists in different team', () => {
    expect(isPlayerNumberUnique(10, 'team-3', rosters as TeamRoster[])).toBe(true);
  });

  it('should return true when updating roster with same number', () => {
    expect(isPlayerNumberUnique(10, 'team-1', rosters as TeamRoster[], 'roster-1')).toBe(true);
  });

  it('should return false when updating roster to existing number', () => {
    expect(isPlayerNumberUnique(7, 'team-1', rosters as TeamRoster[], 'roster-1')).toBe(false);
  });

  it('should return true when player number is null', () => {
    expect(isPlayerNumberUnique(null, 'team-1', rosters as TeamRoster[])).toBe(true);
  });

  it('should return true when player number is undefined', () => {
    expect(isPlayerNumberUnique(undefined, 'team-1', rosters as TeamRoster[])).toBe(true);
  });
});

describe('Player Number Validation', () => {
  it('should return true for valid player numbers (1-99)', () => {
    expect(isValidPlayerNumber(1)).toBe(true);
    expect(isValidPlayerNumber(50)).toBe(true);
    expect(isValidPlayerNumber(99)).toBe(true);
  });

  it('should return false for zero', () => {
    expect(isValidPlayerNumber(0)).toBe(false);
  });

  it('should return false for numbers over 99', () => {
    expect(isValidPlayerNumber(100)).toBe(false);
  });

  it('should return false for negative numbers', () => {
    expect(isValidPlayerNumber(-1)).toBe(false);
  });

  it('should return false for decimal numbers', () => {
    expect(isValidPlayerNumber(10.5)).toBe(false);
  });

  it('should return true for null (optional field)', () => {
    expect(isValidPlayerNumber(null)).toBe(true);
  });

  it('should return true for undefined (optional field)', () => {
    expect(isValidPlayerNumber(undefined)).toBe(true);
  });
});
