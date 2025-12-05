import { describe, it, expect } from 'vitest';
import { sortPlayersByNumber } from './playerUtils';
import type { Schema } from "../../amplify/data/resource";

type Player = Schema["Player"]["type"];

describe('sortPlayersByNumber', () => {
  it('should sort players by player number in ascending order', () => {
    const players = [
      { id: '1', playerNumber: 10, firstName: 'John', lastName: 'Doe' },
      { id: '2', playerNumber: 5, firstName: 'Jane', lastName: 'Smith' },
      { id: '3', playerNumber: 15, firstName: 'Bob', lastName: 'Johnson' },
      { id: '4', playerNumber: 1, firstName: 'Alice', lastName: 'Williams' },
    ] as Player[];

    const sorted = sortPlayersByNumber(players);

    expect(sorted[0].playerNumber).toBe(1);
    expect(sorted[1].playerNumber).toBe(5);
    expect(sorted[2].playerNumber).toBe(10);
    expect(sorted[3].playerNumber).toBe(15);
  });

  it('should handle players with undefined player numbers', () => {
    const players = [
      { id: '1', playerNumber: 10, firstName: 'John', lastName: 'Doe' },
      { id: '2', playerNumber: undefined, firstName: 'Jane', lastName: 'Smith' },
      { id: '3', playerNumber: 5, firstName: 'Bob', lastName: 'Johnson' },
    ] as Player[];

    const sorted = sortPlayersByNumber(players);

    // Undefined should be treated as 0 and come first
    expect(sorted[0].playerNumber).toBe(undefined);
    expect(sorted[1].playerNumber).toBe(5);
    expect(sorted[2].playerNumber).toBe(10);
  });

  it('should handle players with null player numbers', () => {
    const players = [
      { id: '1', playerNumber: 10, firstName: 'John', lastName: 'Doe' },
      { id: '2', playerNumber: null, firstName: 'Jane', lastName: 'Smith' },
      { id: '3', playerNumber: 5, firstName: 'Bob', lastName: 'Johnson' },
    ] as Player[];

    const sorted = sortPlayersByNumber(players);

    // Null should be treated as 0 and come first
    expect(sorted[0].playerNumber).toBe(null);
    expect(sorted[1].playerNumber).toBe(5);
    expect(sorted[2].playerNumber).toBe(10);
  });

  it('should handle empty array', () => {
    const players: Player[] = [];
    const sorted = sortPlayersByNumber(players);
    expect(sorted).toEqual([]);
  });

  it('should handle single player', () => {
    const players = [
      { id: '1', playerNumber: 10, firstName: 'John', lastName: 'Doe' },
    ] as Player[];

    const sorted = sortPlayersByNumber(players);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].playerNumber).toBe(10);
  });

  it('should not mutate original array', () => {
    const players = [
      { id: '1', playerNumber: 10, firstName: 'John', lastName: 'Doe' },
      { id: '2', playerNumber: 5, firstName: 'Jane', lastName: 'Smith' },
    ] as Player[];

    const originalOrder = [...players];
    sortPlayersByNumber(players);

    // Original array should remain unchanged
    expect(players[0].playerNumber).toBe(originalOrder[0].playerNumber);
    expect(players[1].playerNumber).toBe(originalOrder[1].playerNumber);
  });

  it('should handle players with same player number', () => {
    const players = [
      { id: '1', playerNumber: 10, firstName: 'John', lastName: 'Doe' },
      { id: '2', playerNumber: 10, firstName: 'Jane', lastName: 'Smith' },
      { id: '3', playerNumber: 5, firstName: 'Bob', lastName: 'Johnson' },
    ] as Player[];

    const sorted = sortPlayersByNumber(players);

    expect(sorted[0].playerNumber).toBe(5);
    expect(sorted[1].playerNumber).toBe(10);
    expect(sorted[2].playerNumber).toBe(10);
  });
});
