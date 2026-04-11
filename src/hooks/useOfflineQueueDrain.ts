import { useEffect, useRef } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { useNetworkStatus } from './useNetworkStatus';
import {
  pendingCount,
  dequeueAll,
  requeueFailed,
  requeuePreserved,
  deduplicateGameUpdates,
  type QueuedMutation,
} from '../services/offlineQueueService';

const client = generateClient<Schema>();

// Excludes GameNote — those use a custom secure mutation handled by GameManagement.
const DRAINABLE_MODELS = new Set([
  'Game',
  'PlayTimeRecord',
  'Substitution',
  'LineupAssignment',
  'Goal',
  'PlayerAvailability',
]);
const ALLOWED_OPS = new Set(['create', 'update', 'delete']);

function getSafeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

async function executeQueuedMutation(item: QueuedMutation): Promise<void> {
  if (!DRAINABLE_MODELS.has(item.model) || !ALLOWED_OPS.has(item.operation)) {
    throw new Error(`Disallowed model/operation in drain: ${item.model}.${item.operation}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = (client.models as Record<string, any>)[item.model];
  if (!m) throw new Error(`Unknown model in drain: ${item.model}`);
  switch (item.operation) {
    case 'create': await m.create(item.payload); return;
    case 'update': await m.update(item.payload); return;
    case 'delete': await m.delete(item.payload); return;
  }
}

async function drainQueue(): Promise<void> {
  let session;
  try {
    session = await fetchAuthSession({ forceRefresh: false });
  } catch {
    return; // Not authenticated — skip drain
  }

  const currentSub = session.tokens?.idToken?.payload?.sub as string | undefined;
  if (!currentSub) return;

  try {
    await deduplicateGameUpdates();
    const items = await dequeueAll();

    const crossUserHold: QueuedMutation[] = [];
    const actuallyFailed: QueuedMutation[] = [];
    // Items for models this drain can't handle (e.g. GameNote) are put back as-is
    const nonDrainable: QueuedMutation[] = [];

    for (const item of items) {
      if (!DRAINABLE_MODELS.has(item.model)) {
        nonDrainable.push(item);
        continue;
      }
      if (item.ownerSub && item.ownerSub !== currentSub) {
        crossUserHold.push(item);
        continue;
      }
      try {
        await executeQueuedMutation(item);
      } catch (err) {
        actuallyFailed.push(item);
        console.warn(
          `[useOfflineQueueDrain] Failed to replay ${item.model}.${item.operation}: ${getSafeErrorMessage(err)}`
        );
      }
    }

    if (nonDrainable.length > 0) await requeuePreserved(nonDrainable);
    if (crossUserHold.length > 0) await requeuePreserved(crossUserHold);
    if (actuallyFailed.length > 0) await requeueFailed(actuallyFailed);
  } catch (err) {
    console.error(`[useOfflineQueueDrain] Unexpected error during drain: ${getSafeErrorMessage(err)}`);
  }
}

/**
 * Lightweight hook that drains the offline mutation queue on startup and on
 * reconnect, even when GameManagement is not mounted. This ensures that
 * end-game mutations queued while offline are replayed when the user is back
 * on the Home screen (fixes games persisting as in-progress after ending
 * while offline).
 */
export function useOfflineQueueDrain(): void {
  const isDrainingRef = useRef(false);

  const maybeDrain = async () => {
    if (isDrainingRef.current) return;
    const count = await pendingCount().catch(() => 0);
    if (count === 0) return;
    isDrainingRef.current = true;
    try {
      await drainQueue();
    } finally {
      isDrainingRef.current = false;
    }
  };

  // Drain on startup if already online
  useEffect(() => {
    if (navigator.onLine) {
      void maybeDrain();
    }
  }, []); // empty deps: runs once on mount

  // Drain when coming back online
  useNetworkStatus({
    onReconnect: () => {
      void maybeDrain();
    },
  });
}
