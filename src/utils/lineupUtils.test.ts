import { describe, it, expect } from 'vitest';
import { isPlayerInLineup } from './lineupUtils';
import type { Schema } from "../../amplify/data/resource";

type LineupAssignment = Schema["LineupAssignment"]["type"];

const mockAssignments = [
  {
    id: 'assignment-1',
    gameId: 'game-1',
    playerId: 'player-1',
    positionId: 'position-forward',
  },
  {
    id: 'assignment-2',
    gameId: 'game-1',
    playerId: 'player-2',
    positionId: 'position-forward',
  },
  {
    id: 'assignment-3',
    gameId: 'game-1',
    playerId: 'player-3',
    positionId: 'position-midfielder',
  },
] as LineupAssignment[];

describe('isPlayerInLineup', () => {
  it('should return true when player is in lineup', () => {
    expect(isPlayerInLineup('player-1', mockAssignments)).toBe(true);
    expect(isPlayerInLineup('player-2', mockAssignments)).toBe(true);
    expect(isPlayerInLineup('player-3', mockAssignments)).toBe(true);
  });

  it('should return false when player is not in lineup', () => {
    expect(isPlayerInLineup('player-4', mockAssignments)).toBe(false);
    expect(isPlayerInLineup('player-999', mockAssignments)).toBe(false);
  });

  it('should return false for empty lineup', () => {
    expect(isPlayerInLineup('player-1', [])).toBe(false);
  });
});
