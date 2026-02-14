import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  deleteGameCascade,
  deleteTeamCascade,
  deletePlayerCascade,
  deleteFormationCascade,
} from './cascadeDeleteService';

// ---------------------------------------------------------------------------
// Mock setup — vi.hoisted ensures these exist before vi.mock hoisting runs
// ---------------------------------------------------------------------------

const { mockList, mockDelete, mockUpdate } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockDelete: vi.fn(),
  mockUpdate: vi.fn(),
}));

function createMockModel() {
  return {
    list: mockList,
    delete: mockDelete,
    update: mockUpdate,
  };
}

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      Game: createMockModel(),
      PlayTimeRecord: createMockModel(),
      Goal: createMockModel(),
      GameNote: createMockModel(),
      Substitution: createMockModel(),
      LineupAssignment: createMockModel(),
      PlayerAvailability: createMockModel(),
      GamePlan: createMockModel(),
      PlannedRotation: createMockModel(),
      Team: createMockModel(),
      TeamRoster: createMockModel(),
      TeamInvitation: createMockModel(),
      Player: createMockModel(),
      Formation: createMockModel(),
      FormationPosition: createMockModel(),
    },
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Configure mockList to return the given items for a specific filter value. */
function setupListResponses(responses: Map<string, { id: string }[]>) {
  mockList.mockImplementation((opts?: any) => {
    // Find a matching filter key/value
    if (opts?.filter) {
      for (const [, filterValue] of Object.entries(opts.filter)) {
        const eqValue = (filterValue as any)?.eq;
        if (eqValue && responses.has(eqValue)) {
          return Promise.resolve({ data: responses.get(eqValue)!, nextToken: null });
        }
      }
    }
    // Default: return empty
    return Promise.resolve({ data: [], nextToken: null });
  });
}

/** Convenience to collect all ids that mockDelete was called with. */
function getDeletedIds(): string[] {
  return mockDelete.mock.calls.map((call) => call[0]?.id).filter(Boolean);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockResolvedValue({ data: [], nextToken: null });
  mockDelete.mockResolvedValue({ data: null });
  mockUpdate.mockResolvedValue({ data: null });
});

// ---------------------------------------------------------------------------
// deleteGameCascade
// ---------------------------------------------------------------------------

describe('deleteGameCascade', () => {
  it('should delete the game when it has no children', async () => {
    await deleteGameCascade('game-1');

    const deletedIds = getDeletedIds();
    expect(deletedIds).toContain('game-1');
  });

  it('should delete all child record types before the game', async () => {
    setupListResponses(
      new Map([
        ['game-1', [
          { id: 'ptr-1' },
          { id: 'goal-1' },
          { id: 'note-1' },
          { id: 'sub-1' },
          { id: 'lineup-1' },
          { id: 'avail-1' },
          { id: 'plan-1' },
        ]],
      ]),
    );

    await deleteGameCascade('game-1');

    const deletedIds = getDeletedIds();
    // All children should be deleted
    expect(deletedIds).toContain('ptr-1');
    expect(deletedIds).toContain('goal-1');
    expect(deletedIds).toContain('note-1');
    expect(deletedIds).toContain('sub-1');
    expect(deletedIds).toContain('lineup-1');
    expect(deletedIds).toContain('avail-1');
    expect(deletedIds).toContain('plan-1');
    // The game itself should be deleted
    expect(deletedIds).toContain('game-1');
  });

  it('should delete PlannedRotations for each GamePlan', async () => {
    setupListResponses(
      new Map([
        ['game-1', [{ id: 'plan-1' }]],
        ['plan-1', [{ id: 'rot-1' }, { id: 'rot-2' }]],
      ]),
    );

    await deleteGameCascade('game-1');

    const deletedIds = getDeletedIds();
    expect(deletedIds).toContain('rot-1');
    expect(deletedIds).toContain('rot-2');
    expect(deletedIds).toContain('plan-1');
    expect(deletedIds).toContain('game-1');
  });

  it('should delete PlannedRotations before GamePlans', async () => {
    setupListResponses(
      new Map([
        ['game-1', [{ id: 'plan-1' }]],
        ['plan-1', [{ id: 'rot-1' }]],
      ]),
    );

    await deleteGameCascade('game-1');

    // PlannedRotation must be deleted before GamePlan
    const calls = mockDelete.mock.calls.map((c) => c[0]?.id);
    const rotIndex = calls.indexOf('rot-1');
    const planIndex = calls.indexOf('plan-1');
    expect(rotIndex).toBeLessThan(planIndex);
  });

  it('should delete the game last (after all children)', async () => {
    setupListResponses(
      new Map([
        ['game-1', [{ id: 'ptr-1' }, { id: 'goal-1' }]],
      ]),
    );

    await deleteGameCascade('game-1');

    const calls = mockDelete.mock.calls.map((c) => c[0]?.id);
    const gameIndex = calls.indexOf('game-1');
    // Game should be the very last delete call
    expect(gameIndex).toBe(calls.length - 1);
  });

  it('should handle multiple children of each type', async () => {
    setupListResponses(
      new Map([
        ['game-1', [
          { id: 'ptr-1' },
          { id: 'ptr-2' },
          { id: 'ptr-3' },
        ]],
      ]),
    );

    await deleteGameCascade('game-1');

    const deletedIds = getDeletedIds();
    expect(deletedIds).toContain('ptr-1');
    expect(deletedIds).toContain('ptr-2');
    expect(deletedIds).toContain('ptr-3');
    expect(deletedIds).toContain('game-1');
  });

  it('should handle paginated list responses', async () => {
    let callCount = 0;
    mockList.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First page with a nextToken
        return Promise.resolve({
          data: [{ id: 'ptr-1' }, { id: 'ptr-2' }],
          nextToken: 'page2-token',
        });
      }
      if (callCount === 2) {
        // Second page, no more
        return Promise.resolve({
          data: [{ id: 'ptr-3' }],
          nextToken: null,
        });
      }
      return Promise.resolve({ data: [], nextToken: null });
    });

    await deleteGameCascade('game-1');

    const deletedIds = getDeletedIds();
    expect(deletedIds).toContain('ptr-1');
    expect(deletedIds).toContain('ptr-2');
    expect(deletedIds).toContain('ptr-3');
    expect(deletedIds).toContain('game-1');
  });

  it('should not throw when a child delete fails', async () => {
    setupListResponses(
      new Map([
        ['game-1', [{ id: 'ptr-1' }, { id: 'ptr-2' }]],
      ]),
    );

    // Make one delete fail
    mockDelete.mockImplementation(({ id }: { id: string }) => {
      if (id === 'ptr-1') return Promise.reject(new Error('Delete failed'));
      return Promise.resolve({ data: null });
    });

    // Should not throw — batchDelete uses Promise.allSettled
    await expect(deleteGameCascade('game-1')).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// deleteTeamCascade
// ---------------------------------------------------------------------------

describe('deleteTeamCascade', () => {
  it('should delete the team when it has no children', async () => {
    await deleteTeamCascade('team-1');

    const deletedIds = getDeletedIds();
    expect(deletedIds).toContain('team-1');
  });

  it('should cascade-delete games and delete roster/invitations', async () => {
    setupListResponses(
      new Map([
        ['team-1', [
          { id: 'game-1' },
          { id: 'roster-1' },
          { id: 'invite-1' },
        ]],
        // Game child records
        ['game-1', [{ id: 'ptr-1' }]],
      ]),
    );

    await deleteTeamCascade('team-1');

    const deletedIds = getDeletedIds();
    // Game children
    expect(deletedIds).toContain('ptr-1');
    // Game itself
    expect(deletedIds).toContain('game-1');
    // Team direct children
    expect(deletedIds).toContain('roster-1');
    expect(deletedIds).toContain('invite-1');
    // Team itself
    expect(deletedIds).toContain('team-1');
  });

  it('should delete the team last', async () => {
    setupListResponses(
      new Map([
        ['team-1', [{ id: 'roster-1' }]],
      ]),
    );

    await deleteTeamCascade('team-1');

    const calls = mockDelete.mock.calls.map((c) => c[0]?.id);
    const teamIndex = calls.indexOf('team-1');
    expect(teamIndex).toBe(calls.length - 1);
  });

  it('should cascade-delete multiple games sequentially', async () => {
    setupListResponses(
      new Map([
        ['team-1', [{ id: 'game-1' }, { id: 'game-2' }]],
        ['game-1', [{ id: 'ptr-g1' }]],
        ['game-2', [{ id: 'ptr-g2' }]],
      ]),
    );

    await deleteTeamCascade('team-1');

    const deletedIds = getDeletedIds();
    expect(deletedIds).toContain('ptr-g1');
    expect(deletedIds).toContain('game-1');
    expect(deletedIds).toContain('ptr-g2');
    expect(deletedIds).toContain('game-2');
    expect(deletedIds).toContain('team-1');
  });

  it('should delete games before the team', async () => {
    setupListResponses(
      new Map([
        ['team-1', [{ id: 'game-1' }]],
      ]),
    );

    await deleteTeamCascade('team-1');

    const calls = mockDelete.mock.calls.map((c) => c[0]?.id);
    const gameIndex = calls.indexOf('game-1');
    const teamIndex = calls.indexOf('team-1');
    expect(gameIndex).toBeLessThan(teamIndex);
  });
});

// ---------------------------------------------------------------------------
// deletePlayerCascade
// ---------------------------------------------------------------------------

describe('deletePlayerCascade', () => {
  it('should delete the player when it has no children', async () => {
    await deletePlayerCascade('player-1');

    const deletedIds = getDeletedIds();
    expect(deletedIds).toContain('player-1');
  });

  it('should delete all player-owned child records', async () => {
    setupListResponses(
      new Map([
        ['player-1', [
          { id: 'roster-1' },
          { id: 'ptr-1' },
          { id: 'note-1' },
          { id: 'avail-1' },
        ]],
      ]),
    );

    await deletePlayerCascade('player-1');

    const deletedIds = getDeletedIds();
    expect(deletedIds).toContain('roster-1');
    expect(deletedIds).toContain('ptr-1');
    expect(deletedIds).toContain('note-1');
    expect(deletedIds).toContain('avail-1');
    expect(deletedIds).toContain('player-1');
  });

  it('should delete goals where player is the scorer', async () => {
    setupListResponses(
      new Map([
        ['player-1', [{ id: 'goal-scored-1' }, { id: 'goal-scored-2' }]],
      ]),
    );

    await deletePlayerCascade('player-1');

    const deletedIds = getDeletedIds();
    expect(deletedIds).toContain('goal-scored-1');
    expect(deletedIds).toContain('goal-scored-2');
  });

  it('should clear assistId on goals where player is the assist (not delete them)', async () => {
    // For assist goals, the mock needs to differentiate between scorer and assist filters.
    // We use scorerId/assistId in the filter.
    mockList.mockImplementation((opts?: any) => {
      if (opts?.filter?.assistId?.eq === 'player-1') {
        return Promise.resolve({
          data: [{ id: 'goal-assist-1' }, { id: 'goal-assist-2' }],
          nextToken: null,
        });
      }
      return Promise.resolve({ data: [], nextToken: null });
    });

    await deletePlayerCascade('player-1');

    // Should call update (not delete) for assist goals
    expect(mockUpdate).toHaveBeenCalledWith({ id: 'goal-assist-1', assistId: null });
    expect(mockUpdate).toHaveBeenCalledWith({ id: 'goal-assist-2', assistId: null });

    // Assist goals should NOT be deleted
    const deletedIds = getDeletedIds();
    expect(deletedIds).not.toContain('goal-assist-1');
    expect(deletedIds).not.toContain('goal-assist-2');
  });

  it('should delete the player last', async () => {
    setupListResponses(
      new Map([
        ['player-1', [{ id: 'roster-1' }]],
      ]),
    );

    await deletePlayerCascade('player-1');

    const calls = mockDelete.mock.calls.map((c) => c[0]?.id);
    const playerIndex = calls.indexOf('player-1');
    expect(playerIndex).toBe(calls.length - 1);
  });
});

// ---------------------------------------------------------------------------
// deleteFormationCascade
// ---------------------------------------------------------------------------

describe('deleteFormationCascade', () => {
  it('should delete the formation when it has no positions', async () => {
    await deleteFormationCascade('formation-1');

    const deletedIds = getDeletedIds();
    expect(deletedIds).toContain('formation-1');
  });

  it('should delete all positions before the formation', async () => {
    setupListResponses(
      new Map([
        ['formation-1', [
          { id: 'pos-1' },
          { id: 'pos-2' },
          { id: 'pos-3' },
        ]],
      ]),
    );

    await deleteFormationCascade('formation-1');

    const deletedIds = getDeletedIds();
    expect(deletedIds).toContain('pos-1');
    expect(deletedIds).toContain('pos-2');
    expect(deletedIds).toContain('pos-3');
    expect(deletedIds).toContain('formation-1');
  });

  it('should delete positions before the formation itself', async () => {
    setupListResponses(
      new Map([
        ['formation-1', [{ id: 'pos-1' }]],
      ]),
    );

    await deleteFormationCascade('formation-1');

    const calls = mockDelete.mock.calls.map((c) => c[0]?.id);
    const posIndex = calls.indexOf('pos-1');
    const formationIndex = calls.indexOf('formation-1');
    expect(posIndex).toBeLessThan(formationIndex);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('should pass limit: 1000 to list calls', async () => {
    await deleteGameCascade('game-1');

    // Every list call should include limit: 1000
    for (const call of mockList.mock.calls) {
      expect(call[0]?.limit).toBe(1000);
    }
  });

  it('should pass filter with correct eq value', async () => {
    await deleteGameCascade('game-42');

    // At least one call should filter by gameId
    const filtersUsed = mockList.mock.calls.map((c) => c[0]?.filter);
    const gameIdFilters = filtersUsed.filter((f) => f?.gameId?.eq === 'game-42');
    expect(gameIdFilters.length).toBeGreaterThan(0);
  });

  it('should handle list returning empty data gracefully', async () => {
    mockList.mockResolvedValue({ data: [], nextToken: null });

    await expect(deleteGameCascade('game-1')).resolves.not.toThrow();
    await expect(deleteTeamCascade('team-1')).resolves.not.toThrow();
    await expect(deletePlayerCascade('player-1')).resolves.not.toThrow();
    await expect(deleteFormationCascade('form-1')).resolves.not.toThrow();
  });
});
