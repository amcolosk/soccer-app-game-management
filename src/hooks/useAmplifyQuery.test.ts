import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// vi.hoisted runs before vi.mock hoisting, so these are available in the mock factory
const { mockObserveQuery, mockUnsubscribe, subscriberCallbacks } = vi.hoisted(() => {
  const callbacks: Array<{
    next: (result: { items: any[]; isSynced: boolean }) => void;
  }> = [];
  const unsubscribe = vi.fn();
  const observeQuery = vi.fn(() => ({
    subscribe: vi.fn((cb: any) => {
      callbacks.push(cb);
      return { unsubscribe };
    }),
  }));
  return { mockObserveQuery: observeQuery, mockUnsubscribe: unsubscribe, subscriberCallbacks: callbacks };
});

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      Team: { observeQuery: mockObserveQuery },
      Game: { observeQuery: mockObserveQuery },
      Player: { observeQuery: mockObserveQuery },
      TeamRoster: { observeQuery: mockObserveQuery },
      Formation: { observeQuery: mockObserveQuery },
      FormationPosition: { observeQuery: mockObserveQuery },
      FieldPosition: { observeQuery: mockObserveQuery },
      LineupAssignment: { observeQuery: mockObserveQuery },
      Substitution: { observeQuery: mockObserveQuery },
      PlayTimeRecord: { observeQuery: mockObserveQuery },
      Goal: { observeQuery: mockObserveQuery },
      GameNote: { observeQuery: mockObserveQuery },
      GamePlan: { observeQuery: mockObserveQuery },
      PlannedRotation: { observeQuery: mockObserveQuery },
      PlayerAvailability: { observeQuery: mockObserveQuery },
      TeamInvitation: { observeQuery: mockObserveQuery },
    },
  })),
}));

import { useAmplifyQuery } from './useAmplifyQuery';

describe('useAmplifyQuery', () => {
  beforeEach(() => {
    subscriberCallbacks.length = 0;
    mockUnsubscribe.mockClear();
    mockObserveQuery.mockClear();
  });

  it('returns empty array and isSynced=false initially', () => {
    const { result } = renderHook(() => useAmplifyQuery('Team'));

    expect(result.current.data).toEqual([]);
    expect(result.current.isSynced).toBe(false);
  });

  it('returns items after subscription emits', () => {
    const { result } = renderHook(() => useAmplifyQuery('Team'));

    act(() => {
      subscriberCallbacks[0].next({
        items: [{ id: '1', name: 'Eagles' }, { id: '2', name: 'Hawks' }],
        isSynced: false,
      });
    });

    expect(result.current.data).toEqual([
      { id: '1', name: 'Eagles' },
      { id: '2', name: 'Hawks' },
    ]);
    expect(result.current.isSynced).toBe(false);
  });

  it('sets isSynced when subscription reports synced', () => {
    const { result } = renderHook(() => useAmplifyQuery('Team'));

    act(() => {
      subscriberCallbacks[0].next({
        items: [{ id: '1', name: 'Eagles' }],
        isSynced: true,
      });
    });

    expect(result.current.isSynced).toBe(true);
  });

  it('applies sort function to items', () => {
    const sort = (a: any, b: any) => a.name.localeCompare(b.name);
    const { result } = renderHook(() =>
      useAmplifyQuery('Team', { sort }),
    );

    act(() => {
      subscriberCallbacks[0].next({
        items: [{ id: '2', name: 'Zebras' }, { id: '1', name: 'Ants' }],
        isSynced: true,
      });
    });

    expect(result.current.data[0].name).toBe('Ants');
    expect(result.current.data[1].name).toBe('Zebras');
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useAmplifyQuery('Team'));

    expect(mockUnsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('re-subscribes when deps change', () => {
    const { rerender } = renderHook(
      ({ gameId }: { gameId: string }) =>
        useAmplifyQuery('Game', { filter: { gameId: { eq: gameId } } }, [gameId]),
      { initialProps: { gameId: 'game-1' } },
    );

    expect(subscriberCallbacks).toHaveLength(1);
    expect(mockUnsubscribe).not.toHaveBeenCalled();

    rerender({ gameId: 'game-2' });

    // Old subscription unsubscribed, new one created
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    expect(subscriberCallbacks).toHaveLength(2);
  });

  it('does not re-subscribe when sort function reference changes', () => {
    const { rerender } = renderHook(
      ({ sort }: { sort: (a: any, b: any) => number }) =>
        useAmplifyQuery('Team', { sort }),
      { initialProps: { sort: (a: any, b: any) => a.id - b.id } },
    );

    expect(subscriberCallbacks).toHaveLength(1);

    // Rerender with a different sort function reference
    rerender({ sort: (a: any, b: any) => b.id - a.id });

    // Should NOT re-subscribe — sort is stored in ref
    expect(subscriberCallbacks).toHaveLength(1);
    expect(mockUnsubscribe).not.toHaveBeenCalled();
  });

  it('passes filter to observeQuery when provided', () => {
    renderHook(() =>
      useAmplifyQuery('Game', { filter: { gameId: { eq: 'game-1' } } }, ['game-1']),
    );

    expect(mockObserveQuery).toHaveBeenCalledWith({
      filter: { gameId: { eq: 'game-1' } },
    });
  });

  it('calls observeQuery with no args when no filter', () => {
    renderHook(() => useAmplifyQuery('Team'));

    expect(mockObserveQuery).toHaveBeenCalledWith(undefined);
  });

  it('resets isSynced to false on re-subscription', () => {
    const { result, rerender } = renderHook(
      ({ gameId }: { gameId: string }) =>
        useAmplifyQuery('Game', { filter: { gameId: { eq: gameId } } }, [gameId]),
      { initialProps: { gameId: 'game-1' } },
    );

    // First subscription syncs
    act(() => {
      subscriberCallbacks[0].next({
        items: [{ id: '1' }],
        isSynced: true,
      });
    });
    expect(result.current.isSynced).toBe(true);

    // Change deps → re-subscribe
    rerender({ gameId: 'game-2' });

    // isSynced should reset to false
    expect(result.current.isSynced).toBe(false);
  });

  it('does not re-subscribe when deps stay the same', () => {
    const { rerender } = renderHook(
      ({ gameId }: { gameId: string }) =>
        useAmplifyQuery('Game', { filter: { gameId: { eq: gameId } } }, [gameId]),
      { initialProps: { gameId: 'game-1' } },
    );

    expect(subscriberCallbacks).toHaveLength(1);

    // Rerender with same gameId
    rerender({ gameId: 'game-1' });

    // Should NOT re-subscribe
    expect(subscriberCallbacks).toHaveLength(1);
    expect(mockUnsubscribe).not.toHaveBeenCalled();
  });

  it('uses latest sort function without re-subscribing', () => {
    const { result, rerender } = renderHook(
      ({ asc }: { asc: boolean }) =>
        useAmplifyQuery('Team', {
          sort: asc
            ? (a: any, b: any) => a.val - b.val
            : (a: any, b: any) => b.val - a.val,
        }),
      { initialProps: { asc: true } },
    );

    // Emit data with ascending sort
    act(() => {
      subscriberCallbacks[0].next({
        items: [{ id: '1', val: 2 }, { id: '2', val: 1 }],
        isSynced: true,
      });
    });
    expect(result.current.data[0].val).toBe(1);
    expect(result.current.data[1].val).toBe(2);

    // Change sort to descending
    rerender({ asc: false });

    // Emit same data again — should use new sort
    act(() => {
      subscriberCallbacks[0].next({
        items: [{ id: '1', val: 2 }, { id: '2', val: 1 }],
        isSynced: true,
      });
    });
    expect(result.current.data[0].val).toBe(2);
    expect(result.current.data[1].val).toBe(1);
  });
});
