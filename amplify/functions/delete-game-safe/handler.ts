import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
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

// Query-by-physical-index-name variant of scanAll, used for Goal/Shot/Save.
// These three tables now carry an explicit `gameId`-hash-key GSI
// (queryFields listGoalsByGameId/listShotsByGameId/listSavesByGameId), whose
// synthesized *physical* index names are `goalsByGameId`/`shotsByGameId`/
// `savesByGameId` -- derived from @aws-amplify/graphql-index-transformer's
// `${pluralize(modelName)}By${Upper(fieldName)}` naming rule (verified
// against the transformer source, and cross-checked against the sibling
// PlayTimeRecord index, which synthesizes to `playTimeRecordsByGameId` for
// queryField `listPlayTimeRecordsByGameId` -- same pattern). The local
// `.amplify/artifacts/cdk.out` snapshot in this working tree predates this
// schema change and doesn't contain these tables, so re-confirm these names
// against a fresh `cdk synth`/sandbox deploy (same evidence standard
// coachArraySync.ts documents) before this ships. This handler has no
// GraphQL client, so it must use
// QueryCommand against that physical name rather than the GraphQL
// queryField. Accepted tradeoff (stated explicitly, per plan): a GSI read
// has higher propagation lag than a table scan, so a game deleted within
// seconds of a goal/shot/save being logged could theoretically miss a very
// recent row where the old scan wouldn't -- a one-time, narrow migration
// tradeoff, not a permanent behavior change.
async function queryAllByGameIdIndex(tableName: string, indexName: string, gameId: string): Promise<DbItem[]> {
  const results: DbItem[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const response = await docClient.send(new QueryCommand({
      TableName: tableName,
      IndexName: indexName,
      KeyConditionExpression: 'gameId = :gameId',
      ExpressionAttributeValues: { ':gameId': gameId },
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
  const teamTable = process.env.TEAM_TABLE;
  const playTimeRecordTable = process.env.PLAY_TIME_RECORD_TABLE;
  const goalTable = process.env.GOAL_TABLE;
  const shotTable = process.env.SHOT_TABLE;
  const saveTable = process.env.SAVE_TABLE;
  const gameNoteTable = process.env.GAME_NOTE_TABLE;
  const substitutionTable = process.env.SUBSTITUTION_TABLE;
  const lineupAssignmentTable = process.env.LINEUP_ASSIGNMENT_TABLE;
  const playerAvailabilityTable = process.env.PLAYER_AVAILABILITY_TABLE;
  const gamePlanTable = process.env.GAME_PLAN_TABLE;
  const plannedRotationTable = process.env.PLANNED_ROTATION_TABLE;
  const queuedSubstitutionTable = process.env.QUEUED_SUBSTITUTION_TABLE;

  if (!gameTable || !teamTable || !playTimeRecordTable || !goalTable || !shotTable || !saveTable || !gameNoteTable || !substitutionTable || !lineupAssignmentTable || !playerAvailabilityTable || !gamePlanTable || !plannedRotationTable || !queuedSubstitutionTable) {
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

  // TEAM-ARCHIVE-STEP8, Part A, Decision 4: archived teams are meant to stay
  // read-only historical data (Acceptance Criterion 5) — deleting a game
  // permanently removes it from that history, unlike editing content within
  // a still-viewable game (goals/notes/substitutions), which Phase 4 already
  // treats as UI-only. `game.teamId` is a single required field, unlike
  // Formation/Player, so this check is unambiguous. Plain JS comparison
  // (not a DynamoDB ConditionExpression) already treats a missing/undefined
  // `status` as active — Correction 2's null-safe rewrite only applies to
  // ConditionExpression strings. Fails open (allows the delete) if the
  // team record itself can't be found, rather than blocking cleanup of an
  // orphaned game.
  const teamId = game.teamId as string | undefined;
  if (teamId) {
    const teamResponse = await docClient.send(new GetCommand({
      TableName: teamTable,
      Key: { id: teamId },
      ProjectionExpression: '#status',
      ExpressionAttributeNames: { '#status': 'status' },
    }));
    const team = teamResponse.Item as { status?: string } | undefined;
    if (team?.status === 'archived') {
      throw new Error('Cannot delete a game belonging to an archived team. Restore the team first.');
    }
  }

  const rollbackStack: SnapshotRecord[] = [];

  try {
    const [playTimeRecords, goals, shots, saves, gameNotes, substitutions, lineupAssignments, playerAvailabilities, gamePlans, queuedSubstitutions] = await Promise.all([
      scanAll(playTimeRecordTable, 'gameId = :gameId', { ':gameId': gameId }),
      queryAllByGameIdIndex(goalTable, 'goalsByGameId', gameId),
      queryAllByGameIdIndex(shotTable, 'shotsByGameId', gameId),
      queryAllByGameIdIndex(saveTable, 'savesByGameId', gameId),
      scanAll(gameNoteTable, 'gameId = :gameId', { ':gameId': gameId }),
      scanAll(substitutionTable, 'gameId = :gameId', { ':gameId': gameId }),
      scanAll(lineupAssignmentTable, 'gameId = :gameId', { ':gameId': gameId }),
      scanAll(playerAvailabilityTable, 'gameId = :gameId', { ':gameId': gameId }),
      scanAll(gamePlanTable, 'gameId = :gameId', { ':gameId': gameId }),
      scanAll(queuedSubstitutionTable, 'gameId = :gameId', { ':gameId': gameId }),
    ]);

    const plannedRotations: DbItem[] = [];
    for (const gamePlan of gamePlans) {
      const rotations = await scanAll(plannedRotationTable, 'gamePlanId = :gamePlanId', { ':gamePlanId': gamePlan.id });
      plannedRotations.push(...rotations);
    }

    for (const item of plannedRotations) {
      await deleteWithSnapshot(plannedRotationTable, item, rollbackStack);
    }
    for (const item of queuedSubstitutions) {
      await deleteWithSnapshot(queuedSubstitutionTable, item, rollbackStack);
    }
    for (const item of playTimeRecords) {
      await deleteWithSnapshot(playTimeRecordTable, item, rollbackStack);
    }
    for (const item of goals) {
      await deleteWithSnapshot(goalTable, item, rollbackStack);
    }
    for (const item of shots) {
      await deleteWithSnapshot(shotTable, item, rollbackStack);
    }
    for (const item of saves) {
      await deleteWithSnapshot(saveTable, item, rollbackStack);
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
        queuedSubstitutions: queuedSubstitutions.length,
        playTimeRecords: playTimeRecords.length,
        goals: goals.length,
        shots: shots.length,
        saves: saves.length,
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
