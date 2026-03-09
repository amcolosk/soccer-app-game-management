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
      formationId: null,
      maxPlayersOnField: 7,
      halfLengthMinutes: 30,
      sport: 'Soccer',
      gameFormat: 'Halves',
    });

    if (!teamResponse.data) {
      throw new Error('Failed to create demo team');
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
 * Removes all demo data: deletes all players, then the team (cascade delete handles related records).
 * Removes the demo team ID from localStorage.
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
    // Fetch all TeamRoster entries for this team
    const rosterResponse = await client.models.TeamRoster.list({
      filter: { teamId: { eq: teamId } },
      limit: 1000,
    });

    const rosters = rosterResponse.data || [];
    const playerIds = rosters.map(r => r.playerId);

    // Delete each player using cascade delete (removes from all teams, not just this one)
    for (const playerId of playerIds) {
      await deletePlayerCascade(playerId);
    }

    // Delete the team (cascade delete handles games, roster entries, invitations)
    await deleteTeamCascade(teamId);

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
