import type { Schema } from '../../data/resource';
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { getGameNoteActionDecision, type PolicyNoteType } from '../../../shared/policies/gameNoteActionPolicy';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

type Handler = Schema['deleteSecureGameNote']['functionHandler'];

export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito;
  const callerSub = identity?.sub;
  if (!callerSub) {
    throw new Error('AUTH_UNAUTHENTICATED');
  }

  const gameNoteTable = process.env.GAME_NOTE_TABLE;
  const gameTable = process.env.GAME_TABLE;
  const teamTable = process.env.TEAM_TABLE;
  if (!gameNoteTable || !gameTable || !teamTable) {
    throw new Error('Missing required environment variables for delete-game-note handler');
  }

  const noteResponse = await docClient.send(new GetCommand({
    TableName: gameNoteTable,
    Key: { id: event.arguments.id },
    ProjectionExpression: 'id, gameId, noteType, authorId',
  }));
  const note = noteResponse.Item as {
    id: string;
    gameId?: string;
    noteType?: string;
    authorId?: string;
  } | undefined;

  if (!note) {
    throw new Error('NOT_FOUND_GAME_NOTE');
  }

  if (!note.gameId) {
    throw new Error('NOT_FOUND_GAME');
  }

  const gameResponse = await docClient.send(new GetCommand({
    TableName: gameTable,
    Key: { id: note.gameId },
    ProjectionExpression: 'id, teamId',
  }));
  const game = gameResponse.Item as { id: string; teamId?: string } | undefined;
  if (!game) {
    throw new Error('NOT_FOUND_GAME');
  }

  if (!game.teamId) {
    throw new Error('NOT_FOUND_TEAM');
  }

  const teamResponse = await docClient.send(new GetCommand({
    TableName: teamTable,
    Key: { id: game.teamId },
    ProjectionExpression: 'id, coaches',
  }));
  const team = teamResponse.Item as { id: string; coaches?: string[] } | undefined;
  if (!team) {
    throw new Error('NOT_FOUND_TEAM');
  }

  const isTeamCoach = Boolean(team.coaches?.includes(callerSub));
  if (!isTeamCoach) {
    throw new Error('AUTH_COACH_REQUIRED');
  }

  const decision = getGameNoteActionDecision({
    noteType: (note.noteType ?? 'other') as PolicyNoteType,
    isTeamCoach,
    isAuthor: note.authorId === callerSub,
  });

  if (!decision.canDelete) {
    if (decision.deleteReason === 'NOT_AUTHOR') {
      throw new Error('AUTH_DELETE_AUTHOR_REQUIRED');
    }
    if (decision.deleteReason === 'NOTE_TYPE_NON_DELETABLE') {
      throw new Error('RULE_DELETE_DISALLOWED_NOTE_TYPE');
    }
    throw new Error('AUTH_COACH_REQUIRED');
  }

  await docClient.send(new DeleteCommand({
    TableName: gameNoteTable,
    Key: { id: note.id },
    ConditionExpression: 'attribute_exists(id)',
  }));

  return {
    success: true,
    message: 'Game note deleted',
  };
};
