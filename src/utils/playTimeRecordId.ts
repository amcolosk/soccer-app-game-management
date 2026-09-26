/**
 * Deterministic id for a PlayTimeRecord's opening create, shared by every
 * call site that opens one (game start, second-half start, substitution,
 * direct lineup assignment). Making the id addressable up front — rather
 * than letting the DB assign one — lets an offline-queued create be closed
 * by id later even before the create itself has reached DynamoDB or the
 * observeQuery subscription.
 */
export function buildDeterministicStartPlayTimeRecordId(params: {
  gameId: string;
  playerId: string;
  half: 1 | 2;
  startGameSeconds: number;
}): string {
  const { gameId, playerId, half, startGameSeconds } = params;
  return `ptr:${gameId}:${playerId}:h${half}:t${startGameSeconds}`;
}
