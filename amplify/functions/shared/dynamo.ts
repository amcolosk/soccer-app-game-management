import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

export type DbItem = Record<string, unknown> & { id: string };

/**
 * Paginated full-table scan with a filter expression, extracted
 * (architecture review Major 6) from the identical pattern repeated in
 * delete-game-safe, delete-team-safe, delete-player-safe and archive-team.
 * **Used by the new calendar-import Lambdas only** — see teamAccess.ts's
 * doc comment for the same used-by-new-Lambda-only scope guard.
 *
 * No GSI exists for "a team's games" (Finding 10 in the plan) — this is a
 * real per-sync full-table scan, acceptable for manual, per-team sync today;
 * see the plan's Phase 5 risk note for the scheduled-sync scaling dependency
 * this incurs.
 */
export async function scanAll(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  filterExpression: string,
  expressionAttributeValues: Record<string, unknown>,
  expressionAttributeNames?: Record<string, string>,
): Promise<DbItem[]> {
  const results: DbItem[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const response = await docClient.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: expressionAttributeNames,
      ExclusiveStartKey: exclusiveStartKey,
    }));

    if (response.Items) {
      results.push(...(response.Items as DbItem[]));
    }

    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return results;
}
