import type { AppSyncIdentityIAM } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../../data/resource';
import { resolveShareLinkAccess, type GameRecord, type ShareLinkAccessTables } from '../shared/shareLinkAccess';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

type Handler = Schema['getFanGameView']['functionHandler'];

interface OnFieldPlayer {
  firstName: string;
  lastInitial: string;
  positionName: string | null;
}

interface RecentEvent {
  type: string;
  playerName: string | null;
  minute: number | null;
  half: number | null;
}

// First name + last INITIAL only — no birthYear, no coach identities, no
// playerId (see plan's "getFanGameView stays FAN-only" decision: playerIds
// are stable internal UUIDs and a gratuitous identifier leak to anyone
// holding a screenshotted/forwarded Fan Mode link).
function toLastInitial(lastName?: string | null): string {
  if (!lastName) return '';
  return `${lastName.trim().charAt(0).toUpperCase()}.`;
}

function toDisplayName(firstName?: string | null, lastName?: string | null): string | null {
  if (!firstName) return null;
  const initial = toLastInitial(lastName);
  return initial ? `${firstName} ${initial}` : firstName;
}

async function getPlayersByIds(playerTable: string, ids: string[]): Promise<Map<string, { firstName?: string; lastName?: string }>> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const map = new Map<string, { firstName?: string; lastName?: string }>();
  await Promise.all(uniqueIds.map(async (id) => {
    const response = await docClient.send(new GetCommand({
      TableName: playerTable,
      Key: { id },
      ProjectionExpression: 'id, firstName, lastName',
    }));
    if (response.Item) {
      map.set(id, response.Item as { firstName?: string; lastName?: string });
    }
  }));
  return map;
}

async function getFieldPositionsByIds(fieldPositionTable: string, ids: string[]): Promise<Map<string, { positionName?: string }>> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const map = new Map<string, { positionName?: string }>();
  await Promise.all(uniqueIds.map(async (id) => {
    const response = await docClient.send(new GetCommand({
      TableName: fieldPositionTable,
      Key: { id },
      ProjectionExpression: 'id, positionName',
    }));
    if (response.Item) {
      map.set(id, response.Item as { positionName?: string });
    }
  }));
  return map;
}

// Query-by-physical-index-name, same pattern as delete-game-safe/handler.ts
// and shareLinkAccess.ts's queryAllGamesByTeamId — this Lambda has no
// GraphQL client, so it queries the confirmed physical GSI name directly.
async function queryAllByGameIdIndex(tableName: string, indexName: string, gameId: string): Promise<Array<Record<string, unknown>>> {
  const results: Array<Record<string, unknown>> = [];
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
      results.push(...response.Items);
    }
    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);
  return results;
}

function emptyResult(state: string, teamName: string | null = null) {
  return {
    state,
    teamName,
    opponentName: null,
    locationName: null,
    status: null,
    currentHalf: null,
    elapsedSeconds: null,
    lastStartTime: null,
    halfLengthMinutes: null,
    ourScore: null,
    opponentScore: null,
    gameDate: null,
    onFieldPlayers: [],
    recentEvents: [],
  };
}

// Guest + authenticated(identityPool) — see resource.ts / data/resource.ts
// comments for why both grants are needed. Composes the shared
// shareLinkAccess.ts pipeline (token -> team -> validity -> rate-limit ->
// game-selection) and layers on the Fan-Mode-specific curated payload
// (on-field lineup + recent events) — this handler owns that shaping;
// shareLinkAccess.ts deliberately does not, since B2's getStatTrackerView
// needs a materially different payload from the same pipeline.
export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityIAM | undefined;
  const identityId = identity?.cognitoIdentityId;

  const { token } = event.arguments;

  const shareLinkTable = process.env.SHARE_LINK_TABLE;
  const teamTable = process.env.TEAM_TABLE;
  const gameTable = process.env.GAME_TABLE;
  const rateLimitTable = process.env.FAN_VIEW_RATE_LIMIT_TABLE;
  const playTimeRecordTable = process.env.PLAY_TIME_RECORD_TABLE;
  const playerTable = process.env.PLAYER_TABLE;
  const fieldPositionTable = process.env.FIELD_POSITION_TABLE;
  const goalTable = process.env.GOAL_TABLE;
  const substitutionTable = process.env.SUBSTITUTION_TABLE;

  if (
    !shareLinkTable || !teamTable || !gameTable || !rateLimitTable ||
    !playTimeRecordTable || !playerTable || !fieldPositionTable || !goalTable || !substitutionTable
  ) {
    throw new Error('Required environment variables are not set');
  }

  const tables: ShareLinkAccessTables = {
    shareLink: shareLinkTable,
    team: teamTable,
    game: gameTable,
    rateLimit: rateLimitTable,
  };

  const outcome = await resolveShareLinkAccess(docClient, tables, token, 'FAN', identityId);

  if (!outcome.ok) {
    return emptyResult(outcome.reason);
  }

  const { team, selection } = outcome;
  const game = selection.game as GameRecord | null;

  if (!game) {
    // NO_GAMES_YET / NO_GAME_RIGHT_NOW — team resolved, but nothing to show.
    return emptyResult(selection.branch, team.name ?? null);
  }

  const isLive = selection.branch === 'LIVE';
  const showEvents = selection.branch === 'LIVE' || selection.branch === 'FINISHED';

  const [openPlayTimeRecordsRaw, goalsRaw, substitutionsRaw] = await Promise.all([
    isLive ? queryAllByGameIdIndex(playTimeRecordTable, 'playTimeRecordsByGameId', game.id) : Promise.resolve([]),
    showEvents ? queryAllByGameIdIndex(goalTable, 'goalsByGameId', game.id) : Promise.resolve([]),
    showEvents ? queryAllByGameIdIndex(substitutionTable, 'substitutionsByGameId', game.id) : Promise.resolve([]),
  ]);

  const openRecords = openPlayTimeRecordsRaw.filter((r) => r.endGameSeconds === null || r.endGameSeconds === undefined);
  const goals = goalsRaw as Array<{ scoredByUs?: boolean; scorerId?: string | null; gameSeconds?: number; half?: number }>;
  const substitutions = substitutionsRaw as Array<{ playerInId?: string | null; gameSeconds?: number | null; half?: number | null }>;

  const playerIdsForOnField = openRecords.map((r) => r.playerId as string);
  const positionIdsForOnField = openRecords.map((r) => r.positionId as string).filter(Boolean);
  const scorerIds = goals.map((g) => g.scorerId).filter((id): id is string => !!id);
  const playerInIds = substitutions.map((s) => s.playerInId).filter((id): id is string => !!id);

  const [playersMap, positionsMap] = await Promise.all([
    getPlayersByIds(playerTable, [...playerIdsForOnField, ...scorerIds, ...playerInIds]),
    getFieldPositionsByIds(fieldPositionTable, positionIdsForOnField),
  ]);

  const onFieldPlayers: OnFieldPlayer[] = openRecords.map((r) => {
    const player = playersMap.get(r.playerId as string);
    const position = r.positionId ? positionsMap.get(r.positionId as string) : undefined;
    return {
      firstName: player?.firstName ?? 'Player',
      lastInitial: toLastInitial(player?.lastName),
      positionName: position?.positionName ?? null,
    };
  });

  const goalEvents: RecentEvent[] = goals.map((g) => ({
    type: 'GOAL',
    playerName: g.scoredByUs && g.scorerId
      ? toDisplayName(playersMap.get(g.scorerId)?.firstName, playersMap.get(g.scorerId)?.lastName)
      : null,
    minute: typeof g.gameSeconds === 'number' ? Math.floor(g.gameSeconds / 60) : null,
    half: g.half ?? null,
  }));

  const substitutionEvents: RecentEvent[] = substitutions.map((s) => ({
    type: 'SUBSTITUTION',
    playerName: s.playerInId
      ? toDisplayName(playersMap.get(s.playerInId)?.firstName, playersMap.get(s.playerInId)?.lastName)
      : null,
    minute: typeof s.gameSeconds === 'number' ? Math.floor(s.gameSeconds / 60) : null,
    half: s.half ?? null,
  }));

  const recentEvents = [...goalEvents, ...substitutionEvents]
    .sort((a, b) => {
      const halfDiff = (b.half ?? 0) - (a.half ?? 0);
      if (halfDiff !== 0) return halfDiff;
      return (b.minute ?? 0) - (a.minute ?? 0);
    })
    .slice(0, 5);

  return {
    state: selection.branch,
    teamName: team.name ?? null,
    opponentName: game.opponent ?? null,
    locationName: game.locationName ?? null,
    status: game.status ?? null,
    currentHalf: game.currentHalf ?? null,
    elapsedSeconds: game.elapsedSeconds ?? null,
    lastStartTime: game.lastStartTime ?? null,
    halfLengthMinutes: game.halfLengthMinutes ?? null,
    ourScore: game.ourScore ?? null,
    opponentScore: game.opponentScore ?? null,
    gameDate: game.gameDate ?? null,
    onFieldPlayers: isLive ? onFieldPlayers : [],
    recentEvents: showEvents ? recentEvents : [],
  };
};
