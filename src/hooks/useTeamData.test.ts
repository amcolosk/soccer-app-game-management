import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTeamData } from './useTeamData';

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const {
  mockTeamRosterObserveQuery,
  mockPlayerObserveQuery,
  mockFormationPositionObserveQuery,
} = vi.hoisted(() => ({
  mockTeamRosterObserveQuery: vi.fn(),
  mockPlayerObserveQuery: vi.fn(),
  mockFormationPositionObserveQuery: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      TeamRoster: {
        observeQuery: mockTeamRosterObserveQuery,
      },
      Player: {
        observeQuery: mockPlayerObserveQuery,
      },
      FormationPosition: {
        observeQuery: mockFormationPositionObserveQuery,
      },
    },
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRosterObservable(rosters: Array<{ playerId: string; playerNumber: number }>) {
  return {
    subscribe: ({ next }: { next: (data: { items: typeof rosters }) => void }) => {
      // Call next immediately to trigger player subscription
      next({ items: rosters });
      return { unsubscribe: vi.fn() };
    },
  };
}

function createPlayerObservable(players: Array<{ id: string; firstName: string; lastName: string }>) {
  return {
    subscribe: ({ next }: { next: (data: { items: typeof players }) => void }) => {
      next({ items: players });
      return { unsubscribe: vi.fn() };
    },
  };
}

function createPositionObservable(positions: Array<{ id: string; name: string; sortOrder?: number }>) {
  return {
    subscribe: ({ next }: { next: (data: { items: typeof positions }) => void }) => {
      next({ items: positions });
      return { unsubscribe: vi.fn() };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useTeamData', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default empty mocks
    mockTeamRosterObserveQuery.mockReturnValue(createRosterObservable([]));
    mockPlayerObserveQuery.mockReturnValue(createPlayerObservable([]));
    mockFormationPositionObserveQuery.mockReturnValue(createPositionObservable([]));
  });

  it('returns { players: [], positions: [] } when teamId is null', () => {
    const { result } = renderHook(() => useTeamData('', null));

    expect(result.current.players).toEqual([]);
    expect(result.current.positions).toEqual([]);
  });

  it('returns { players: [], positions: [] } when formationId is null and subscribes only to roster', () => {
    const rosters = [{ playerId: 'player-1', playerNumber: 1 }];
    const players = [{ id: 'player-1', firstName: 'Sam', lastName: 'Smith' }];

    mockTeamRosterObserveQuery.mockReturnValue(createRosterObservable(rosters));
    mockPlayerObserveQuery.mockReturnValue(createPlayerObservable(players));

    const { result } = renderHook(() => useTeamData('team-1', null));

    // Should not call position subscription
    expect(mockFormationPositionObserveQuery).not.toHaveBeenCalled();

    // Should have empty positions
    expect(result.current.positions).toEqual([]);
  });

  it('when formationId is null, no position subscription is created and cleanup runs without error', async () => {
    const rosters = [{ playerId: 'player-1', playerNumber: 1 }];
    const players = [{ id: 'player-1', firstName: 'Sam', lastName: 'Smith' }];

    const rosterUnsubscribe = vi.fn();
    const playerUnsubscribe = vi.fn();

    mockTeamRosterObserveQuery.mockReturnValue({
      subscribe: ({ next }: { next: (data: { items: unknown[] }) => void }) => {
        next({ items: rosters });
        return { unsubscribe: rosterUnsubscribe };
      },
    });

    mockPlayerObserveQuery.mockReturnValue({
      subscribe: ({ next }: { next: (data: { items: unknown[] }) => void }) => {
        next({ items: players });
        return { unsubscribe: playerUnsubscribe };
      },
    });

    const { unmount } = renderHook(() => useTeamData('team-1', null));

    unmount();

    expect(rosterUnsubscribe).toHaveBeenCalled();
    expect(playerUnsubscribe).toHaveBeenCalled();
    expect(mockFormationPositionObserveQuery).not.toHaveBeenCalled();
  });

  it('subscribes to TeamRoster with correct teamId filter', () => {
    renderHook(() => useTeamData('team-123', null));

    expect(mockTeamRosterObserveQuery).toHaveBeenCalledWith({
      filter: { teamId: { eq: 'team-123' } },
    });
  });

  it('subscribes to FieldPosition with correct formationId filter when provided', () => {
    renderHook(() => useTeamData('team-1', 'formation-1'));

    expect(mockFormationPositionObserveQuery).toHaveBeenCalledWith({
      filter: { formationId: { eq: 'formation-1' } },
    });
  });

  it('merges roster data with player data — playerNumber and preferredPositions come from roster', async () => {
    const rosters = [
      { playerId: 'player-1', playerNumber: 7, preferredPositions: ['Forward'] },
    ];
    const players = [{ id: 'player-1', firstName: 'Sam', lastName: 'Smith' }];

    mockTeamRosterObserveQuery.mockReturnValue(createRosterObservable(rosters));
    mockPlayerObserveQuery.mockReturnValue(createPlayerObservable(players));

    const { result } = renderHook(() => useTeamData('team-1', null));

    await waitFor(() => {
      expect(result.current.players).toHaveLength(1);
    });

    expect(result.current.players[0]).toMatchObject({
      id: 'player-1',
      firstName: 'Sam',
      lastName: 'Smith',
      playerNumber: 7,
      preferredPositions: ['Forward'],
    });
  });

  it('filters out players whose IDs are not in the roster', async () => {
    const rosters = [{ playerId: 'player-1', playerNumber: 1 }];
    const players = [
      { id: 'player-1', firstName: 'Sam', lastName: 'Smith' },
      { id: 'player-2', firstName: 'Alex', lastName: 'Johnson' },
    ];

    mockTeamRosterObserveQuery.mockReturnValue(createRosterObservable(rosters));
    mockPlayerObserveQuery.mockReturnValue(createPlayerObservable(players));

    const { result } = renderHook(() => useTeamData('team-1', null));

    await waitFor(() => {
      expect(result.current.players).toHaveLength(1);
    });

    expect(result.current.players[0].id).toBe('player-1');
  });

  it('sorts roster entries by jersey number ascending', async () => {
    const rosters = [
      { playerId: 'player-3', playerNumber: 10 },
      { playerId: 'player-1', playerNumber: 3 },
      { playerId: 'player-2', playerNumber: 7 },
    ];
    const players = [
      { id: 'player-1', firstName: 'Sam', lastName: 'A' },
      { id: 'player-2', firstName: 'Alex', lastName: 'B' },
      { id: 'player-3', firstName: 'Jordan', lastName: 'C' },
    ];

    mockTeamRosterObserveQuery.mockReturnValue(createRosterObservable(rosters));
    mockPlayerObserveQuery.mockReturnValue(createPlayerObservable(players));

    const { result } = renderHook(() => useTeamData('team-1', null));

    await waitFor(() => {
      expect(result.current.players).toHaveLength(3);
    });

    expect(result.current.players[0].playerNumber).toBe(3);
    expect(result.current.players[1].playerNumber).toBe(7);
    expect(result.current.players[2].playerNumber).toBe(10);
  });

  it('updates players reactively when roster subscription fires new data', async () => {
    let rosterNext: (data: { items: unknown[] }) => void;

    mockTeamRosterObserveQuery.mockReturnValue({
      subscribe: ({ next }: { next: (data: { items: unknown[] }) => void }) => {
        rosterNext = next;
        next({ items: [] });
        return { unsubscribe: vi.fn() };
      },
    });

    const players = [
      { id: 'player-1', firstName: 'Sam', lastName: 'A' },
      { id: 'player-2', firstName: 'Alex', lastName: 'B' },
    ];

    mockPlayerObserveQuery.mockReturnValue(createPlayerObservable(players));

    const { result } = renderHook(() => useTeamData('team-1', null));

    // Initially empty
    expect(result.current.players).toEqual([]);

    // Fire roster update
    await waitFor(() => {
      rosterNext!({
        items: [
          { playerId: 'player-1', playerNumber: 1 },
          { playerId: 'player-2', playerNumber: 2 },
        ],
      });
    });

    await waitFor(() => {
      expect(result.current.players).toHaveLength(2);
    });
  });

  it('updates positions reactively when position subscription fires new data', async () => {
    let positionNext: (data: { items: unknown[] }) => void;

    mockTeamRosterObserveQuery.mockReturnValue(createRosterObservable([]));
    mockFormationPositionObserveQuery.mockReturnValue({
      subscribe: ({ next }: { next: (data: { items: unknown[] }) => void }) => {
        positionNext = next;
        next({ items: [] });
        return { unsubscribe: vi.fn() };
      },
    });

    const { result } = renderHook(() => useTeamData('team-1', 'formation-1'));

    // Initially empty
    expect(result.current.positions).toEqual([]);

    // Fire position update
    await waitFor(() => {
      positionNext!({
        items: [
          { id: 'pos-1', name: 'Forward', sortOrder: 1 },
          { id: 'pos-2', name: 'Midfield', sortOrder: 2 },
        ],
      });
    });

    await waitFor(() => {
      expect(result.current.positions).toHaveLength(2);
    });
  });

  it('unsubscribes all subscriptions on unmount', () => {
    const rosterUnsubscribe = vi.fn();
    const playerUnsubscribe = vi.fn();
    const positionUnsubscribe = vi.fn();

    mockTeamRosterObserveQuery.mockReturnValue({
      subscribe: ({ next }: { next: (data: { items: unknown[] }) => void }) => {
        next({ items: [{ playerId: 'player-1', playerNumber: 1 }] });
        return { unsubscribe: rosterUnsubscribe };
      },
    });

    mockPlayerObserveQuery.mockReturnValue({
      subscribe: ({ next }: { next: (data: { items: unknown[] }) => void }) => {
        next({ items: [{ id: 'player-1', firstName: 'Sam', lastName: 'A' }] });
        return { unsubscribe: playerUnsubscribe };
      },
    });

    mockFormationPositionObserveQuery.mockReturnValue({
      subscribe: ({ next }: { next: (data: { items: unknown[] }) => void }) => {
        next({ items: [] });
        return { unsubscribe: positionUnsubscribe };
      },
    });

    const { unmount } = renderHook(() => useTeamData('team-1', 'formation-1'));

    unmount();

    expect(rosterUnsubscribe).toHaveBeenCalled();
    expect(playerUnsubscribe).toHaveBeenCalled();
    expect(positionUnsubscribe).toHaveBeenCalled();
  });

  it('re-subscribes when teamId prop changes (old sub unsubscribed, new sub created)', async () => {
    const unsubscribe1 = vi.fn();
    const unsubscribe2 = vi.fn();

    let callCount = 0;
    mockTeamRosterObserveQuery.mockImplementation(() => {
      callCount++;
      return {
        subscribe: ({ next }: { next: (data: { items: unknown[] }) => void }) => {
          next({ items: [] });
          return { unsubscribe: callCount === 1 ? unsubscribe1 : unsubscribe2 };
        },
      };
    });

    const { rerender } = renderHook(
      ({ teamId }) => useTeamData(teamId, null),
      { initialProps: { teamId: 'team-1' } }
    );

    // Change teamId
    rerender({ teamId: 'team-2' });

    await waitFor(() => {
      expect(mockTeamRosterObserveQuery).toHaveBeenCalledTimes(2);
    });

    expect(unsubscribe1).toHaveBeenCalled();
  });

  it('re-subscribes when formationId prop changes', async () => {
    const unsubscribe1 = vi.fn();
    const unsubscribe2 = vi.fn();

    let callCount = 0;
    mockFormationPositionObserveQuery.mockImplementation(() => {
      callCount++;
      return {
        subscribe: ({ next }: { next: (data: { items: unknown[] }) => void }) => {
          next({ items: [] });
          return { unsubscribe: callCount === 1 ? unsubscribe1 : unsubscribe2 };
        },
      };
    });

    mockTeamRosterObserveQuery.mockReturnValue(createRosterObservable([]));

    const { rerender } = renderHook(
      ({ formationId }) => useTeamData('team-1', formationId),
      { initialProps: { formationId: 'formation-1' } }
    );

    // Change formationId
    rerender({ formationId: 'formation-2' });

    await waitFor(() => {
      expect(mockFormationPositionObserveQuery).toHaveBeenCalledTimes(2);
    });

    expect(unsubscribe1).toHaveBeenCalled();
  });

  it('handles empty roster (subscription fires [] — produces [] players)', async () => {
    mockTeamRosterObserveQuery.mockReturnValue(createRosterObservable([]));

    const { result } = renderHook(() => useTeamData('team-1', null));

    expect(result.current.players).toEqual([]);
    // Player subscription should not be created
    expect(mockPlayerObserveQuery).not.toHaveBeenCalled();
  });

  it('handles roster entries with no matching player records (those entries omitted)', async () => {
    const rosters = [
      { playerId: 'player-1', playerNumber: 1 },
      { playerId: 'player-2', playerNumber: 2 },
    ];
    const players = [{ id: 'player-1', firstName: 'Sam', lastName: 'A' }];

    mockTeamRosterObserveQuery.mockReturnValue(createRosterObservable(rosters));
    mockPlayerObserveQuery.mockReturnValue(createPlayerObservable(players));

    const { result } = renderHook(() => useTeamData('team-1', null));

    await waitFor(() => {
      expect(result.current.players).toHaveLength(1);
    });

    expect(result.current.players[0].id).toBe('player-1');
  });
});
