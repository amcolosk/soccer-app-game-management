/* eslint-disable @typescript-eslint/no-explicit-any */
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
 *
 * Authoritative deletes are executed server-side via custom mutations.
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
  filter?: Record<string, unknown>,
): Promise<T[]> {
  const all: T[] = [];
  let nextToken: string | null | undefined = undefined;

  do {
    const opts: { limit: number; filter?: Record<string, unknown>; nextToken?: string } = { limit: 1000 };
    if (filter) opts.filter = filter;
    if (nextToken) opts.nextToken = nextToken;

    const response = await model.list(opts);
    all.push(...response.data);
    nextToken = response.nextToken;
  } while (nextToken);

  return all;
}

type SafeDeleteMutationResult = {
  data?: unknown;
  errors?: Array<{ message?: string }>;
};

function assertMutationSuccess(result: SafeDeleteMutationResult, fallbackMessage: string): void {
  if (result.errors && result.errors.length > 0) {
    throw new Error(result.errors[0]?.message ?? fallbackMessage);
  }

  const success =
    typeof result.data === 'object' &&
    result.data !== null &&
    'success' in result.data &&
    (result.data as { success?: unknown }).success === true;

  if (!success) {
    throw new Error(fallbackMessage);
  }
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
  const result = await client.mutations.deleteGameSafe({ gameId });
  assertMutationSuccess(result, 'Failed to delete game safely');
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
  const result = await client.mutations.deleteTeamSafe({ teamId });
  assertMutationSuccess(result, 'Failed to delete team safely');
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
  const result = await client.mutations.deletePlayerSafe({ playerId });
  assertMutationSuccess(result, 'Failed to delete player safely');
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
  const result = await client.mutations.deleteFormationSafe({ formationId });
  assertMutationSuccess(result, 'Failed to delete formation safely');

  const deletedPositions =
    typeof (result.data as { deletedPositions?: unknown } | null | undefined)?.deletedPositions === 'number'
      ? (result.data as { deletedPositions: number }).deletedPositions
      : 0;

  if (deletedPositions > 0) {
    console.log(
      `[cascadeDelete] Formation ${formationId}: deleted ${deletedPositions} positions`,
    );
  }
}

// ---------------------------------------------------------------------------
// Impact Queries (used to warn users before destructive deletes)
// ---------------------------------------------------------------------------

/**
 * Counts of game-related records that will be destroyed when a player is deleted.
 * `rosterCount` is intentionally excluded — it is derived from the component's
 * already-loaded `teamRosters` subscription state to avoid a redundant DB round-trip.
 *
 * Note: PlayerAvailability records are excluded from the impact summary because
 * they are low-meaning historical scheduling data (absent/available markers) that
 * the user is unlikely to care about preserving. They are still deleted by
 * `deletePlayerCascade` but omitted from the warning to keep the message focused
 * on meaningful game data (play time, goals, notes).
 */
export interface PlayerImpact {
  playTimeCount: number;
  goalCount: number;
  noteCount: number;
}

/**
 * Returns counts of game-related records that will be destroyed when a player is
 * deleted. Used to build an informed-consent warning before `deletePlayerCascade`.
 */
export async function getPlayerImpact(playerId: string): Promise<PlayerImpact> {
  const [playTimeRecords, goalsAsScorer, gameNotes] = await Promise.all([
    listAll(client.models.PlayTimeRecord as any, { playerId: { eq: playerId } }),
    listAll(client.models.Goal as any, { scorerId: { eq: playerId } }),
    listAll(client.models.GameNote as any, { playerId: { eq: playerId } }),
  ]);

  return {
    playTimeCount: playTimeRecords.length,
    goalCount: goalsAsScorer.length,
    noteCount: gameNotes.length,
  };
}
