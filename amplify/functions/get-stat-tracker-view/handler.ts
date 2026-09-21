import type { AppSyncIdentityIAM } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../../data/resource';
import { resolveShareLinkAccess, selectUpcomingGames, type GameRecord, type ShareLinkAccessTables } from '../shared/shareLinkAccess';
import { queryAllByGameIdIndex } from '../shared/dynamo';
import { computeActiveGoalkeeperId, type PlayTimeRecordLike, type PositionRoleLike } from '../shared/goalkeeper';

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

interface FormationPositionRow extends PositionRoleLike {
  positionName?: string | null;
}

// Chunked BatchGetItem for FormationPosition rows -- same pattern as
// batchGetPlayers above. Projects `positionName` alongside `role` now (not
// just `role`, as the original Save Auto-Goalkeeper Attribution version
// did) so the same lookup also drives each on-field roster entry's
// positionName -- one query serves both goalkeeper derivation and the
// current-lineup display, rather than a second near-duplicate BatchGetItem.
async function batchGetFormationPositions(
  formationPositionTable: string,
  ids: string[]
): Promise<Map<string, FormationPositionRow>> {
  const map = new Map<string, FormationPositionRow>();
  const uniqueIds = Array.from(new Set(ids));
  const chunkSize = 100; // DynamoDB BatchGetItem max 100 items per request

  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);
    let unprocessedKeys: Array<{ id: string }> = chunk.map((id) => ({ id }));
    do {
      const response = await docClient.send(new BatchGetCommand({
        RequestItems: {
          [formationPositionTable]: {
            Keys: unprocessedKeys,
            ProjectionExpression: 'id, #role, positionName',
            ExpressionAttributeNames: { '#role': 'role' },
          },
        },
      }));
      const rows = (response.Responses?.[formationPositionTable] ?? []) as FormationPositionRow[];
      rows.forEach((row) => map.set(row.id, row));
      unprocessedKeys = (response.UnprocessedKeys?.[formationPositionTable]?.Keys as Array<{ id: string }> | undefined) ?? [];
    } while (unprocessedKeys.length > 0);
  }

  return map;
}

// I/O wrapper around the pure `computeActiveGoalkeeperId` (see
// ../shared/goalkeeper.ts, and its coach-side twin getCurrentGoalkeeperId in
// src/utils/playTimeCalculations.ts): takes the already-queried open
// PlayTimeRecords (see the handler's Promise.all with the roster query
// below), batch-gets the distinct positions from FormationPosition, then
// delegates the goalkeeper derivation to the pure function -- and also
// returns the full positions map so the caller can derive each on-field
// player's positionName from the same single BatchGetItem (see
// batchGetFormationPositions above).
async function fetchActiveGoalkeeperAndPositions(
  formationPositionTable: string,
  openRecords: PlayTimeRecordLike[]
): Promise<{ activeGoalkeeperId: string | null; positionsMap: Map<string, FormationPositionRow> }> {
  const positionIds = Array.from(new Set(
    openRecords.map((r) => r.positionId).filter((id): id is string => !!id)
  ));
  const positionsMap = await batchGetFormationPositions(formationPositionTable, positionIds);

  return {
    activeGoalkeeperId: computeActiveGoalkeeperId(openRecords, Array.from(positionsMap.values())),
    positionsMap,
  };
}

function emptyResult(state: string, teamName: string | null = null) {
  return {
    state,
    teamName,
    opponentName: null,
    status: null,
    currentHalf: null,
    elapsedSeconds: null,
    lastStartTime: null,
    halfLengthMinutes: null,
    ourScore: null,
    opponentScore: null,
    gameId: null,
    roster: [],
    activeGoalkeeperId: null,
    upcomingGames: [],
  };
}

function toUpcomingGame(game: GameRecord) {
  return {
    opponentName: game.opponent ?? null,
    gameDate: game.gameDate ?? null,
    locationName: game.locationName ?? null,
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
//
// Save Auto-Goalkeeper Attribution: also queries PlayTimeRecord's
// playTimeRecordsByGameId GSI and batch-gets FormationPosition (only when
// game.status === 'in-progress') to derive activeGoalkeeperId and each
// on-field player's positionName -- see fetchActiveGoalkeeperAndPositions
// above and amplify/functions/shared/goalkeeper.ts.
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
  const playTimeRecordTable = process.env.PLAY_TIME_RECORD_TABLE;
  const formationPositionTable = process.env.FORMATION_POSITION_TABLE;

  if (
    !shareLinkTable || !teamTable || !gameTable || !rateLimitTable || !teamRosterTable || !playerTable ||
    !playTimeRecordTable || !formationPositionTable
  ) {
    throw new Error('Required environment variables are not set');
  }

  const tables: ShareLinkAccessTables = {
    shareLink: shareLinkTable,
    team: teamTable,
    game: gameTable,
    rateLimit: rateLimitTable,
  };

  // Read dimension (polling the view), not write -- submitStatEvent is the
  // only write-dimension caller. `now` is read once here and threaded
  // through, rather than left to resolveShareLinkAccess's own internal
  // default -- selectUpcomingGames below needs the exact same instant
  // selection was computed against (see ShareLinkAccessOutcome.now's doc
  // comment), not a second, independently-read `Date` that could disagree
  // with `selection` at a millisecond boundary.
  const now = new Date();
  const outcome = await resolveShareLinkAccess(docClient, tables, token, 'STAT_TRACKER', identityId, now, 'read');

  if (!outcome.ok) {
    return emptyResult(outcome.reason);
  }

  const { team, selection, games } = outcome;
  const game = selection.game as GameRecord | null;

  // Upcoming-games list: cheap in-memory derivation off the same
  // already-fetched `games` list resolveShareLinkAccess used for
  // selection -- no extra query. Populated regardless of branch, but by
  // construction (see selectUpcomingGames's doc comment) only ever
  // non-empty on LIVE or NEXT_GAME -- FINISHED, NO_GAME_RIGHT_NOW, and
  // NO_GAMES_YET all imply zero future-dated games exist. The frontend
  // renders it on FINISHED/NEXT_GAME/NO_GAME_RIGHT_NOW/NO_GAMES_YET,
  // falling back to static copy wherever the list comes back empty.
  const upcomingGames = selectUpcomingGames(games, outcome.now).map(toUpcomingGame);

  // Gate on the game actually being `in-progress`, NOT the broader `LIVE`
  // branch (which also covers halftime, per selectGameForFan) -- halftime
  // closes every open PlayTimeRecord, so gating on LIVE would waste a GSI
  // query + BatchGetItem on every halftime poll for a result that's always
  // null anyway. The Stat Tracker's own tap UI is already locked at
  // halftime (StatTrackerView.tsx's tapUiUnlocked keys off the same
  // `status === 'in-progress'` check).
  const isInProgress = game?.status === 'in-progress';

  // The new PlayTimeRecord GSI query runs concurrently with the existing
  // roster query -- they're independent reads. The FormationPosition
  // batch-get below depends on this query's result (needs its distinct
  // positionIds first), so it can't join this same Promise.all.
  const [rosterRows, openPlayTimeRecordsRaw] = await Promise.all([
    queryActiveRosterByTeamId(teamRosterTable, team.id),
    isInProgress
      ? queryAllByGameIdIndex(docClient, playTimeRecordTable, 'playTimeRecordsByGameId', (game as GameRecord).id)
      : Promise.resolve([]),
  ]);

  const openPlayTimeRecords = openPlayTimeRecordsRaw.filter(
    (r) => r.endGameSeconds === null || r.endGameSeconds === undefined
  ) as unknown as PlayTimeRecordLike[];

  const [playersMap, goalkeeperAndPositions] = await Promise.all([
    batchGetPlayers(playerTable, rosterRows.map((r) => r.playerId)),
    isInProgress
      ? fetchActiveGoalkeeperAndPositions(formationPositionTable, openPlayTimeRecords)
      : Promise.resolve({ activeGoalkeeperId: null, positionsMap: new Map<string, FormationPositionRow>() }),
  ]);
  const { activeGoalkeeperId, positionsMap } = goalkeeperAndPositions;

  // playerId -> the FormationPosition.positionName of their currently-open
  // PlayTimeRecord (there's at most one, by construction -- a player can't
  // hold two open PlayTimeRecords in the same game). Absent from this map
  // means bench (or the game isn't in-progress, in which case the map is
  // always empty).
  const playerIdToPositionName = new Map<string, string | null>();
  openPlayTimeRecords.forEach((r) => {
    const positionName = r.positionId ? positionsMap.get(r.positionId)?.positionName ?? null : null;
    if (positionName) playerIdToPositionName.set(r.playerId, positionName);
  });

  const roster = rosterRows
    .map((row) => {
      const player = playersMap.get(row.playerId);
      if (!player) return null;
      return {
        id: row.playerId,
        firstName: player.firstName ?? '',
        lastName: player.lastName ?? '',
        positionName: playerIdToPositionName.get(row.playerId) ?? null,
      };
    })
    .filter((p): p is { id: string; firstName: string; lastName: string; positionName: string | null } => p !== null);

  if (!game) {
    // NO_GAMES_YET / NO_GAME_RIGHT_NOW -- team resolved, roster still useful
    // to show (a helper might open the link before the first game exists).
    return {
      state: selection.branch,
      teamName: team.name ?? null,
      opponentName: null,
      status: null,
      currentHalf: null,
      elapsedSeconds: null,
      lastStartTime: null,
      halfLengthMinutes: null,
      ourScore: null,
      opponentScore: null,
      gameId: null,
      roster,
      activeGoalkeeperId: null,
      upcomingGames,
    };
  }

  return {
    state: selection.branch,
    teamName: team.name ?? null,
    opponentName: game.opponent ?? null,
    status: game.status ?? null,
    currentHalf: game.currentHalf ?? null,
    elapsedSeconds: game.elapsedSeconds ?? null,
    lastStartTime: game.lastStartTime ?? null,
    halfLengthMinutes: game.halfLengthMinutes ?? null,
    ourScore: game.ourScore ?? null,
    opponentScore: game.opponentScore ?? null,
    gameId: game.id,
    roster,
    activeGoalkeeperId,
    upcomingGames,
  };
};
