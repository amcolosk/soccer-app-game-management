import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
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

type Handler = Schema['restoreTeam']['functionHandler'];

// Owner-authorized restore: reactivates the team and clears current archive
// audit metadata. Does NOT revive invitations expired during archiving —
// that is explicitly out of scope per the plan. Deterministic/idempotent
// when called repeatedly.
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

  if (!team.ownerId) {
    throw new Error('Team has no assigned owner. Assign an owner before restoring.');
  }

  if (team.ownerId !== callerSub) {
    throw new Error('Access denied: only the team owner can restore this team');
  }

  // Major 2: same TOCTOU guard as archive-team — see that handler's comment.
  const coaches = team.coaches as string[] | undefined;
  if (!coaches?.includes(callerSub)) {
    throw new Error('Access denied: only the team owner can restore this team');
  }

  if (team.status === 'archived') {
    const nowIso = new Date().toISOString();
    try {
      const result = await docClient.send(new UpdateCommand({
        TableName: teamTable,
        Key: { id: teamId },
        // Decision (TEAM-ARCHIVE-PLAN Correction 5c): archivedAt/archivedBy are
        // REMOVEd on restore. They are only meaningful while a team is archived,
        // and a stale value on an active team misleads. If archive history is
        // wanted, add append-only audit records instead. Document in
        // docs/SHARING-PERMISSIONS.md when Phase 7 lands.
        UpdateExpression: 'SET #status = :activeStatus, updatedAt = :updatedAt REMOVE archivedAt, archivedBy',
        // contains(coaches, :callerSub) closes the TOCTOU window between the
        // GetCommand above and this write (Major 2).
        ConditionExpression: 'ownerId = :callerSub AND contains(coaches, :callerSub)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':activeStatus': 'active',
          ':updatedAt': nowIso,
          ':callerSub': callerSub,
        },
        ReturnValues: 'ALL_NEW', // Minor 6: replaces the trailing GetCommand.
        ReturnValuesOnConditionCheckFailure: 'ALL_OLD', // Minor 3: shape consistency; unused here.
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return result.Attributes as any;
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        throw new Error('Access denied: only the team owner can restore this team');
      }
      throw error;
    }
  }

  // Already active — idempotent no-op. Nothing was written, so return the
  // team as already fetched rather than re-reading it (Minor 6).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return team as any;
};
