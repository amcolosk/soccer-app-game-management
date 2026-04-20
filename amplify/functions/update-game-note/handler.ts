import type { Schema } from '../../data/resource';
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getGameNoteActionDecision } from '../../../shared/policies/gameNoteActionPolicy';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const MAX_NOTES_LENGTH = 500;

type Handler = Schema['updateSecureGameNote']['functionHandler'];

export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito;

  const callerId = identity?.sub;
  if (!callerId) {
    throw new Error('AUTH_UNAUTHENTICATED');
  }

  const args = event.arguments;

  if (args.authorId !== undefined || args.noteType !== undefined || args.playerId !== undefined) {
    throw new Error('VALIDATION_NOTES_ONLY_EDIT');
  }

  // Server-side max-length enforcement for notes (500 chars).
  if (args.notes && args.notes.length > MAX_NOTES_LENGTH) {
    throw new Error('VALIDATION_NOTES_TOO_LONG');
  }

  const gameNoteTable = process.env.GAME_NOTE_TABLE;
  const gameTable = process.env.GAME_TABLE;
  const teamTable = process.env.TEAM_TABLE;

  if (!gameNoteTable || !gameTable || !teamTable) {
    throw new Error('Missing required environment variables for update-game-note handler');
  }

  const noteResponse = await docClient.send(new GetCommand({
    TableName: gameNoteTable,
    Key: { id: args.id },
    ProjectionExpression: 'id, gameId, noteType, authorId, notes, timestamp, gameSeconds, half, playerId, createdAt, coaches, editedAt, editedById',
  }));

  const existing = noteResponse.Item as {
    id: string;
    authorId?: string;
    gameId?: string;
    noteType?: string;
    playerId?: string | null;
    gameSeconds?: number | null;
    half?: number | null;
    notes?: string | null;
    timestamp?: string;
    createdAt?: string;
    coaches?: string[];
    editedAt?: string | null;
    editedById?: string | null;
  } | undefined;

  if (!existing) {
    throw new Error('NOT_FOUND_GAME_NOTE');
  }

  if (!existing.gameId) {
    throw new Error('NOT_FOUND_GAME');
  }

  const gameResponse = await docClient.send(new GetCommand({
    TableName: gameTable,
    Key: { id: existing.gameId },
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

  if (!team.coaches?.includes(callerId)) {
    throw new Error('AUTH_COACH_REQUIRED');
  }

  const policyDecision = getGameNoteActionDecision({
    noteType: (existing.noteType ?? 'other') as 'coaching-point' | 'gold-star' | 'yellow-card' | 'red-card' | 'other',
    isTeamCoach: true,
    isAuthor: existing.authorId === callerId,
  });
  if (!policyDecision.canEdit) {
    throw new Error('AUTH_COACH_REQUIRED');
  }

  const incomingNotes = args.notes ?? null;
  const previousNotes = existing.notes ?? null;
  const notesChanged = incomingNotes !== previousNotes;

  const now = new Date().toISOString();
  const expressionParts: string[] = ['#updatedAt = :updatedAt', '#notes = :notes'];
  const expressionNames: Record<string, string> = {
    '#updatedAt': 'updatedAt',
    '#notes': 'notes',
  };
  const expressionValues: Record<string, unknown> = {
    ':updatedAt': now,
    ':notes': incomingNotes,
  };

  if (notesChanged) {
    expressionParts.push('#editedAt = :editedAt', '#editedById = :editedById');
    expressionNames['#editedAt'] = 'editedAt';
    expressionNames['#editedById'] = 'editedById';
    expressionValues[':editedAt'] = now;
    expressionValues[':editedById'] = callerId;
  }

  const updateResponse = await docClient.send(new UpdateCommand({
    TableName: gameNoteTable,
    Key: { id: args.id },
    UpdateExpression: `SET ${expressionParts.join(', ')}`,
    ExpressionAttributeNames: expressionNames,
    ExpressionAttributeValues: expressionValues,
    ReturnValues: 'ALL_NEW',
  }));

  const updated = updateResponse.Attributes as typeof existing;

  return {
    id: updated?.id ?? args.id,
    __typename: 'GameNote' as const,
    gameId: updated?.gameId ?? '',
    noteType: (updated?.noteType ?? existing.noteType) as 'coaching-point' | 'gold-star' | 'yellow-card' | 'red-card' | 'other',
    playerId: updated?.playerId ?? null,
    authorId: existing.authorId ?? null,
    gameSeconds: updated?.gameSeconds ?? null,
    half: updated?.half ?? null,
    notes: updated?.notes ?? null,
    editedAt: updated?.editedAt ?? null,
    editedById: updated?.editedById ?? null,
    timestamp: updated?.timestamp ?? existing.timestamp ?? new Date().toISOString(),
    coaches: existing.coaches ?? [],
    createdAt: existing.createdAt ?? new Date().toISOString(),
    updatedAt: now,
  };
};
