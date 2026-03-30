import type { Schema } from '../../data/resource';
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const VALID_NOTE_TYPES = new Set([
  'coaching-point',
  'gold-star',
  'yellow-card',
  'red-card',
  'other',
]);

const MAX_NOTES_LENGTH = 500;

function hasNullTiming(gameSeconds: number | null | undefined, half: number | null | undefined): boolean {
  return gameSeconds == null && half == null;
}

function hasInGameTiming(gameSeconds: number | null | undefined, half: number | null | undefined): boolean {
  return gameSeconds != null && half != null;
}

type Handler = Schema['updateSecureGameNote']['functionHandler'];

export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito;

  const callerId = identity?.sub;
  if (!callerId) {
    throw new Error('User not authenticated');
  }

  const args = event.arguments;

  if (args.authorId !== undefined && args.authorId !== null) {
    throw new Error('authorId cannot be updated');
  }

  // Validate noteType when provided.
  if (args.noteType && !VALID_NOTE_TYPES.has(args.noteType)) {
    throw new Error(`Invalid noteType: ${args.noteType}`);
  }

  // Server-side max-length enforcement for notes (500 chars).
  if (args.notes && args.notes.length > MAX_NOTES_LENGTH) {
    throw new Error(`notes exceeds maximum length of ${MAX_NOTES_LENGTH} characters`);
  }

  const gameNoteTable = process.env.GAME_NOTE_TABLE;
  const gameTable = process.env.GAME_TABLE;
  const teamRosterTable = process.env.TEAM_ROSTER_TABLE;

  if (!gameNoteTable) {
    throw new Error('Required environment variable GAME_NOTE_TABLE is not set');
  }

  // Fetch the existing note to verify caller authorization.
  const noteResponse = await docClient.send(new GetCommand({
    TableName: gameNoteTable,
    Key: { id: args.id },
  }));

  const existing = noteResponse.Item as {
    id: string;
    authorId?: string;
    coaches?: string[];
    gameId?: string;
    noteType?: string;
    playerId?: string | null;
    gameSeconds?: number | null;
    half?: number | null;
    notes?: string | null;
    timestamp?: string;
    createdAt?: string;
  } | undefined;

  if (!existing) {
    throw new Error(`GameNote not found: ${args.id}`);
  }

  // Only coaches on this game may update notes.
  if (!existing.coaches?.includes(callerId)) {
    throw new Error('Access denied: caller is not a coach on this game');
  }

  const resultingNoteType = args.noteType ?? existing.noteType;
  if (!resultingNoteType || !VALID_NOTE_TYPES.has(resultingNoteType)) {
    throw new Error(`Invalid noteType: ${String(resultingNoteType)}`);
  }

  // Timing fields are immutable in this secure update path, so validate noteType
  // changes against the existing persisted timing values.
  if (resultingNoteType === 'coaching-point') {
    if (!hasNullTiming(existing.gameSeconds, existing.half)) {
      throw new Error('coaching-point notes must retain null gameSeconds and half');
    }
  } else if (!hasInGameTiming(existing.gameSeconds, existing.half)) {
    throw new Error('non-coaching notes must retain both gameSeconds and half');
  }

  if (args.playerId) {
    if (!existing.gameId) {
      throw new Error('GameNote is missing gameId');
    }

    if (!gameTable || !teamRosterTable) {
      throw new Error('Required environment variables GAME_TABLE and TEAM_ROSTER_TABLE are not set');
    }

    const gameResponse = await docClient.send(new GetCommand({
      TableName: gameTable,
      Key: { id: existing.gameId },
      ProjectionExpression: 'id, teamId',
    }));

    const game = gameResponse.Item as { id: string; teamId: string } | undefined;

    if (!game) {
      throw new Error(`Game not found: ${existing.gameId}`);
    }

    const rosterResponse = await docClient.send(new ScanCommand({
      TableName: teamRosterTable,
      FilterExpression: 'teamId = :teamId AND playerId = :playerId',
      ExpressionAttributeValues: {
        ':teamId': game.teamId,
        ':playerId': args.playerId,
      },
      ProjectionExpression: 'id',
      Limit: 1,
    }));

    if (!rosterResponse.Items || rosterResponse.Items.length === 0) {
      throw new Error('playerId must belong to the game team roster');
    }
  }

  // Build update expression — authorId is NEVER updated regardless of what was supplied.
  // Any caller-supplied authorId argument value in args is ignored here.
  const expressionParts: string[] = ['#updatedAt = :updatedAt'];
  const expressionNames: Record<string, string> = { '#updatedAt': 'updatedAt' };
  const expressionValues: Record<string, unknown> = { ':updatedAt': new Date().toISOString() };

  if (args.noteType !== undefined && args.noteType !== null) {
    expressionParts.push('#noteType = :noteType');
    expressionNames['#noteType'] = 'noteType';
    expressionValues[':noteType'] = args.noteType;
  }

  if (args.playerId !== undefined) {
    expressionParts.push('#playerId = :playerId');
    expressionNames['#playerId'] = 'playerId';
    expressionValues[':playerId'] = args.playerId ?? null;
  }

  if (args.notes !== undefined) {
    expressionParts.push('#notes = :notes');
    expressionNames['#notes'] = 'notes';
    expressionValues[':notes'] = args.notes ?? null;
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
    timestamp: updated?.timestamp ?? existing.timestamp ?? new Date().toISOString(),
    coaches: existing.coaches ?? [],
    createdAt: existing.createdAt ?? new Date().toISOString(),
    updatedAt: expressionValues[':updatedAt'] as string,
  };
};
