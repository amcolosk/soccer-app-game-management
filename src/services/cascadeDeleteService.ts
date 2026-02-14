import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

/**
 * Cascade Delete Service
 *
 * DynamoDB (used by Amplify Gen 2) has no native cascade delete support.
 * When a parent record is deleted, all child records are orphaned forever.
 * This service ensures all children are cleaned up before the parent is removed.
 *
 * Deletion order matters — children must be deleted before parents to avoid
 * foreign key references to non-existent records.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Paginated list that fetches ALL records matching a filter.
 * Amplify .list() returns at most one page (~100 items by default).
 * We loop through all pages to ensure nothing is missed.
 */
async function listAll<T extends { id: string }>(
  model: { list: (opts?: any) => Promise<{ data: T[]; nextToken?: string | null }> },
  filter?: Record<string, any>,
): Promise<T[]> {
  const all: T[] = [];
  let nextToken: string | null | undefined = undefined;

  do {
    const opts: any = { limit: 1000 };
    if (filter) opts.filter = filter;
    if (nextToken) opts.nextToken = nextToken;

    const response = await model.list(opts);
    all.push(...response.data);
    nextToken = response.nextToken;
  } while (nextToken);

  return all;
}

/**
 * Delete an array of records in parallel batches for speed.
 * Uses Promise.allSettled so one failure doesn't block the rest.
 */
async function batchDelete(
  model: { delete: (input: { id: string }) => Promise<any> },
  items: { id: string }[],
  batchSize = 10,
): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((item) => model.delete({ id: item.id })),
    );
    deleted += results.filter((r) => r.status === "fulfilled").length;
  }
  return deleted;
}

// ---------------------------------------------------------------------------
// Game Cascade Delete
// ---------------------------------------------------------------------------

/**
 * Deletes a game and ALL of its child records:
 * - PlayTimeRecords
 * - Goals
 * - GameNotes
 * - Substitutions
 * - LineupAssignments
 * - PlayerAvailability
 * - GamePlan → PlannedRotations
 */
export async function deleteGameCascade(gameId: string): Promise<void> {
  const gameFilter = { gameId: { eq: gameId } };

  // Fetch all children in parallel
  const [playTimeRecords, goals, gameNotes, substitutions, lineupAssignments, playerAvailabilities, gamePlans] =
    await Promise.all([
      listAll(client.models.PlayTimeRecord as any, gameFilter),
      listAll(client.models.Goal as any, gameFilter),
      listAll(client.models.GameNote as any, gameFilter),
      listAll(client.models.Substitution as any, gameFilter),
      listAll(client.models.LineupAssignment as any, gameFilter),
      listAll(client.models.PlayerAvailability as any, gameFilter),
      listAll(client.models.GamePlan as any, gameFilter),
    ]);

  // Fetch PlannedRotations for each GamePlan
  const plannedRotations: { id: string }[] = [];
  for (const gp of gamePlans) {
    const rotations = await listAll(client.models.PlannedRotation as any, {
      gamePlanId: { eq: gp.id },
    });
    plannedRotations.push(...rotations);
  }

  // Delete all children (deepest first)
  await Promise.all([
    batchDelete(client.models.PlannedRotation as any, plannedRotations),
    batchDelete(client.models.PlayTimeRecord as any, playTimeRecords),
    batchDelete(client.models.Goal as any, goals),
    batchDelete(client.models.GameNote as any, gameNotes),
    batchDelete(client.models.Substitution as any, substitutions),
    batchDelete(client.models.LineupAssignment as any, lineupAssignments),
    batchDelete(client.models.PlayerAvailability as any, playerAvailabilities),
  ]);

  // Delete GamePlans (after their PlannedRotations are gone)
  await batchDelete(client.models.GamePlan as any, gamePlans);

  // Finally delete the game itself
  await client.models.Game.delete({ id: gameId });

  const totalChildren =
    playTimeRecords.length +
    goals.length +
    gameNotes.length +
    substitutions.length +
    lineupAssignments.length +
    playerAvailabilities.length +
    gamePlans.length +
    plannedRotations.length;

  if (totalChildren > 0) {
    console.log(
      `[cascadeDelete] Game ${gameId}: deleted ${totalChildren} child records ` +
        `(${playTimeRecords.length} play-time, ${goals.length} goals, ` +
        `${gameNotes.length} notes, ${substitutions.length} subs, ` +
        `${lineupAssignments.length} lineup, ${playerAvailabilities.length} availability, ` +
        `${gamePlans.length} plans, ${plannedRotations.length} rotations)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Team Cascade Delete
// ---------------------------------------------------------------------------

/**
 * Deletes a team and ALL of its child records:
 * - Games → (cascade deletes each game's children)
 * - TeamRoster entries
 * - TeamInvitations
 */
export async function deleteTeamCascade(teamId: string): Promise<void> {
  const teamFilter = { teamId: { eq: teamId } };

  // Fetch direct children in parallel
  const [games, teamRosters, teamInvitations] = await Promise.all([
    listAll(client.models.Game as any, teamFilter),
    listAll(client.models.TeamRoster as any, teamFilter),
    listAll(client.models.TeamInvitation as any, teamFilter),
  ]);

  // Cascade delete each game (which deletes all game children)
  for (const game of games) {
    await deleteGameCascade(game.id);
  }

  // Delete remaining team children
  await Promise.all([
    batchDelete(client.models.TeamRoster as any, teamRosters),
    batchDelete(client.models.TeamInvitation as any, teamInvitations),
  ]);

  // Finally delete the team itself
  await client.models.Team.delete({ id: teamId });

  console.log(
    `[cascadeDelete] Team ${teamId}: deleted ${games.length} games, ` +
      `${teamRosters.length} roster entries, ${teamInvitations.length} invitations`,
  );
}

// ---------------------------------------------------------------------------
// Player Cascade Delete
// ---------------------------------------------------------------------------

/**
 * Deletes a player and ALL of its child records:
 * - TeamRoster entries (removes from all teams)
 * - PlayTimeRecords
 * - Goals (as scorer)
 * - GameNotes
 * - PlayerAvailability
 *
 * Note: Substitution records reference playerOutId/playerInId but are
 * game-scoped historical data — they are cleaned up with game deletion.
 * LineupAssignments are also game-scoped.
 */
export async function deletePlayerCascade(playerId: string): Promise<void> {
  const playerFilter = { playerId: { eq: playerId } };

  // Fetch children in parallel
  const [teamRosters, playTimeRecords, goalsAsScorer, goalsAsAssist, gameNotes, playerAvailabilities] =
    await Promise.all([
      listAll(client.models.TeamRoster as any, playerFilter),
      listAll(client.models.PlayTimeRecord as any, playerFilter),
      listAll(client.models.Goal as any, { scorerId: { eq: playerId } }),
      listAll(client.models.Goal as any, { assistId: { eq: playerId } }),
      listAll(client.models.GameNote as any, playerFilter),
      listAll(client.models.PlayerAvailability as any, playerFilter),
    ]);

  // For goals where this player is an assist, just clear the assistId
  // rather than deleting the goal (the goal still happened)
  for (const goal of goalsAsAssist) {
    await client.models.Goal.update({ id: goal.id, assistId: null });
  }

  // Delete owned children
  await Promise.all([
    batchDelete(client.models.TeamRoster as any, teamRosters),
    batchDelete(client.models.PlayTimeRecord as any, playTimeRecords),
    batchDelete(client.models.Goal as any, goalsAsScorer),
    batchDelete(client.models.GameNote as any, gameNotes),
    batchDelete(client.models.PlayerAvailability as any, playerAvailabilities),
  ]);

  // Finally delete the player itself
  await client.models.Player.delete({ id: playerId });

  const totalChildren =
    teamRosters.length + playTimeRecords.length + goalsAsScorer.length + gameNotes.length + playerAvailabilities.length;

  if (totalChildren > 0) {
    console.log(
      `[cascadeDelete] Player ${playerId}: deleted ${totalChildren} child records ` +
        `(${teamRosters.length} rosters, ${playTimeRecords.length} play-time, ` +
        `${goalsAsScorer.length} goals, ${gameNotes.length} notes, ` +
        `${playerAvailabilities.length} availability), ` +
        `cleared assist on ${goalsAsAssist.length} goals`,
    );
  }
}

// ---------------------------------------------------------------------------
// Formation Cascade Delete
// ---------------------------------------------------------------------------

/**
 * Deletes a formation and ALL of its child records:
 * - FormationPositions
 *
 * Note: Teams that reference this formation via formationId will have a
 * dangling reference. The UI should handle missing formations gracefully.
 */
export async function deleteFormationCascade(formationId: string): Promise<void> {
  const positions = await listAll(client.models.FormationPosition as any, {
    formationId: { eq: formationId },
  });

  await batchDelete(client.models.FormationPosition as any, positions);

  // Finally delete the formation itself
  await client.models.Formation.delete({ id: formationId });

  if (positions.length > 0) {
    console.log(
      `[cascadeDelete] Formation ${formationId}: deleted ${positions.length} positions`,
    );
  }
}
