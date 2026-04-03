import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../../data/resource';

type DbItem = Record<string, unknown> & { id: string };

type SnapshotRecord = {
  tableName: string;
  item: DbItem;
};

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

async function scanAll(tableName: string, filterExpression: string, expressionAttributeValues: Record<string, unknown>): Promise<DbItem[]> {
  const results: DbItem[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const response = await docClient.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ExclusiveStartKey: exclusiveStartKey,
    }));

    if (response.Items) {
      results.push(...(response.Items as DbItem[]));
    }

    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return results;
}

async function deleteWithSnapshot(tableName: string, item: DbItem, rollbackStack: SnapshotRecord[]): Promise<void> {
  await docClient.send(new DeleteCommand({
    TableName: tableName,
    Key: { id: item.id },
    ConditionExpression: 'attribute_exists(id)',
  }));

  rollbackStack.push({ tableName, item });
}

async function restoreSnapshots(rollbackStack: SnapshotRecord[]): Promise<string[]> {
  const failures: string[] = [];
  for (let i = rollbackStack.length - 1; i >= 0; i -= 1) {
    const snapshot = rollbackStack[i];
    try {
      await docClient.send(new PutCommand({
        TableName: snapshot.tableName,
        Item: snapshot.item,
      }));
    } catch {
      failures.push(`${snapshot.tableName}:${snapshot.item.id}`);
    }
  }
  return failures;
}

type Handler = Schema['deletePlayerSafe']['functionHandler'];

export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito;
  const callerSub = identity?.sub;

  if (!callerSub) {
    throw new Error('User not authenticated');
  }

  const playerId = event.arguments.playerId;
  const playerTable = process.env.PLAYER_TABLE;
  const teamRosterTable = process.env.TEAM_ROSTER_TABLE;
  const playTimeRecordTable = process.env.PLAY_TIME_RECORD_TABLE;
  const goalTable = process.env.GOAL_TABLE;
  const gameNoteTable = process.env.GAME_NOTE_TABLE;
  const playerAvailabilityTable = process.env.PLAYER_AVAILABILITY_TABLE;

  if (!playerTable || !teamRosterTable || !playTimeRecordTable || !goalTable || !gameNoteTable || !playerAvailabilityTable) {
    throw new Error('Required environment variables are not set');
  }

  const playerResponse = await docClient.send(new GetCommand({
    TableName: playerTable,
    Key: { id: playerId },
  }));

  const player = playerResponse.Item as DbItem | undefined;
  if (!player) {
    throw new Error('Player not found');
  }

  const coaches = player.coaches as string[] | undefined;
  if (!coaches?.includes(callerSub)) {
    throw new Error('Access denied: caller is not a coach on this player');
  }

  const rollbackStack: SnapshotRecord[] = [];

  try {
    const [teamRosters, playTimeRecords, goalsAsScorer, goalsAsAssist, gameNotes, playerAvailabilities] = await Promise.all([
      scanAll(teamRosterTable, 'playerId = :playerId', { ':playerId': playerId }),
      scanAll(playTimeRecordTable, 'playerId = :playerId', { ':playerId': playerId }),
      scanAll(goalTable, 'scorerId = :playerId', { ':playerId': playerId }),
      scanAll(goalTable, 'assistId = :playerId', { ':playerId': playerId }),
      scanAll(gameNoteTable, 'playerId = :playerId', { ':playerId': playerId }),
      scanAll(playerAvailabilityTable, 'playerId = :playerId', { ':playerId': playerId }),
    ]);

    for (const goal of goalsAsAssist) {
      await docClient.send(new UpdateCommand({
        TableName: goalTable,
        Key: { id: goal.id },
        UpdateExpression: 'SET assistId = :assistId',
        ExpressionAttributeValues: {
          ':assistId': null,
        },
        ConditionExpression: 'attribute_exists(id)',
      }));
      rollbackStack.push({ tableName: goalTable, item: goal });
    }

    for (const item of teamRosters) {
      await deleteWithSnapshot(teamRosterTable, item, rollbackStack);
    }
    for (const item of playTimeRecords) {
      await deleteWithSnapshot(playTimeRecordTable, item, rollbackStack);
    }
    for (const item of goalsAsScorer) {
      await deleteWithSnapshot(goalTable, item, rollbackStack);
    }
    for (const item of gameNotes) {
      await deleteWithSnapshot(gameNoteTable, item, rollbackStack);
    }
    for (const item of playerAvailabilities) {
      await deleteWithSnapshot(playerAvailabilityTable, item, rollbackStack);
    }

    await deleteWithSnapshot(playerTable, player, rollbackStack);

    return {
      success: true,
      deletedCounts: {
        teamRosters: teamRosters.length,
        playTimeRecords: playTimeRecords.length,
        goalsAsScorer: goalsAsScorer.length,
        gameNotes: gameNotes.length,
        playerAvailabilities: playerAvailabilities.length,
        assistLinksCleared: goalsAsAssist.length,
      },
    };
  } catch (error) {
    const rollbackFailures = await restoreSnapshots(rollbackStack);

    if (rollbackFailures.length > 0) {
      throw new Error(
        `deletePlayerSafe failed and rollback was incomplete: ${rollbackFailures.join(', ')}. Original error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    throw new Error(
      `deletePlayerSafe failed; all prior deletes were rolled back. Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
