import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { isMissingRecordError } from "./amplifyMutationResult";

const client = generateClient<Schema>();

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
    const { data } = await client.models.LineupAssignment.list({
      filter: { gameId: { eq: gameId }, positionId: { eq: positionId } },
    });

    const orphans = data.filter(
      (assignment) => (assignment.createdAt ?? '') < deletedAssignmentCreatedAt,
    );
    if (orphans.length === 0) return;

    await Promise.all(
      orphans.map(async (orphan) => {
        try {
          await client.models.LineupAssignment.delete({ id: orphan.id });
          console.warn(
            `[lineupCleanupService] Deleted orphaned LineupAssignment id=${orphan.id} `
            + `(positionId=${positionId}, playerId=${orphan.playerId ?? '(none)'}, createdAt=${orphan.createdAt ?? '(none)'}) `
            + `left behind after clearing this position (issue #215).`
          );
        } catch (error) {
          if (isMissingRecordError(error)) return;
          console.warn(`[lineupCleanupService] Failed to delete orphaned assignment id=${orphan.id}`, error);
        }
      }),
    );
  } catch (error) {
    console.warn(`[lineupCleanupService] Failed to query for orphaned assignments (gameId=${gameId}, positionId=${positionId})`, error);
  }
}
