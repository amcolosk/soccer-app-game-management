import type { Schema } from '../../data/resource';
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  BatchGetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { escapeHtml } from '../shared/escapeHtml';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cognitoClient = new CognitoIdentityProviderClient({});
const sesClient = new SESClient({});

// Rate limiting (Major 4 / plan §3.8) — same shape as
// create-github-issue/handler.ts's checkRateLimit, own dedicated table.
const MAX_SUMMARY_EMAILS_PER_HOUR = 10;

interface GameRecord {
  id: string;
  teamId?: string;
  opponent?: string;
  isHome?: boolean;
  gameDate?: string | null;
  status?: string;
  ourScore?: number;
  opponentScore?: number;
  coaches?: string[];
}

interface TeamRecord {
  id: string;
  name?: string;
}

interface GoalRecord {
  id: string;
  gameId: string;
  scoredByUs: boolean;
  gameSeconds: number;
  half: number;
  scorerId?: string | null;
  assistId?: string | null;
  notes?: string | null;
  timestamp: string;
  coaches?: string[];
}

interface GameNoteRecord {
  id: string;
  gameId: string;
  noteType: string;
  playerId?: string | null;
  gameSeconds?: number | null;
  half?: number | null;
  notes?: string | null;
  timestamp: string;
  coaches?: string[];
}

interface PlayerRecord {
  id: string;
  firstName?: string;
  lastName?: string;
}

const NOTE_TYPE_LABELS: Record<string, string> = {
  'gold-star': '⭐ Gold Star',
  'yellow-card': '🟨 Yellow Card',
  'red-card': '🟥 Red Card',
  other: 'Note',
};

/**
 * Paginated Query against a relationship GSI, filtered to rows the caller
 * would already be able to see in-app (Major 2 — row-level visibility
 * parity with `allow.ownersDefinedIn('coaches')`, since this handler reads
 * via the raw SDK and bypasses that model-level authorization entirely).
 */
async function queryAllByGameId<T>(
  tableName: string,
  indexName: string,
  gameId: string,
  callerSub: string,
): Promise<T[]> {
  const results: T[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const response = await docClient.send(new QueryCommand({
      TableName: tableName,
      IndexName: indexName,
      KeyConditionExpression: 'gameId = :gameId',
      FilterExpression: 'contains(coaches, :callerId)',
      ExpressionAttributeValues: {
        ':gameId': gameId,
        ':callerId': callerSub,
      },
      ExclusiveStartKey: exclusiveStartKey,
    }));

    results.push(...((response.Items as T[] | undefined) ?? []));
    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return results;
}

/** Chunked BatchGetItem against Player (id, firstName, lastName only),
 * matching get-team-coach-profiles/handler.ts's batchGetCoachProfiles shape. */
async function batchGetPlayers(playerIds: string[], tableName: string): Promise<Map<string, PlayerRecord>> {
  const result = new Map<string, PlayerRecord>();
  const chunkSize = 100;

  for (let i = 0; i < playerIds.length; i += chunkSize) {
    const chunk = playerIds.slice(i, i + chunkSize);
    let unprocessedKeys: Array<{ id: string }> = chunk.map((id) => ({ id }));

    do {
      const response = await docClient.send(new BatchGetCommand({
        RequestItems: {
          [tableName]: {
            Keys: unprocessedKeys,
            ProjectionExpression: 'id, firstName, lastName',
          },
        },
      }));

      const players = (response.Responses?.[tableName] || []) as PlayerRecord[];
      players.forEach((player) => {
        result.set(player.id, player);
      });

      unprocessedKeys = (response.UnprocessedKeys?.[tableName]?.Keys as Array<{ id: string }> | undefined) ?? [];
    } while (unprocessedKeys.length > 0);
  }

  return result;
}

function playerDisplayName(playerId: string | null | undefined, playerMap: Map<string, PlayerRecord>): string {
  if (!playerId) return 'a former player';
  const player = playerMap.get(playerId);
  if (!player) return 'a former player';
  const name = `${player.firstName ?? ''} ${player.lastName ?? ''}`.trim();
  return name || 'a former player';
}

/** MM:SS formatting, mirroring src/utils/gameTimeUtils.ts's
 * formatMinutesSeconds — duplicated locally since this Lambda has its own
 * deployable bundle and doesn't share a build with the frontend. */
function formatMmSs(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatGameDate(gameDate: string | null | undefined): string {
  if (!gameDate) return 'Date not recorded';
  const date = new Date(gameDate);
  if (isNaN(date.getTime())) return 'Date not recorded';
  return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function formatNoteTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return timestamp;
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Rate limit gate (Major 4) — identical shape to
 * create-github-issue/handler.ts's checkRateLimit, against the new
 * EmailGameSummaryRateLimit table. */
export async function checkRateLimit(rateLimitTable: string, userId: string): Promise<void> {
  const hourBucket = new Date().toISOString().slice(0, 13); // "2026-03-07T14"
  const ttl = Math.floor(Date.now() / 1000) + 2 * 60 * 60; // TTL: 2 hours from now

  const result = await docClient.send(
    new UpdateCommand({
      TableName: rateLimitTable,
      Key: { userId, hourBucket },
      UpdateExpression: 'ADD #count :one SET #ttl = if_not_exists(#ttl, :ttl)',
      ExpressionAttributeNames: { '#count': 'count', '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':one': 1, ':ttl': ttl },
      ReturnValues: 'ALL_NEW',
    }),
  );

  const count = (result.Attributes?.['count'] as number) ?? 0;
  if (count > MAX_SUMMARY_EMAILS_PER_HOUR) {
    throw new Error('Rate limit exceeded. Try again later.');
  }
}

/** Resolves the caller's email server-side — access tokens carry no `email`
 * claim (CLAUDE.md's Amplify v6 auth gotcha), so this fallback chain
 * (matching accept-invitation/handler.ts) essentially always bottoms out at
 * AdminGetUser in practice, but is kept in full for defensiveness/
 * consistency with the only two working examples in the codebase. */
async function resolveCallerEmail(identity: AppSyncIdentityCognito, userPoolId: string): Promise<string | undefined> {
  let email: string | undefined;

  if (identity?.claims?.email) {
    email = identity.claims.email as string;
  }

  if (!email && identity?.username && identity.username.includes('@')) {
    email = identity.username;
  }

  if (!email && identity?.claims?.username) {
    email = identity.claims.username as string;
  }

  if (!email && identity?.claims && identity.claims['cognito:username']) {
    email = identity.claims['cognito:username'] as string;
  }

  if (!email && (identity?.username || identity?.sub)) {
    try {
      const response = await cognitoClient.send(new AdminGetUserCommand({
        UserPoolId: userPoolId,
        Username: identity.username || identity.sub,
      }));
      const emailAttr = response.UserAttributes?.find((attr) => attr.Name === 'email');
      if (emailAttr?.Value) {
        email = emailAttr.Value;
      }
    } catch (error) {
      console.error('Error fetching user from Cognito:', error);
    }
  }

  return email;
}

type Handler = Schema['emailGameSummary']['functionHandler'];

export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito;
  const callerSub = identity?.sub;

  if (!callerSub) {
    throw new Error('User not authenticated');
  }

  const { gameId } = event.arguments;

  const gameTable = process.env.GAME_TABLE;
  const teamTable = process.env.TEAM_TABLE;
  const goalTable = process.env.GOAL_TABLE;
  const gameNoteTable = process.env.GAME_NOTE_TABLE;
  const playerTable = process.env.PLAYER_TABLE;
  const rateLimitTable = process.env.RATE_LIMIT_TABLE;
  const userPoolId = process.env.USER_POOL_ID;
  const fromEmail = process.env.FROM_EMAIL;

  if (!gameTable || !teamTable || !goalTable || !gameNoteTable || !playerTable || !rateLimitTable || !userPoolId || !fromEmail) {
    throw new Error('Required environment variables not set');
  }

  // 1. Read the Game.
  const gameResponse = await docClient.send(new GetCommand({
    TableName: gameTable,
    Key: { id: gameId },
  }));
  const game = gameResponse.Item as GameRecord | undefined;

  if (!game) {
    throw new Error('Game not found');
  }

  // 2. Authz gate (R7) — before any other read.
  if (!game.coaches?.includes(callerSub)) {
    throw new Error('Access denied: caller is not a coach on this game');
  }

  // 3. Status gate.
  if (game.status !== 'completed') {
    throw new Error('Game summary email is only available once the game is completed');
  }

  // 4. Rate limit gate (Major 4) — after the cheap authz/status gates, before
  // any further reads, so a caller who was never going to succeed doesn't
  // consume their own quota.
  await checkRateLimit(rateLimitTable, callerSub);

  // 5. Resolve caller email server-side.
  const resolvedEmail = await resolveCallerEmail(identity, userPoolId);
  if (!resolvedEmail) {
    throw new Error('Unable to resolve your account email address');
  }

  // 6. Team (best-effort — display name only).
  let teamName = 'Your Team';
  if (game.teamId) {
    const teamResponse = await docClient.send(new GetCommand({
      TableName: teamTable,
      Key: { id: game.teamId },
    }));
    const team = teamResponse.Item as TeamRecord | undefined;
    if (team?.name) {
      teamName = team.name;
    }
  }

  // 7. Query Goal/GameNote via their relationship GSIs (Major 1 — confirmed,
  // not a Scan), each filtered to rows the caller is themselves listed on
  // (Major 2 — row-level visibility parity with the in-app ownersDefinedIn
  // authorization this handler otherwise bypasses).
  const [goals, gameNotes] = await Promise.all([
    queryAllByGameId<GoalRecord>(goalTable, 'gsi-Game.goals', gameId, callerSub),
    queryAllByGameId<GameNoteRecord>(gameNoteTable, 'gsi-Game.gameNotes', gameId, callerSub),
  ]);

  // 8. Sort goals; split + sort notes (Q1 resolution — two sections matching
  // PreGameNotesPanel.tsx / PlayerNotesPanel.tsx's own existing split).
  const sortedGoals = [...goals].sort((a, b) => (a.half - b.half) || (a.gameSeconds - b.gameSeconds));

  const preGameNotes = gameNotes
    .filter((note) => note.noteType === 'coaching-point')
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const inGameNotes = gameNotes
    .filter((note) => note.noteType !== 'coaching-point')
    .sort((a, b) =>
      ((a.half ?? 0) - (b.half ?? 0)) ||
      ((a.gameSeconds ?? 0) - (b.gameSeconds ?? 0)) ||
      a.timestamp.localeCompare(b.timestamp)
    );

  // 9. Resolve player display names.
  const playerIds = new Set<string>();
  sortedGoals.forEach((goal) => {
    if (goal.scorerId) playerIds.add(goal.scorerId);
    if (goal.assistId) playerIds.add(goal.assistId);
  });
  inGameNotes.forEach((note) => {
    if (note.playerId) playerIds.add(note.playerId);
  });

  const playerMap = await batchGetPlayers(Array.from(playerIds), playerTable);

  // 10. Build subject + bodies.
  const subject = `Game Summary: ${teamName} vs ${game.opponent}`;
  const { html, text } = buildEmailBodies({
    teamName,
    game,
    goals: sortedGoals,
    preGameNotes,
    inGameNotes,
    playerMap,
  });

  // 11. Send via SES — failures are NOT caught/swallowed, they propagate.
  await sesClient.send(new SendEmailCommand({
    Source: fromEmail,
    Destination: { ToAddresses: [resolvedEmail] },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: {
        Html: { Data: html, Charset: 'UTF-8' },
        Text: { Data: text, Charset: 'UTF-8' },
      },
    },
  }));

  return { success: true, sentTo: resolvedEmail };
};

interface BuildEmailBodiesInput {
  teamName: string;
  game: GameRecord;
  goals: GoalRecord[];
  preGameNotes: GameNoteRecord[];
  inGameNotes: GameNoteRecord[];
  playerMap: Map<string, PlayerRecord>;
}

function buildGoalLineText(goal: GoalRecord, teamName: string, opponent: string, playerMap: Map<string, PlayerRecord>): string {
  const timeLabel = `Half ${goal.half}, ${formatMmSs(goal.gameSeconds)}`;
  if (!goal.scoredByUs) {
    return `${timeLabel} — ${opponent} goal`;
  }
  const scorerName = playerDisplayName(goal.scorerId, playerMap);
  const assistSuffix = goal.assistId ? `, assisted by ${playerDisplayName(goal.assistId, playerMap)}` : '';
  return `${timeLabel} — ${teamName} goal by ${scorerName}${assistSuffix}`;
}

function buildInGameNoteLineText(note: GameNoteRecord, playerMap: Map<string, PlayerRecord>): string {
  const timeLabel = `Half ${note.half}, ${formatMmSs(note.gameSeconds ?? 0)}`;
  const label = NOTE_TYPE_LABELS[note.noteType] ?? 'Note';
  const playerSuffix = note.playerId ? ` ${playerDisplayName(note.playerId, playerMap)}` : '';
  return `${timeLabel} — [${label}]${playerSuffix}: ${note.notes ?? ''}`;
}

function buildEmailBodies(input: BuildEmailBodiesInput): { html: string; text: string } {
  const { teamName, game, goals, preGameNotes, inGameNotes, playerMap } = input;
  const opponent = game.opponent ?? 'Opponent';
  const homeAway = game.isHome ? 'Home' : 'Away';
  const gameDate = formatGameDate(game.gameDate);
  const ourScore = game.ourScore ?? 0;
  const opponentScore = game.opponentScore ?? 0;

  // ---- Plain text (raw, unescaped values) ----
  const textGoalsSection = goals.length === 0
    ? 'No goals recorded for this game.'
    : goals.map((goal) => buildGoalLineText(goal, teamName, opponent, playerMap)).join('\n');

  const textPreGameSection = preGameNotes.length === 0
    ? 'No pre-game notes recorded.'
    : preGameNotes.map((note) => `${formatNoteTimestamp(note.timestamp)} — ${note.notes ?? ''}`).join('\n');

  const textInGameSection = inGameNotes.length === 0
    ? 'No in-game notes recorded.'
    : inGameNotes.map((note) => buildInGameNoteLineText(note, playerMap)).join('\n');

  const text = `
${teamName} vs ${opponent} — ${homeAway} — ${gameDate}
Final Score: ${teamName} ${ourScore} – ${opponent} ${opponentScore}

GOALS
${textGoalsSection}

PRE-GAME NOTES
${textPreGameSection}

IN-GAME NOTES
${textInGameSection}

You're receiving this because you clicked "Email Game Summary" in TeamTrack.
  `.trim();

  // ---- HTML (every dynamic value escaped) ----
  const eTeamName = escapeHtml(teamName);
  const eOpponent = escapeHtml(opponent);

  const htmlGoalsSection = goals.length === 0
    ? '<p>No goals recorded for this game.</p>'
    : `<ul>${goals.map((goal) => `<li>${escapeHtml(buildGoalLineText(goal, teamName, opponent, playerMap))}</li>`).join('')}</ul>`;

  const htmlPreGameSection = preGameNotes.length === 0
    ? '<p>No pre-game notes recorded.</p>'
    : `<ul>${preGameNotes.map((note) => `<li>${escapeHtml(`${formatNoteTimestamp(note.timestamp)} — ${note.notes ?? ''}`)}</li>`).join('')}</ul>`;

  const htmlInGameSection = inGameNotes.length === 0
    ? '<p>No in-game notes recorded.</p>'
    : `<ul>${inGameNotes.map((note) => `<li>${escapeHtml(buildInGameNoteLineText(note, playerMap))}</li>`).join('')}</ul>`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 30px;
          text-align: center;
          border-radius: 8px 8px 0 0;
        }
        .content {
          background: #f9f9f9;
          padding: 30px;
          border-radius: 0 0 8px 8px;
        }
        .footer {
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid #ddd;
          font-size: 0.9em;
          color: #666;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${eTeamName} vs ${eOpponent}</h1>
        <p>${escapeHtml(homeAway)} — ${escapeHtml(gameDate)}</p>
        <p><strong>Final Score:</strong> ${eTeamName} ${ourScore} – ${eOpponent} ${opponentScore}</p>
      </div>
      <div class="content">
        <h2>Goals</h2>
        ${htmlGoalsSection}

        <h2>Pre-Game Notes</h2>
        ${htmlPreGameSection}

        <h2>In-Game Notes</h2>
        ${htmlInGameSection}

        <div class="footer">
          <p>You're receiving this because you clicked "Email Game Summary" in TeamTrack.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return { html, text };
}
