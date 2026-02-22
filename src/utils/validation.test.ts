import { describe, it, expect } from 'vitest';
import {
  isPlayerNumberUnique,
  isValidPlayerNumber,
  parseBirthYear,
  validateTeamFormData,
  validateFormationFormData,
  BIRTH_YEAR_MIN,
} from './validation';
import type { TeamRoster } from '../types/schema';

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

// ---------------------------------------------------------------------------
// parseBirthYear
// ---------------------------------------------------------------------------

describe('parseBirthYear', () => {
  const currentYear = new Date().getFullYear();

  it('should return undefined for an empty string', () => {
    expect(parseBirthYear('')).toBeUndefined();
    expect(parseBirthYear('   ')).toBeUndefined();
  });

  it('should return the parsed number for a valid birth year', () => {
    expect(parseBirthYear('2000')).toBe(2000);
    expect(parseBirthYear(String(BIRTH_YEAR_MIN))).toBe(BIRTH_YEAR_MIN);
    expect(parseBirthYear(String(currentYear))).toBe(currentYear);
  });

  it('should return null for a year below the minimum', () => {
    expect(parseBirthYear(String(BIRTH_YEAR_MIN - 1))).toBeNull();
  });

  it('should return null for a year above the current year', () => {
    expect(parseBirthYear(String(currentYear + 1))).toBeNull();
  });

  it('should return null for a non-integer value', () => {
    expect(parseBirthYear('2000.5')).toBeNull();
  });

  it('should return null for non-numeric input', () => {
    expect(parseBirthYear('abc')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateTeamFormData
// ---------------------------------------------------------------------------

describe('validateTeamFormData', () => {
  const valid = { name: 'Eagles', maxPlayers: '7', halfLength: '25' };

  it('should return parsed numbers for a valid form', () => {
    const result = validateTeamFormData(valid);
    expect(result).toEqual({ maxPlayersNum: 7, halfLengthNum: 25 });
  });

  it('should return an error when name is empty', () => {
    const result = validateTeamFormData({ ...valid, name: '' });
    expect(result).toHaveProperty('error');
  });

  it('should return an error when name is only whitespace', () => {
    const result = validateTeamFormData({ ...valid, name: '   ' });
    expect(result).toHaveProperty('error');
  });

  it('should return an error when maxPlayers is not a number', () => {
    const result = validateTeamFormData({ ...valid, maxPlayers: 'abc' });
    expect(result).toHaveProperty('error');
  });

  it('should return an error when maxPlayers is zero', () => {
    const result = validateTeamFormData({ ...valid, maxPlayers: '0' });
    expect(result).toHaveProperty('error');
  });

  it('should return an error when maxPlayers is negative', () => {
    const result = validateTeamFormData({ ...valid, maxPlayers: '-1' });
    expect(result).toHaveProperty('error');
  });

  it('should return an error when halfLength is not a number', () => {
    const result = validateTeamFormData({ ...valid, halfLength: 'xyz' });
    expect(result).toHaveProperty('error');
  });

  it('should return an error when halfLength is zero', () => {
    const result = validateTeamFormData({ ...valid, halfLength: '0' });
    expect(result).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------
// validateFormationFormData
// ---------------------------------------------------------------------------

describe('validateFormationFormData', () => {
  const positions = [
    { positionName: 'Goalkeeper', abbreviation: 'GK' },
    { positionName: 'Defender', abbreviation: 'CB' },
    { positionName: 'Midfielder', abbreviation: 'MF' },
  ];
  const valid = { name: '4-3-3', playerCount: '3', positions };

  it('should return the count for a valid form', () => {
    const result = validateFormationFormData(valid);
    expect(result).toEqual({ count: 3 });
  });

  it('should return an error when name is empty', () => {
    const result = validateFormationFormData({ ...valid, name: '' });
    expect(result).toHaveProperty('error');
  });

  it('should return an error when playerCount is empty', () => {
    const result = validateFormationFormData({ ...valid, playerCount: '' });
    expect(result).toHaveProperty('error');
  });

  it('should return an error when playerCount is not a number', () => {
    const result = validateFormationFormData({ ...valid, playerCount: 'abc' });
    expect(result).toHaveProperty('error');
  });

  it('should return an error when playerCount is zero', () => {
    const result = validateFormationFormData({ ...valid, playerCount: '0' });
    expect(result).toHaveProperty('error');
  });

  it('should return an error when position count does not match playerCount', () => {
    const result = validateFormationFormData({ ...valid, playerCount: '5' });
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('Expected 5 positions but found 3');
  });

  it('should return an error when a position is missing its name', () => {
    const incomplete = [
      { positionName: '', abbreviation: 'GK' },
      { positionName: 'Defender', abbreviation: 'CB' },
      { positionName: 'Midfielder', abbreviation: 'MF' },
    ];
    const result = validateFormationFormData({ ...valid, positions: incomplete });
    expect(result).toHaveProperty('error');
  });

  it('should return an error when a position is missing its abbreviation', () => {
    const incomplete = [
      { positionName: 'Goalkeeper', abbreviation: '' },
      { positionName: 'Defender', abbreviation: 'CB' },
      { positionName: 'Midfielder', abbreviation: 'MF' },
    ];
    const result = validateFormationFormData({ ...valid, positions: incomplete });
    expect(result).toHaveProperty('error');
  });

  it('should return an error when a position has only whitespace', () => {
    const incomplete = [
      { positionName: '   ', abbreviation: 'GK' },
      { positionName: 'Defender', abbreviation: 'CB' },
      { positionName: 'Midfielder', abbreviation: 'MF' },
    ];
    const result = validateFormationFormData({ ...valid, positions: incomplete });
    expect(result).toHaveProperty('error');
  });
});
