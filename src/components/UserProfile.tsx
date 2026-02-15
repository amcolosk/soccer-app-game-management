import { useState, useEffect } from 'react';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { useOutletContext } from 'react-router-dom';
import { updatePassword, deleteUser, fetchUserAttributes } from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import type { Team } from '../types/schema';
import {
  getUserPendingInvitations,
  acceptTeamInvitation,
  declineTeamInvitation,
} from '../services/invitationService';
import { useConfirm } from './ConfirmModal';

const client = generateClient<Schema>();

export function UserProfile() {
  const confirm = useConfirm();
  const { user } = useAuthenticator();
  const { signOut } = useOutletContext<{ signOut: () => void }>();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pendingInvitations, setPendingInvitations] = useState<{
    teamInvitations: any[];
  }>({ teamInvitations: [] });
  const [teams, setTeams] = useState<Team[]>([]);
  const [loadingInvitations, setLoadingInvitations] = useState(false);
  const [userEmail, setUserEmail] = useState('');

  useEffect(() => {
    loadPendingInvitations();
    loadUserAttributes();
  }, []);

  async function loadUserAttributes() {
    try {
      const attributes = await fetchUserAttributes();
      if (attributes.email) {
        setUserEmail(attributes.email);
      }
    } catch (error) {
      console.error('Error fetching user attributes:', error);
    }
  }

  async function loadPendingInvitations() {
    setLoadingInvitations(true);
    try {
      const invitations = await getUserPendingInvitations();
      setPendingInvitations(invitations);

      // Load team names for the invitations
      const teamIds = invitations.teamInvitations.map((inv: any) => inv.teamId);
      const teamPromises = teamIds.map((id: string) => client.models.Team.get({ id }));
      const teamResults = await Promise.all(teamPromises);

      setTeams(teamResults.map((r) => r.data).filter(t => t !== null) as Team[]);
    } catch (error) {
      console.error('Error loading invitations:', error);
    } finally {
      setLoadingInvitations(false);
    }
  }

  async function handleAcceptInvitation(invitationId: string) {
    try {
      await acceptTeamInvitation(invitationId);
      setMessage({ type: 'success', text: 'Team invitation accepted!' });
      await loadPendingInvitations();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to accept invitation' });
    }
  }

  async function handleDeclineInvitation(invitationId: string) {
    const confirmed = await confirm({
      title: 'Decline Invitation',
      message: 'Are you sure you want to decline this invitation?',
      confirmText: 'Decline',
      variant: 'warning',
    });
    if (!confirmed) return;

    try {
      await declineTeamInvitation(invitationId);
      setMessage({ type: 'success', text: 'Invitation declined' });
      await loadPendingInvitations();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to decline invitation' });
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match' });
      return;
    }

    if (newPassword.length < 8) {
      setMessage({ type: 'error', text: 'Password must be at least 8 characters' });
      return;
    }

    setIsChangingPassword(true);
    setMessage(null);

    try {
      await updatePassword({ oldPassword, newPassword });
      setMessage({ type: 'success', text: 'Password updated successfully' });
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      console.error('Error changing password:', error);
      setMessage({ 
        type: 'error', 
        text: error.message || 'Failed to change password. Please check your current password.' 
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    const confirmed = await confirm({
      title: 'Delete Account',
      message: 'Are you sure you want to delete your account? This action cannot be undone and will delete all your data including seasons, teams, players, and game records.',
      confirmText: 'Delete Account',
      variant: 'danger',
    });

    if (!confirmed) return;

    const doubleConfirm = await confirm({
      title: 'Final Warning',
      message: 'This is your final warning. Deleting your account is PERMANENT. Are you absolutely sure?',
      confirmText: 'Yes, Delete Forever',
      variant: 'danger',
    });

    if (!doubleConfirm) return;

    setIsDeletingAccount(true);
    setMessage(null);

    try {
      await deleteUser();
      // User will be automatically signed out after deletion
    } catch (error: any) {
      console.error('Error deleting account:', error);
      setMessage({ 
        type: 'error', 
        text: error.message || 'Failed to delete account. Please try again.' 
      });
      setIsDeletingAccount(false);
    }
  };

  return (
    <div className="user-profile">
      <h2>👤 User Profile</h2>

      {message && (
        <div className={`message message-${message.type}`}>
          {message.text}
        </div>
      )}

      {/* Pending Invitations Section */}
      {pendingInvitations.teamInvitations.length > 0 && (
        <div className="profile-section invitations-section">
          <h3>✉️ Pending Invitations</h3>
          <p className="section-hint">You've been invited to join the following teams:</p>
          
          {pendingInvitations.teamInvitations.map((invitation) => {
            const team = teams.find((t) => t?.id === invitation.teamId);
            return (
              <div key={invitation.id} className="invitation-card">
                <div className="invitation-header">
                  <strong>Team: {team?.name || 'Loading...'}</strong>
                  <span className="invitation-role">
                    {invitation.role === 'PARENT' ? 'Parent (Read-only)' : invitation.role}
                  </span>
                </div>
                <div className="invitation-meta">
                  Expires: {new Date(invitation.expiresAt).toLocaleDateString()}
                </div>
                <div className="invitation-actions">
                  <button
                    onClick={() => handleAcceptInvitation(invitation.id)}
                    className="btn-primary"
                    disabled={loadingInvitations}
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => handleDeclineInvitation(invitation.id)}
                    className="btn-secondary"
                    disabled={loadingInvitations}
                  >
                    Decline
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="profile-section">
        <h3>Account Information</h3>
        <div className="info-row">
          <label>Email Address</label>
          <div className="info-value">
            {userEmail || user?.signInDetails?.loginId || (user as any)?.attributes?.email || user?.username || 'Not available'}
          </div>
        </div>
      </div>

      <div className="profile-section">
        <h3>Change Password</h3>
        <form onSubmit={handleChangePassword} className="password-form">
          <div className="form-group">
            <label htmlFor="oldPassword">Current Password</label>
            <input
              type="password"
              id="oldPassword"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              required
              disabled={isChangingPassword}
              autoComplete="current-password"
            />
          </div>

          <div className="form-group">
            <label htmlFor="newPassword">New Password</label>
            <input
              type="password"
              id="newPassword"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              disabled={isChangingPassword}
              autoComplete="new-password"
              minLength={8}
            />
            <small>Must be at least 8 characters</small>
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm New Password</label>
            <input
              type="password"
              id="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={isChangingPassword}
              autoComplete="new-password"
            />
          </div>

          <button 
            type="submit" 
            className="btn-primary"
            disabled={isChangingPassword}
          >
            {isChangingPassword ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>

      <div className="profile-section danger-zone">
        <h3>Danger Zone</h3>
        <p className="warning-text">
          Once you delete your account, there is no going back. All your data will be permanently deleted.
        </p>
        <button 
          onClick={handleDeleteAccount}
          className="btn-danger"
          disabled={isDeletingAccount}
        >
          {isDeletingAccount ? 'Deleting...' : 'Delete Account'}
        </button>
      </div>

      <div className="profile-section">
        <button onClick={signOut} className="btn-signout-profile">
          Sign Out
        </button>
      </div>
    </div>
  );
}
