import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { isMissingRecordError } from "./amplifyMutationResult";
import { listAll } from "../utils/listAll";

const client = generateClient<Schema>();

async function deleteAssignments(
  orphans: Array<{ id: string; positionId?: string | null; playerId?: string | null; createdAt?: string | null }>,
): Promise<void> {
  await Promise.all(
    orphans.map(async (orphan) => {
      try {
        await client.models.LineupAssignment.delete({ id: orphan.id });
        console.warn(
          `[lineupCleanupService] Deleted orphaned LineupAssignment id=${orphan.id} `
          + `(positionId=${orphan.positionId ?? '(none)'}, playerId=${orphan.playerId ?? '(none)'}, createdAt=${orphan.createdAt ?? '(none)'}) `
          + `left behind after clearing this position (issue #215).`
        );
      } catch (error) {
        if (isMissingRecordError(error)) return;
        console.warn(`[lineupCleanupService] Failed to delete orphaned assignment id=${orphan.id}`, error);
      }
    }),
  );
}

/**
 * Deletes known orphaned LineupAssignment rows by id, for a caller that already
 * has the rows in hand (e.g. from a query it's already subscribed to) and so
 * doesn't need — and must not pay the cost or pagination risk of — a fresh
 * `list()` query. See `cleanupDuplicateAssignmentsForPosition` below for the
 * query-based variant and the safety invariant both share: only pass rows that
 * are strictly older than whatever this position's currently-visible/kept
 * assignment is, never same-or-newer (a legitimate concurrent write).
 */
export async function deleteOrphanedAssignments(
  orphans: Array<{ id: string; positionId?: string | null; playerId?: string | null; createdAt?: string | null }>,
): Promise<void> {
  if (orphans.length === 0) return;
  await deleteAssignments(orphans);
}

/**
 * Best-effort cleanup for issue #215: `useGameSubscriptions.ts`'s lineup dedup
 * hides every LineupAssignment for a position except the most-recently-created
 * one (an orphan left behind by, e.g., a failed delete during a substitution —
 * see that file's own comment). Hiding is enough for display, but if a coach
 * then clears the position the coach can see, deleting only that one visible
 * assignment unmasks the orphan underneath it — the position looks like it
 * never cleared, showing whatever player the orphan still references.
 *
 * Called after a position's visible assignment (the one with the latest
 * `createdAt` for that position, per the dedup logic above) is deleted or
 * found already gone, so any OLDER assignment still pointing at that position
 * — a true orphan, by the same "latest wins" logic that was hiding it — is
 * deleted too, rather than just hidden.
 *
 * `deletedAssignmentCreatedAt` anchors this: only a row strictly older than
 * the one the coach's own action just removed is a candidate. A row at or
 * after that timestamp was NOT the one being displayed and cleared — it can
 * only be a legitimate write that landed concurrently (another coach's
 * substitution, a queued offline write draining) or after, and must never be
 * swept up here; deleting it would silently undo someone else's action with
 * the exact "no error, nothing visibly happened" symptom this fix exists to
 * remove. When the caller doesn't have a timestamp to anchor on, this is a
 * no-op rather than guessing. Known residual gap: an orphan sharing the exact
 * same `createdAt` millisecond as the cleared assignment (e.g. two rapid
 * creates from an offline-queue drain) won't be caught by the strict `<`
 * below and can still resurface — accepted, since the alternative (`<=`)
 * risks the false positive above, which is the worse failure mode.
 *
 * Uses `listAll` (not a single `.list()` page) since LineupAssignment has no
 * gameId/positionId index — this filter is a scan, and a true orphan can land
 * on a later page than the first, silently surviving a single-page query.
 *
 * Queries directly (bypassing the offline mutation queue, like
 * useGameSubscriptions.ts's own game-plan sync) since this is opportunistic
 * tidying, not the primary write the coach is waiting on — a failure here
 * must never surface as "clearing the position failed".
 */
export async function cleanupDuplicateAssignmentsForPosition(
  gameId: string,
  positionId: string,
  deletedAssignmentCreatedAt: string | null | undefined,
): Promise<void> {
  if (!deletedAssignmentCreatedAt) return;

  try {
    const data = await listAll<{ id: string; positionId?: string | null; playerId?: string | null; createdAt?: string | null }>(
      client.models.LineupAssignment as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      { gameId: { eq: gameId }, positionId: { eq: positionId } },
    );

    const orphans = data.filter(
      (assignment) => (assignment.createdAt ?? '') < deletedAssignmentCreatedAt,
    );
    if (orphans.length === 0) return;

    await deleteAssignments(orphans);
  } catch (error) {
    console.warn(`[lineupCleanupService] Failed to query for orphaned assignments (gameId=${gameId}, positionId=${positionId})`, error);
  }
}
