import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

type PlayTimeRecord = Schema["PlayTimeRecord"]["type"];

/**
 * Closes active play time records for specified players or all active records
 * @param playTimeRecords - All play time records
 * @param endGameSeconds - The game time to mark as end time
 * @param playerIds - Optional array of player IDs to close records for. If not provided, closes all active records
 */
export async function closeActivePlayTimeRecords(
  playTimeRecords: PlayTimeRecord[],
  endGameSeconds: number,
  playerIds?: string[]
): Promise<void> {
  const activeRecords = playTimeRecords.filter(r => {
    const isActive = r.endGameSeconds === null || r.endGameSeconds === undefined;
    if (!isActive) return false;
    
    // If playerIds specified, only include those players
    if (playerIds && playerIds.length > 0) {
      return playerIds.includes(r.playerId);
    }
    
    return true;
  });

  console.log(`Closing ${activeRecords.length} active play time records at ${endGameSeconds}s`);

  const endPromises = activeRecords.map(async (record) => {
    const duration = endGameSeconds - record.startGameSeconds;
    console.log(`Closing record for player ${record.playerId}, duration: ${duration}s`);
    
    return client.models.PlayTimeRecord.update({
      id: record.id,
      endGameSeconds: endGameSeconds,
    });
  });

  await Promise.all(endPromises);
  console.log('All play time records closed successfully');
}

/**
 * Executes a substitution by:
 * 1. Ending play time for the outgoing player
 * 2. Removing old lineup assignment
 * 3. Creating new lineup assignment for incoming player
 * 4. Starting play time for incoming player
 * 5. Recording the substitution
 * 
 * @param gameId - The game ID
 * @param oldPlayerId - Player being substituted out
 * @param newPlayerId - Player being substituted in
 * @param positionId - Position for the substitution
 * @param currentGameSeconds - Current game time in seconds
 * @param currentHalf - Current half (1 or 2)
 * @param playTimeRecords - All play time records to find active record
 * @param oldAssignmentId - ID of the lineup assignment to remove
 * @param coaches - Array of coach user IDs for authorization
 * @returns Promise that resolves when substitution is complete
 */
export async function executeSubstitution(
  gameId: string,
  oldPlayerId: string,
  newPlayerId: string,
  positionId: string,
  currentGameSeconds: number,
  currentHalf: number,
  playTimeRecords: PlayTimeRecord[],
  oldAssignmentId: string,
  coaches: string[]
): Promise<void> {
  console.log(`Executing substitution: ${oldPlayerId} OUT, ${newPlayerId} IN at position ${positionId}`);

  // 1. End play time for outgoing player
  const activeRecord = playTimeRecords.find(
    r => r.playerId === oldPlayerId && 
    r.positionId === positionId &&
    (r.endGameSeconds === null || r.endGameSeconds === undefined)
  );

  if (activeRecord) {
    console.log(`Ending play time record ${activeRecord.id} at ${currentGameSeconds}s`);
    await client.models.PlayTimeRecord.update({
      id: activeRecord.id,
      endGameSeconds: currentGameSeconds,
    });
  } else {
    console.warn(`No active play time record found for player ${oldPlayerId} at position ${positionId}`);
  }

  // 2. Remove old lineup assignment
  console.log(`Removing lineup assignment ${oldAssignmentId}`);
  await client.models.LineupAssignment.delete({ id: oldAssignmentId });

  // 3. Create new lineup assignment
  console.log(`Creating new lineup assignment for player ${newPlayerId}`);
  await client.models.LineupAssignment.create({
    gameId: gameId,
    playerId: newPlayerId,
    positionId: positionId,
    isStarter: false,
    coaches: coaches, // Copy coaches array from team
  });

  // 4. Start play time for incoming player
  console.log(`Creating play time record for player ${newPlayerId} starting at ${currentGameSeconds}s`);
  await client.models.PlayTimeRecord.create({
    gameId: gameId,
    playerId: newPlayerId,
    positionId: positionId,
    startGameSeconds: currentGameSeconds,
    coaches: coaches, // Copy coaches array from team
  });

  // 5. Record the substitution
  console.log(`Recording substitution in database`);
  await client.models.Substitution.create({
    gameId: gameId,
    positionId: positionId,
    playerOutId: oldPlayerId,
    playerInId: newPlayerId,
    half: currentHalf,
    gameSeconds: currentGameSeconds,
    coaches: coaches, // Copy coaches array from team
  });

  console.log('Substitution completed successfully');
}
