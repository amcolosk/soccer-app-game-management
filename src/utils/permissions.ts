import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { getCurrentUser } from 'aws-amplify/auth';

const client = generateClient<Schema>();

export type PermissionRole = 'OWNER' | 'COACH' | 'READ_ONLY';

/**
 * Check if a user has permission to access a season with a specific role
 */
export async function hasSeasonPermission(
  userId: string,
  seasonId: string,
  requiredRole: PermissionRole = 'READ_ONLY'
): Promise<boolean> {
  try {
    // Get the season
    const seasonResponse = await client.models.Season.get({ id: seasonId });
    const season = seasonResponse.data;
    
    if (!season) return false;
    
    // Check if user is the owner
    if (season.ownerId === userId) return true;
    
    // Check permissions
    const permissionsResponse = await client.models.SeasonPermission.list({
      filter: {
        seasonId: { eq: seasonId },
        userId: { eq: userId },
      },
    });
    
    const permissions = permissionsResponse.data;
    if (!permissions || permissions.length === 0) return false;
    
    const userRole = permissions[0].role as PermissionRole;
    
    // Role hierarchy: OWNER > COACH > READ_ONLY
    const roleHierarchy: Record<PermissionRole, number> = {
      OWNER: 3,
      COACH: 2,
      READ_ONLY: 1,
    };
    
    return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
  } catch (error) {
    console.error('Error checking season permission:', error);
    return false;
  }
}

/**
 * Check if a user has permission to access a team with a specific role
 */
export async function hasTeamPermission(
  userId: string,
  teamId: string,
  requiredRole: PermissionRole = 'READ_ONLY'
): Promise<boolean> {
  try {
    // Get the team
    const teamResponse = await client.models.Team.get({ id: teamId });
    const team = teamResponse.data;
    
    if (!team) return false;
    
    // Check if user is the owner
    if (team.ownerId === userId) return true;
    
    // Check if user has season-level permission (inherits to teams)
    const hasSeasonAccess = await hasSeasonPermission(userId, team.seasonId, requiredRole);
    if (hasSeasonAccess) return true;
    
    // Check team-specific permissions
    const permissionsResponse = await client.models.TeamPermission.list({
      filter: {
        teamId: { eq: teamId },
        userId: { eq: userId },
      },
    });
    
    const permissions = permissionsResponse.data;
    if (!permissions || permissions.length === 0) return false;
    
    const userRole = permissions[0].role as PermissionRole;
    
    // Role hierarchy: OWNER > COACH > READ_ONLY
    const roleHierarchy: Record<PermissionRole, number> = {
      OWNER: 3,
      COACH: 2,
      READ_ONLY: 1,
    };
    
    return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
  } catch (error) {
    console.error('Error checking team permission:', error);
    return false;
  }
}

/**
 * Get all seasons that a user has access to (owned or shared)
 */
export async function getUserSeasons(userId: string) {
  try {
    // Get seasons owned by user
    const ownedSeasonsResponse = await client.models.Season.list({
      filter: { ownerId: { eq: userId } },
    });
    
    // Get seasons with permissions
    const permissionsResponse = await client.models.SeasonPermission.list({
      filter: { userId: { eq: userId } },
    });
    
    const sharedSeasonIds = permissionsResponse.data.map((p) => p.seasonId);
    const sharedSeasonsPromises = sharedSeasonIds.map((id) =>
      client.models.Season.get({ id })
    );
    const sharedSeasonsResults = await Promise.all(sharedSeasonsPromises);
    const sharedSeasons = sharedSeasonsResults
      .map((r) => r.data)
      .filter((s) => s !== null);
    
    // Combine and deduplicate
    const allSeasons = [...ownedSeasonsResponse.data, ...sharedSeasons];
    const uniqueSeasons = Array.from(
      new Map(allSeasons.map((s) => [s!.id, s])).values()
    );
    
    return uniqueSeasons;
  } catch (error) {
    console.error('Error getting user seasons:', error);
    return [];
  }
}

/**
 * Get all teams that a user has access to (owned or shared)
 */
export async function getUserTeams(userId: string) {
  try {
    // Get teams owned by user
    const ownedTeamsResponse = await client.models.Team.list({
      filter: { ownerId: { eq: userId } },
    });
    
    // Get teams from seasons with permissions
    const userSeasons = await getUserSeasons(userId);
    const seasonTeamsPromises = userSeasons.map((season) =>
      client.models.Team.list({
        filter: { seasonId: { eq: season!.id } },
      })
    );
    const seasonTeamsResults = await Promise.all(seasonTeamsPromises);
    const seasonTeams = seasonTeamsResults.flatMap((r) => r.data);
    
    // Get teams with direct permissions
    const permissionsResponse = await client.models.TeamPermission.list({
      filter: { userId: { eq: userId } },
    });
    
    const sharedTeamIds = permissionsResponse.data.map((p) => p.teamId);
    const sharedTeamsPromises = sharedTeamIds.map((id) =>
      client.models.Team.get({ id })
    );
    const sharedTeamsResults = await Promise.all(sharedTeamsPromises);
    const sharedTeams = sharedTeamsResults
      .map((r) => r.data)
      .filter((t) => t !== null);
    
    // Combine and deduplicate
    const allTeams = [...ownedTeamsResponse.data, ...seasonTeams, ...sharedTeams];
    const uniqueTeams = Array.from(
      new Map(allTeams.map((t) => [t!.id, t])).values()
    );
    
    return uniqueTeams;
  } catch (error) {
    console.error('Error getting user teams:', error);
    return [];
  }
}

/**
 * Get the current user's ID
 */
export async function getCurrentUserId(): Promise<string | null> {
  try {
    const user = await getCurrentUser();
    return user.userId;
  } catch (error) {
    console.error('Error getting current user:', error);
    return null;
  }
}

/**
 * Verify user has write permissions before performing team mutations
 * Throws an error if user lacks required permissions
 * 
 * @param teamId - The team ID to check permissions for
 * @param operation - Description of the operation being performed (for error messages)
 * @throws Error if user lacks COACH-level permissions
 */
export async function requireTeamWritePermission(teamId: string, operation: string = 'modify this team'): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error('User not authenticated');
  }
  
  const hasPermission = await hasTeamPermission(userId, teamId, 'COACH');
  if (!hasPermission) {
    throw new Error(`You don't have permission to ${operation}. Contact the team owner for access.`);
  }
}

/**
 * Check if current user can write to a team (non-throwing version)
 * 
 * @param teamId - The team ID to check permissions for
 * @returns true if user has COACH or OWNER permissions
 */
export async function canWriteToTeam(teamId: string): Promise<boolean> {
  const userId = await getCurrentUserId();
  if (!userId) return false;
  
  return await hasTeamPermission(userId, teamId, 'COACH');
}
