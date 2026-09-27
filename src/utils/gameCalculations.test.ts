import { describe, it, expect } from 'vitest';
import {
  calculatePlayerGoals,
  calculatePlayerAssists,
  calculatePlayerGoldStars,
  calculatePlayerYellowCards,
  calculatePlayerRedCards,
  calculateRecord,
  togglePreferredPosition,
  computeScoreFromGoals,
  resolveSaveKeeperId,
  calculateSavesByKeeper,
  calculatePlayerShotStats,
  calculateTeamShotStats,
} from './gameCalculations';
import type { Goal, GameNote } from '../types/schema';
import type { PositionRoleLookup } from './playTimeCalculations';

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

describe('computeScoreFromGoals', () => {
  it('returns 0-0 for an empty goals array', () => {
    expect(computeScoreFromGoals([])).toEqual({ ourScore: 0, opponentScore: 0 });
  });

  it('counts goals scored by us', () => {
    expect(computeScoreFromGoals([{ scoredByUs: true }, { scoredByUs: true }])).toEqual({
      ourScore: 2,
      opponentScore: 0,
    });
  });

  it('counts goals scored by the opponent', () => {
    expect(computeScoreFromGoals([{ scoredByUs: false }, { scoredByUs: false }, { scoredByUs: false }])).toEqual({
      ourScore: 0,
      opponentScore: 3,
    });
  });

  it('counts a mix of goals for both sides', () => {
    expect(
      computeScoreFromGoals([
        { scoredByUs: true },
        { scoredByUs: false },
        { scoredByUs: true },
        { scoredByUs: false },
        { scoredByUs: true },
      ])
    ).toEqual({ ourScore: 3, opponentScore: 2 });
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

// -- Issue #203: Saves by Goalie ------------------------------------------

const gkPositions: PositionRoleLookup[] = [{ id: 'pos-gk', role: 'GOALKEEPER' }];

interface PTR {
  id: string;
  playerId: string;
  gameId: string;
  positionId?: string | null;
  startGameSeconds: number;
  endGameSeconds?: number | null;
  createdAt: string;
  updatedAt: string;
}

function ptr(overrides: Partial<PTR> & Pick<PTR, 'id' | 'playerId' | 'gameId' | 'startGameSeconds'>): PTR {
  return {
    positionId: 'pos-gk',
    endGameSeconds: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('resolveSaveKeeperId', () => {
  it('returns the explicit playerId directly, never consulting a disagreeing fallback', () => {
    // Fallback would resolve to 'fallback-player' via the covering record below,
    // but the save's own explicit playerId must win regardless.
    const records = [ptr({ id: 'r1', playerId: 'fallback-player', gameId: 'g1', startGameSeconds: 0, endGameSeconds: 2700 })];
    const save = { playerId: 'explicit-player', gameId: 'g1', gameSeconds: 100 };
    expect(resolveSaveKeeperId(save, records, gkPositions)).toBe('explicit-player');
  });

  it('falls back to getGoalkeeperIdAtTime when playerId is absent and gameSeconds is present', () => {
    const records = [ptr({ id: 'r1', playerId: 'fallback-player', gameId: 'g1', startGameSeconds: 0, endGameSeconds: 2700 })];
    const save = { playerId: null, gameId: 'g1', gameSeconds: 100 };
    expect(resolveSaveKeeperId(save, records, gkPositions)).toBe('fallback-player');
  });

  it('returns null without crashing when playerId is absent and gameSeconds is null', () => {
    const records = [ptr({ id: 'r1', playerId: 'fallback-player', gameId: 'g1', startGameSeconds: 0, endGameSeconds: 2700 })];
    const save = { playerId: null, gameId: 'g1', gameSeconds: null };
    expect(resolveSaveKeeperId(save, records, gkPositions)).toBeNull();
  });

  it('returns null when playerId is absent and the fallback is unresolvable', () => {
    const save = { playerId: null, gameId: 'g1', gameSeconds: 5000 };
    expect(resolveSaveKeeperId(save, [], gkPositions)).toBeNull();
  });
});

describe('calculateSavesByKeeper', () => {
  const records = [ptr({ id: 'r1', playerId: 'keeper-a', gameId: 'g1', startGameSeconds: 0, endGameSeconds: 2700 })];

  it('excludes byUs: false saves entirely (not counted, not unattributed)', () => {
    const saves = [{ id: 's1', playerId: null, gameId: 'g1', gameSeconds: 100, byUs: false }];
    const result = calculateSavesByKeeper(saves, records, gkPositions);
    expect(result.byKeeper.size).toBe(0);
    expect(result.unattributedCount).toBe(0);
  });

  it('populates byKeeper and byKeeperForSaveId for a save with an explicit playerId', () => {
    const saves = [{ id: 's1', playerId: 'keeper-a', gameId: 'g1', gameSeconds: 100, byUs: true }];
    const result = calculateSavesByKeeper(saves, records, gkPositions);
    expect(result.byKeeper.get('keeper-a')).toBe(1);
    expect(result.byKeeperForSaveId.get('s1')).toBe('keeper-a');
  });

  it('populates both maps identically for a save with a resolvable fallback', () => {
    const saves = [{ id: 's1', playerId: null, gameId: 'g1', gameSeconds: 100, byUs: true }];
    const result = calculateSavesByKeeper(saves, records, gkPositions);
    expect(result.byKeeper.get('keeper-a')).toBe(1);
    expect(result.byKeeperForSaveId.get('s1')).toBe('keeper-a');
  });

  it('increments unattributedCount and omits byKeeperForSaveId when no fallback resolves', () => {
    const saves = [{ id: 's1', playerId: null, gameId: 'g1', gameSeconds: 9999, byUs: true }];
    const result = calculateSavesByKeeper(saves, records, gkPositions);
    expect(result.unattributedCount).toBe(1);
    expect(result.byKeeperForSaveId.has('s1')).toBe(false);
  });

  it('save-appears-in-exactly-one-drill-down invariant: no double counting across keepers', () => {
    const multiRecords = [
      ptr({ id: 'r1', playerId: 'keeper-a', gameId: 'g1', startGameSeconds: 0, endGameSeconds: 1000 }),
      ptr({ id: 'r2', playerId: 'keeper-b', gameId: 'g1', startGameSeconds: 1000, endGameSeconds: 2700 }),
    ];
    const saves = [
      { id: 's1', playerId: null, gameId: 'g1', gameSeconds: 100, byUs: true },
      { id: 's2', playerId: null, gameId: 'g1', gameSeconds: 200, byUs: true },
      { id: 's3', playerId: null, gameId: 'g1', gameSeconds: 1500, byUs: true },
    ];
    const result = calculateSavesByKeeper(saves, multiRecords, gkPositions);
    expect(result.byKeeperForSaveId.size).toBe(3);
    const totalCounted = Array.from(result.byKeeper.values()).reduce((sum, n) => sum + n, 0);
    expect(totalCounted).toBe(result.byKeeperForSaveId.size);
    expect(result.byKeeper.get('keeper-a')).toBe(2);
    expect(result.byKeeper.get('keeper-b')).toBe(1);
  });

  it('returns empty maps/zero count for an empty saves array', () => {
    const result = calculateSavesByKeeper([], records, gkPositions);
    expect(result.byKeeper.size).toBe(0);
    expect(result.byKeeperForSaveId.size).toBe(0);
    expect(result.unattributedCount).toBe(0);
  });
});

describe('calculatePlayerShotStats', () => {
  it('counts a null-outcome shot toward shots only', () => {
    const shots = [{ playerId: 'p1', takenByUs: true, outcome: null }];
    expect(calculatePlayerShotStats('p1', shots)).toEqual({ shots: 1, onTarget: 0, wide: 0, blocked: 0 });
  });

  it('counts GOAL and SAVED outcomes toward onTarget (and shots)', () => {
    const shots = [
      { playerId: 'p1', takenByUs: true, outcome: 'GOAL' as const },
      { playerId: 'p1', takenByUs: true, outcome: 'SAVED' as const },
    ];
    expect(calculatePlayerShotStats('p1', shots)).toEqual({ shots: 2, onTarget: 2, wide: 0, blocked: 0 });
  });

  it('counts WIDE outcome toward wide (and shots) only', () => {
    const shots = [{ playerId: 'p1', takenByUs: true, outcome: 'WIDE' as const }];
    expect(calculatePlayerShotStats('p1', shots)).toEqual({ shots: 1, onTarget: 0, wide: 1, blocked: 0 });
  });

  it('counts BLOCKED outcome toward blocked (and shots) only', () => {
    const shots = [{ playerId: 'p1', takenByUs: true, outcome: 'BLOCKED' as const }];
    expect(calculatePlayerShotStats('p1', shots)).toEqual({ shots: 1, onTarget: 0, wide: 0, blocked: 1 });
  });

  it('excludes opponent shots (takenByUs: false) even if playerId matches', () => {
    const shots = [{ playerId: 'p1', takenByUs: false, outcome: 'GOAL' as const }];
    expect(calculatePlayerShotStats('p1', shots)).toEqual({ shots: 0, onTarget: 0, wide: 0, blocked: 0 });
  });

  it('excludes shots for a different playerId', () => {
    const shots = [{ playerId: 'p2', takenByUs: true, outcome: 'GOAL' as const }];
    expect(calculatePlayerShotStats('p1', shots)).toEqual({ shots: 0, onTarget: 0, wide: 0, blocked: 0 });
  });

  it('returns an all-zero result for an empty shots array', () => {
    expect(calculatePlayerShotStats('p1', [])).toEqual({ shots: 0, onTarget: 0, wide: 0, blocked: 0 });
  });
});

describe('calculateTeamShotStats', () => {
  it('counts GOAL and SAVED outcomes toward onTarget for our shots', () => {
    const shots = [
      { takenByUs: true, outcome: 'GOAL' as const },
      { takenByUs: true, outcome: 'SAVED' as const },
      { takenByUs: true, outcome: 'WIDE' as const },
    ];
    expect(calculateTeamShotStats(true, shots)).toEqual({ shots: 3, onTarget: 2, wide: 1, blocked: 0 });
  });

  it('counts the opponent side separately from our side', () => {
    const shots = [
      { takenByUs: true, outcome: 'GOAL' as const },
      { takenByUs: false, outcome: 'SAVED' as const },
      { takenByUs: false, outcome: 'BLOCKED' as const },
    ];
    expect(calculateTeamShotStats(false, shots)).toEqual({ shots: 2, onTarget: 1, wide: 0, blocked: 1 });
  });

  it('counts a null-outcome shot toward shots only', () => {
    const shots = [{ takenByUs: true, outcome: null }];
    expect(calculateTeamShotStats(true, shots)).toEqual({ shots: 1, onTarget: 0, wide: 0, blocked: 0 });
  });

  it('returns an all-zero result for an empty shots array', () => {
    expect(calculateTeamShotStats(true, [])).toEqual({ shots: 0, onTarget: 0, wide: 0, blocked: 0 });
  });
});
