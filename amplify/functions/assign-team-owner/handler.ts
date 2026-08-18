import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient, type AttributeValue } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../../data/resource';

type DbItem = Record<string, unknown> & { id: string };

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

function isConditionalCheckFailed(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  return (error as { name?: unknown }).name === 'ConditionalCheckFailedException';
}

type Handler = Schema['assignTeamOwner']['functionHandler'];

// First-come-first-served-by-any-existing-coach owner assignment for legacy
// (ownerless) teams. A conditional attribute_not_exists(ownerId) write ensures
// only one concurrent caller can win the race.
export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito;
  const callerSub = identity?.sub;

  if (!callerSub) {
    throw new Error('User not authenticated');
  }

  const teamId = event.arguments.teamId;
  const teamTable = process.env.TEAM_TABLE;

  if (!teamTable) {
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

  try {
    const result = await docClient.send(new UpdateCommand({
      TableName: teamTable,
      Key: { id: teamId },
      UpdateExpression: 'SET ownerId = :ownerId, updatedAt = :updatedAt',
      // attribute_not_exists(ownerId) resolves the common "legacy, never
      // owned" case. NOT contains(coaches, ownerId) additionally allows
      // reclaiming a team whose current owner was removed from `coaches` by
      // revokeCoachAccess (Major 2 / Decision 5) — without this clause an
      // orphaned-owner team can never be archived or restored by anyone.
      // contains(coaches, :callerSub) closes the TOCTOU window where
      // revokeCoachAccess removes the caller between the read and this write.
      //
      // Accepted tradeoff (TEAM-ARCHIVE-STEP1-BACKEND-WIRING.md, Decision 5 /
      // Risks): revokeCoachAccess (src/services/invitationService.ts) has no
      // owner guard today, so a co-coach can revoke the current owner and
      // then immediately call assignTeamOwner to take ownership themselves.
      // This is intentionally allowed here (availability over hijack-
      // resistance — an orphaned team must always be reclaimable by *some*
      // coach), but it means "owner" is not a hijack-proof role boundary
      // until revokeCoachAccess itself gains a server-side guard against
      // revoking the current owner (see that plan doc's Required Follow-Ups).
      ConditionExpression: '(attribute_not_exists(ownerId) OR NOT contains(coaches, ownerId)) AND contains(coaches, :callerSub)',
      ExpressionAttributeValues: {
        ':ownerId': callerSub,
        ':callerSub': callerSub,
        ':updatedAt': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
      ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result.Attributes as any;
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      // DynamoDB reports one undifferentiated failure for a compound
      // condition. ReturnValuesOnConditionCheckFailure returns the pre-write
      // item atomically on the exception itself — no re-read, no race — but
      // in raw low-level AttributeValue shape, so it must be unmarshalled.
      const rawItem = (error as { Item?: Record<string, AttributeValue> }).Item;
      const current = rawItem ? (unmarshall(rawItem) as DbItem) : undefined;

      if (!current) {
        throw new Error('Team not found');
      }

      const currentCoaches = current.coaches as string[] | undefined;
      if (current.ownerId && currentCoaches?.includes(current.ownerId as string)) {
        throw new Error('Team already has an owner');
      }

      throw new Error('Access denied: caller is not a coach on this team');
    }

    throw error;
  }
};
