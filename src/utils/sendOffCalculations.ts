import type { FormationPosition, GameNote } from "../components/GameManagement/types";

type SendOffNote = Pick<GameNote, "noteType" | "playerId" | "positionId" | "rescindedAt">;

export interface PendingSendOff {
  playerId: string;
  positionId: string | null;
}

/**
 * Send-offs this device has recorded whose card note hasn't round-tripped through
 * the subscription yet (always the case offline). Without them the lock and the
 * sent-off exclusion would silently not apply until reconnect.
 */
export function withPendingSendOffs(
  notes: readonly SendOffNote[],
  pending: readonly PendingSendOff[],
): SendOffNote[] {
  const cardedPlayerIds = new Set(
    notes.filter((note) => note.noteType === "red-card" && note.playerId).map((note) => note.playerId as string),
  );
  const synthetic = pending
    .filter((entry) => !cardedPlayerIds.has(entry.playerId))
    .map((entry) => ({ noteType: "red-card", playerId: entry.playerId, positionId: entry.positionId, rescindedAt: null }) as SendOffNote);
  return [...notes, ...synthetic];
}

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

interface SubLike {
  playerOutId: string;
  playerInId: string;
  positionId: string;
}

/**
 * Drops planned subs that can no longer happen once someone is sent off: the
 * incoming or outgoing player is carded, or the target position is locked.
 */
export function filterPlannedSubstitutions<T extends SubLike>(
  subs: readonly T[],
  lockedPositionIds: ReadonlySet<string>,
  sentOffPlayerIds: ReadonlySet<string>,
): T[] {
  return subs.filter(
    (sub) =>
      !lockedPositionIds.has(sub.positionId)
      && !sentOffPlayerIds.has(sub.playerInId)
      && !sentOffPlayerIds.has(sub.playerOutId),
  );
}

/**
 * Planned rotations as the coach should see them after a send-off: invalid subs
 * removed, and rotations that only held invalid subs dropped so the countdown and
 * rotation modal don't point at a rotation with nothing left to do.
 */
export function filterRotationsForSendOffs<T extends { plannedSubstitutions?: unknown }>(
  rotations: readonly T[],
  lockedPositionIds: ReadonlySet<string>,
  sentOffPlayerIds: ReadonlySet<string>,
): T[] {
  if (lockedPositionIds.size === 0 && sentOffPlayerIds.size === 0) return rotations as T[];
  const result: T[] = [];
  for (const rotation of rotations) {
    let subs: SubLike[];
    try {
      subs = JSON.parse(rotation.plannedSubstitutions as string);
    } catch {
      result.push(rotation);
      continue;
    }
    if (!Array.isArray(subs) || subs.length === 0) {
      result.push(rotation);
      continue;
    }
    const kept = filterPlannedSubstitutions(subs, lockedPositionIds, sentOffPlayerIds);
    if (kept.length === 0) continue;
    result.push(kept.length === subs.length ? rotation : { ...rotation, plannedSubstitutions: JSON.stringify(kept) });
  }
  return result;
}

export interface SendOffSummary {
  playerId: string;
  /** Game-clock seconds at which the card was shown. */
  sentOffSeconds: number;
  /** Seconds the team played a player down, from the card to the final whistle. */
  playedDownSeconds: number;
}

/** One entry per active (non-rescinded) send-off, in the order they happened. */
export function getSendOffSummaries(
  gameNotes: ReadonlyArray<SendOffNote & Pick<GameNote, "gameSeconds">>,
  gameEndSeconds: number,
): SendOffSummary[] {
  return gameNotes
    .filter((note) => isActiveSendOff(note))
    .map((note) => {
      const sentOffSeconds = Math.max(0, note.gameSeconds ?? 0);
      return {
        playerId: note.playerId as string,
        sentOffSeconds,
        playedDownSeconds: Math.max(0, gameEndSeconds - sentOffSeconds),
      };
    })
    .sort((a, b) => a.sentOffSeconds - b.sentOffSeconds);
}
