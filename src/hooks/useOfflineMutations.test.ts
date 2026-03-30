import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Hoisted mock factories ───────────────────────────────────────────────────
// Must be created before vi.mock() factories (also hoisted) can reference them.

const {
  mockGameUpdate,
  mockPlayTimeRecordCreate,
  mockCreateSecureGameNote,
  mockUpdateSecureGameNote,
  mockGameNoteDelete,
  mockPlayerAvailabilityCreate,
  mockPlayerAvailabilityUpdate,
  mockEnqueue,
  mockDequeueAll,
  mockRequeueFailed,
  mockRequeuePreserved,
  mockPendingCount,
  mockDeduplicateGameUpdates,
  mockFetchAuthSession,
  mockShowWarning,
  mockUseNetworkStatus,
} = vi.hoisted(() => ({
  mockGameUpdate: vi.fn(),
  mockPlayTimeRecordCreate: vi.fn(),
  mockCreateSecureGameNote: vi.fn(),
  mockUpdateSecureGameNote: vi.fn(),
  mockGameNoteDelete: vi.fn(),
  mockPlayerAvailabilityCreate: vi.fn(),
  mockPlayerAvailabilityUpdate: vi.fn(),
  mockEnqueue: vi.fn(),
  mockDequeueAll: vi.fn(),
  mockRequeueFailed: vi.fn(),
  mockRequeuePreserved: vi.fn(),
  mockPendingCount: vi.fn(),
  mockDeduplicateGameUpdates: vi.fn(),
  mockFetchAuthSession: vi.fn(),
  mockShowWarning: vi.fn(),
  mockUseNetworkStatus: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      Game: { update: mockGameUpdate },
      PlayTimeRecord: {
        create: mockPlayTimeRecordCreate,
        update: vi.fn().mockResolvedValue({ data: {} }),
      },
      Substitution: { create: vi.fn().mockResolvedValue({ data: {} }) },
      LineupAssignment: {
        create: vi.fn().mockResolvedValue({ data: {} }),
        delete: vi.fn().mockResolvedValue({ data: {} }),
        update: vi.fn().mockResolvedValue({ data: {} }),
      },
      Goal: { create: vi.fn().mockResolvedValue({ data: {} }) },
      GameNote: {
        delete: mockGameNoteDelete,
      },
      PlayerAvailability: {
        create: mockPlayerAvailabilityCreate,
        update: mockPlayerAvailabilityUpdate,
      },
    },
    mutations: {
      createSecureGameNote: mockCreateSecureGameNote,
      updateSecureGameNote: mockUpdateSecureGameNote,
    },
  })),
}));

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: mockFetchAuthSession,
}));

vi.mock('../services/offlineQueueService', () => ({
  enqueue: mockEnqueue,
  dequeueAll: mockDequeueAll,
  requeueFailed: mockRequeueFailed,
  requeuePreserved: mockRequeuePreserved,
  pendingCount: mockPendingCount,
  deduplicateGameUpdates: mockDeduplicateGameUpdates,
}));

vi.mock('../utils/toast', () => ({
  showWarning: mockShowWarning,
  showSuccess: vi.fn(),
}));

vi.mock('./useNetworkStatus', () => ({
  useNetworkStatus: mockUseNetworkStatus,
}));

// Import AFTER vi.mock declarations
import { useOfflineMutations } from './useOfflineMutations';

// ── Helpers ───────────────────────────────────────────────────────────────────

let capturedOnReconnect: (() => void) | undefined;

const DEFAULT_SUB = 'user-A';
const DEFAULT_SESSION = {
  tokens: { idToken: { payload: { sub: DEFAULT_SUB } } },
};

function setupOnline() {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  mockUseNetworkStatus.mockImplementation((opts: { onReconnect?: () => void } = {}) => {
    capturedOnReconnect = opts.onReconnect;
    return { isOnline: true };
  });
}

function setupOffline() {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
  mockUseNetworkStatus.mockImplementation((opts: { onReconnect?: () => void } = {}) => {
    capturedOnReconnect = opts.onReconnect;
    return { isOnline: false };
  });
}

/** Wait for all pending microtasks and macro-tasks to settle. */
async function flush() {
  await act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 50));
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useOfflineMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnReconnect = undefined;

    // Default mock behaviour
    setupOnline();
    mockGameUpdate.mockResolvedValue({ data: {} });
    mockPlayTimeRecordCreate.mockResolvedValue({ data: {} });
    mockCreateSecureGameNote.mockResolvedValue({ data: {} });
    mockUpdateSecureGameNote.mockResolvedValue({ data: {} });
    mockGameNoteDelete.mockResolvedValue({ data: {} });
    mockPlayerAvailabilityCreate.mockResolvedValue({ data: {} });
    mockPlayerAvailabilityUpdate.mockResolvedValue({ data: {} });
    mockFetchAuthSession.mockResolvedValue(DEFAULT_SESSION);
    mockEnqueue.mockResolvedValue(undefined);
    mockDequeueAll.mockResolvedValue([]);
    mockPendingCount.mockResolvedValue(0);
    mockDeduplicateGameUpdates.mockResolvedValue(undefined);
    mockRequeueFailed.mockResolvedValue(undefined);
    mockRequeuePreserved.mockResolvedValue(undefined);
  });

  // ── Baseline state ──────────────────────────────────────────────────────

  it('exposes isOnline from useNetworkStatus', () => {
    setupOnline();
    const { result } = renderHook(() => useOfflineMutations());
    expect(result.current.isOnline).toBe(true);
  });

  it('exposes isSyncing as false at rest', () => {
    const { result } = renderHook(() => useOfflineMutations());
    expect(result.current.isSyncing).toBe(false);
  });

  it('exposes pendingCount as 0 initially', () => {
    const { result } = renderHook(() => useOfflineMutations());
    expect(result.current.pendingCount).toBe(0);
  });

  // ── Online path ─────────────────────────────────────────────────────────

  describe('online path — mutations call the API directly', () => {
    it('updateGame calls client.models.Game.update with correct args', async () => {
      const { result } = renderHook(() => useOfflineMutations());

      await act(async () => {
        await result.current.mutations.updateGame('g1', { elapsedSeconds: 30 });
      });

      expect(mockGameUpdate).toHaveBeenCalledWith({ id: 'g1', elapsedSeconds: 30 });
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('createPlayTimeRecord calls the Amplify model directly', async () => {
      const { result } = renderHook(() => useOfflineMutations());

      await act(async () => {
        await result.current.mutations.createPlayTimeRecord({
          gameId: 'g1',
          playerId: 'p1',
          startGameSeconds: 0,
          coaches: ['coach-1'],
        });
      });

      expect(mockPlayTimeRecordCreate).toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('createPlayerAvailability calls the Amplify model directly', async () => {
      const { result } = renderHook(() => useOfflineMutations());

      await act(async () => {
        await result.current.mutations.createPlayerAvailability({
          gameId: 'g1',
          playerId: 'p1',
          status: 'injured',
          markedAt: new Date().toISOString(),
          coaches: ['coach-1'],
        });
      });

      expect(mockPlayerAvailabilityCreate).toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('updatePlayerAvailability calls the Amplify model directly', async () => {
      const { result } = renderHook(() => useOfflineMutations());

      await act(async () => {
        await result.current.mutations.updatePlayerAvailability('pa-1', {
          status: 'available',
          availableUntilMinute: null,
        });
      });

      expect(mockPlayerAvailabilityUpdate).toHaveBeenCalledWith({
        id: 'pa-1',
        status: 'available',
        availableUntilMinute: null,
      });
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('createGameNote uses the secure custom mutation path without forwarding authorId or coaches', async () => {
      const { result } = renderHook(() => useOfflineMutations());

      await act(async () => {
        await result.current.mutations.createGameNote({
          gameId: 'g1',
          noteType: 'coaching-point',
          gameSeconds: null,
          half: null,
          notes: 'Pre-game focus',
          coaches: ['coach-1'],
        });
      });

      expect(mockCreateSecureGameNote).toHaveBeenCalledWith({
        gameId: 'g1',
        noteType: 'coaching-point',
        gameSeconds: null,
        half: null,
        notes: 'Pre-game focus',
      });
    });

    it('updateGameNote updates only allowed mutable fields payload', async () => {
      const { result } = renderHook(() => useOfflineMutations());

      await act(async () => {
        await result.current.mutations.updateGameNote('note-1', {
          noteType: 'coaching-point',
          playerId: 'p1',
          notes: 'Updated text',
        });
      });

      expect(mockUpdateSecureGameNote).toHaveBeenCalledWith({
        id: 'note-1',
        noteType: 'coaching-point',
        playerId: 'p1',
        notes: 'Updated text',
      });
    });

    it('updateGameNote strips authorId from payload even if supplied at runtime', async () => {
      const { result } = renderHook(() => useOfflineMutations());

      await act(async () => {
        // Cast to bypass TypeScript to simulate a runtime injection attempt.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const injectedPayload: any = { noteType: 'coaching-point', notes: 'Updated text', authorId: 'attacker-id' };
        await result.current.mutations.updateGameNote('note-1', injectedPayload);
      });

      expect(mockUpdateSecureGameNote).toHaveBeenCalledWith(
        expect.not.objectContaining({ authorId: expect.anything() })
      );
    });

    it('deleteGameNote calls model delete with id payload', async () => {
      const { result } = renderHook(() => useOfflineMutations());

      await act(async () => {
        await result.current.mutations.deleteGameNote('note-1');
      });

      expect(mockGameNoteDelete).toHaveBeenCalledWith({ id: 'note-1' });
    });
  });

  // ── Offline path ─────────────────────────────────────────────────────────

  describe('offline path — mutations are queued to IndexedDB', () => {
    it('updateGame enqueues the mutation with correct model and operation', async () => {
      setupOffline();
      const { result } = renderHook(() => useOfflineMutations());

      await act(async () => {
        await result.current.mutations.updateGame('g1', { elapsedSeconds: 30 });
      });

      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'Game', operation: 'update' })
      );
      expect(mockGameUpdate).not.toHaveBeenCalled();
    });

    it('increments pendingCount after each enqueue', async () => {
      setupOffline();
      const { result } = renderHook(() => useOfflineMutations());

      expect(result.current.pendingCount).toBe(0);

      await act(async () => {
        await result.current.mutations.updateGame('g1', { elapsedSeconds: 30 });
      });

      expect(result.current.pendingCount).toBe(1);
    });

    it('stores the ownerSub from fetchAuthSession in the queued item', async () => {
      setupOffline();
      mockFetchAuthSession.mockResolvedValue({
        tokens: { idToken: { payload: { sub: 'user-A' } } },
      });
      const { result } = renderHook(() => useOfflineMutations());

      await act(async () => {
        await result.current.mutations.updateGame('g1', { elapsedSeconds: 30 });
      });

      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({ ownerSub: 'user-A' })
      );
    });

    it('createPlayerAvailability is queued while offline', async () => {
      setupOffline();
      const { result } = renderHook(() => useOfflineMutations());

      await act(async () => {
        await result.current.mutations.createPlayerAvailability({
          gameId: 'g1',
          playerId: 'p1',
          status: 'injured',
          markedAt: new Date().toISOString(),
        });
      });

      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'PlayerAvailability', operation: 'create' })
      );
      expect(mockPlayerAvailabilityCreate).not.toHaveBeenCalled();
    });

    it('queues GameNote update and delete while offline', async () => {
      setupOffline();
      const { result } = renderHook(() => useOfflineMutations());

      await act(async () => {
        await result.current.mutations.updateGameNote('note-2', {
          notes: 'Offline edit',
        });
        await result.current.mutations.deleteGameNote('note-2');
      });

      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'GameNote', operation: 'update' })
      );
      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'GameNote', operation: 'delete' })
      );
      expect(mockUpdateSecureGameNote).not.toHaveBeenCalled();
      expect(mockGameNoteDelete).not.toHaveBeenCalled();
    });

    it('still enqueues even when fetchAuthSession fails (no ownerSub)', async () => {
      setupOffline();
      mockFetchAuthSession.mockRejectedValue(new Error('Session expired'));
      const { result } = renderHook(() => useOfflineMutations());

      await act(async () => {
        await result.current.mutations.updateGame('g1', { elapsedSeconds: 30 });
      });

      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'Game', operation: 'update' })
      );
    });
  });

  // ── Drain queue ───────────────────────────────────────────────────────────

  describe('drainQueue — triggered on reconnect', () => {
    it('deduplicates then replays queued mutations via the Amplify client', async () => {
      mockDequeueAll.mockResolvedValue([
        {
          id: 'q1',
          model: 'Game',
          operation: 'update',
          payload: { id: 'g1', elapsedSeconds: 60 },
          enqueuedAt: 1,
          retryCount: 0,
          ownerSub: DEFAULT_SUB,
        },
      ]);

      renderHook(() => useOfflineMutations());

      await act(async () => {
        capturedOnReconnect?.();
      });
      await flush();

      expect(mockDeduplicateGameUpdates).toHaveBeenCalled();
      expect(mockDequeueAll).toHaveBeenCalled();
      expect(mockGameUpdate).toHaveBeenCalledWith({ id: 'g1', elapsedSeconds: 60 });
    });

    it('replays queued GameNote writes through the secure custom mutations', async () => {
      mockDequeueAll.mockResolvedValue([
        {
          id: 'q1',
          model: 'GameNote',
          operation: 'create',
          payload: {
            gameId: 'g1',
            noteType: 'coaching-point',
            gameSeconds: null,
            half: null,
            notes: 'Queued pre-game note',
            authorId: 'spoofed-author',
          },
          enqueuedAt: 1,
          retryCount: 0,
          ownerSub: DEFAULT_SUB,
        },
        {
          id: 'q2',
          model: 'GameNote',
          operation: 'update',
          payload: {
            id: 'note-1',
            notes: 'Queued update',
            authorId: 'spoofed-author',
          },
          enqueuedAt: 2,
          retryCount: 0,
          ownerSub: DEFAULT_SUB,
        },
      ]);

      renderHook(() => useOfflineMutations());

      await act(async () => {
        capturedOnReconnect?.();
      });
      await flush();

      expect(mockCreateSecureGameNote).toHaveBeenCalledWith({
        gameId: 'g1',
        noteType: 'coaching-point',
        gameSeconds: null,
        half: null,
        notes: 'Queued pre-game note',
      });
      expect(mockUpdateSecureGameNote).toHaveBeenCalledWith({
        id: 'note-1',
        notes: 'Queued update',
      });
    });

    it('replays queued PlayerAvailability updates via the Amplify client', async () => {
      mockDequeueAll.mockResolvedValue([
        {
          id: 'q1',
          model: 'PlayerAvailability',
          operation: 'update',
          payload: { id: 'pa-1', status: 'available', availableUntilMinute: null },
          enqueuedAt: 1,
          retryCount: 0,
          ownerSub: DEFAULT_SUB,
        },
      ]);

      renderHook(() => useOfflineMutations());

      await act(async () => {
        capturedOnReconnect?.();
      });
      await flush();

      expect(mockPlayerAvailabilityUpdate).toHaveBeenCalledWith({
        id: 'pa-1',
        status: 'available',
        availableUntilMinute: null,
      });
    });

    it('shows a warning and resets isSyncing when auth refresh fails', async () => {
      mockFetchAuthSession.mockRejectedValue(new Error('Auth error'));
      const { result } = renderHook(() => useOfflineMutations());

      await act(async () => {
        capturedOnReconnect?.();
      });
      await flush();

      expect(mockShowWarning).toHaveBeenCalled();
      expect(result.current.isSyncing).toBe(false);
    });

    it('resets isSyncing to false via the finally block when drain throws unexpectedly', async () => {
      mockDeduplicateGameUpdates.mockRejectedValue(new Error('IDB failure'));
      const { result } = renderHook(() => useOfflineMutations());

      await act(async () => {
        capturedOnReconnect?.();
      });
      await flush();

      expect(result.current.isSyncing).toBe(false);
    });

    it('does not execute mutations from a different user session, but requeues them for the correct user', async () => {
      // Current user is user-B, but the queued item belongs to user-A.
      // The item must NOT be executed and must be requeued without incrementing
      // retryCount (via requeuePreserved, not requeueFailed).
      mockFetchAuthSession.mockResolvedValue({
        tokens: { idToken: { payload: { sub: 'user-B' } } },
      });
      mockDequeueAll.mockResolvedValue([
        {
          id: 'q1',
          model: 'Game',
          operation: 'update',
          payload: { id: 'g1', elapsedSeconds: 60 },
          enqueuedAt: 1,
          retryCount: 0,
          ownerSub: 'user-A',
        },
      ]);

      renderHook(() => useOfflineMutations());

      await act(async () => {
        capturedOnReconnect?.();
      });
      await flush();

      // The mutation must NOT be executed
      expect(mockGameUpdate).not.toHaveBeenCalled();
      // Must be preserved as-is via requeuePreserved (retryCount unchanged)
      expect(mockRequeuePreserved).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: 'q1', ownerSub: 'user-A', retryCount: 0 })])
      );
      // Must NOT go through requeueFailed (which would increment retryCount)
      expect(mockRequeueFailed).not.toHaveBeenCalled();
    });

    it('replays mutations with no ownerSub regardless of current user', async () => {
      mockDequeueAll.mockResolvedValue([
        {
          id: 'q1',
          model: 'Game',
          operation: 'update',
          payload: { id: 'g1', elapsedSeconds: 60 },
          enqueuedAt: 1,
          retryCount: 0,
          // ownerSub deliberately absent (legacy items before the fix)
        },
      ]);

      renderHook(() => useOfflineMutations());

      await act(async () => {
        capturedOnReconnect?.();
      });
      await flush();

      expect(mockGameUpdate).toHaveBeenCalled();
    });

    it('requeues mutations that fail to replay', async () => {
      mockGameUpdate.mockRejectedValue(new Error('API error'));
      mockDequeueAll.mockResolvedValue([
        {
          id: 'q1',
          model: 'Game',
          operation: 'update',
          payload: { id: 'g1' },
          enqueuedAt: 1,
          retryCount: 0,
          ownerSub: DEFAULT_SUB,
        },
      ]);

      renderHook(() => useOfflineMutations());

      await act(async () => {
        capturedOnReconnect?.();
      });
      await flush();

      expect(mockRequeueFailed).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: 'q1' })])
      );
    });

    it('requeues (and does not execute) items with a disallowed model name', async () => {
      mockDequeueAll.mockResolvedValue([
        {
          id: 'q1',
          model: 'EvilModel',
          operation: 'create',
          payload: {},
          enqueuedAt: 1,
          retryCount: 0,
          ownerSub: DEFAULT_SUB,
        },
      ]);

      renderHook(() => useOfflineMutations());

      await act(async () => {
        capturedOnReconnect?.();
      });
      await flush();

      // executeSingleMutation throws for unknown models → item gets requeued
      expect(mockRequeueFailed).toHaveBeenCalled();
      expect(mockGameUpdate).not.toHaveBeenCalled();
    });

    it('sets isSyncing to true while draining and false when done', async () => {
      // Block the drain mid-way so we can observe the isSyncing state
      let unlockDedup!: () => void;
      mockDeduplicateGameUpdates.mockReturnValue(
        new Promise<void>(resolve => { unlockDedup = resolve; }),
      );

      const { result } = renderHook(() => useOfflineMutations());

      // Fire the reconnect (sync) — React will batch the setIsSyncing(true) update
      act(() => { capturedOnReconnect?.(); });

      // Flush one round of microtasks: fetchAuthSession resolves, then
      // drainQueue blocks at deduplicateGameUpdates (still locked).
      // React will commit the setIsSyncing(true) state update in this act.
      await act(async () => {});

      // isSyncing must be true while the drain is suspended
      expect(result.current.isSyncing).toBe(true);

      // Unblock the drain and let it complete
      await act(async () => { unlockDedup(); });
      await flush();

      expect(result.current.isSyncing).toBe(false);
    });
  });
});
