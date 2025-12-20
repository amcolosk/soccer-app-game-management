import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { getCurrentUser } from 'aws-amplify/auth';

const client = generateClient<Schema>();

/**
 * Check if a user has access to a team (is in the coaches array)
 */
export async function hasTeamAccess(
  userId: string,
  teamId: string
): Promise<boolean> {
  try {
    // Get the team
    const teamResponse = await client.models.Team.get({ id: teamId });
    const team = teamResponse.data;
    
    if (!team) return false;
    
    // Check if user is in the coaches array
    return team.coaches?.includes(userId) ?? false;
  } catch (error) {
    console.error('Error checking team access:', error);
    return false;
  }
}

/**
 * Get all teams that a user has access to
 * With ownersDefinedIn authorization, Team.list() automatically returns only accessible teams
 */
export async function getUserTeams() {
  try {
    // With ownersDefinedIn('coaches'), the backend automatically filters
    // to only return teams where the user is in the coaches array
    const teamsResponse = await client.models.Team.list();
    return teamsResponse.data || [];
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
 * With ownersDefinedIn authorization, if the user can access the team, they can write to it
 * 
 * @param teamId - The team ID to check permissions for
 * @param operation - Description of the operation being performed (for error messages)
 * @throws Error if user lacks access
 */
export async function requireTeamWritePermission(teamId: string, operation: string = 'modify this team'): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error('User not authenticated');
  }
  
  const hasAccess = await hasTeamAccess(userId, teamId);
  if (!hasAccess) {
    throw new Error(`You don't have permission to ${operation}. Contact a team coach for access.`);
  }
}

/**
 * Check if current user can write to a team (non-throwing version)
 * 
 * @param teamId - The team ID to check permissions for
 * @returns true if user has access to the team
 */
export async function canWriteToTeam(teamId: string): Promise<boolean> {
  const userId = await getCurrentUserId();
  if (!userId) return false;
  
  return await hasTeamAccess(userId, teamId);
}
