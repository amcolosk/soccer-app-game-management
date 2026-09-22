import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

export type DbItem = Record<string, unknown> & { id: string };

/**
 * Generic, docClient-parameterized DynamoDB primitives shared across
 * Lambdas. Each export documents its own usage scope below -- this file is
 * NOT scoped to any single Lambda or milestone; `scanAll` happens to be
 * calendar-import-only (see its own comment), while `queryAllByGameIdIndex`
 * below is reused by both get-fan-game-view and get-stat-tracker-view.
 */

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

/**
 * Paginated Query-by-physical-GSI-name for a `gameId`-keyed index, extracted
 * (Save Auto-Goalkeeper Attribution plan, architecture review) from
 * get-fan-game-view/handler.ts's original module-local copy — reused by
 * get-stat-tracker-view's new PlayTimeRecord lookup too. Same
 * query-by-physical-index-name pattern documented in
 * shareLinkAccess.ts's queryAllGamesByTeamId and delete-game-safe/handler.ts:
 * these Lambdas have no GraphQL client, so they query the confirmed physical
 * GSI name directly. `docClient` is an explicit parameter (not closed over),
 * matching `scanAll`'s convention above.
 */
export async function queryAllByGameIdIndex(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  indexName: string,
  gameId: string,
): Promise<DbItem[]> {
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
