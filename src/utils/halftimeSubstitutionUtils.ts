import type { PlannedSubstitution } from "../services/rotationPlannerService";

interface StarterAssignment {
  id: string;
  playerId?: string | null;
  positionId?: string | null;
  isStarter?: boolean | null;
}

export interface HalftimeLineupChanges {
  /** LineupAssignment ids to delete (outgoing players, and the old spot of any player who moves). */
  deleteAssignmentIds: string[];
  /** New starter assignments to create, at most one per position and one per player. */
  createAssignments: Array<{ playerId: string; positionId: string }>;
  /** Substitution records to write, relative to the lineup before this batch. */
  substitutions: Array<{ positionId: string; playerOutId: string; playerInId: string }>;
  /** Subs that conflict with an earlier sub in the same batch and were not applied. */
  skipped: PlannedSubstitution[];
  /** Positions that were filled before this batch and are empty after it (a player moved away). */
  vacatedPositionIds: string[];
}

/**
 * Resolves a batch of halftime planned substitutions against the current
 * starters into one set of lineup writes that keeps every player in at most
 * one position and every position with at most one player.
 *
 * Planned halftime rotations can contain position changes: a player who is
 * `playerOutId` of one sub and `playerInId` of another (e.g. A moves LB -> RB).
 * Applying the "A in at RB" sub must therefore also vacate A's current spot,
 * and the "C in at LB" sub must be able to fill LB even after it's vacated.
 */
export function planHalftimeLineupChanges(
  lineup: StarterAssignment[],
  subs: PlannedSubstitution[],
): HalftimeLineupChanges {
  const occupantByPosition = new Map<string, { playerId: string; assignmentId: string | null }>();
  const originalPlayerByPosition = new Map<string, string>();
  for (const assignment of lineup) {
    if (!assignment.isStarter || !assignment.playerId || !assignment.positionId) continue;
    occupantByPosition.set(assignment.positionId, { playerId: assignment.playerId, assignmentId: assignment.id });
    originalPlayerByPosition.set(assignment.positionId, assignment.playerId);
  }

  const deleteAssignmentIds: string[] = [];
  const createdByPosition = new Map<string, string>();
  // Positions/players already settled by an earlier sub in this batch (applied
  // now, or already in place) — a later sub touching them is a plan conflict.
  const claimedPositions = new Set<string>();
  const placedPlayers = new Set<string>();
  const substitutions: HalftimeLineupChanges["substitutions"] = [];
  const skipped: PlannedSubstitution[] = [];

  const vacate = (positionId: string) => {
    const occupant = occupantByPosition.get(positionId);
    if (occupant?.assignmentId) deleteAssignmentIds.push(occupant.assignmentId);
    occupantByPosition.delete(positionId);
  };

  for (const sub of subs) {
    const { positionId, playerInId } = sub;
    if (!positionId || !playerInId) continue;
    if (claimedPositions.has(positionId) || placedPlayers.has(playerInId)) {
      skipped.push(sub);
      continue;
    }
    claimedPositions.add(positionId);
    placedPlayers.add(playerInId);

    // Position change: free every other spot the incoming player holds.
    for (const [otherPositionId, occupant] of Array.from(occupantByPosition.entries())) {
      if (occupant.playerId === playerInId && otherPositionId !== positionId) {
        vacate(otherPositionId);
      }
    }

    if (occupantByPosition.get(positionId)?.playerId === playerInId) continue; // already applied
    vacate(positionId);

    occupantByPosition.set(positionId, { playerId: playerInId, assignmentId: null });
    createdByPosition.set(positionId, playerInId);

    // A position emptied by an earlier Apply (its player moved) has no original
    // occupant; fall back to the plan's outgoing player so the Substitution
    // history matches applying the whole plan at once.
    const playerOutId = originalPlayerByPosition.get(positionId) ?? sub.playerOutId;
    if (playerOutId && playerOutId !== playerInId) {
      substitutions.push({ positionId, playerOutId, playerInId });
    }
  }

  const vacatedPositionIds = Array.from(originalPlayerByPosition.keys())
    .filter((positionId) => !occupantByPosition.has(positionId));

  return {
    deleteAssignmentIds,
    createAssignments: Array.from(createdByPosition, ([positionId, playerId]) => ({ playerId, positionId })),
    substitutions,
    skipped,
    vacatedPositionIds,
  };
}
