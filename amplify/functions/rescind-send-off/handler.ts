import type { Schema } from '../../data/resource';
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getRescindSendOffDecision, type PolicyNoteType } from '../../../shared/policies/gameNoteActionPolicy';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

type Handler = Schema['rescindSendOff']['functionHandler'];

// Touches only rescindedAt / rescindedById. rescindedById is always the caller's
// session sub; nothing else on the note (noteType, notes, authorId) can change here.
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
    throw new Error('Missing required environment variables for rescind-send-off handler');
  }

  const noteResponse = await docClient.send(new GetCommand({
    TableName: gameNoteTable,
    Key: { id: event.arguments.id },
    ProjectionExpression: 'id, gameId, noteType, rescindedAt',
  }));
  const note = noteResponse.Item as {
    id: string;
    gameId?: string;
    noteType?: string;
    rescindedAt?: string | null;
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

  const decision = getRescindSendOffDecision({
    noteType: (note.noteType ?? 'other') as PolicyNoteType,
    isTeamCoach: Boolean(team.coaches?.includes(callerSub)),
    alreadyRescinded: Boolean(note.rescindedAt),
  });

  if (!decision.canRescind) {
    if (decision.reason === 'NOT_RED_CARD') throw new Error('RULE_RESCIND_NOT_RED_CARD');
    if (decision.reason === 'ALREADY_RESCINDED') throw new Error('RULE_ALREADY_RESCINDED');
    throw new Error('AUTH_COACH_REQUIRED');
  }

  const now = new Date().toISOString();
  let updateResponse;
  try {
    updateResponse = await docClient.send(new UpdateCommand({
    TableName: gameNoteTable,
    Key: { id: note.id },
    UpdateExpression: 'SET #rescindedAt = :rescindedAt, #rescindedById = :rescindedById, #updatedAt = :updatedAt',
    ConditionExpression: 'attribute_exists(id) AND (attribute_not_exists(#rescindedAt) OR attribute_type(#rescindedAt, :nullType))',
    ExpressionAttributeNames: {
      '#rescindedAt': 'rescindedAt',
      '#rescindedById': 'rescindedById',
      '#updatedAt': 'updatedAt',
    },
    ExpressionAttributeValues: {
      ':rescindedAt': now,
      ':rescindedById': callerSub,
      ':updatedAt': now,
      ':nullType': 'NULL',
    },
    ReturnValues: 'ALL_NEW',
  }));
  } catch (error) {
    // A concurrent rescind (or a note deleted underneath us) fails the condition.
    if ((error as { name?: string })?.name === 'ConditionalCheckFailedException') {
      throw new Error('RULE_ALREADY_RESCINDED');
    }
    throw error;
  }

  const updated = (updateResponse.Attributes ?? {}) as Record<string, unknown>;

  return {
    id: note.id,
    __typename: 'GameNote' as const,
    gameId: note.gameId,
    noteType: (updated.noteType ?? note.noteType) as 'coaching-point' | 'gold-star' | 'yellow-card' | 'red-card' | 'other',
    playerId: (updated.playerId as string | null | undefined) ?? null,
    positionId: (updated.positionId as string | null | undefined) ?? null,
    authorId: (updated.authorId as string | null | undefined) ?? null,
    gameSeconds: (updated.gameSeconds as number | null | undefined) ?? null,
    half: (updated.half as number | null | undefined) ?? null,
    notes: (updated.notes as string | null | undefined) ?? null,
    editedAt: (updated.editedAt as string | null | undefined) ?? null,
    editedById: (updated.editedById as string | null | undefined) ?? null,
    rescindedAt: now,
    rescindedById: callerSub,
    timestamp: (updated.timestamp as string | undefined) ?? now,
    coaches: (updated.coaches as string[] | undefined) ?? team.coaches ?? [],
    createdAt: (updated.createdAt as string | undefined) ?? now,
    updatedAt: now,
  };
};
