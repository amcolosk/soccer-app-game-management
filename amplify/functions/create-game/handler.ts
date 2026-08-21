import type { Schema } from '../../data/resource';
import type { AppSyncIdentityCognito } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

type Handler = Schema['createGame']['functionHandler'];

export const handler: Handler = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito;
  const callerSub = identity?.sub;
  if (typeof callerSub !== 'string' || callerSub.length === 0) {
    throw new Error('User not authenticated');
  }

  const { teamId, opponent, isHome, gameDate } = event.arguments;

  if (typeof opponent !== 'string' || opponent.trim().length === 0) {
    throw new Error('opponent is required');
  }

  const gameTable = process.env.GAME_TABLE;
  const teamTable = process.env.TEAM_TABLE;
  if (!gameTable || !teamTable) {
    throw new Error('Required environment variables are not set');
  }

  const teamResponse = await docClient.send(new GetCommand({
    TableName: teamTable,
    Key: { id: teamId },
    ProjectionExpression: 'id, coaches',
    // Strongly consistent (TEAM-ARCHIVE-STEP11 revision, architecture review
    // finding): GetCommand defaults to eventually-consistent reads. Decision
    // 2 removes the client-side defensive "include currentUserId even if
    // team.coaches looks stale" compensation in favor of trusting this read.
    // Without ConsistentRead, a coach who just accepted a team invitation
    // and immediately tries to schedule a game could hit a stale replica and
    // get a hard "Access denied" error on a team visible in their own UI —
    // a worse failure mode than the silent/permissive behavior it replaces.
    // Cost: one extra RCU, no meaningful latency impact on a write path.
    ConsistentRead: true,
  }));

  const team = teamResponse.Item as { id: string; coaches?: string[] } | undefined;
  if (!team) {
    throw new Error('Team not found');
  }

  // TEAM-ARCHIVE-STEP11 Part 1: coaches derived server-side from the team's
  // own coaches array (Decision 2) — not accepted as a client argument. This
  // both closes the population rule (CLAUDE.md) and is the authorization
  // check: a caller not in `team.coaches` cannot create a game for it.
  const coaches = team.coaches ?? [];
  if (!coaches.includes(callerSub)) {
    throw new Error('Access denied: caller is not a coach on this team');
  }

  // No archived-team check in this part — see
  // TEAM-ARCHIVE-STEP11-GAME-CREATE-CONVERSION-PART2.md.

  const now = new Date().toISOString();
  const id = randomUUID();

  const item = {
    id,
    __typename: 'Game',
    teamId,
    opponent: opponent.trim(),
    isHome,
    gameDate: gameDate ?? null,
    status: 'scheduled',
    currentHalf: 1,
    elapsedSeconds: 0,
    lastStartTime: null,
    halfLengthMinutes: null,
    ourScore: 0,
    opponentScore: 0,
    coaches,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({
    TableName: gameTable,
    Item: item,
  }));

  return item;
};
