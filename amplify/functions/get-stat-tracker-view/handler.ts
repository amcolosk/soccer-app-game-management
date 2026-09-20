import type { AppSyncIdentityIAM } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../../data/resource';
import { resolveShareLinkAccess, type GameRecord, type ShareLinkAccessTables } from '../shared/shareLinkAccess';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

type Handler = Schema['getStatTrackerView']['functionHandler'];

// Amplify Gen2 auto-creates a `teamId`-hash-key relationship GSI on
// TeamRoster named `gsi-Team.roster` -- same confirmed-physical-name
// pattern coachArraySync.ts documents and revoke-coach-access/handler.ts
// already uses for this exact table.
const TEAM_ROSTER_INDEX = 'gsi-Team.roster';

interface TeamRosterRow {
  teamId: string;
  playerId: string;
  isActive?: boolean | null;
}

interface PlayerRow {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
}

async function queryActiveRosterByTeamId(teamRosterTable: string, teamId: string): Promise<TeamRosterRow[]> {
  const results: TeamRosterRow[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const response = await docClient.send(new QueryCommand({
      TableName: teamRosterTable,
      IndexName: TEAM_ROSTER_INDEX,
      KeyConditionExpression: 'teamId = :teamId',
      ExpressionAttributeValues: { ':teamId': teamId },
      ExclusiveStartKey: exclusiveStartKey,
    }));
    if (response.Items) {
      results.push(...(response.Items as TeamRosterRow[]));
    }
    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  // "Active roster" is pinned to TeamRoster.isActive (the roster-membership
  // flag), not Player.isActive (a different concern) -- per the plan, this
  // is what keeps the helper's picker showing the same set the coach's own
  // lineup UI does.
  return results.filter((row) => row.isActive !== false);
}

// Chunked BatchGetItem, not one GetCommand per player -- same efficiency
// concern get-fan-game-view's own roster-adjacent lookups raised, more
// urgent here since this page polls even more frequently and needs the
// FULL roster, not just a handful of on-field players.
async function batchGetPlayers(playerTable: string, ids: string[]): Promise<Map<string, PlayerRow>> {
  const map = new Map<string, PlayerRow>();
  const uniqueIds = Array.from(new Set(ids));
  const chunkSize = 100; // DynamoDB BatchGetItem max 100 items per request

  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);
    let unprocessedKeys: Array<{ id: string }> = chunk.map((id) => ({ id }));
    do {
      const response = await docClient.send(new BatchGetCommand({
        RequestItems: {
          [playerTable]: { Keys: unprocessedKeys },
        },
      }));
      const players = (response.Responses?.[playerTable] ?? []) as PlayerRow[];
      players.forEach((p) => map.set(p.id, p));
      unprocessedKeys = (response.UnprocessedKeys?.[playerTable]?.Keys as Array<{ id: string }> | undefined) ?? [];
    } while (unprocessedKeys.length > 0);
  }

  return map;
}

function emptyResult(state: string, teamName: string | null = null) {
  return {
    state,
    teamName,
    opponentName: null,
    status: null,
    currentHalf: null,
    gameId: null,
    roster: [],
  };
}

// Guest + authenticated(identityPool) -- same rationale as getFanGameView: a
// coach opening their own freshly-generated Stat Tracker link to confirm it
// works is exactly as real a first-touch scenario here as it was for Fan
// Mode. Composes the shared shareLinkAccess.ts pipeline (token -> team ->
// validity -> rate-limit -> game-selection), but shapes a materially
// different payload than getFanGameView -- full active roster (with
// playerIds, for the helper's own player picker) instead of an anonymized
// on-field-only lineup. See the plan's "getFanGameView stays FAN-only"
// decision for why these are two separate operations, not one type-gated
// one.
export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityIAM | undefined;
  const identityId = identity?.cognitoIdentityId;

  const { token } = event.arguments;

  const shareLinkTable = process.env.SHARE_LINK_TABLE;
  const teamTable = process.env.TEAM_TABLE;
  const gameTable = process.env.GAME_TABLE;
  const rateLimitTable = process.env.FAN_VIEW_RATE_LIMIT_TABLE;
  const teamRosterTable = process.env.TEAM_ROSTER_TABLE;
  const playerTable = process.env.PLAYER_TABLE;

  if (!shareLinkTable || !teamTable || !gameTable || !rateLimitTable || !teamRosterTable || !playerTable) {
    throw new Error('Required environment variables are not set');
  }

  const tables: ShareLinkAccessTables = {
    shareLink: shareLinkTable,
    team: teamTable,
    game: gameTable,
    rateLimit: rateLimitTable,
  };

  // Read dimension (polling the view), not write -- submitStatEvent is the
  // only write-dimension caller.
  const outcome = await resolveShareLinkAccess(docClient, tables, token, 'STAT_TRACKER', identityId, undefined, 'read');

  if (!outcome.ok) {
    return emptyResult(outcome.reason);
  }

  const { team, selection } = outcome;
  const game = selection.game as GameRecord | null;

  const rosterRows = await queryActiveRosterByTeamId(teamRosterTable, team.id);
  const playersMap = await batchGetPlayers(playerTable, rosterRows.map((r) => r.playerId));

  const roster = rosterRows
    .map((row) => {
      const player = playersMap.get(row.playerId);
      if (!player) return null;
      return {
        id: row.playerId,
        firstName: player.firstName ?? '',
        lastName: player.lastName ?? '',
        // Not derived in this milestone -- the roster fetch is a
        // Player-only batch fetch (no FormationPosition lookup); left null
        // rather than guessed at.
        positionName: null,
      };
    })
    .filter((p): p is { id: string; firstName: string; lastName: string; positionName: null } => p !== null);

  if (!game) {
    // NO_GAMES_YET / NO_GAME_RIGHT_NOW -- team resolved, roster still useful
    // to show (a helper might open the link before the first game exists).
    return {
      state: selection.branch,
      teamName: team.name ?? null,
      opponentName: null,
      status: null,
      currentHalf: null,
      gameId: null,
      roster,
    };
  }

  return {
    state: selection.branch,
    teamName: team.name ?? null,
    opponentName: game.opponent ?? null,
    status: game.status ?? null,
    currentHalf: game.currentHalf ?? null,
    gameId: game.id,
    roster,
  };
};
