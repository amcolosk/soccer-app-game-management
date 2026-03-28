import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

type CoachScopedRecord = {
  id: string;
  coaches?: string[];
};

type TeamRecord = CoachScopedRecord & {
  formationId?: string | null;
};

type TeamRosterRecord = CoachScopedRecord & {
  playerId?: string;
};

type TeamInvitationRecord = {
  id: string;
  teamId?: string;
  status?: string;
  acceptedBy?: string;
};

type ScriptConfig = {
  teamInvitationTable: string;
  teamTable: string;
  teamRosterTable: string;
  playerTable: string;
  formationTable: string;
  formationPositionTable: string;
  gameTable: string;
  apply: boolean;
  teamId?: string;
};

type RepairCounters = {
  teamsScanned: number;
  teamsUpdated: number;
  rosterUpdated: number;
  playersUpdated: number;
  formationsUpdated: number;
  formationPositionsUpdated: number;
  gamesUpdated: number;
};

function getArgValue(flag: string): string | undefined {
  const argument = process.argv.find((value) => value.startsWith(`${flag}=`));
  if (!argument) {
    return undefined;
  }

  return argument.slice(flag.length + 1);
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getRequiredValue(label: string, envName: string, flagName: string): string {
  const fromArg = getArgValue(flagName);
  const fromEnv = process.env[envName];
  const value = fromArg ?? fromEnv;

  if (!value) {
    throw new Error(`Missing ${label}. Provide ${flagName}=<value> or set ${envName}.`);
  }

  return value;
}

function parseConfig(): ScriptConfig {
  const explicitDryRun = hasFlag('--dry-run');
  const apply = hasFlag('--apply');
  const teamId = getArgValue('--team-id');
  const allowGlobalApply = hasFlag('--all-teams');

  if (explicitDryRun && apply) {
    throw new Error('Specify only one mode flag: use either --dry-run or --apply.');
  }

  if (apply && !teamId && !allowGlobalApply) {
    throw new Error('Refusing to apply across all teams without --all-teams. Provide --team-id=<team-id> or add --all-teams.');
  }

  return {
    teamInvitationTable: getRequiredValue('team invitation table', 'TEAM_INVITATION_TABLE', '--team-invitation-table'),
    teamTable: getRequiredValue('team table', 'TEAM_TABLE', '--team-table'),
    teamRosterTable: getRequiredValue('team roster table', 'TEAM_ROSTER_TABLE', '--team-roster-table'),
    playerTable: getRequiredValue('player table', 'PLAYER_TABLE', '--player-table'),
    formationTable: getRequiredValue('formation table', 'FORMATION_TABLE', '--formation-table'),
    formationPositionTable: getRequiredValue('formation position table', 'FORMATION_POSITION_TABLE', '--formation-position-table'),
    gameTable: getRequiredValue('game table', 'GAME_TABLE', '--game-table'),
    apply,
    teamId,
  };
}

function mergeCoachLists(existing: string[] | undefined, incoming: string[]): string[] {
  return Array.from(new Set([...(existing ?? []), ...incoming]));
}

function shouldBackfillCoaches(existing: string[] | undefined, incoming: string[]): boolean {
  const merged = mergeCoachLists(existing, incoming);
  if (!existing) {
    return merged.length > 0;
  }

  return merged.length !== existing.length || merged.some((coachId) => !existing.includes(coachId));
}

function isConditionalCheckFailed(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  return (error as { name?: unknown }).name === 'ConditionalCheckFailedException';
}

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

async function getRecordById<T extends Record<string, unknown>>(
  tableName: string,
  id: string,
  projectionFields: string[],
): Promise<T | null> {
  const result = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: { id },
    ProjectionExpression: projectionFields.join(', '),
  }));

  return (result.Item as T | undefined) ?? null;
}

async function scanByField<T extends Record<string, unknown>>(
  tableName: string,
  fieldName: string,
  fieldValue: string,
  projectionFields: string[],
): Promise<T[]> {
  const items: T[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: '#field = :fieldValue',
      ExpressionAttributeNames: { '#field': fieldName },
      ExpressionAttributeValues: { ':fieldValue': fieldValue },
      ProjectionExpression: projectionFields.join(', '),
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    items.push(...((result.Items as T[] | undefined) ?? []));
    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return items;
}

async function scanAcceptedInvitations(tableName: string): Promise<TeamInvitationRecord[]> {
  const items: TeamInvitationRecord[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: '#status = :acceptedStatus',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':acceptedStatus': 'ACCEPTED' },
      ProjectionExpression: 'id, teamId, #status, acceptedBy',
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    items.push(...((result.Items as TeamInvitationRecord[] | undefined) ?? []));
    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return items;
}

async function updateRecordCoachesIfNeeded(
  tableName: string,
  record: CoachScopedRecord,
  teamCoaches: string[],
  updatedAtIso: string,
  dryRun: boolean,
): Promise<boolean> {
  let latest = record;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!shouldBackfillCoaches(latest.coaches, teamCoaches)) {
      return false;
    }

    const merged = mergeCoachLists(latest.coaches, teamCoaches);

    if (dryRun) {
      return true;
    }

    try {
      if (latest.coaches === undefined) {
        await docClient.send(new UpdateCommand({
          TableName: tableName,
          Key: { id: latest.id },
          UpdateExpression: 'SET coaches = :coaches, updatedAt = :updatedAt',
          ConditionExpression: 'attribute_not_exists(coaches)',
          ExpressionAttributeValues: {
            ':coaches': merged,
            ':updatedAt': updatedAtIso,
          },
        }));
      } else {
        await docClient.send(new UpdateCommand({
          TableName: tableName,
          Key: { id: latest.id },
          UpdateExpression: 'SET coaches = :coaches, updatedAt = :updatedAt',
          ConditionExpression: 'coaches = :expectedCoaches',
          ExpressionAttributeValues: {
            ':coaches': merged,
            ':expectedCoaches': latest.coaches,
            ':updatedAt': updatedAtIso,
          },
        }));
      }

      return true;
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }

      const refreshed = await getRecordById<CoachScopedRecord>(tableName, latest.id, ['id', 'coaches']);
      if (!refreshed) {
        return false;
      }

      latest = refreshed;
    }
  }

  throw new Error(`Failed to update ${tableName} record ${latest.id} after retrying concurrent writes.`);
}

async function repairTeamPermissions(
  teamId: string,
  acceptedCoachIds: string[],
  config: ScriptConfig,
  counters: RepairCounters,
): Promise<void> {
  const team = await getRecordById<TeamRecord>(config.teamTable, teamId, ['id', 'coaches', 'formationId']);
  if (!team) {
    return;
  }

  counters.teamsScanned += 1;

  const mergedTeamCoaches = mergeCoachLists(team.coaches, acceptedCoachIds);
  const updatedAtIso = new Date().toISOString();

  if (shouldBackfillCoaches(team.coaches, acceptedCoachIds)) {
    if (config.apply) {
      await updateRecordCoachesIfNeeded(
        config.teamTable,
        { id: team.id, coaches: team.coaches },
        acceptedCoachIds,
        updatedAtIso,
        false,
      );
    }
    counters.teamsUpdated += 1;
  }

  const rosterRecords = await scanByField<TeamRosterRecord>(
    config.teamRosterTable,
    'teamId',
    teamId,
    ['id', 'coaches', 'playerId'],
  );

  const rosterUpdateResults = await Promise.all(
    rosterRecords.map((record) =>
      updateRecordCoachesIfNeeded(config.teamRosterTable, record, mergedTeamCoaches, updatedAtIso, !config.apply)
    )
  );
  counters.rosterUpdated += rosterUpdateResults.filter(Boolean).length;

  const rosterPlayerIds = Array.from(new Set(
    rosterRecords
      .map((record) => record.playerId)
      .filter((playerId): playerId is string => typeof playerId === 'string' && playerId.length > 0)
  ));

  const players = await Promise.all(
    rosterPlayerIds.map((playerId) => getRecordById<CoachScopedRecord>(config.playerTable, playerId, ['id', 'coaches']))
  );

  const playerUpdateResults = await Promise.all(
    players
      .filter((player): player is CoachScopedRecord => player !== null)
      .map((player) => updateRecordCoachesIfNeeded(config.playerTable, player, mergedTeamCoaches, updatedAtIso, !config.apply))
  );
  counters.playersUpdated += playerUpdateResults.filter(Boolean).length;

  const formationId = typeof team.formationId === 'string' ? team.formationId : null;
  if (!formationId) {
    return;
  }

  const formation = await getRecordById<CoachScopedRecord>(config.formationTable, formationId, ['id', 'coaches']);
  if (formation) {
    const updated = await updateRecordCoachesIfNeeded(
      config.formationTable,
      formation,
      mergedTeamCoaches,
      updatedAtIso,
      !config.apply,
    );
    if (updated) {
      counters.formationsUpdated += 1;
    }
  }

  const formationPositions = await scanByField<CoachScopedRecord>(
    config.formationPositionTable,
    'formationId',
    formationId,
    ['id', 'coaches'],
  );

  const positionUpdateResults = await Promise.all(
    formationPositions.map((position) =>
      updateRecordCoachesIfNeeded(
        config.formationPositionTable,
        position,
        mergedTeamCoaches,
        updatedAtIso,
        !config.apply,
      )
    )
  );
  counters.formationPositionsUpdated += positionUpdateResults.filter(Boolean).length;

  // Backfill Game coaches so shared users can see games for this team.
  const gameRecords = await scanByField<CoachScopedRecord>(
    config.gameTable,
    'teamId',
    teamId,
    ['id', 'coaches'],
  );

  const gameUpdateResults = await Promise.all(
    gameRecords.map((record) =>
      updateRecordCoachesIfNeeded(config.gameTable, record, mergedTeamCoaches, updatedAtIso, !config.apply)
    )
  );
  counters.gamesUpdated += gameUpdateResults.filter(Boolean).length;
}

async function main(): Promise<void> {
  const config = parseConfig();
  const mode = config.apply ? 'apply' : 'dry-run';
  const scope = config.teamId ? `team:${config.teamId}` : 'all-teams';

  console.log('Sharing permissions repair starting', {
    mode,
    scope,
    writesEnabled: config.apply,
    globalApplyGuardSatisfied: config.apply ? Boolean(config.teamId) || hasFlag('--all-teams') : true,
  });

  const counters: RepairCounters = {
    teamsScanned: 0,
    teamsUpdated: 0,
    rosterUpdated: 0,
    playersUpdated: 0,
    formationsUpdated: 0,
    formationPositionsUpdated: 0,
    gamesUpdated: 0,
  };

  const acceptedInvitations = await scanAcceptedInvitations(config.teamInvitationTable);
  const teamToAcceptedCoaches = new Map<string, Set<string>>();

  for (const invitation of acceptedInvitations) {
    if (!invitation.teamId || !invitation.acceptedBy) {
      continue;
    }

    if (config.teamId && invitation.teamId !== config.teamId) {
      continue;
    }

    const acceptedCoachSet = teamToAcceptedCoaches.get(invitation.teamId) ?? new Set<string>();
    acceptedCoachSet.add(invitation.acceptedBy);
    teamToAcceptedCoaches.set(invitation.teamId, acceptedCoachSet);
  }

  for (const [teamId, acceptedCoachSet] of teamToAcceptedCoaches.entries()) {
    await repairTeamPermissions(teamId, [...acceptedCoachSet], config, counters);
  }

  console.log('Sharing permissions repair completed', {
    mode,
    teamFilter: config.teamId ?? 'all',
    ...counters,
  });
}

// Usage:
// 1) Dry run all teams:
//    npx tsx scripts/repair-shared-team-permissions.ts
// 2) Apply to a single team:
//    npx tsx scripts/repair-shared-team-permissions.ts --apply --team-id=<team-id>
// 3) Apply to all teams (guarded):
//    npx tsx scripts/repair-shared-team-permissions.ts --apply --all-teams
// 3) Table names can be passed as flags or env vars:
//    --team-invitation-table --team-table --team-roster-table --player-table --formation-table --formation-position-table
//    TEAM_INVITATION_TABLE TEAM_TABLE TEAM_ROSTER_TABLE PLAYER_TABLE FORMATION_TABLE FORMATION_POSITION_TABLE
void main().catch((error: unknown) => {
  console.error('Sharing permissions repair failed', error);
  process.exitCode = 1;
});
