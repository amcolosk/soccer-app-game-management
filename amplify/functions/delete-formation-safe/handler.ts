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

type TeamRef = {
  id: string;
  name: string;
};

type FormationRecord = {
  id: string;
  coaches?: string[];
};

type FormationPositionRecord = {
  id: string;
  [key: string]: unknown;
};

type SnapshotRecord = {
  tableName: string;
  item: Record<string, unknown>;
};

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

async function scanTeamsUsingFormation(tableName: string, formationId: string): Promise<TeamRef[]> {
  const results: TeamRef[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const response = await docClient.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: 'formationId = :formationId',
      ExpressionAttributeValues: { ':formationId': formationId },
      ProjectionExpression: 'id, #teamName',
      ExpressionAttributeNames: { '#teamName': 'name' },
      ExclusiveStartKey: exclusiveStartKey,
    }));

    if (response.Items) {
      results.push(...(response.Items as TeamRef[]));
    }

    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return results;
}

async function scanFormationPositions(tableName: string, formationId: string): Promise<FormationPositionRecord[]> {
  const results: FormationPositionRecord[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const response = await docClient.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: 'formationId = :formationId',
      ExpressionAttributeValues: { ':formationId': formationId },
      ExclusiveStartKey: exclusiveStartKey,
    }));

    if (response.Items) {
      results.push(...(response.Items as FormationPositionRecord[]));
    }

    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return results;
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
      const id = typeof snapshot.item.id === 'string' ? snapshot.item.id : 'unknown-id';
      failures.push(`${snapshot.tableName}:${id}`);
    }
  }

  return failures;
}

type Handler = Schema['deleteFormationSafe']['functionHandler'];

export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito;
  const callerSub = identity?.sub;

  if (!callerSub) {
    throw new Error('User not authenticated');
  }

  const formationId = event.arguments.formationId;
  const formationTable = process.env.FORMATION_TABLE;
  const formationPositionTable = process.env.FORMATION_POSITION_TABLE;
  const teamTable = process.env.TEAM_TABLE;

  if (!formationTable || !formationPositionTable || !teamTable) {
    throw new Error('Required environment variables are not set');
  }

  const formationResponse = await docClient.send(new GetCommand({
    TableName: formationTable,
    Key: { id: formationId },
    ProjectionExpression: 'id, coaches',
  }));

  const formation = formationResponse.Item as FormationRecord | undefined;
  if (!formation) {
    throw new Error('Formation not found');
  }

  if (!formation.coaches?.includes(callerSub)) {
    throw new Error('Access denied: caller is not a coach on this formation');
  }

  const referencingTeams = await scanTeamsUsingFormation(teamTable, formationId);
  if (referencingTeams.length > 0) {
    const teamNames = referencingTeams.slice(0, 3).map((team) => team.name).join(', ');
    const remainderCount = referencingTeams.length - Math.min(referencingTeams.length, 3);
    const remainderText = remainderCount > 0 ? ` and ${remainderCount} more` : '';
    throw new Error(
      `Cannot delete formation: referenced by ${referencingTeams.length} team(s): ${teamNames}${remainderText}. Reassign teams before deleting.`,
    );
  }

  const positions = await scanFormationPositions(formationPositionTable, formationId);
  const rollbackStack: SnapshotRecord[] = [];

  try {
    for (const position of positions) {
      await docClient.send(new DeleteCommand({
        TableName: formationPositionTable,
        Key: { id: position.id },
        ConditionExpression: 'attribute_exists(id)',
      }));

      rollbackStack.push({
        tableName: formationPositionTable,
        item: position,
      });
    }

    await docClient.send(new DeleteCommand({
      TableName: formationTable,
      Key: { id: formationId },
      ConditionExpression: 'attribute_exists(id)',
    }));

    return {
      success: true,
      deletedPositions: positions.length,
    };
  } catch (error) {
    const rollbackFailures = await restoreSnapshots(rollbackStack);

    if (rollbackFailures.length > 0) {
      throw new Error(
        `deleteFormationSafe failed and rollback was incomplete: ${rollbackFailures.join(', ')}. Original error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    throw new Error(
      `deleteFormationSafe failed; all prior deletes were rolled back. Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
