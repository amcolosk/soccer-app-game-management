import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
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

type Handler = Schema['deleteGameSafe']['functionHandler'];

export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito;
  const callerSub = identity?.sub;

  if (!callerSub) {
    throw new Error('User not authenticated');
  }

  const gameId = event.arguments.gameId;
  const gameTable = process.env.GAME_TABLE;
  const playTimeRecordTable = process.env.PLAY_TIME_RECORD_TABLE;
  const goalTable = process.env.GOAL_TABLE;
  const gameNoteTable = process.env.GAME_NOTE_TABLE;
  const substitutionTable = process.env.SUBSTITUTION_TABLE;
  const lineupAssignmentTable = process.env.LINEUP_ASSIGNMENT_TABLE;
  const playerAvailabilityTable = process.env.PLAYER_AVAILABILITY_TABLE;
  const gamePlanTable = process.env.GAME_PLAN_TABLE;
  const plannedRotationTable = process.env.PLANNED_ROTATION_TABLE;

  if (!gameTable || !playTimeRecordTable || !goalTable || !gameNoteTable || !substitutionTable || !lineupAssignmentTable || !playerAvailabilityTable || !gamePlanTable || !plannedRotationTable) {
    throw new Error('Required environment variables are not set');
  }

  const gameResponse = await docClient.send(new GetCommand({
    TableName: gameTable,
    Key: { id: gameId },
  }));

  const game = gameResponse.Item as DbItem | undefined;
  if (!game) {
    throw new Error('Game not found');
  }

  const coaches = game.coaches as string[] | undefined;
  if (!coaches?.includes(callerSub)) {
    throw new Error('Access denied: caller is not a coach on this game');
  }

  const rollbackStack: SnapshotRecord[] = [];

  try {
    const [playTimeRecords, goals, gameNotes, substitutions, lineupAssignments, playerAvailabilities, gamePlans] = await Promise.all([
      scanAll(playTimeRecordTable, 'gameId = :gameId', { ':gameId': gameId }),
      scanAll(goalTable, 'gameId = :gameId', { ':gameId': gameId }),
      scanAll(gameNoteTable, 'gameId = :gameId', { ':gameId': gameId }),
      scanAll(substitutionTable, 'gameId = :gameId', { ':gameId': gameId }),
      scanAll(lineupAssignmentTable, 'gameId = :gameId', { ':gameId': gameId }),
      scanAll(playerAvailabilityTable, 'gameId = :gameId', { ':gameId': gameId }),
      scanAll(gamePlanTable, 'gameId = :gameId', { ':gameId': gameId }),
    ]);

    const plannedRotations: DbItem[] = [];
    for (const gamePlan of gamePlans) {
      const rotations = await scanAll(plannedRotationTable, 'gamePlanId = :gamePlanId', { ':gamePlanId': gamePlan.id });
      plannedRotations.push(...rotations);
    }

    for (const item of plannedRotations) {
      await deleteWithSnapshot(plannedRotationTable, item, rollbackStack);
    }
    for (const item of playTimeRecords) {
      await deleteWithSnapshot(playTimeRecordTable, item, rollbackStack);
    }
    for (const item of goals) {
      await deleteWithSnapshot(goalTable, item, rollbackStack);
    }
    for (const item of gameNotes) {
      await deleteWithSnapshot(gameNoteTable, item, rollbackStack);
    }
    for (const item of substitutions) {
      await deleteWithSnapshot(substitutionTable, item, rollbackStack);
    }
    for (const item of lineupAssignments) {
      await deleteWithSnapshot(lineupAssignmentTable, item, rollbackStack);
    }
    for (const item of playerAvailabilities) {
      await deleteWithSnapshot(playerAvailabilityTable, item, rollbackStack);
    }
    for (const item of gamePlans) {
      await deleteWithSnapshot(gamePlanTable, item, rollbackStack);
    }

    await deleteWithSnapshot(gameTable, game, rollbackStack);

    return {
      success: true,
      deletedCounts: {
        plannedRotations: plannedRotations.length,
        playTimeRecords: playTimeRecords.length,
        goals: goals.length,
        gameNotes: gameNotes.length,
        substitutions: substitutions.length,
        lineupAssignments: lineupAssignments.length,
        playerAvailabilities: playerAvailabilities.length,
        gamePlans: gamePlans.length,
      },
    };
  } catch (error) {
    const rollbackFailures = await restoreSnapshots(rollbackStack);

    if (rollbackFailures.length > 0) {
      throw new Error(
        `deleteGameSafe failed and rollback was incomplete: ${rollbackFailures.join(', ')}. Original error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    throw new Error(
      `deleteGameSafe failed; all prior deletes were rolled back. Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
