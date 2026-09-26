import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import type { PlayTimeRecord } from "../types/schema";
import type { GameMutationInput } from "../hooks/useOfflineMutations";
import { buildDeterministicStartPlayTimeRecordId } from "../utils/playTimeRecordId";

const client = generateClient<Schema>();

type PlayTimeRecordIndexPage = {
  data?: unknown;
  nextToken?: string | null;
  errors?: Array<{ message?: string | null }>;
};

/**
 * Paginates through the gameId secondary index (amplify/data/resource.ts:
 * index('gameId').queryField('listPlayTimeRecordsByGameId')) rather than a
 * filtered Scan — the Scan this replaced needed multiple pages to find matches
 * because it scanned the whole table, which also widened the offline race
 * window this file's two-phase close exists to cover.
 *
 * Cast the same way SeasonReport.tsx's equivalent query does — the generated
 * client type for a custom index query field doesn't expose a clean call
 * signature directly on the model.
 */
async function fetchPlayTimeRecordsByGameId(gameId: string): Promise<PlayTimeRecord[]> {
  const items: PlayTimeRecord[] = [];
  let nextToken: string | null | undefined = undefined;

  const playTimeModel = client.models.PlayTimeRecord as typeof client.models.PlayTimeRecord & {
    listPlayTimeRecordsByGameId?: (args: {
      gameId: string;
      limit?: number;
      nextToken?: string;
    }) => Promise<PlayTimeRecordIndexPage>;
  };

  if (typeof playTimeModel.listPlayTimeRecordsByGameId !== 'function') {
    throw new Error('PlayTimeRecord gameId index query is not available on the generated client');
  }

  do {
    const response: PlayTimeRecordIndexPage = await playTimeModel.listPlayTimeRecordsByGameId({
      gameId,
      limit: 1000,
      ...(nextToken ? { nextToken } : {}),
    });
    if (response.errors && response.errors.length > 0) {
      throw new Error(response.errors[0]?.message ?? 'Failed to query PlayTimeRecords by gameId index');
    }
    if (Array.isArray(response.data)) {
      items.push(...(response.data as PlayTimeRecord[]));
    }
    nextToken = response.nextToken;
  } while (nextToken);

  return items;
}

function isMissingRecordError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|does not exist|cannot find/i.test(message);
}

/**
 * Closes active play time records for specified players or all active records.
 *
 * Uses BOTH the in-memory array AND a fresh DB query to ensure no records are missed.
 * This fixes a race condition where records created by executeSubstitution may not
 * yet be reflected in the React state (updated via observeQuery subscriptions).
 *
 * This is now a CROSS-DEVICE BACKSTOP: the primary close path for records this
 * device itself opened is GameMutationInput.closeAllOpenPlayTimeRecords
 * (useOfflineMutations.ts), which tracks open records locally and doesn't
 * depend on this DB read succeeding. This function still matters for a record
 * opened on a *different* coach's device, which the local map can't know
 * about — that case still needs connectivity to see.
 *
 * @param playTimeRecords - All play time records from React state (may be stale)
 * @param endGameSeconds - The game time to mark as end time
 * @param playerIds - Optional array of player IDs to close records for. If not provided, closes all active records
 * @param gameId - Optional game ID to query DB for active records (recommended for accuracy)
 */
export async function closeActivePlayTimeRecords(
  playTimeRecords: PlayTimeRecord[],
  endGameSeconds: number,
  playerIds?: string[],
  gameId?: string,
  mutations?: GameMutationInput
): Promise<void> {
  // Start with in-memory records
  const allRecords = [...playTimeRecords];

  // If gameId provided, also query DB to catch any records not yet in React state
  // (e.g. opened on a different coach's device).
  if (gameId) {
    try {
      const allDbRecords = await fetchPlayTimeRecordsByGameId(gameId);
      if (allDbRecords.length > 0) {
        // Merge: add any DB records not already in the in-memory array
        const existingIds = new Set(allRecords.map(r => r.id));
        for (const dbRecord of allDbRecords) {
          if (!existingIds.has(dbRecord.id)) {
            console.log(`Found record in DB not in React state: player ${dbRecord.playerId}, start ${dbRecord.startGameSeconds}s`);
            allRecords.push(dbRecord);
          }
        }
      }
      console.log(`DB query found ${allDbRecords.length} total records for game ${gameId}`);
    } catch (error) {
      console.warn('Failed to query DB for play time records, using in-memory only:', error);
    }
  }

  const activeRecords = allRecords.filter(r => {
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
    if (mutations) {
      return mutations.updatePlayTimeRecord(record.id, { endGameSeconds });
    }
    return client.models.PlayTimeRecord.update({
      id: record.id,
      endGameSeconds: endGameSeconds,
    });
  });

  await Promise.all(endPromises);
  console.log('All play time records closed successfully');

  // Retry: DynamoDB reads are eventually consistent, so records written very
  // recently (e.g., by executeSubstitution seconds before End Game) may not
  // appear in the first query. Wait briefly and re-query to catch stragglers.
  if (gameId) {
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      const retryRecords = await fetchPlayTimeRecordsByGameId(gameId);
      const stillActive = retryRecords.filter(r =>
        (r.endGameSeconds === null || r.endGameSeconds === undefined) &&
        (!playerIds || playerIds.length === 0 || playerIds.includes(r.playerId))
      );
      if (stillActive.length > 0) {
        console.log(`Retry: closing ${stillActive.length} records missed by first pass`);
        await Promise.all(stillActive.map(r => mutations
          ? mutations.updatePlayTimeRecord(r.id, { endGameSeconds })
          : client.models.PlayTimeRecord.update({ id: r.id, endGameSeconds: endGameSeconds })
        ));
      }
    } catch (error) {
      console.warn('Retry scan failed:', error);
    }
  }
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
  coaches: string[],
  mutations: GameMutationInput
): Promise<void> {
  console.log(`Executing substitution: ${oldPlayerId} OUT, ${newPlayerId} IN at position ${positionId}`);

  // 1. End play time for outgoing player
  let activeRecord = playTimeRecords.find(
    r => r.playerId === oldPlayerId &&
    r.positionId === positionId &&
    (r.endGameSeconds === null || r.endGameSeconds === undefined)
  );

  // If not found in the passed-in records (possibly stale React state),
  // do a fresh DB query to catch records not yet reflected in subscriptions
  if (!activeRecord) {
    console.warn(`Active play time record for player ${oldPlayerId} not found in React state — querying DB`);
    try {
      const dbRecords = await fetchPlayTimeRecordsByGameId(gameId);
      activeRecord = dbRecords.find(
        r => r.playerId === oldPlayerId &&
        r.positionId === positionId &&
        (r.endGameSeconds === null || r.endGameSeconds === undefined)
      );
    } catch (error) {
      console.warn('DB query for active play time record failed:', error);
    }
  }

  if (activeRecord) {
    console.log(`Ending play time record ${activeRecord.id} at ${currentGameSeconds}s`);
    await mutations.updatePlayTimeRecord(activeRecord.id, { endGameSeconds: currentGameSeconds });
  } else {
    console.warn(`No active play time record found for player ${oldPlayerId} at position ${positionId}`);
  }

  // 2. Remove old lineup assignment
  // A caller may pass an oldAssignmentId that's already gone — e.g. a coach
  // clears a halftime slot (an optimistic, immediate delete) and then taps
  // that same slot to assign a replacement before the subscription echoes
  // the delete back into the lineup the substitution flow read from. The
  // assignment already being gone is exactly the outcome we want here, so
  // treat it as success and continue seating the new player. Any other
  // failure (network, auth, etc.) still aborts the substitution.
  console.log(`Removing lineup assignment ${oldAssignmentId}`);
  try {
    await mutations.deleteLineupAssignment(oldAssignmentId);
  } catch (error) {
    if (!isMissingRecordError(error)) {
      throw error;
    }
    console.log(`Lineup assignment ${oldAssignmentId} was already removed — continuing`);
  }

  // 3. Create new lineup assignment
  console.log(`Creating new lineup assignment for player ${newPlayerId}`);
  await mutations.createLineupAssignment({
    gameId: gameId,
    playerId: newPlayerId,
    positionId: positionId,
    isStarter: true,
    coaches: coaches,
  });

  // 4. Start play time for incoming player
  console.log(`Creating play time record for player ${newPlayerId} starting at ${currentGameSeconds}s`);
  await mutations.createPlayTimeRecord({
    id: buildDeterministicStartPlayTimeRecordId({
      gameId,
      playerId: newPlayerId,
      half: currentHalf === 2 ? 2 : 1,
      startGameSeconds: currentGameSeconds,
    }),
    gameId: gameId,
    playerId: newPlayerId,
    positionId: positionId,
    startGameSeconds: currentGameSeconds,
    coaches: coaches,
  });

  // 5. Record the substitution
  console.log(`Recording substitution in database`);
  await mutations.createSubstitution({
    gameId: gameId,
    positionId: positionId,
    playerOutId: oldPlayerId,
    playerInId: newPlayerId,
    half: currentHalf,
    gameSeconds: currentGameSeconds,
    coaches: coaches,
  });

  console.log('Substitution completed successfully');
}
