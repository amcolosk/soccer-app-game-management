import type { FormationPosition, GameNote } from "../components/GameManagement/types";

type SendOffNote = Pick<GameNote, "noteType" | "playerId" | "positionId" | "rescindedAt">;

/** A red card against a specific player that has not been rescinded. */
export function isActiveSendOff(note: SendOffNote): boolean {
  return note.noteType === "red-card" && !!note.playerId && !note.rescindedAt;
}

export function getSentOffPlayerIds(gameNotes: readonly SendOffNote[]): Set<string> {
  const ids = new Set<string>();
  for (const note of gameNotes) {
    if (isActiveSendOff(note) && note.playerId) ids.add(note.playerId);
  }
  return ids;
}

/**
 * Positions that must stay empty for the rest of the game because the player in
 * them was sent off. A sent-off goalkeeper's slot is never locked: the team still
 * needs a keeper, so someone covers goal and the position they left is the gap.
 */
export function getLockedPositionIds(
  gameNotes: readonly SendOffNote[],
  positions: ReadonlyArray<Pick<FormationPosition, "id" | "role">>,
): Set<string> {
  const goalkeeperPositionIds = new Set(
    positions.filter((position) => position.role === "GOALKEEPER").map((position) => position.id),
  );
  const ids = new Set<string>();
  for (const note of gameNotes) {
    if (!isActiveSendOff(note) || !note.positionId) continue;
    if (goalkeeperPositionIds.has(note.positionId)) continue;
    ids.add(note.positionId);
  }
  return ids;
}
