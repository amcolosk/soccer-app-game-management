import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../../data/resource';
import { assertTeamAccess } from '../shared/teamAccess';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

type Handler = Schema['unlinkTeamCalendar']['functionHandler'];

/**
 * Small dedicated Lambda mirroring the archiveTeam/restoreTeam pattern of
 * one purpose-specific function per action (docs/plans/
 * CALENDAR-FEED-GAME-IMPORT-PLAN.md, New mutations). Deletes the team's
 * CalendarFeed row and clears the five Team status fields. `Game.external*`
 * fields on already-imported games are deliberately left untouched (Risks,
 * "Unlink semantics") so a future re-link re-matches by externalUid instead
 * of creating duplicates.
 */
export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito;
  const callerSub = identity?.sub;
  if (typeof callerSub !== 'string' || callerSub.length === 0) {
    throw new Error('User not authenticated');
  }

  const { teamId } = event.arguments;
  const teamTable = process.env.TEAM_TABLE;
  const calendarFeedTable = process.env.CALENDAR_FEED_TABLE;
  if (!teamTable || !calendarFeedTable) {
    throw new Error('Required environment variables are not set');
  }

  await assertTeamAccess(docClient, teamTable, teamId, callerSub, {
    archivedMessage: 'Cannot unlink a calendar for an archived team. Restore the team first.',
  });

  // Idempotent: deleting a CalendarFeed row that doesn't exist is a no-op,
  // no attribute_exists condition needed (unlike deleteGameSafe's cascade,
  // there's nothing else that depends on this row's presence).
  await docClient.send(new DeleteCommand({
    TableName: calendarFeedTable,
    Key: { teamId },
  }));

  await docClient.send(new UpdateCommand({
    TableName: teamTable,
    Key: { id: teamId },
    UpdateExpression: 'SET updatedAt = :now REMOVE calendarFeedProvider, calendarFeedTeamAlias, calendarFeedHost, calendarFeedLastSyncedAt, calendarFeedLastError',
    ExpressionAttributeValues: { ':now': new Date().toISOString() },
  }));

  return true;
};
