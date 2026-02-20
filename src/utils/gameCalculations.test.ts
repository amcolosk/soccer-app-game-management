import { describe, it, expect } from 'vitest';
import {
  calculatePlayerGoals,
  calculatePlayerAssists,
  calculatePlayerGoldStars,
  calculatePlayerYellowCards,
  calculatePlayerRedCards,
  calculateRecord,
  togglePreferredPosition,
} from './gameCalculations';
import type { Goal, GameNote } from '../types/schema';

const mockGoals = [
  {
    id: 'goal-1',
    gameId: 'game-1',
    scorerId: 'player-1',
    assistId: 'player-2',
  },
  {
    id: 'goal-2',
    gameId: 'game-1',
    scorerId: 'player-1',
    assistId: null,
  },
  {
    id: 'goal-3',
    gameId: 'game-1',
    scorerId: 'player-3',
    assistId: 'player-1',
  },
  {
    id: 'goal-4',
    gameId: 'game-2',
    scorerId: 'player-2',
    assistId: 'player-3',
  },
] as Goal[];

const mockNotes = [
  {
    id: 'note-1',
    gameId: 'game-1',
    playerId: 'player-1',
    noteType: 'gold-star',
  },
  {
    id: 'note-2',
    gameId: 'game-1',
    playerId: 'player-2',
    noteType: 'yellow-card',
  },
  {
    id: 'note-3',
    gameId: 'game-1',
    playerId: 'player-3',
    noteType: 'red-card',
  },
  {
    id: 'note-4',
    gameId: 'game-2',
    playerId: 'player-1',
    noteType: 'gold-star',
  },
] as GameNote[];

describe('Player Goal Calculations', () => {
  it('should calculate total goals for a player', () => {
    expect(calculatePlayerGoals('player-1', mockGoals)).toBe(2);
    expect(calculatePlayerGoals('player-2', mockGoals)).toBe(1);
    expect(calculatePlayerGoals('player-3', mockGoals)).toBe(1);
  });

  it('should return 0 for player with no goals', () => {
    expect(calculatePlayerGoals('player-4', mockGoals)).toBe(0);
  });
});

describe('Player Assist Calculations', () => {
  it('should calculate total assists for a player', () => {
    expect(calculatePlayerAssists('player-1', mockGoals)).toBe(1);
    expect(calculatePlayerAssists('player-2', mockGoals)).toBe(1);
    expect(calculatePlayerAssists('player-3', mockGoals)).toBe(1);
  });

  it('should return 0 for player with no assists', () => {
    expect(calculatePlayerAssists('player-4', mockGoals)).toBe(0);
  });
});

describe('Player Note Calculations', () => {
  it('should calculate gold stars for a player', () => {
    expect(calculatePlayerGoldStars('player-1', mockNotes)).toBe(2);
  });

  it('should calculate yellow cards for a player', () => {
    expect(calculatePlayerYellowCards('player-2', mockNotes)).toBe(1);
  });

  it('should calculate red cards for a player', () => {
    expect(calculatePlayerRedCards('player-3', mockNotes)).toBe(1);
  });

  it('should return 0 for player with no notes', () => {
    expect(calculatePlayerGoldStars('player-4', mockNotes)).toBe(0);
    expect(calculatePlayerYellowCards('player-4', mockNotes)).toBe(0);
    expect(calculatePlayerRedCards('player-4', mockNotes)).toBe(0);
  });
});

describe('calculateRecord', () => {
  it('should count wins, losses, and ties from completed games', () => {
    const games = [
      { status: 'completed', ourScore: 3, opponentScore: 1 },
      { status: 'completed', ourScore: 0, opponentScore: 2 },
      { status: 'completed', ourScore: 1, opponentScore: 1 },
      { status: 'completed', ourScore: 4, opponentScore: 0 },
    ];
    expect(calculateRecord(games)).toEqual({ wins: 2, losses: 1, ties: 1 });
  });

  it('should ignore non-completed games', () => {
    const games = [
      { status: 'completed', ourScore: 2, opponentScore: 1 },
      { status: 'scheduled', ourScore: null, opponentScore: null },
      { status: 'in-progress', ourScore: 0, opponentScore: 0 },
    ];
    expect(calculateRecord(games)).toEqual({ wins: 1, losses: 0, ties: 0 });
  });

  it('should treat null scores as 0', () => {
    const games = [
      { status: 'completed', ourScore: null, opponentScore: null },
      { status: 'completed', ourScore: 1, opponentScore: null },
      { status: 'completed', ourScore: null, opponentScore: 2 },
    ];
    expect(calculateRecord(games)).toEqual({ wins: 1, losses: 1, ties: 1 });
  });

  it('should return all zeros for empty array', () => {
    expect(calculateRecord([])).toEqual({ wins: 0, losses: 0, ties: 0 });
  });
});

describe('togglePreferredPosition', () => {
  it('should add a position to empty preferences', () => {
    expect(togglePreferredPosition(null, 'pos-1', true)).toBe('pos-1');
    expect(togglePreferredPosition(undefined, 'pos-1', true)).toBe('pos-1');
  });

  it('should add a position to existing preferences', () => {
    expect(togglePreferredPosition('pos-1', 'pos-2', true)).toBe('pos-1, pos-2');
  });

  it('should not duplicate an existing position', () => {
    expect(togglePreferredPosition('pos-1, pos-2', 'pos-1', true)).toBe('pos-1, pos-2');
  });

  it('should remove a position from preferences', () => {
    expect(togglePreferredPosition('pos-1, pos-2, pos-3', 'pos-2', false)).toBe('pos-1, pos-3');
  });

  it('should return undefined when removing the last position', () => {
    expect(togglePreferredPosition('pos-1', 'pos-1', false)).toBeUndefined();
  });

  it('should handle removing a position that is not present', () => {
    expect(togglePreferredPosition('pos-1', 'pos-99', false)).toBe('pos-1');
  });

  it('should return undefined when removing from empty string', () => {
    expect(togglePreferredPosition('', 'pos-1', false)).toBeUndefined();
  });
});
