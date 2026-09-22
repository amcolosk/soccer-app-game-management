import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

// Read-only export of the tables needed for ad hoc analytical questions that
// span multiple models with no AppSync join between them (e.g. "how many
// goals did each center back leak while in that position?" -- Goal carries
// no positional data; it has to be derived by joining Goal.gameSeconds
// against the PlayTimeRecord interval active at that moment, then resolving
// positionId against FormationPosition -- see playTimeCalculations.ts's
// getCurrentGoalkeeperId for the same lookup pattern already used in-app).
//
// This never writes anything. It runs the same way as
// scripts/repair-shared-team-permissions.ts: raw AWS SDK against the
// underlying DynamoDB tables (bypassing AppSync/Cognito, using whatever AWS
// credentials/profile are active in your shell), because there's no
// Cognito-authenticated "coach" identity available outside the running app.
//
// Also exports Formation and LineupAssignment, needed for the
// formation-win-rate.sql query: LineupAssignment.positionId is populated
// with FormationPosition ids (same current-era precedent documented on
// getCurrentGoalkeeperId in playTimeCalculations.ts), so a game's starting
// formation is derived from its starters' positionId -> FormationPosition
// .formationId, not from Team.formationId (which is a mutable current
// pointer, not a historical record of what a given game was played in).
//
// Usage:
//   npx tsx scripts/export-analytics-data.ts [--out-dir=./analytics-export] [--team-id=<id>]
//
// Table names come from env vars or matching --flag=value (same convention
// as repair-shared-team-permissions.ts). Find them in the Amplify sandbox/
// branch outputs (CloudFormation stack resources), not in amplify_outputs.json
// (that file only has the AppSync endpoint, not table names).
//   TEAM_TABLE GAME_TABLE GOAL_TABLE SHOT_TABLE SAVE_TABLE
//   PLAY_TIME_RECORD_TABLE FORMATION_TABLE FORMATION_POSITION_TABLE
//   LINEUP_ASSIGNMENT_TABLE PLAYER_TABLE

type ScriptConfig = {
  teamTable: string;
  gameTable: string;
  goalTable: string;
  shotTable: string;
  saveTable: string;
  playTimeRecordTable: string;
  formationTable: string;
  formationPositionTable: string;
  lineupAssignmentTable: string;
  playerTable: string;
  outDir: string;
  teamId?: string;
};

function getArgValue(flag: string): string | undefined {
  const argument = process.argv.find((value) => value.startsWith(`${flag}=`));
  return argument ? argument.slice(flag.length + 1) : undefined;
}

function getRequiredValue(label: string, envName: string, flagName: string): string {
  const value = getArgValue(flagName) ?? process.env[envName];
  if (!value) {
    throw new Error(`Missing ${label}. Provide ${flagName}=<value> or set ${envName}.`);
  }
  return value;
}

function parseConfig(): ScriptConfig {
  return {
    teamTable: getRequiredValue('team table', 'TEAM_TABLE', '--team-table'),
    gameTable: getRequiredValue('game table', 'GAME_TABLE', '--game-table'),
    goalTable: getRequiredValue('goal table', 'GOAL_TABLE', '--goal-table'),
    shotTable: getRequiredValue('shot table', 'SHOT_TABLE', '--shot-table'),
    saveTable: getRequiredValue('save table', 'SAVE_TABLE', '--save-table'),
    playTimeRecordTable: getRequiredValue('play time record table', 'PLAY_TIME_RECORD_TABLE', '--play-time-record-table'),
    formationTable: getRequiredValue('formation table', 'FORMATION_TABLE', '--formation-table'),
    formationPositionTable: getRequiredValue('formation position table', 'FORMATION_POSITION_TABLE', '--formation-position-table'),
    lineupAssignmentTable: getRequiredValue('lineup assignment table', 'LINEUP_ASSIGNMENT_TABLE', '--lineup-assignment-table'),
    playerTable: getRequiredValue('player table', 'PLAYER_TABLE', '--player-table'),
    outDir: getArgValue('--out-dir') ?? './analytics-export',
    teamId: getArgValue('--team-id'),
  };
}

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

async function scanAll<T extends Record<string, unknown>>(
  tableName: string,
  projectionFields: string[],
  filter?: { field: string; value: string },
): Promise<T[]> {
  const items: T[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(new ScanCommand({
      TableName: tableName,
      ProjectionExpression: projectionFields.join(', '),
      ...(filter
        ? {
            FilterExpression: '#field = :fieldValue',
            ExpressionAttributeNames: { '#field': filter.field },
            ExpressionAttributeValues: { ':fieldValue': filter.value },
          }
        : {}),
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    items.push(...((result.Items as T[] | undefined) ?? []));
    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return items;
}

function csvEscape(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function writeCsv(outDir: string, fileName: string, columns: string[], rows: Record<string, unknown>[]): void {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column])).join(','));
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- outDir/fileName come from this script's own CLI flags and hardcoded call sites, not untrusted input; this is a local admin script, not a served path
  writeFileSync(join(outDir, fileName), lines.join('\n') + '\n', 'utf8');
  console.log(`  wrote ${fileName} (${rows.length} rows)`);
}

async function main(): Promise<void> {
  const config = parseConfig();
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- outDir comes from this script's own --out-dir flag, not untrusted input
  mkdirSync(config.outDir, { recursive: true });

  console.log('Exporting analytics tables', { outDir: config.outDir, teamFilter: config.teamId ?? 'all' });

  const teams = await scanAll<Record<string, unknown>>(config.teamTable, ['id', 'name', 'formationId']);
  const relevantTeamIds = config.teamId
    ? new Set([config.teamId])
    : new Set(teams.map((team) => team.id as string));

  const allGames = await scanAll<Record<string, unknown>>(
    config.gameTable,
    ['id', 'teamId', 'opponent', 'isHome', 'gameDate', 'status', 'ourScore', 'opponentScore'],
  );
  const games = allGames.filter((game) => relevantTeamIds.has(game.teamId as string));
  const gameIds = new Set(games.map((game) => game.id as string));

  const [allGoals, allShots, allSaves, allPlayTimeRecords] = await Promise.all([
    scanAll<Record<string, unknown>>(config.goalTable, ['id', 'gameId', 'scoredByUs', 'gameSeconds', 'half', 'scorerId', 'assistId']),
    scanAll<Record<string, unknown>>(config.shotTable, ['id', 'gameId', 'playerId', 'takenByUs', 'onTarget', 'gameSeconds', 'half']),
    scanAll<Record<string, unknown>>(config.saveTable, ['id', 'gameId', 'playerId', 'byUs', 'gameSeconds', 'half']),
    scanAll<Record<string, unknown>>(config.playTimeRecordTable, ['id', 'gameId', 'playerId', 'positionId', 'startGameSeconds', 'endGameSeconds']),
  ]);

  const goals = allGoals.filter((row) => gameIds.has(row.gameId as string));
  const shots = allShots.filter((row) => gameIds.has(row.gameId as string));
  const saves = allSaves.filter((row) => gameIds.has(row.gameId as string));
  const playTimeRecords = allPlayTimeRecords.filter((row) => gameIds.has(row.gameId as string));

  const allLineupAssignments = await scanAll<Record<string, unknown>>(
    config.lineupAssignmentTable,
    ['id', 'gameId', 'playerId', 'positionId', 'isStarter'],
  );
  const lineupAssignments = allLineupAssignments.filter((row) => gameIds.has(row.gameId as string));

  // FormationPosition ids referenced by either PlayTimeRecord or LineupAssignment --
  // a team's assigned formation can change over time, so a game's lineup may
  // reference a formation the team no longer points to (Team.formationId is
  // a current pointer, not history), and both writers need to resolve here.
  const relevantFormationIds = new Set(
    teams.filter((team) => relevantTeamIds.has(team.id as string)).map((team) => team.formationId as string).filter(Boolean),
  );
  const allFormationPositions = await scanAll<Record<string, unknown>>(
    config.formationPositionTable,
    ['id', 'formationId', 'positionName', 'abbreviation', 'role'],
  );
  const referencedFormationPositionIds = new Set([
    ...playTimeRecords.map((row) => row.positionId as string),
    ...lineupAssignments.map((row) => row.positionId as string),
  ]);
  const formationPositions = allFormationPositions.filter(
    (row) => relevantFormationIds.has(row.formationId as string) || referencedFormationPositionIds.has(row.id as string),
  );

  const relevantAllFormationIds = new Set([
    ...relevantFormationIds,
    ...formationPositions.map((row) => row.formationId as string),
  ]);
  const allFormations = await scanAll<Record<string, unknown>>(config.formationTable, ['id', 'name']);
  const formations = allFormations.filter((row) => relevantAllFormationIds.has(row.id as string));

  const relevantPlayerIds = new Set([
    ...playTimeRecords.map((row) => row.playerId as string),
    ...lineupAssignments.map((row) => row.playerId as string),
  ]);
  const allPlayers = await scanAll<Record<string, unknown>>(config.playerTable, ['id', 'firstName', 'lastName']);
  const players = allPlayers.filter((row) => relevantPlayerIds.has(row.id as string));

  writeCsv(config.outDir, 'teams.csv', ['id', 'name', 'formationId'], teams.filter((t) => relevantTeamIds.has(t.id as string)));
  writeCsv(config.outDir, 'games.csv', ['id', 'teamId', 'opponent', 'isHome', 'gameDate', 'status', 'ourScore', 'opponentScore'], games);
  writeCsv(config.outDir, 'goals.csv', ['id', 'gameId', 'scoredByUs', 'gameSeconds', 'half', 'scorerId', 'assistId'], goals);
  writeCsv(config.outDir, 'shots.csv', ['id', 'gameId', 'playerId', 'takenByUs', 'onTarget', 'gameSeconds', 'half'], shots);
  writeCsv(config.outDir, 'saves.csv', ['id', 'gameId', 'playerId', 'byUs', 'gameSeconds', 'half'], saves);
  writeCsv(config.outDir, 'play_time_records.csv', ['id', 'gameId', 'playerId', 'positionId', 'startGameSeconds', 'endGameSeconds'], playTimeRecords);
  writeCsv(config.outDir, 'formations.csv', ['id', 'name'], formations);
  writeCsv(config.outDir, 'formation_positions.csv', ['id', 'formationId', 'positionName', 'abbreviation', 'role'], formationPositions);
  writeCsv(config.outDir, 'lineup_assignments.csv', ['id', 'gameId', 'playerId', 'positionId', 'isStarter'], lineupAssignments);
  writeCsv(config.outDir, 'players.csv', ['id', 'firstName', 'lastName'], players);

  console.log('Export complete. Query the CSVs directly with DuckDB, e.g.:');
  console.log(`  duckdb -c ".read scripts/queries/goals-against-by-position.sql"`);
}

void main().catch((error: unknown) => {
  console.error('Analytics export failed', error);
  process.exitCode = 1;
});
