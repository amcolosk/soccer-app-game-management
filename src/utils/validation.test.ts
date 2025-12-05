import { describe, it, expect } from 'vitest';
import {
  isPlayerNumberUnique,
  isValidPlayerNumber,
} from './validation';
import type { Schema } from "../../amplify/data/resource";

type Player = Schema["Player"]["type"];

describe('Player Number Uniqueness', () => {
  const players: Partial<Player>[] = [
    {
      id: 'player-1',
      teamId: 'team-1',
      playerNumber: 10,
      firstName: 'John',
      lastName: 'Doe',
    },
    {
      id: 'player-2',
      teamId: 'team-1',
      playerNumber: 7,
      firstName: 'Jane',
      lastName: 'Smith',
    },
    {
      id: 'player-3',
      teamId: 'team-2',
      playerNumber: 10,
      firstName: 'Bob',
      lastName: 'Johnson',
    },
  ];

  it('should return true when player number is unique in team', () => {
    expect(isPlayerNumberUnique(5, 'team-1', players as Player[])).toBe(true);
  });

  it('should return false when player number already exists in team', () => {
    expect(isPlayerNumberUnique(10, 'team-1', players as Player[])).toBe(false);
  });

  it('should return true when same number exists in different team', () => {
    expect(isPlayerNumberUnique(10, 'team-3', players as Player[])).toBe(true);
  });

  it('should return true when updating player with their own number', () => {
    expect(isPlayerNumberUnique(10, 'team-1', players as Player[], 'player-1')).toBe(true);
  });

  it('should return false when updating player to existing number', () => {
    expect(isPlayerNumberUnique(7, 'team-1', players as Player[], 'player-1')).toBe(false);
  });

  it('should return true when player number is null', () => {
    expect(isPlayerNumberUnique(null, 'team-1', players as Player[])).toBe(true);
  });

  it('should return true when player number is undefined', () => {
    expect(isPlayerNumberUnique(undefined, 'team-1', players as Player[])).toBe(true);
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
