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

type Handler = Schema['deleteTeamSafe']['functionHandler'];

export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito;
  const callerSub = identity?.sub;

  if (!callerSub) {
    throw new Error('User not authenticated');
  }

  const teamId = event.arguments.teamId;
  const teamTable = process.env.TEAM_TABLE;
  const gameTable = process.env.GAME_TABLE;
  const teamRosterTable = process.env.TEAM_ROSTER_TABLE;
  const teamInvitationTable = process.env.TEAM_INVITATION_TABLE;
  const playTimeRecordTable = process.env.PLAY_TIME_RECORD_TABLE;
  const goalTable = process.env.GOAL_TABLE;
  const gameNoteTable = process.env.GAME_NOTE_TABLE;
  const substitutionTable = process.env.SUBSTITUTION_TABLE;
  const lineupAssignmentTable = process.env.LINEUP_ASSIGNMENT_TABLE;
  const playerAvailabilityTable = process.env.PLAYER_AVAILABILITY_TABLE;
  const gamePlanTable = process.env.GAME_PLAN_TABLE;
  const plannedRotationTable = process.env.PLANNED_ROTATION_TABLE;

  if (!teamTable || !gameTable || !teamRosterTable || !teamInvitationTable || !playTimeRecordTable || !goalTable || !gameNoteTable || !substitutionTable || !lineupAssignmentTable || !playerAvailabilityTable || !gamePlanTable || !plannedRotationTable) {
    throw new Error('Required environment variables are not set');
  }

  const teamResponse = await docClient.send(new GetCommand({
    TableName: teamTable,
    Key: { id: teamId },
  }));

  const team = teamResponse.Item as DbItem | undefined;
  if (!team) {
    throw new Error('Team not found');
  }

  const coaches = team.coaches as string[] | undefined;
  if (!coaches?.includes(callerSub)) {
    throw new Error('Access denied: caller is not a coach on this team');
  }

  const rollbackStack: SnapshotRecord[] = [];

  try {
    const [games, teamRosters, teamInvitations] = await Promise.all([
      scanAll(gameTable, 'teamId = :teamId', { ':teamId': teamId }),
      scanAll(teamRosterTable, 'teamId = :teamId', { ':teamId': teamId }),
      scanAll(teamInvitationTable, 'teamId = :teamId', { ':teamId': teamId }),
    ]);

    const gameChildren = [] as Array<{
      playTimeRecords: DbItem[];
      goals: DbItem[];
      gameNotes: DbItem[];
      substitutions: DbItem[];
      lineupAssignments: DbItem[];
      playerAvailabilities: DbItem[];
      gamePlans: DbItem[];
      plannedRotations: DbItem[];
    }>;

    for (const game of games) {
      const [playTimeRecords, goals, gameNotes, substitutions, lineupAssignments, playerAvailabilities, gamePlans] = await Promise.all([
        scanAll(playTimeRecordTable, 'gameId = :gameId', { ':gameId': game.id }),
        scanAll(goalTable, 'gameId = :gameId', { ':gameId': game.id }),
        scanAll(gameNoteTable, 'gameId = :gameId', { ':gameId': game.id }),
        scanAll(substitutionTable, 'gameId = :gameId', { ':gameId': game.id }),
        scanAll(lineupAssignmentTable, 'gameId = :gameId', { ':gameId': game.id }),
        scanAll(playerAvailabilityTable, 'gameId = :gameId', { ':gameId': game.id }),
        scanAll(gamePlanTable, 'gameId = :gameId', { ':gameId': game.id }),
      ]);

      const plannedRotations: DbItem[] = [];
      for (const gamePlan of gamePlans) {
        const rotations = await scanAll(plannedRotationTable, 'gamePlanId = :gamePlanId', { ':gamePlanId': gamePlan.id });
        plannedRotations.push(...rotations);
      }

      gameChildren.push({
        playTimeRecords,
        goals,
        gameNotes,
        substitutions,
        lineupAssignments,
        playerAvailabilities,
        gamePlans,
        plannedRotations,
      });
    }

    for (let i = 0; i < games.length; i += 1) {
      const child = gameChildren[i];
      const game = games[i];

      for (const item of child.plannedRotations) {
        await deleteWithSnapshot(plannedRotationTable, item, rollbackStack);
      }
      for (const item of child.playTimeRecords) {
        await deleteWithSnapshot(playTimeRecordTable, item, rollbackStack);
      }
      for (const item of child.goals) {
        await deleteWithSnapshot(goalTable, item, rollbackStack);
      }
      for (const item of child.gameNotes) {
        await deleteWithSnapshot(gameNoteTable, item, rollbackStack);
      }
      for (const item of child.substitutions) {
        await deleteWithSnapshot(substitutionTable, item, rollbackStack);
      }
      for (const item of child.lineupAssignments) {
        await deleteWithSnapshot(lineupAssignmentTable, item, rollbackStack);
      }
      for (const item of child.playerAvailabilities) {
        await deleteWithSnapshot(playerAvailabilityTable, item, rollbackStack);
      }
      for (const item of child.gamePlans) {
        await deleteWithSnapshot(gamePlanTable, item, rollbackStack);
      }

      await deleteWithSnapshot(gameTable, game, rollbackStack);
    }

    for (const item of teamRosters) {
      await deleteWithSnapshot(teamRosterTable, item, rollbackStack);
    }
    for (const item of teamInvitations) {
      await deleteWithSnapshot(teamInvitationTable, item, rollbackStack);
    }

    await deleteWithSnapshot(teamTable, team, rollbackStack);

    return {
      success: true,
      deletedCounts: {
        games: games.length,
        teamRosters: teamRosters.length,
        teamInvitations: teamInvitations.length,
      },
    };
  } catch (error) {
    const rollbackFailures = await restoreSnapshots(rollbackStack);

    if (rollbackFailures.length > 0) {
      throw new Error(
        `deleteTeamSafe failed and rollback was incomplete: ${rollbackFailures.join(', ')}. Original error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    throw new Error(
      `deleteTeamSafe failed; all prior deletes were rolled back. Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
