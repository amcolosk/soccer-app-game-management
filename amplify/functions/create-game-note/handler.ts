import type { Schema } from '../../data/resource';
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

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

function hasValidInGameTiming(gameSeconds: number | null | undefined, half: number | null | undefined): boolean {
  return Number.isInteger(gameSeconds) && (gameSeconds as number) >= 0 && (half === 1 || half === 2);
}

async function isPlayerOnTeamRoster(teamRosterTable: string, teamId: string, playerId: string): Promise<boolean> {
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const rosterResponse = await docClient.send(new ScanCommand({
      TableName: teamRosterTable,
      FilterExpression: 'teamId = :teamId AND playerId = :playerId',
      ExpressionAttributeValues: {
        ':teamId': teamId,
        ':playerId': playerId,
      },
      ProjectionExpression: 'id',
      ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
    }));

    if (rosterResponse.Items && rosterResponse.Items.length > 0) {
      return true;
    }

    exclusiveStartKey = rosterResponse.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return false;
}

type Handler = Schema['createSecureGameNote']['functionHandler'];

export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito;

  // Extract the authenticated user's sub — this becomes authorId.
  // Never accept authorId from caller arguments (it is ignored server-side).
  const callerSub = identity?.sub;
  if (typeof callerSub !== 'string' || callerSub.length === 0) {
    throw new Error('User not authenticated');
  }
  const authorId: string = callerSub;

  const args = event.arguments;
  const noteType = args.noteType;

  // Validate noteType enum (AppSync schema also enforces this, but belt-and-suspenders).
  if (typeof noteType !== 'string') {
    throw new Error(`Invalid noteType: ${String(noteType)}`);
  }

  if (!VALID_NOTE_TYPES.has(noteType)) {
    throw new Error(`Invalid noteType: ${String(noteType)}`);
  }

  // Server-side max-length enforcement for notes (500 chars).
  if (args.notes && args.notes.length > MAX_NOTES_LENGTH) {
    throw new Error(`notes exceeds maximum length of ${MAX_NOTES_LENGTH} characters`);
  }

  if (noteType === 'coaching-point') {
    if (!hasNullTiming(args.gameSeconds, args.half)) {
      throw new Error('coaching-point notes must have null gameSeconds and half');
    }
  } else {
    if (!hasInGameTiming(args.gameSeconds, args.half)) {
      throw new Error('non-coaching notes must include both gameSeconds and half');
    }

    if (!hasValidInGameTiming(args.gameSeconds, args.half)) {
      throw new Error('non-coaching notes must include a non-negative integer gameSeconds and half of 1 or 2');
    }
  }

  const gameNoteTable = process.env.GAME_NOTE_TABLE;
  const gameTable = process.env.GAME_TABLE;
  const teamRosterTable = process.env.TEAM_ROSTER_TABLE;

  if (!gameNoteTable || !gameTable) {
    throw new Error('Required environment variables GAME_NOTE_TABLE and GAME_TABLE are not set');
  }

  // Look up the Game to obtain its coaches array for authorization propagation.
  const gameResponse = await docClient.send(new GetCommand({
    TableName: gameTable,
    Key: { id: args.gameId },
    ProjectionExpression: 'id, teamId, coaches',
  }));

  const game = gameResponse.Item as { id: string; teamId: string; coaches?: string[] } | undefined;

  if (!game) {
    throw new Error(`Game not found: ${args.gameId}`);
  }

  // Verify the caller is a coach on this game.
  if (!game.coaches?.includes(authorId)) {
    throw new Error('Access denied: caller is not a coach on this game');
  }

  if (args.playerId) {
    if (!teamRosterTable) {
      throw new Error('Required environment variable TEAM_ROSTER_TABLE is not set');
    }

    // TeamRoster has no teamId+playerId index in the current schema, so a filtered scan
    // is the narrowest server-side membership check currently available.
    const playerOnRoster = await isPlayerOnTeamRoster(teamRosterTable, game.teamId, args.playerId);
    if (!playerOnRoster) {
      throw new Error('playerId must belong to the game team roster');
    }
  }

  const now = new Date().toISOString();
  const id = randomUUID();

  const item = {
    id,
    __typename: 'GameNote',
    gameId: args.gameId,
    noteType,
    ...(args.playerId ? { playerId: args.playerId } : {}),
    authorId,
    gameSeconds: args.gameSeconds ?? null,
    half: args.half ?? null,
    notes: args.notes ?? null,
    editedAt: null,
    editedById: null,
    timestamp: args.timestamp ?? now,
    coaches: game.coaches ?? [],
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({
    TableName: gameNoteTable,
    Item: item,
  }));

  return item;
};
