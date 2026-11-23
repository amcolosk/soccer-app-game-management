import type { GameMutationInput } from "../hooks/useOfflineMutations";
import type { Game, LineupAssignment, PlayTimeRecord, Team } from "../components/GameManagement/types";
import { isMissingRecordError } from "./amplifyMutationResult";
import { cleanupDuplicateAssignmentsForPosition } from "./lineupCleanupService";

export interface SendOffTarget {
  assignment: LineupAssignment;
  positionId: string;
}

/** The starter slot a red-carded player is vacating, or null for a bench/unassigned player. */
export function findSendOffTarget(
  playerId: string,
  lineup: readonly LineupAssignment[],
): SendOffTarget | null {
  const assignment = lineup.find(
    (candidate) => candidate.playerId === playerId && candidate.isStarter && candidate.positionId,
  );
  if (!assignment?.positionId) return null;
  return { assignment, positionId: assignment.positionId };
}

export interface PerformSendOffParams {
  game: Pick<Game, "id">;
  team: Pick<Team, "coaches">;
  playerId: string;
  gameSeconds: number;
  half: number;
  notes: string | undefined;
  lineup: readonly LineupAssignment[];
  playTimeRecords: readonly PlayTimeRecord[];
  mutations: Pick<
    GameMutationInput,
    "createGameNote" | "updatePlayTimeRecord" | "deleteLineupAssignment"
  >;
}

export interface PerformSendOffResult {
  /** The card is recorded (and the position locked) but the lineup/play-time cleanup did not finish. */
  vacateFailed: boolean;
}

/**
 * Records a red card and takes the player off the field. The card note goes first:
 * it is the durable record that locks the position, so if a later step fails the
 * coach still has a correct send-off to finish by hand. There is no transaction
 * across these writes (none exists in this app); the failure is reported, not hidden.
 */
export async function performSendOff(params: PerformSendOffParams): Promise<PerformSendOffResult> {
  const { game, team, playerId, gameSeconds, half, notes, lineup, playTimeRecords, mutations } = params;
  const target = findSendOffTarget(playerId, lineup);

  await mutations.createGameNote({
    gameId: game.id,
    noteType: "red-card",
    playerId,
    ...(target ? { positionId: target.positionId } : {}),
    gameSeconds,
    half,
    notes,
    timestamp: new Date().toISOString(),
    coaches: team.coaches,
  });

  if (!target) return { vacateFailed: false };

  try {
    const openRecords = playTimeRecords.filter(
      (record) => record.playerId === playerId && record.endGameSeconds == null,
    );
    for (const record of openRecords) {
      await mutations.updatePlayTimeRecord(record.id, { endGameSeconds: gameSeconds });
    }

    try {
      await mutations.deleteLineupAssignment(target.assignment.id);
    } catch (error) {
      if (!isMissingRecordError(error)) throw error;
    }
    void cleanupDuplicateAssignmentsForPosition(
      game.id,
      target.positionId,
      target.assignment.createdAt,
    );
    return { vacateFailed: false };
  } catch (error) {
    console.warn("[sendOffService] Red card recorded but vacating the lineup failed.", error);
    return { vacateFailed: true };
  }
}
