import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../../data/resource';
import { assertTeamAccess } from '../shared/teamAccess';
import { scanAll, type DbItem } from '../shared/dynamo';
import { parseICalendar, ICalParseError } from '../shared/ical/parser';
import { selectAdapter } from '../shared/ical/adapters';
import type { GameImportRecord } from '../shared/ical/adapters/types';
import { computeContentHash, deriveDeterministicGameId } from '../shared/ical/contentHash';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Server-side enforcement of the client's advisory 512 KB upload cap
// (Security requirements: "icsContent from file upload skips the network
// controls entirely but still needs every parser cap... enforced
// server-side"). Checked before parsing, ahead of the parser's own DoS caps.
const MAX_ICS_CONTENT_BYTES = 512 * 1024;

// Adoption window (Reconciliation rules, matching precedence step 2).
const ADOPTION_WINDOW_MS = 3 * 60 * 60 * 1000;

function isConditionalCheckFailed(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { name?: unknown }).name === 'ConditionalCheckFailedException';
}

interface ReconcileCounters {
  skippedCount: number;
  cancelledCount: number;
  adoptedCount: number;
  protectedCount: number;
  failedCount: number;
}

type Handler = Schema['syncTeamCalendar']['functionHandler'];

export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito;
  const callerSub = identity?.sub;
  if (typeof callerSub !== 'string' || callerSub.length === 0) {
    throw new Error('User not authenticated');
  }

  const { teamId, feedUrl, icsContent, saveFeedUrl, dryRun } = event.arguments;

  // Phase 2 scope (docs/plans/CALENDAR-FEED-GAME-IMPORT-PLAN.md, Phasing):
  // only the file-upload (`icsContent`) path is implemented. `feedUrl` and
  // `saveFeedUrl` are hard-rejected -- not silently ignored -- so no client
  // can come to depend on pre-hardening URL-fetch behavior before Phase 3's
  // SSRF controls exist.
  if (feedUrl !== undefined && feedUrl !== null) {
    throw new Error('Syncing from a feed URL is not available yet. Upload an .ics file instead.');
  }
  if (saveFeedUrl) {
    throw new Error('Saving a feed URL is not available yet. Upload an .ics file instead.');
  }
  if (typeof icsContent !== 'string' || icsContent.trim().length === 0) {
    throw new Error('icsContent is required');
  }

  if (Buffer.byteLength(icsContent, 'utf8') > MAX_ICS_CONTENT_BYTES) {
    throw new Error('Calendar file is too large (max 512 KB).');
  }

  const gameTable = process.env.GAME_TABLE;
  const teamTable = process.env.TEAM_TABLE;
  if (!gameTable || !teamTable) {
    throw new Error('Required environment variables are not set');
  }

  const { coaches } = await assertTeamAccess(docClient, teamTable, teamId, callerSub, {
    archivedMessage: 'Cannot sync a calendar for an archived team. Restore the team first.',
  });

  let parsed;
  try {
    parsed = parseICalendar(icsContent);
  } catch (error) {
    if (error instanceof ICalParseError) {
      throw new Error(`Could not parse calendar file: ${error.message}`);
    }
    throw error;
  }

  const adapter = selectAdapter(parsed.calendar);
  const warnings: string[] = [...parsed.warnings];
  const records: GameImportRecord[] = [];
  for (const rawEvent of parsed.events) {
    const record = adapter.parseEvent(rawEvent, { calendar: parsed.calendar });
    if (!record) {
      warnings.push('Skipped an event with no UID.');
      continue;
    }
    warnings.push(...record.warnings);
    records.push(record);
  }

  const existingGames = await scanAll(docClient, gameTable, 'teamId = :teamId', { ':teamId': teamId });

  const commit = dryRun !== true;
  const nowIso = new Date().toISOString();

  const createdGames: DbItem[] = [];
  const updatedGames: DbItem[] = [];
  const counters: ReconcileCounters = {
    skippedCount: 0,
    cancelledCount: 0,
    adoptedCount: 0,
    protectedCount: 0,
    failedCount: 0,
  };

  const consumedForAdoption = new Set<string>();

  const findByExternalKey = (record: GameImportRecord): DbItem | undefined =>
    existingGames.find((g) => g.externalUid === record.externalUid && g.externalSource === record.externalSource);

  const findAdoptionCandidate = (record: GameImportRecord): DbItem | undefined => {
    if (!record.gameDate) return undefined;
    const recordMs = new Date(record.gameDate).getTime();
    if (Number.isNaN(recordMs)) return undefined;

    let best: DbItem | undefined;
    let bestDiff = Infinity;
    for (const g of existingGames) {
      if (g.externalUid != null) continue; // already feed-linked, not a hand-created candidate
      if (consumedForAdoption.has(g.id)) continue;
      const gDate = g.gameDate as string | null | undefined;
      if (!gDate) continue;
      const diff = Math.abs(new Date(gDate).getTime() - recordMs);
      if (diff <= ADOPTION_WINDOW_MS && diff < bestDiff) {
        best = g;
        bestDiff = diff;
      }
    }
    return best;
  };

  for (const record of records) {
    try {
      const hash = computeContentHash(record);
      const keyMatch = findByExternalKey(record);
      const isAdoption = !keyMatch;
      const match = keyMatch ?? findAdoptionCandidate(record);

      if (!match) {
        // Genuinely new game (Reconciliation rules, row 1).
        const id = deriveDeterministicGameId(teamId, record.externalSource, record.externalUid);
        const item: DbItem = {
          id,
          __typename: 'Game',
          teamId,
          opponent: record.opponent,
          isHome: record.isHome,
          gameDate: record.gameDate,
          status: 'scheduled',
          currentHalf: 1,
          elapsedSeconds: 0,
          lastStartTime: null,
          halfLengthMinutes: null,
          ourScore: 0,
          opponentScore: 0,
          coaches,
          externalUid: record.externalUid,
          externalSource: record.externalSource,
          externalSequence: record.externalSequence,
          externalContentHash: hash,
          externalSyncedAt: nowIso,
          externalCancelled: record.cancelled,
          externalHomeAwayUnverified: record.homeAwayUnverified,
          externalAdoptedAt: null,
          locationName: record.locationName,
          locationAddress: record.locationAddress,
          arriveByTime: record.arriveByTime,
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        if (commit) {
          try {
            await docClient.send(new PutCommand({
              TableName: gameTable,
              Item: item,
              // Idempotent create: two concurrent sync invocations for the
              // same feed event converge on the same deterministic id and
              // only one PutCommand wins (architecture review Major 4).
              ConditionExpression: 'attribute_not_exists(id)',
            }));
            createdGames.push(item);
          } catch (error) {
            if (isConditionalCheckFailed(error)) {
              // Another invocation already created this exact game — not an
              // error, just a no-op for this run.
              counters.skippedCount += 1;
            } else {
              throw error;
            }
          }
        } else {
          createdGames.push(item);
        }
        continue;
      }

      if (match.status !== 'scheduled') {
        // Protect: never mutate a game whose status !== 'scheduled'. Checked
        // locally before issuing any write (Reconciliation rules, row 5).
        counters.protectedCount += 1;
        continue;
      }

      if (isAdoption) {
        consumedForAdoption.add(match.id);
        const fields = {
          externalUid: record.externalUid,
          externalSource: record.externalSource,
          externalSequence: record.externalSequence,
          externalContentHash: hash,
          externalSyncedAt: nowIso,
          externalCancelled: record.cancelled,
          externalHomeAwayUnverified: record.homeAwayUnverified,
          externalAdoptedAt: nowIso,
          opponent: record.opponent,
          isHome: record.isHome,
          gameDate: record.gameDate,
          locationName: record.locationName,
          locationAddress: record.locationAddress,
          arriveByTime: record.arriveByTime,
        };

        if (commit) {
          try {
            const result = await docClient.send(new UpdateCommand({
              TableName: gameTable,
              Key: { id: match.id },
              UpdateExpression: 'SET externalUid = :externalUid, externalSource = :externalSource, externalSequence = :externalSequence, externalContentHash = :externalContentHash, externalSyncedAt = :externalSyncedAt, externalCancelled = :externalCancelled, externalHomeAwayUnverified = :externalHomeAwayUnverified, externalAdoptedAt = :externalAdoptedAt, opponent = :opponent, isHome = :isHome, gameDate = :gameDate, locationName = :locationName, locationAddress = :locationAddress, arriveByTime = :arriveByTime, updatedAt = :updatedAt',
              ConditionExpression: '#status = :scheduled',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':externalUid': fields.externalUid,
                ':externalSource': fields.externalSource,
                ':externalSequence': fields.externalSequence,
                ':externalContentHash': fields.externalContentHash,
                ':externalSyncedAt': fields.externalSyncedAt,
                ':externalCancelled': fields.externalCancelled,
                ':externalHomeAwayUnverified': fields.externalHomeAwayUnverified,
                ':externalAdoptedAt': fields.externalAdoptedAt,
                ':opponent': fields.opponent,
                ':isHome': fields.isHome,
                ':gameDate': fields.gameDate,
                ':locationName': fields.locationName,
                ':locationAddress': fields.locationAddress,
                ':arriveByTime': fields.arriveByTime,
                ':updatedAt': nowIso,
                ':scheduled': 'scheduled',
              },
              ReturnValues: 'ALL_NEW',
            }));
            updatedGames.push(result.Attributes as DbItem);
            counters.adoptedCount += 1;
            warnings.push(`Linked "${record.opponent}" to an existing game you entered by hand.`);
          } catch (error) {
            if (isConditionalCheckFailed(error)) {
              counters.protectedCount += 1;
            } else {
              throw error;
            }
          }
        } else {
          updatedGames.push({ ...match, ...fields, updatedAt: nowIso });
          counters.adoptedCount += 1;
          warnings.push(`Linked "${record.opponent}" to an existing game you entered by hand.`);
        }
        continue;
      }

      // Dedupe-key match (Reconciliation rules, precedence step 1).
      if (record.cancelled) {
        if (match.externalCancelled === true) {
          counters.skippedCount += 1;
          continue;
        }

        if (commit) {
          try {
            const result = await docClient.send(new UpdateCommand({
              TableName: gameTable,
              Key: { id: match.id },
              UpdateExpression: 'SET externalCancelled = :true, externalSyncedAt = :now, updatedAt = :now',
              ConditionExpression: '#status = :scheduled',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: { ':true': true, ':now': nowIso, ':scheduled': 'scheduled' },
              ReturnValues: 'ALL_NEW',
            }));
            updatedGames.push(result.Attributes as DbItem);
            counters.cancelledCount += 1;
          } catch (error) {
            if (isConditionalCheckFailed(error)) {
              counters.protectedCount += 1;
            } else {
              throw error;
            }
          }
        } else {
          updatedGames.push({ ...match, externalCancelled: true, externalSyncedAt: nowIso, updatedAt: nowIso });
          counters.cancelledCount += 1;
        }
        continue;
      }

      const unchanged = match.externalContentHash === hash && match.externalCancelled !== true;
      if (unchanged) {
        counters.skippedCount += 1;
        continue;
      }

      const fields = {
        opponent: record.opponent,
        isHome: record.isHome,
        gameDate: record.gameDate,
        locationName: record.locationName,
        locationAddress: record.locationAddress,
        arriveByTime: record.arriveByTime,
        externalContentHash: hash,
        externalSequence: record.externalSequence,
        externalSyncedAt: nowIso,
        externalCancelled: false,
        externalHomeAwayUnverified: record.homeAwayUnverified,
      };

      if (commit) {
        try {
          const result = await docClient.send(new UpdateCommand({
            TableName: gameTable,
            Key: { id: match.id },
            UpdateExpression: 'SET opponent = :opponent, isHome = :isHome, gameDate = :gameDate, locationName = :locationName, locationAddress = :locationAddress, arriveByTime = :arriveByTime, externalContentHash = :externalContentHash, externalSequence = :externalSequence, externalSyncedAt = :externalSyncedAt, externalCancelled = :externalCancelled, externalHomeAwayUnverified = :externalHomeAwayUnverified, updatedAt = :updatedAt',
            ConditionExpression: '#status = :scheduled AND attribute_exists(id)',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':opponent': fields.opponent,
              ':isHome': fields.isHome,
              ':gameDate': fields.gameDate,
              ':locationName': fields.locationName,
              ':locationAddress': fields.locationAddress,
              ':arriveByTime': fields.arriveByTime,
              ':externalContentHash': fields.externalContentHash,
              ':externalSequence': fields.externalSequence,
              ':externalSyncedAt': fields.externalSyncedAt,
              ':externalCancelled': fields.externalCancelled,
              ':externalHomeAwayUnverified': fields.externalHomeAwayUnverified,
              ':updatedAt': nowIso,
              ':scheduled': 'scheduled',
            },
            ReturnValues: 'ALL_NEW',
          }));
          updatedGames.push(result.Attributes as DbItem);
        } catch (error) {
          if (isConditionalCheckFailed(error)) {
            counters.protectedCount += 1;
          } else {
            throw error;
          }
        }
      } else {
        updatedGames.push({ ...match, ...fields, updatedAt: nowIso });
      }
    } catch (error) {
      counters.failedCount += 1;
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to sync "${record.opponent}": ${message}`);
    }
  }

  return {
    createdGames,
    updatedGames,
    skippedCount: counters.skippedCount,
    cancelledCount: counters.cancelledCount,
    adoptedCount: counters.adoptedCount,
    protectedCount: counters.protectedCount,
    failedCount: counters.failedCount,
    warnings,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
};
