import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

/**
 * Generic, reusable primitives extracted from accept-invitation/handler.ts
 * (issue #162 / ISSUE-162-REVOKE-COACH-ACCESS-CASCADE.md file #1) — this is
 * the concrete trigger for TEAM-ARCHIVE-STEP1-BACKEND-WIRING.md's Required
 * Follow-Up #6 ("extract isConditionalCheckFailed/scanAll ... once a further
 * handler needs either"), extended slightly further since both
 * accept-invitation and the new revoke-coach-access handler need the same
 * conditional-retry write shape, not just the scan helper.
 *
 * Used by accept-invitation (add/merge strategy) and revoke-coach-access
 * (remove strategy, including the Team record's own update). Not
 * consolidated with amplify/functions/shared/dynamo.ts's scanAll, which
 * takes an arbitrary filter expression rather than a single field/value
 * pair — same "not this slice" reasoning already used for teamAccess.ts vs.
 * the older *Safe handlers.
 */

export type CoachScopedRecord = {
  id: string;
  coaches?: string[];
};

export function isConditionalCheckFailed(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeName = (error as { name?: unknown }).name;
  return maybeName === 'ConditionalCheckFailedException';
}

export function normalizeEmail(value: string | undefined | null): string {
  if (!value) {
    return '';
  }

  return value.trim().toLowerCase();
}

/**
 * Paginated GetCommand-by-id with optional field projection.
 *
 * `extraExpressionAttributeNames` (F1 — architecture review round 3) lets
 * callers safely project DynamoDB reserved words (e.g. 'status') by passing
 * a '#status' alias in `projectionFields` and `{ '#status': 'status' }`
 * here. This module does NOT auto-detect reserved words — the caller is
 * responsible for aliasing. When `projectionFields` is omitted (or empty),
 * no ProjectionExpression is sent and the full record is returned — this is
 * what updateRecordCoachesWithRetry relies on for its Team-level retry
 * re-read (F2).
 */
export async function getRecordById<T extends Record<string, unknown>>(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  id: string,
  projectionFields?: string[],
  extraExpressionAttributeNames?: Record<string, string>,
): Promise<T | null> {
  const hasProjection = Boolean(projectionFields && projectionFields.length > 0);
  // DynamoDB rejects any request carrying an empty ExpressionAttributeNames
  // map with ValidationException: ExpressionAttributeNames must not be
  // empty. Only send the key when there's actually at least one alias to
  // report — most projected reads don't need a reserved-word alias, so
  // `extraExpressionAttributeNames` is commonly undefined even when
  // `hasProjection` is true.
  const expressionAttributeNames =
    hasProjection && extraExpressionAttributeNames && Object.keys(extraExpressionAttributeNames).length > 0
      ? { ...extraExpressionAttributeNames }
      : undefined;

  const response = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: { id },
    ProjectionExpression: hasProjection ? projectionFields!.join(', ') : undefined,
    ExpressionAttributeNames: expressionAttributeNames,
  }));

  return (response.Item as T | undefined) ?? null;
}

/**
 * Paginated full-table scan filtered to a single field/value pair, with
 * optional field projection. See getRecordById's doc comment for the
 * `extraExpressionAttributeNames` reserved-word-aliasing contract — the
 * internally-generated `{ '#field': fieldName }` alias always wins on
 * collision; callers only ever use the extra map for *projection* aliases,
 * never to rename the lookup key.
 */
export async function scanByField<T extends Record<string, unknown>>(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  fieldName: string,
  fieldValue: string,
  projectionFields: string[],
  extraExpressionAttributeNames?: Record<string, string>,
): Promise<T[]> {
  const results: T[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const scanResult = await docClient.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: '#field = :fieldValue',
      ExpressionAttributeNames: { ...extraExpressionAttributeNames, '#field': fieldName },
      ExpressionAttributeValues: { ':fieldValue': fieldValue },
      ProjectionExpression: projectionFields.join(', '),
      ExclusiveStartKey: exclusiveStartKey,
    }));

    results.push(...((scanResult.Items as T[] | undefined) ?? []));
    exclusiveStartKey = scanResult.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return results;
}

/**
 * Paginated Query against a single-hash-key GSI, filtered to one
 * field/value pair. Used by revoke-coach-access (Data Model / API Impact,
 * Minor 8): Amplify Gen2 auto-creates a relationship GSI on every
 * `hasMany`/`belongsTo` child table, and the deployed CDK synth output
 * (`.amplify/artifacts/cdk.out`) was checked before this handler was
 * written — `TeamRoster` (`gsi-Team.roster`), `FieldPosition`
 * (`gsi-Team.positions`), `Game` (`gsi-Team.games`), and `TeamInvitation`
 * (`gsi-Team.invitations`) each have a `teamId`-hash-key GSI with
 * `projectionType: 'ALL'`, so a `Query` against the confirmed index name is
 * used instead of a full-table `Scan` for all four of revoke-coach-access's
 * team-scoped lookups. accept-invitation's own scans are NOT converted —
 * file #3 of ISSUE-162-REVOKE-COACH-ACCESS-CASCADE.md is a
 * behavior-preserving refactor only, not a scope change, and its existing
 * `Scan`-based precedent stays as-is.
 *
 * See getRecordById's doc comment for the `extraExpressionAttributeNames`
 * reserved-word-aliasing contract — the internally-generated
 * `{ '#field': fieldName }` alias always wins on collision.
 */
export async function queryByIndex<T extends Record<string, unknown>>(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  indexName: string,
  fieldName: string,
  fieldValue: string,
  projectionFields: string[],
  extraExpressionAttributeNames?: Record<string, string>,
): Promise<T[]> {
  const results: T[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const queryResult = await docClient.send(new QueryCommand({
      TableName: tableName,
      IndexName: indexName,
      KeyConditionExpression: '#field = :fieldValue',
      ExpressionAttributeNames: { ...extraExpressionAttributeNames, '#field': fieldName },
      ExpressionAttributeValues: { ':fieldValue': fieldValue },
      ProjectionExpression: projectionFields.join(', '),
      ExclusiveStartKey: exclusiveStartKey,
    }));

    results.push(...((queryResult.Items as T[] | undefined) ?? []));
    exclusiveStartKey = queryResult.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return results;
}

export async function withBoundedConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

/**
 * Discriminated strategy contract for updateRecordCoachesWithRetry
 * (Critical 2, architecture review round 1). Evaluated fresh against the
 * latest known `coaches` array on EVERY retry attempt, not just once before
 * the first write — this is what closes the concurrent-double-revoke race:
 * an invariant that was true on attempt 1 (e.g. "caller is still a coach")
 * but has since changed is caught on attempt 2 against a freshly re-read
 * record, not blindly retried against a stale assumption.
 *
 * - 'write' — attempt a conditional write to `next`.
 * - 'skip' — no write, treated as idempotent success (e.g. target already
 *   absent, or writing would leave a child record's coaches empty).
 * - 'abort' — throw `reason` immediately, no retry, no write. Used by the
 *   Team-level strategy for caller-membership / zero-coaches invariants.
 *   Child-record strategies never use 'abort'.
 */
export type CoachesStrategyResult =
  | { action: 'write'; next: string[] }
  | { action: 'skip' }
  | { action: 'abort'; reason: string };

export type CoachesStrategy = (current: string[] | undefined) => CoachesStrategyResult;

export type CoachesWriteResult<T> =
  | { action: 'write'; record: T }
  | { action: 'skip'; record: T };
// 'abort' never returns a value — it throws, per CoachesStrategyResult's doc comment.

/**
 * Generalized version of accept-invitation's former
 * updateRecordCoachesIfNeeded — same optimistic-concurrency retry shape (up
 * to 3 attempts), but driven by a CoachesStrategy instead of a plain
 * computeNextCoaches function, so both add-side (accept-invitation) and
 * remove-side (revoke-coach-access) callers can express their own
 * invariants, including remove-side aborts.
 *
 * `retryReadProjection` (F2 — architecture review round 3): projection used
 * for the GetCommand re-read on a conditional-check conflict. Child-record
 * callers (TeamRoster/FieldPosition/Game/TeamInvitation) pass
 * `['id', 'coaches']` — they only ever need to know whether a write
 * happened. The Team-level caller omits this parameter entirely so its
 * retry re-read returns the FULL record — required because that call's
 * `record` is returned to the client as-is as the mutation's `a.ref('Team')`
 * response, and `Team.name` is `.required()`; an `['id','coaches']`-limited
 * stub returned for a 'skip' result would fail AppSync's non-nullable-field
 * validation and surface a spurious client-visible error for a revoke that
 * actually fully succeeded.
 *
 * If a retry re-read finds no record at all (the row was deleted between
 * attempts), throws `Failed to re-read record during concurrent update
 * retry — record no longer exists` rather than silently treating it as
 * "nothing to do".
 */
export async function updateRecordCoachesWithRetry<T extends { id: string; coaches?: string[] }>(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  record: T,
  strategy: CoachesStrategy,
  updatedAtIso: string,
  retryReadProjection?: string[],
): Promise<CoachesWriteResult<T>> {
  let latestRecord: T = record;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = strategy(latestRecord.coaches);

    if (result.action === 'abort') {
      throw new Error(result.reason);
    }

    if (result.action === 'skip') {
      return { action: 'skip', record: latestRecord };
    }

    try {
      let response;
      if (latestRecord.coaches === undefined) {
        response = await docClient.send(new UpdateCommand({
          TableName: tableName,
          Key: { id: latestRecord.id },
          UpdateExpression: 'SET coaches = :coaches, updatedAt = :updatedAt',
          ConditionExpression: 'attribute_not_exists(coaches)',
          ExpressionAttributeValues: {
            ':coaches': result.next,
            ':updatedAt': updatedAtIso,
          },
          ReturnValues: 'ALL_NEW',
        }));
      } else {
        response = await docClient.send(new UpdateCommand({
          TableName: tableName,
          Key: { id: latestRecord.id },
          UpdateExpression: 'SET coaches = :coaches, updatedAt = :updatedAt',
          ConditionExpression: 'coaches = :expectedCoaches',
          ExpressionAttributeValues: {
            ':coaches': result.next,
            ':expectedCoaches': latestRecord.coaches,
            ':updatedAt': updatedAtIso,
          },
          ReturnValues: 'ALL_NEW',
        }));
      }

      return { action: 'write', record: response.Attributes as T };
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }

      const refreshed = await getRecordById<T & Record<string, unknown>>(
        docClient,
        tableName,
        latestRecord.id,
        retryReadProjection,
      );

      if (!refreshed) {
        throw new Error('Failed to re-read record during concurrent update retry — record no longer exists');
      }

      latestRecord = refreshed as T;
    }
  }

  throw new Error(`Failed to update coaches for record ${latestRecord.id} in ${tableName} after concurrent update retries`);
}
