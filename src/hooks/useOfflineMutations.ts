import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import { fetchAuthSession } from 'aws-amplify/auth';
import type { Schema } from '../../amplify/data/resource';
import { showWarning } from '../utils/toast';
import {
  enqueue,
  dequeueAll,
  requeueFailed,
  requeuePreserved,
  pendingCount as getQueuePendingCount,
  deduplicateGameUpdates,
  type QueuedMutation,
} from '../services/offlineQueueService';
import { useNetworkStatus } from './useNetworkStatus';

const client = generateClient<Schema>();

// ── Typed input fields for each live-game mutation ──────────────────────────

export interface GameUpdateFields {
  status?: string | null;
  currentHalf?: number | null;
  lastStartTime?: string | null;
  elapsedSeconds?: number | null;
  ourScore?: number | null;
  opponentScore?: number | null;
}

export interface PlayTimeRecordCreateFields {
  gameId: string;
  playerId: string;
  positionId?: string | null;
  startGameSeconds: number;
  coaches?: string[] | null;
}

export interface PlayTimeRecordUpdateFields {
  endGameSeconds?: number | null;
}

export interface SubstitutionCreateFields {
  gameId: string;
  positionId?: string | null;
  playerOutId: string;
  playerInId: string;
  half?: number | null;
  gameSeconds: number;
  coaches?: string[] | null;
}

export interface LineupAssignmentCreateFields {
  gameId: string;
  playerId: string;
  positionId?: string | null;
  isStarter?: boolean | null;
  coaches?: string[] | null;
}

export interface LineupAssignmentUpdateFields {
  playerId?: string;
}

export interface GoalCreateFields {
  gameId: string;
  scoredByUs: boolean;
  gameSeconds: number;
  half?: number | null;
  scorerId?: string | null;
  assistId?: string | null;
  notes?: string | null;
  timestamp?: string | null;
  coaches?: string[] | null;
}

export interface GoalUpdateFields {
  scorerId?: string | null;
  assistId?: string | null;
  notes?: string | null;
}

export interface GameNoteCreateFields {
  gameId: string;
  noteType: 'coaching-point' | 'gold-star' | 'yellow-card' | 'red-card' | 'other';
  playerId?: string | null;
  // authorId is intentionally excluded — always derived from the authenticated session
  // in createGameNote() so callers cannot inject an arbitrary author identity.
  gameSeconds?: number | null;
  half?: number | null;
  notes?: string | null;
  timestamp?: string | null;
  coaches?: string[] | null;
}

export interface GameNoteUpdateFields {
  noteType?: 'coaching-point' | 'gold-star' | 'yellow-card' | 'red-card' | 'other';
  playerId?: string | null;
  notes?: string | null;
}

export interface PlayerAvailabilityCreateFields {
  gameId: string;
  playerId: string;
  status: string;
  markedAt: string;
  coaches?: string[] | null;
  availableUntilMinute?: number | null;
  notes?: string | null;
}

export interface PlayerAvailabilityUpdateFields {
  status?: string | null;
  availableUntilMinute?: number | null;
  markedAt?: string | null;
  notes?: string | null;
}

export interface GameMutationInput {
  updateGame: (id: string, fields: GameUpdateFields) => Promise<void>;
  createPlayTimeRecord: (fields: PlayTimeRecordCreateFields) => Promise<void>;
  updatePlayTimeRecord: (id: string, fields: PlayTimeRecordUpdateFields) => Promise<void>;
  createSubstitution: (fields: SubstitutionCreateFields) => Promise<void>;
  createLineupAssignment: (fields: LineupAssignmentCreateFields) => Promise<void>;
  deleteLineupAssignment: (id: string) => Promise<void>;
  updateLineupAssignment: (id: string, fields: LineupAssignmentUpdateFields) => Promise<void>;
  createGoal: (fields: GoalCreateFields) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;
  updateGoal: (id: string, fields: GoalUpdateFields) => Promise<void>;
  createGameNote: (fields: GameNoteCreateFields) => Promise<void>;
  updateGameNote: (id: string, fields: GameNoteUpdateFields) => Promise<void>;
  deleteGameNote: (id: string) => Promise<void>;
  createPlayerAvailability: (fields: PlayerAvailabilityCreateFields) => Promise<void>;
  updatePlayerAvailability: (id: string, fields: PlayerAvailabilityUpdateFields) => Promise<void>;
}

export interface UseOfflineMutationsResult {
  mutations: GameMutationInput;
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
}

// ── Replay a single queued mutation against the live API ─────────────────────

const ALLOWED_MODELS = new Set(['Game', 'PlayTimeRecord', 'Substitution', 'LineupAssignment', 'Goal', 'GameNote', 'PlayerAvailability']);
const ALLOWED_OPS = new Set(['create', 'update', 'delete']);

function getSafeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
}

function getGraphQLErrorMessage(result: { errors?: Array<{ message?: string | null }> } | undefined, fallback: string): string {
  const message = result?.errors?.[0]?.message;
  return message && message.length > 0 ? message : fallback;
}

type SecureGameNoteCreatePayload = {
  gameId: string;
  noteType: GameNoteCreateFields['noteType'];
  notes: string;
  playerId?: string | null;
  gameSeconds?: number | null;
  half?: number | null;
  timestamp?: string;
};

function sanitizeSecureCreateGameNotePayload(
  payload: GameNoteCreateFields & { authorId?: unknown }
): SecureGameNoteCreatePayload {
  const {
    authorId: _ignoredAuthorId,
    coaches: _ignoredCoaches,
    notes,
    timestamp,
    ...safePayload
  } = payload;
  void _ignoredAuthorId;
  void _ignoredCoaches;

  return {
    ...safePayload,
    notes: notes ?? '',
    ...(timestamp != null ? { timestamp } : {}),
  };
}

async function executeSecureCreateGameNote(
  payload: GameNoteCreateFields & { authorId?: unknown }
): Promise<void> {
  const safePayload = sanitizeSecureCreateGameNotePayload(payload);

  const result = await client.mutations.createSecureGameNote(safePayload);
  if (result.errors && result.errors.length > 0) {
    throw new Error(getGraphQLErrorMessage(result, 'Failed to create game note'));
  }
}

async function executeSecureUpdateGameNote(
  payload: { id: string } & GameNoteUpdateFields & { authorId?: unknown }
): Promise<void> {
  const { authorId: _ignoredAuthorId, ...safePayload } = payload;
  void _ignoredAuthorId;

  const result = await client.mutations.updateSecureGameNote(safePayload);
  if (result.errors && result.errors.length > 0) {
    throw new Error(getGraphQLErrorMessage(result, 'Failed to update game note'));
  }
}

async function executeSingleMutation(item: QueuedMutation): Promise<void> {
  if (!ALLOWED_MODELS.has(item.model) || !ALLOWED_OPS.has(item.operation)) {
    throw new Error(`Disallowed model/operation in offline queue: ${item.model}.${item.operation}`);
  }
  if (item.model === 'GameNote' && item.operation === 'create') {
    await executeSecureCreateGameNote(item.payload as unknown as GameNoteCreateFields & { authorId?: unknown });
    return;
  }
  if (item.model === 'GameNote' && item.operation === 'update') {
    await executeSecureUpdateGameNote(item.payload as unknown as { id: string } & GameNoteUpdateFields & { authorId?: unknown });
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = (client.models as Record<string, any>)[item.model];
  if (!m) throw new Error(`Unknown model in offline queue: ${item.model}`);
  switch (item.operation) {
    case 'create': await m.create(item.payload); return;
    case 'update': await m.update(item.payload); return;
    case 'delete': await m.delete(item.payload); return;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useOfflineMutations(): UseOfflineMutationsResult {
  const [queuedCount, setQueuedCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  // Ref so mutation callbacks don't need to re-create when isOnline changes
  const isOnlineRef = useRef(navigator.onLine);

  // Load initial count from IndexedDB on mount (persists across reloads)
  useEffect(() => {
    void getQueuePendingCount()
      .then(setQueuedCount)
      .catch(() => setQueuedCount(0));
  }, []);

  const drainQueue = useCallback(async () => {
    setIsSyncing(true);
    let session;
    try {
      session = await fetchAuthSession({ forceRefresh: true });
    } catch {
      showWarning('Please reconnect and refresh to sync offline changes');
      setIsSyncing(false);
      return;
    }

    // Extract the current user's identity to guard against cross-user replay
    // on shared devices (security fix: MAJOR-1).
    const currentSub = session.tokens?.idToken?.payload?.sub as string | undefined;

    try {
      await deduplicateGameUpdates();
      const items = await dequeueAll();

      // Separate cross-user items (must not count toward retryCount) from
      // items that genuinely failed to execute (should increment retryCount).
      const crossUserHold: QueuedMutation[] = [];
      const actuallyFailed: QueuedMutation[] = [];

      for (const item of items) {
        // Skip mutations queued by a different user session. Put them in
        // crossUserHold so they are restored as-is (retryCount unchanged).
        if (item.ownerSub && currentSub && item.ownerSub !== currentSub) {
          console.warn('Skipping queued mutation from a different user session — preserving for later replay.');
          crossUserHold.push(item);
          continue;
        }
        try {
          await executeSingleMutation(item);
        } catch (err) {
          actuallyFailed.push(item);
          console.warn(
            `[useOfflineMutations] Failed to replay queued mutation ${item.model}.${item.operation}: ${getSafeErrorMessage(err)}`
          );
        }
      }

      // Restore cross-user items without touching retryCount so they are never
      // dropped by MAX_RETRIES before the correct user can replay them.
      if (crossUserHold.length > 0) {
        await requeuePreserved(crossUserHold);
      }

      // Increment retryCount only for genuinely-failed execution attempts.
      if (actuallyFailed.length > 0) {
        await requeueFailed(actuallyFailed);
      }

      const remaining = await getQueuePendingCount();
      setQueuedCount(remaining);
    } catch (err) {
      console.error(`[useOfflineMutations] Unexpected error during offline queue drain: ${getSafeErrorMessage(err)}`);
    } finally {
      setIsSyncing(false);
    }
  }, []);

  const { isOnline } = useNetworkStatus({
    onReconnect: () => {
      void drainQueue();
    },
  });

  // Keep isOnlineRef in sync for use inside stable mutation callbacks
  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

  // ── Helper: route to direct API call or IndexedDB queue ──────────────────

  const enqueueOrRun = useCallback(
    async (
      model: string,
      operation: 'create' | 'update' | 'delete',
      payload: Record<string, unknown>,
      directFn: () => Promise<void>
    ): Promise<void> => {
      if (isOnlineRef.current) {
        await directFn();
      } else {
        // Capture the current user's sub so drain can reject items from other
        // sessions on shared devices (security fix: MAJOR-1).
        let ownerSub: string | undefined;
        try {
          const session = await fetchAuthSession();
          ownerSub = session.tokens?.idToken?.payload?.sub as string | undefined;
        } catch {
          // Unable to identify user — enqueue anyway; drain will check sub.
        }
        await enqueue({ model, operation, payload, ownerSub });
        setQueuedCount((prev) => prev + 1);
      }
    },
    []
  );

  // ── Mutation functions ────────────────────────────────────────────────────

  const updateGame = useCallback(
    async (id: string, fields: GameUpdateFields): Promise<void> => {
      await enqueueOrRun(
        'Game', 'update',
        { id, ...fields } as Record<string, unknown>,
        () => client.models.Game.update({ id, ...fields }).then(() => undefined)
      );
    },
    [enqueueOrRun]
  );

  const createPlayTimeRecord = useCallback(
    async (fields: PlayTimeRecordCreateFields): Promise<void> => {
      await enqueueOrRun(
        'PlayTimeRecord', 'create',
        fields as unknown as Record<string, unknown>,
        () => client.models.PlayTimeRecord.create(fields).then(() => undefined)
      );
    },
    [enqueueOrRun]
  );

  const updatePlayTimeRecord = useCallback(
    async (id: string, fields: PlayTimeRecordUpdateFields): Promise<void> => {
      await enqueueOrRun(
        'PlayTimeRecord', 'update',
        { id, ...fields } as Record<string, unknown>,
        () => client.models.PlayTimeRecord.update({ id, ...fields }).then(() => undefined)
      );
    },
    [enqueueOrRun]
  );

  const createSubstitution = useCallback(
    async (fields: SubstitutionCreateFields): Promise<void> => {
      await enqueueOrRun(
        'Substitution', 'create',
        fields as unknown as Record<string, unknown>,
        () => client.models.Substitution.create(fields).then(() => undefined)
      );
    },
    [enqueueOrRun]
  );

  const createLineupAssignment = useCallback(
    async (fields: LineupAssignmentCreateFields): Promise<void> => {
      await enqueueOrRun(
        'LineupAssignment', 'create',
        fields as unknown as Record<string, unknown>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => client.models.LineupAssignment.create(fields as any).then(() => undefined)
      );
    },
    [enqueueOrRun]
  );

  const deleteLineupAssignment = useCallback(
    async (id: string): Promise<void> => {
      await enqueueOrRun(
        'LineupAssignment', 'delete',
        { id },
        () => client.models.LineupAssignment.delete({ id }).then(() => undefined)
      );
    },
    [enqueueOrRun]
  );

  const updateLineupAssignment = useCallback(
    async (id: string, fields: LineupAssignmentUpdateFields): Promise<void> => {
      await enqueueOrRun(
        'LineupAssignment', 'update',
        { id, ...fields } as Record<string, unknown>,
        () => client.models.LineupAssignment.update({ id, ...fields }).then(() => undefined)
      );
    },
    [enqueueOrRun]
  );

  const createGoal = useCallback(
    async (fields: GoalCreateFields): Promise<void> => {
      await enqueueOrRun(
        'Goal', 'create',
        fields as unknown as Record<string, unknown>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => client.models.Goal.create(fields as any).then(() => undefined)
      );
    },
    [enqueueOrRun]
  );

  const deleteGoal = useCallback(
    async (id: string): Promise<void> => {
      await enqueueOrRun(
        'Goal', 'delete',
        { id },
        () => client.models.Goal.delete({ id }).then(() => undefined)
      );
    },
    [enqueueOrRun]
  );

  const updateGoal = useCallback(
    async (id: string, fields: GoalUpdateFields): Promise<void> => {
      const { scorerId, assistId, notes } = fields;
      const safeFields = { scorerId, assistId, notes };
      await enqueueOrRun(
        'Goal', 'update',
        { id, ...safeFields } as Record<string, unknown>,
        () => client.models.Goal.update({ id, ...safeFields }).then(() => undefined)
      );
    },
    [enqueueOrRun]
  );

  const createGameNote = useCallback(
    async (fields: GameNoteCreateFields): Promise<void> => {
      const { authorId: _strippedAuthorId, coaches: _strippedCoaches, ...safeFields } = fields as GameNoteCreateFields & {
        authorId?: unknown;
      };
      void _strippedAuthorId;
      void _strippedCoaches;

      await enqueueOrRun(
        'GameNote', 'create',
        safeFields as unknown as Record<string, unknown>,
        () => executeSecureCreateGameNote(safeFields)
      );
    },
    [enqueueOrRun]
  );

  const updateGameNote = useCallback(
    async (id: string, fields: GameNoteUpdateFields): Promise<void> => {
      // Explicitly strip authorId to prevent mutation of existing attribution,
      // even if callers somehow supply it via an untyped object at runtime.
      const { authorId: _stripped, ...safeFields } = fields as GameNoteUpdateFields & { authorId?: unknown };
      void _stripped; // unused — intentionally discarded
      await enqueueOrRun(
        'GameNote', 'update',
        { id, ...safeFields } as Record<string, unknown>,
        () => executeSecureUpdateGameNote({ id, ...safeFields })
      );
    },
    [enqueueOrRun]
  );

  const deleteGameNote = useCallback(
    async (id: string): Promise<void> => {
      await enqueueOrRun(
        'GameNote', 'delete',
        { id },
        () => client.models.GameNote.delete({ id }).then(() => undefined)
      );
    },
    [enqueueOrRun]
  );

  const createPlayerAvailability = useCallback(
    async (fields: PlayerAvailabilityCreateFields): Promise<void> => {
      await enqueueOrRun(
        'PlayerAvailability', 'create',
        fields as unknown as Record<string, unknown>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => client.models.PlayerAvailability.create(fields as any).then(() => undefined)
      );
    },
    [enqueueOrRun]
  );

  const updatePlayerAvailability = useCallback(
    async (id: string, fields: PlayerAvailabilityUpdateFields): Promise<void> => {
      await enqueueOrRun(
        'PlayerAvailability', 'update',
        { id, ...fields } as Record<string, unknown>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => client.models.PlayerAvailability.update({ id, ...fields } as any).then(() => undefined)
      );
    },
    [enqueueOrRun]
  );

  const mutations = useMemo(
    (): GameMutationInput => ({
      updateGame,
      createPlayTimeRecord,
      updatePlayTimeRecord,
      createSubstitution,
      createLineupAssignment,
      deleteLineupAssignment,
      updateLineupAssignment,
      createGoal,
      deleteGoal,
      updateGoal,
      createGameNote,
      updateGameNote,
      deleteGameNote,
      createPlayerAvailability,
      updatePlayerAvailability,
    }),
    [
      updateGame, createPlayTimeRecord, updatePlayTimeRecord, createSubstitution,
      createLineupAssignment, deleteLineupAssignment, updateLineupAssignment,
      createGoal, deleteGoal, updateGoal, createGameNote, updateGameNote, deleteGameNote,
      createPlayerAvailability, updatePlayerAvailability,
    ]
  );

  return { mutations, isOnline, pendingCount: queuedCount, isSyncing };
}
