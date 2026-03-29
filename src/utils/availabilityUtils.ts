type AvailabilityLike = {
  playerId: string;
  status?: string | null;
};

function findAvailabilityRecord(
  playerId: string,
  playerAvailabilities?: AvailabilityLike[] | null,
): AvailabilityLike | undefined {
  if (!playerAvailabilities || playerAvailabilities.length === 0) {
    return undefined;
  }
  return playerAvailabilities.find((availability) => availability.playerId === playerId);
}

export function getPlayerAvailabilityStatus(
  playerId: string,
  playerAvailabilities?: AvailabilityLike[] | null,
): string {
  return findAvailabilityRecord(playerId, playerAvailabilities)?.status ?? "available";
}

export function isPlayerInjured(
  playerId: string,
  playerAvailabilities?: AvailabilityLike[] | null,
): boolean {
  return getPlayerAvailabilityStatus(playerId, playerAvailabilities) === "injured";
}

export function isPlayerAvailable(
  playerId: string,
  playerAvailabilities?: AvailabilityLike[] | null,
): boolean {
  const status = getPlayerAvailabilityStatus(playerId, playerAvailabilities);
  return status !== "injured" && status !== "absent";
}
