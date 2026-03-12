import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── In-memory IDB mock ───────────────────────────────────────────────────────
// All mock functions are created here via vi.hoisted so they are available
// inside vi.mock() factory (which is also hoisted before module imports).

const { store, txApi, dbMock } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = new Map<string, any>();

  const txApi = {
    getAll: vi.fn(),
    clear: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };

  const dbMock = {
    count: vi.fn(),
    add: vi.fn(),
    transaction: vi.fn(),
  };

  return { store: s, txApi, dbMock };
});

vi.mock('idb', () => ({
  openDB: vi.fn().mockResolvedValue(dbMock),
}));

// Import AFTER vi.mock so the module receives the mocked idb.
import {
  enqueue,
  dequeueAll,
  requeueFailed,
  requeuePreserved,
  pendingCount,
  deduplicateGameUpdates,
  type QueuedMutation,
} from './offlineQueueService';

// ── Test helpers ─────────────────────────────────────────────────────────────

let _counter = 0;
function makeItem(overrides: Partial<QueuedMutation> = {}): QueuedMutation {
  const id = `id-${++_counter}`;
  return {
    id,
    model: 'Game',
    operation: 'update',
    payload: { id: 'game-1' },
    enqueuedAt: Date.now(),
    retryCount: 0,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('offlineQueueService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();

    // Re-wire implementations each time because vi.clearAllMocks() removes them.
    dbMock.count.mockImplementation(() => Promise.resolve(store.size));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dbMock.add.mockImplementation((_storeName: string, item: any) => {
      store.set(item.id as string, item);
      return Promise.resolve();
    });
    dbMock.transaction.mockReturnValue({
      store: txApi,
      done: Promise.resolve(),
    });
    txApi.getAll.mockImplementation(() =>
      Promise.resolve([...store.values()])
    );
    txApi.clear.mockImplementation(() => {
      store.clear();
      return Promise.resolve();
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    txApi.put.mockImplementation((item: any) => {
      store.set(item.id as string, item);
      return Promise.resolve();
    });
    txApi.delete.mockImplementation((id: string) => {
      store.delete(id);
      return Promise.resolve();
    });
  });

  // ── enqueue ──────────────────────────────────────────────────────────────

  describe('enqueue', () => {
    it('adds an item with a generated id, enqueuedAt timestamp, and retryCount 0', async () => {
      await enqueue({ model: 'Game', operation: 'update', payload: { id: 'g1' } });
      expect(store.size).toBe(1);
      const [item] = [...store.values()];
      expect(item.id).toBeTruthy();
      expect(item.retryCount).toBe(0);
      expect(item.enqueuedAt).toBeGreaterThan(0);
      expect(item.model).toBe('Game');
      expect(item.operation).toBe('update');
    });

    it('stores the ownerSub when provided', async () => {
      await enqueue({
        model: 'Game',
        operation: 'update',
        payload: { id: 'g1' },
        ownerSub: 'user-A',
      });
      const [item] = [...store.values()];
      expect(item.ownerSub).toBe('user-A');
    });

    it('throws when the queue has reached the 500-item capacity', async () => {
      dbMock.count.mockResolvedValue(500);
      await expect(
        enqueue({ model: 'Game', operation: 'update', payload: {} })
      ).rejects.toThrow('Offline queue is full');
    });

    it('does not add item when at capacity', async () => {
      dbMock.count.mockResolvedValue(500);
      await enqueue({ model: 'Game', operation: 'update', payload: {} }).catch(() => {});
      expect(dbMock.add).not.toHaveBeenCalled();
    });
  });

  // ── pendingCount ─────────────────────────────────────────────────────────

  describe('pendingCount', () => {
    it('returns 0 for an empty store', async () => {
      expect(await pendingCount()).toBe(0);
    });

    it('returns correct count after items are added', async () => {
      store.set('a', makeItem({ id: 'a' }));
      store.set('b', makeItem({ id: 'b' }));
      expect(await pendingCount()).toBe(2);
    });
  });

  // ── dequeueAll ───────────────────────────────────────────────────────────

  describe('dequeueAll', () => {
    it('returns items sorted oldest-first by enqueuedAt', async () => {
      const newer = makeItem({ id: 'newer', enqueuedAt: 2000 });
      const older = makeItem({ id: 'older', enqueuedAt: 1000 });
      store.set(newer.id, newer);
      store.set(older.id, older);

      const result = await dequeueAll();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('older');
      expect(result[1].id).toBe('newer');
    });

    it('clears the store after dequeuing', async () => {
      store.set('x', makeItem({ id: 'x' }));
      await dequeueAll();
      expect(store.size).toBe(0);
    });

    it('returns an empty array when the store is empty', async () => {
      expect(await dequeueAll()).toEqual([]);
    });
  });

  // ── requeueFailed ────────────────────────────────────────────────────────

  describe('requeueFailed', () => {
    it('re-adds the item with an incremented retryCount', async () => {
      const item = makeItem({ retryCount: 1 });
      await requeueFailed([item]);
      expect(store.get(item.id)?.retryCount).toBe(2);
    });

    it('drops items that have reached MAX_RETRIES (5)', async () => {
      const maxed = makeItem({ id: 'maxed', retryCount: 5 });
      const underLimit = makeItem({ id: 'ok', retryCount: 2 });
      await requeueFailed([maxed, underLimit]);
      expect(store.has('maxed')).toBe(false);
      expect(store.has('ok')).toBe(true);
    });

    it('drops all items when every item has exceeded max retries', async () => {
      await requeueFailed([
        makeItem({ retryCount: 5 }),
        makeItem({ retryCount: 10 }),
      ]);
      expect(store.size).toBe(0);
    });

    it('does nothing when the list is empty', async () => {
      await requeueFailed([]);
      expect(store.size).toBe(0);
    });
  });

  // ── requeuePreserved ─────────────────────────────────────────────────────

  describe('requeuePreserved', () => {
    it('puts items back without changing retryCount', async () => {
      const item = makeItem({ id: 'x', retryCount: 3 });
      await requeuePreserved([item]);
      expect(store.get('x')?.retryCount).toBe(3); // unchanged
    });

    it('restores multiple items', async () => {
      const a = makeItem({ id: 'a', retryCount: 0 });
      const b = makeItem({ id: 'b', retryCount: 2 });
      await requeuePreserved([a, b]);
      expect(store.size).toBe(2);
      expect(store.get('a')?.retryCount).toBe(0);
      expect(store.get('b')?.retryCount).toBe(2);
    });

    it('does nothing when the list is empty', async () => {
      await requeuePreserved([]);
      expect(store.size).toBe(0);
    });

    it('does NOT drop items at or above MAX_RETRIES (unlike requeueFailed)', async () => {
      const maxed = makeItem({ id: 'maxed', retryCount: 5 });
      await requeuePreserved([maxed]);
      // Must be preserved — retryCount is 5 but we never increment it
      expect(store.has('maxed')).toBe(true);
      expect(store.get('maxed')?.retryCount).toBe(5);
    });
  });

  // ── deduplicateGameUpdates ───────────────────────────────────────────────

  describe('deduplicateGameUpdates', () => {
    it('keeps only the most recent Game.update entry per gameId', async () => {
      const old = makeItem({ id: 'old', enqueuedAt: 100, payload: { id: 'game-A' } });
      const mid = makeItem({ id: 'mid', enqueuedAt: 200, payload: { id: 'game-A' } });
      const latest = makeItem({ id: 'latest', enqueuedAt: 300, payload: { id: 'game-A' } });
      for (const i of [old, mid, latest]) store.set(i.id, i);

      await deduplicateGameUpdates();

      expect(store.has('old')).toBe(false);
      expect(store.has('mid')).toBe(false);
      expect(store.has('latest')).toBe(true);
    });

    it('deduplicates independently per gameId', async () => {
      const a1 = makeItem({ id: 'a1', enqueuedAt: 100, payload: { id: 'game-A' } });
      const a2 = makeItem({ id: 'a2', enqueuedAt: 200, payload: { id: 'game-A' } });
      const b1 = makeItem({ id: 'b1', enqueuedAt: 100, payload: { id: 'game-B' } });
      const b2 = makeItem({ id: 'b2', enqueuedAt: 200, payload: { id: 'game-B' } });
      for (const i of [a1, a2, b1, b2]) store.set(i.id, i);

      await deduplicateGameUpdates();

      expect(store.size).toBe(2);
      expect(store.has('a2')).toBe(true);
      expect(store.has('b2')).toBe(true);
    });

    it('leaves non-Game.update items untouched', async () => {
      const goal = makeItem({ id: 'goal', model: 'Goal', operation: 'create', payload: {} });
      const ptr = makeItem({
        id: 'ptr',
        model: 'PlayTimeRecord',
        operation: 'update',
        payload: {},
      });
      store.set(goal.id, goal);
      store.set(ptr.id, ptr);

      await deduplicateGameUpdates();

      expect(store.size).toBe(2);
    });

    it('does not remove a single Game.update entry', async () => {
      const only = makeItem({ id: 'only', enqueuedAt: 100, payload: { id: 'game-A' } });
      store.set(only.id, only);

      await deduplicateGameUpdates();

      expect(store.has('only')).toBe(true);
    });

    it('no-ops on an empty queue', async () => {
      await expect(deduplicateGameUpdates()).resolves.toBeUndefined();
    });
  });
});
