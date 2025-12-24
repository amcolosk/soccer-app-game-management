import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { getCurrentUser } from 'aws-amplify/auth';

const client = generateClient<Schema>();

export type InvitationRole = 'OWNER' | 'COACH' | 'PARENT';
export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';

/**
 * Send an invitation to join a team
 */
export async function sendTeamInvitation(
  teamId: string,
  email: string,
  role: InvitationRole
) {
  try {
    const user = await getCurrentUser();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Get the team to copy coaches array
    const teamResponse = await client.models.Team.get({ id: teamId });
    if (!teamResponse.data) {
      throw new Error('Team not found');
    }

    const invitation = await client.models.TeamInvitation.create({
      teamId,
      teamName: teamResponse.data.name,
      email: email.toLowerCase(),
      role,
      status: 'PENDING',
      invitedBy: user.userId,
      invitedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      coaches: teamResponse.data.coaches, // Copy coaches array from team
    });

    console.log('Team invitation sent:', invitation.data);
    return invitation.data;
  } catch (error) {
    console.error('Error sending team invitation:', error);
    throw error;
  }
}

/**
 * Accept a team invitation using the custom mutation with elevated permissions
 */
export async function acceptTeamInvitation(invitationId: string) {
  try {
    const user = await getCurrentUser();
    const userAttributes = await user.signInDetails;
    const userEmail = userAttributes?.loginId?.toLowerCase();

    // Get the invitation to verify email
    // Note: We can't use client.models.TeamInvitation.get() here because the user
    // might not have read access to the invitation if they are not in the coaches list yet.
    // Instead, we rely on the backend Lambda to verify the invitation and user.
    
    console.log('Calling acceptInvitation mutation for:', invitationId);

    // Call the custom mutation which has elevated permissions
    const result = await client.mutations.acceptInvitation({
      invitationId,
    });

    if (result.errors && result.errors.length > 0) {
      console.error('Mutation errors:', result.errors);
      throw new Error(result.errors[0].message || 'Failed to accept invitation');
    }

    console.log('Invitation accepted successfully:', result.data);

    return result.data;
  } catch (error) {
    console.error('Error accepting team invitation:', error);
    throw error;
  }
}

/**
 * Decline a team invitation
 */
export async function declineTeamInvitation(invitationId: string) {
  try {
    const updatedInvitation = await client.models.TeamInvitation.update({
      id: invitationId,
      status: 'DECLINED',
    });

    return updatedInvitation.data;
  } catch (error) {
    console.error('Error declining team invitation:', error);
    throw error;
  }
}

/**
 * Revoke a coach's access by removing them from the team's coaches array
 */
export async function revokeCoachAccess(teamId: string, userId: string) {
  try {
    // Get the team
    const teamResponse = await client.models.Team.get({ id: teamId });
    const team = teamResponse.data;

    if (!team) {
      throw new Error('Team not found');
    }

    // Remove user from coaches array
    const coaches = team.coaches || [];
    const updatedCoaches = coaches.filter(id => id !== userId);

    if (updatedCoaches.length === coaches.length) {
      throw new Error('User is not a coach of this team');
    }

    // Update team
    await client.models.Team.update({
      id: teamId,
      coaches: updatedCoaches,
    });

    return true;
  } catch (error) {
    console.error('Error revoking coach access:', error);
    throw error;
  }
}

/**
 * Get pending invitations for the current user
 */
export async function getUserPendingInvitations() {
  try {
    // Use the custom query that has elevated permissions to read invitations by email
    const result = await client.queries.getUserInvitations();
    
    if (!result.data) {
      return { teamInvitations: [] };
    }

    if (typeof result.data === 'string') {
      try {
        const parsed = JSON.parse(result.data);
        return {
          teamInvitations: parsed.teamInvitations || [],
        };
      } catch (e) {
        console.error('Error parsing invitations JSON:', e);
        return { teamInvitations: [] };
      }
    }

    const data = result.data as any;
    return {
      teamInvitations: data.teamInvitations || [],
    };
  } catch (error) {
    console.error('Error getting pending invitations:', error);
    return { teamInvitations: [] };
  }
}
