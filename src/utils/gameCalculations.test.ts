import { describe, it, expect } from 'vitest';
import {
  calculatePlayerGoals,
  calculatePlayerAssists,
  calculatePlayerGoldStars,
  calculatePlayerYellowCards,
  calculatePlayerRedCards,
} from './gameCalculations';
import type { Schema } from "../../amplify/data/resource";

type Goal = Schema["Goal"]["type"];
type GameNote = Schema["GameNote"]["type"];

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
