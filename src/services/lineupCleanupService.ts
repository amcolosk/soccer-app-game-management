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
 * Called after a position's visible assignment is deleted (or found already
 * gone) so any other assignment still pointing at that position is deleted
 * too, rather than just hidden. Queries directly (bypassing the offline
 * mutation queue, like useGameSubscriptions.ts's own game-plan sync) since
 * this is opportunistic tidying, not the primary write the coach is waiting
 * on — a failure here must never surface as "clearing the position failed".
 */
export async function cleanupDuplicateAssignmentsForPosition(
  gameId: string,
  positionId: string,
  keepAssignmentId?: string | null,
): Promise<void> {
  try {
    const { data } = await client.models.LineupAssignment.list({
      filter: { gameId: { eq: gameId }, positionId: { eq: positionId } },
    });

    const orphans = data.filter((assignment) => assignment.id !== keepAssignmentId);
    if (orphans.length === 0) return;

    await Promise.all(
      orphans.map(async (orphan) => {
        try {
          await client.models.LineupAssignment.delete({ id: orphan.id });
          console.warn(
            `[lineupCleanupService] Deleted orphaned LineupAssignment id=${orphan.id} `
            + `(positionId=${positionId}, playerId=${orphan.playerId ?? '(none)'}) left behind after clearing this position (issue #215).`
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
