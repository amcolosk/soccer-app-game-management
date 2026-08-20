import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { deletePlayerCascade, deleteTeamCascade } from './cascadeDeleteService';
import { trackEvent, AnalyticsEvents } from '../utils/analytics';

const client = generateClient<Schema>();

/**
 * Creates a demo team with 12 players and 1 scheduled game.
 * Stores the demo team ID in localStorage for later identification.
 * Does NOT create a formation — leaves formationId null (per architect M2).
 * 
 * @param currentUserId - The authenticated user's ID (required for coaches array)
 * @throws Error if offline or if any creation step fails
 */
export async function createDemoTeam(currentUserId: string): Promise<void> {
  // Check online status first (per architect Min4)
  if (!navigator.onLine) {
    throw new Error('Demo data requires an internet connection');
  }

  // Idempotency guard — avoid creating a second demo team across sessions
  if (localStorage.getItem('onboarding:demoTeamId')) {
    return;
  }

  // Track newly created records so we can clean them up if something fails partway
  let createdTeamId: string | null = null;
  const createdPlayerIds: string[] = [];

  try {
    // Create demo team (NO formation, per M2 — step 3 becomes a genuine user task)
    const teamResponse = await client.models.Team.create({
      name: 'Eagles Demo',
      coaches: [currentUserId],
      ownerId: currentUserId,
      maxPlayersOnField: 7,
      halfLengthMinutes: 30,
      sport: 'Soccer',
      gameFormat: 'Halves',
    });

    if (!teamResponse.data) {
      const msg = teamResponse.errors?.map(e => e.message).join('; ') ?? 'Unknown error';
      throw new Error(`Failed to create demo team: ${msg}`);
    }

    const teamId = teamResponse.data.id;
    createdTeamId = teamId;

    // Store demo team ID in localStorage (instead of team.isDemo field, per architect note)
    localStorage.setItem('onboarding:demoTeamId', teamId);

    // Create 12 demo players (firstName only, lastName empty)
    const playerNames = [
      'Sam', 'Alex', 'Jordan', 'Riley', 'Casey', 'Taylor',
      'Morgan', 'Drew', 'Quinn', 'Blake', 'Avery', 'Reese'
    ];

    for (const name of playerNames) {
      const playerResponse = await client.models.Player.create({
        firstName: name,
        lastName: '',
        coaches: [currentUserId],
      });

      if (playerResponse.data) {
        createdPlayerIds.push(playerResponse.data.id);
      }
    }

    // Create 12 TeamRoster entries (jersey numbers 1-12)
    for (let i = 0; i < createdPlayerIds.length; i++) {
      await client.models.TeamRoster.create({
        teamId,
        playerId: createdPlayerIds[i],
        playerNumber: i + 1,
        coaches: [currentUserId],
      });
    }

    // Create 1 scheduled game (today + 3 days)
    const gameDate = new Date();
    gameDate.setDate(gameDate.getDate() + 3);

    await client.models.Game.create({
      teamId,
      opponent: 'Lions',
      isHome: true,
      gameDate: gameDate.toISOString(),
      status: 'scheduled',
      coaches: [currentUserId],
    });

    // Track analytics
    trackEvent(AnalyticsEvents.DEMO_TEAM_CREATED.category, AnalyticsEvents.DEMO_TEAM_CREATED.action);

    console.log(`✓ Demo team created: ${teamId} with ${createdPlayerIds.length} players`);
  } catch (error) {
    // Best-effort cleanup of any partial data already written to DynamoDB
    localStorage.removeItem('onboarding:demoTeamId');
    if (createdTeamId) {
      // Attempt to remove team + related data; ignore cleanup failures
      void deleteTeamCascade(createdTeamId).catch(() => undefined);
    }
    for (const pid of createdPlayerIds) {
      void deletePlayerCascade(pid).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Removes all demo data: deletes the team first, then each demo player.
 * Removes the demo team ID from localStorage.
 *
 * Deletion order matters: `deletePlayerSafe` (TEAM-ARCHIVE-STEP8, Decision 3)
 * blocks deleting a player who has TeamRoster history on any *archived* team,
 * to protect real archived teams from silent history loss. The demo team is
 * an ordinary Team record — nothing prevents a coach from archiving it via
 * the normal Management UI before removing demo data. If we deleted players
 * first (the old order), an archived demo team would make every player
 * delete fail with "player has history on archived team(s)", leaving the
 * archived demo team stuck with no way to clean it up.
 *
 * `deleteTeamSafe` is intentionally unguarded for archived status (see the
 * comment in amplify/functions/delete-team-safe/handler.ts) specifically so
 * this flow keeps working, and it deletes the team's own TeamRoster rows as
 * part of its cascade. So deleting the team first removes this team's
 * TeamRoster link for every demo player; deletePlayerSafe's guard re-scans
 * TeamRoster fresh, so by the time we delete each player afterward it no
 * longer sees this team at all (archived or not) and the guard never fires.
 *
 * @param teamId - The demo team ID to delete
 * @throws Error if deletion fails
 */
export async function removeDemoData(teamId: string): Promise<void> {
  // Validate target team is actually the demo team before deleting anything
  const teamCheck = await client.models.Team.get({ id: teamId });
  if (!teamCheck.data || teamCheck.data.name !== 'Eagles Demo') {
    // Stale or tampered localStorage pointer — clean it up and bail
    localStorage.removeItem('onboarding:demoTeamId');
    throw new Error('Target team is not recognized as a demo team');
  }

  try {
    // Fetch all TeamRoster entries for this team (need player IDs before the
    // team — and these roster rows — are deleted).
    const rosterResponse = await client.models.TeamRoster.list({
      filter: { teamId: { eq: teamId } },
      limit: 1000,
    });

    const rosters = rosterResponse.data || [];
    const playerIds = rosters.map(r => r.playerId);

    // Delete the team FIRST (cascade handles games, roster entries,
    // invitations). This removes each demo player's TeamRoster link to this
    // team, so the archived-team guard in deletePlayerSafe below can no
    // longer see this team — even if it was archived.
    await deleteTeamCascade(teamId);

    // Delete each player using cascade delete (removes from all remaining
    // teams, not just this one).
    for (const playerId of playerIds) {
      await deletePlayerCascade(playerId);
    }

    // Remove from localStorage
    localStorage.removeItem('onboarding:demoTeamId');

    // Track analytics
    trackEvent(AnalyticsEvents.DEMO_TEAM_REMOVED.category, AnalyticsEvents.DEMO_TEAM_REMOVED.action);

    console.log(`✓ Demo team removed: ${teamId}`);
  } catch (error) {
    // Still remove from localStorage even if deletion failed (user can retry)
    localStorage.removeItem('onboarding:demoTeamId');
    throw error;
  }
}
