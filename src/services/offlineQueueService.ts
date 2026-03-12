import { openDB, type IDBPDatabase } from 'idb';

export interface QueuedMutation {
  id: string;
  model: string;
  operation: 'create' | 'update' | 'delete';
  payload: Record<string, unknown>;
  enqueuedAt: number;
  retryCount: number;
  /** Cognito sub of the user who enqueued this mutation. Used to discard items
   * that were queued by a different user on a shared device. */
  ownerSub?: string;
}

const DB_NAME = 'teamtrack-offline';
const STORE_NAME = 'pending-mutations';
const DB_VERSION = 1;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dbPromise: Promise<IDBPDatabase<any>> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDB(): Promise<IDBPDatabase<any>> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

const MAX_QUEUE_SIZE = 500;

export async function enqueue(
  item: Omit<QueuedMutation, 'id' | 'enqueuedAt' | 'retryCount'>
): Promise<void> {
  const db = await getDB();
  const count = await db.count(STORE_NAME);
  if (count >= MAX_QUEUE_SIZE) {
    throw new Error('Offline queue is full (500 items). Please reconnect before continuing.');
  }
  const mutation: QueuedMutation = {
    ...item,
    id: crypto.randomUUID(),
    enqueuedAt: Date.now(),
    retryCount: 0,
  };
  await db.add(STORE_NAME, mutation);
}

export async function dequeueAll(): Promise<QueuedMutation[]> {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const items = await tx.store.getAll();
  await tx.store.clear();
  await tx.done;
  return items.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
}

const MAX_RETRIES = 5;

export async function requeueFailed(items: QueuedMutation[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  let dropped = 0;
  for (const item of items) {
    if (item.retryCount >= MAX_RETRIES) {
      dropped++;
      console.warn(`Dropping permanently-failed mutation after ${MAX_RETRIES} retries:`, item.model, item.operation);
      continue;
    }
    await tx.store.put({ ...item, retryCount: item.retryCount + 1 });
  }
  await tx.done;
  if (dropped > 0) {
    console.warn(`Dropped ${dropped} queued mutation(s) that exceeded max retry count.`);
  }
}

/**
 * Restores items to the queue exactly as-is, without incrementing retryCount.
 * Used to preserve cross-user mutations that were skipped (not failed) so they
 * can be replayed when the correct user returns.
 */
export async function requeuePreserved(items: QueuedMutation[]): Promise<void> {
  if (items.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  for (const item of items) {
    await tx.store.put(item); // put back unchanged — retryCount must not increment
  }
  await tx.done;
}

export async function pendingCount(): Promise<number> {
  const db = await getDB();
  return db.count(STORE_NAME);
}

/**
 * Collapses multiple Game.update entries for the same gameId into one (latest wins).
 * Prevents hundreds of timer-sync entries from replaying after a long offline period.
 */
export async function deduplicateGameUpdates(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const all = await tx.store.getAll();

  const gameUpdates = all.filter(
    (item) => item.model === 'Game' && item.operation === 'update'
  );

  const byGameId = new Map<string, QueuedMutation[]>();
  for (const item of gameUpdates) {
    const gameId = (item.payload as { id?: string }).id;
    if (!gameId) continue;
    if (!byGameId.has(gameId)) byGameId.set(gameId, []);
    byGameId.get(gameId)!.push(item);
  }

  for (const [, entries] of byGameId) {
    if (entries.length <= 1) continue;
    // Keep the entry with the highest enqueuedAt; delete the rest
    const sorted = [...entries].sort((a, b) => b.enqueuedAt - a.enqueuedAt);
    for (const item of sorted.slice(1)) {
      await tx.store.delete(item.id);
    }
  }

  await tx.done;
}
