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

    const invitation = await client.models.TeamInvitation.create({
      teamId,
      email: email.toLowerCase(),
      role,
      status: 'PENDING',
      invitedBy: user.userId,
      invitedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
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

    // Determine permission role based on invitation role
    const permissionRole = invitation.role === 'PARENT' ? 'READ_ONLY' : 'COACH';

    // Create permission
    await client.models.TeamPermission.create({
      teamId: invitation.teamId,
      userId: user.userId,
      role: permissionRole,
      grantedAt: new Date().toISOString(),
      grantedBy: invitation.invitedBy,
    });

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
 * Revoke a team permission
 */
export async function revokeTeamPermission(permissionId: string) {
  try {
    await client.models.TeamPermission.delete({ id: permissionId });
    return true;
  } catch (error) {
    console.error('Error revoking team permission:', error);
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
