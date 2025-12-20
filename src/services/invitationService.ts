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
 * Accept a team invitation
 */
export async function acceptTeamInvitation(invitationId: string) {
  try {
    const user = await getCurrentUser();
    const userAttributes = await user.signInDetails;
    const userEmail = userAttributes?.loginId?.toLowerCase();

    // Get the invitation
    const invitationResponse = await client.models.TeamInvitation.get({
      id: invitationId,
    });
    const invitation = invitationResponse.data;

    if (!invitation) {
      throw new Error('Invitation not found');
    }

    // Verify email matches
    if (invitation.email !== userEmail) {
      throw new Error('This invitation is for a different email address');
    }

    // Check if already accepted
    if (invitation.status !== 'PENDING') {
      throw new Error(`Invitation is ${invitation.status?.toLowerCase() || 'invalid'}`);
    }

    // Check if expired
    if (new Date(invitation.expiresAt) < new Date()) {
      await client.models.TeamInvitation.update({
        id: invitationId,
        status: 'EXPIRED',
      });
      throw new Error('Invitation has expired');
    }

    // Get the team to update coaches array
    const teamResponse = await client.models.Team.get({
      id: invitation.teamId,
    });
    const team = teamResponse.data;

    if (!team) {
      throw new Error('Team not found');
    }

    // Add user to coaches array if not already present
    const coaches = team.coaches || [];
    if (!coaches.includes(user.userId)) {
      const newCoaches = [...coaches, user.userId];
      
      // 1. Update Team
      await client.models.Team.update({
        id: team.id,
        coaches: newCoaches,
      });

      // 2. Propagate access to all related team data
      await grantCoachAccessToTeamData(team.id, newCoaches);
    }

    // Update invitation status
    const updatedInvitation = await client.models.TeamInvitation.update({
      id: invitationId,
      status: 'ACCEPTED',
      acceptedAt: new Date().toISOString(),
    });

    return updatedInvitation.data;
  } catch (error) {
    console.error('Error accepting team invitation:', error);
    throw error;
  }
}

/**
 * Helper to propagate coach access to all related team data
 */
async function grantCoachAccessToTeamData(teamId: string, newCoaches: string[]) {
  try {
    // 1. Update TeamRosters
    const rosters = await client.models.TeamRoster.list({
      filter: { teamId: { eq: teamId } }
    });
    
    const playerIds = new Set<string>();
    
    for (const roster of rosters.data) {
      await client.models.TeamRoster.update({
        id: roster.id,
        coaches: newCoaches
      });
      if (roster.playerId) playerIds.add(roster.playerId);
    }

    // 2. Update Players (ensure they have access to the players on the roster)
    // Note: Players might be shared across teams, so we need to be careful not to remove other coaches
    // But here we are adding, so we merge the new coaches with existing ones
    for (const playerId of playerIds) {
      const player = await client.models.Player.get({ id: playerId });
      if (player.data) {
        const existingCoaches = player.data.coaches || [];
        // Merge existing coaches with new team coaches, removing duplicates
        const mergedCoaches = Array.from(new Set([...existingCoaches, ...newCoaches]));
        
        // Only update if there's a change
        if (mergedCoaches.length > existingCoaches.length) {
          await client.models.Player.update({
            id: playerId,
            coaches: mergedCoaches
          });
        }
      }
    }

    // 3. Update FieldPositions
    const positions = await client.models.FieldPosition.list({
      filter: { teamId: { eq: teamId } }
    });
    
    for (const position of positions.data) {
      await client.models.FieldPosition.update({
        id: position.id,
        coaches: newCoaches
      });
    }

    // 4. Update Games
    const games = await client.models.Game.list({
      filter: { teamId: { eq: teamId } }
    });
    
    for (const game of games.data) {
      await client.models.Game.update({
        id: game.id,
        coaches: newCoaches
      });
      
      // Note: We could also update deep game data (LineupAssignments, etc.) here
      // For now, we'll assume the most critical data is the Game itself
    }
    
    console.log(`✓ Propagated access for team ${teamId} to ${newCoaches.length} coaches`);
  } catch (error) {
    console.error('Error propagating coach access:', error);
    // Don't throw here, as the main invitation acceptance succeeded
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
    const user = await getCurrentUser();
    const userAttributes = await user.signInDetails;
    const userEmail = userAttributes?.loginId?.toLowerCase();

    if (!userEmail) {
      return { teamInvitations: [] };
    }

    // Get team invitations
    const teamInvitationsResponse = await client.models.TeamInvitation.list({
      filter: {
        email: { eq: userEmail },
        status: { eq: 'PENDING' },
      },
    });

    // Filter out expired invitations
    const now = new Date();
    const validTeamInvitations = teamInvitationsResponse.data.filter(
      (inv) => new Date(inv.expiresAt) > now
    );

    return {
      teamInvitations: validTeamInvitations,
    };
  } catch (error) {
    console.error('Error getting pending invitations:', error);
    return { teamInvitations: [] };
  }
}
