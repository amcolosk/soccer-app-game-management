import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { useOutletContext } from 'react-router-dom';
import { updatePassword, deleteUser, fetchUserAttributes } from 'aws-amplify/auth';
import { getCurrentUser } from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import type { Team } from '../types/schema';
import {
  getUserPendingInvitations,
  acceptTeamInvitation,
  declineTeamInvitation,
} from '../services/invitationService';
import { useConfirm } from './ConfirmModal';
import { trackEvent, AnalyticsEvents } from '../utils/analytics';
import { useHelpFab } from '../contexts/HelpFabContext';
import { buildFlatDebugSnapshot } from '../utils/debugUtils';
import type { UserProfileDebugContext } from '../types/debug';

const client = generateClient<Schema>();

type CoachProfile = Schema['CoachProfile']['type'];

function normalizeName(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function UserProfile() {
  const confirm = useConfirm();
  const { user } = useAuthenticator();
  const { signOut } = useOutletContext<{ signOut: () => void }>();
  const { setHelpContext, setDebugContext } = useHelpFab();

  // Register 'profile' help context while this screen is mounted.
  // @help-content: profile
  useEffect(() => {
    setHelpContext('profile');
    return () => setHelpContext(null);
  }, [setHelpContext]);
  const firstNameInputRef = useRef<HTMLInputElement | null>(null);

  // Coach profile state
  const [coachProfile, setCoachProfile] = useState<CoachProfile | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [shareLastName, setShareLastName] = useState(true);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pendingInvitations, setPendingInvitations] = useState<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    teamInvitations: any[];
  }>({ teamInvitations: [] });
  const [teams, setTeams] = useState<Team[]>([]);
  const [loadingInvitations, setLoadingInvitations] = useState(false);
  const [userEmail, setUserEmail] = useState('');

  const normalizedFirstName = useMemo(() => normalizeName(firstName), [firstName]);
  const saveDisabled = isSavingProfile || !normalizedFirstName;
  const isDirty = useMemo(() => {
    if (!coachProfile) {
      return firstName.trim().length > 0 || lastName.trim().length > 0 || shareLastName !== true;
    }

    return (
      (coachProfile.firstName ?? '') !== firstName ||
      (coachProfile.lastName ?? '') !== lastName ||
      (coachProfile.shareLastNameWithCoaches ?? true) !== shareLastName
    );
  }, [coachProfile, firstName, lastName, shareLastName]);

  const userProfileDebugContext = useMemo((): UserProfileDebugContext => {
    const atIndex = userEmail.indexOf('@');
    const emailDomain = atIndex >= 0 ? userEmail.slice(atIndex + 1) : '(loading)';
    return {
      emailDomain,
      pendingInvitationCount: pendingInvitations.teamInvitations.length,
      invitationTeamCount: teams.length,
      isChangingPassword,
      isDeletingAccount,
    };
  }, [userEmail, pendingInvitations, teams, isChangingPassword, isDeletingAccount]);

  const userProfileDebugSnapshot = useMemo(
    () => buildFlatDebugSnapshot('User Profile Debug Snapshot', { ...userProfileDebugContext }),
    [userProfileDebugContext]
  );

  useEffect(() => {
    setDebugContext(userProfileDebugSnapshot);
    return () => setDebugContext(null);
  }, [userProfileDebugSnapshot, setDebugContext]);

  useEffect(() => {
    void loadPendingInvitations();
    void loadUserAttributes();
    void loadCoachProfile();
  }, []);

  async function loadCoachProfile(): Promise<boolean> {
    setIsLoadingProfile(true);
    try {
      const user = await getCurrentUser();
      const result = await client.models.CoachProfile.get({ id: user.userId });
      const profile = result.data;

      setCoachProfile(profile ?? null);
      setFirstName(profile?.firstName ?? '');
      setLastName(profile?.lastName ?? '');
      setShareLastName(profile?.shareLastNameWithCoaches ?? true);
      return true;
    } catch (error) {
      console.error('Error loading coach profile:', error);
      setProfileMessage({ type: 'error', text: 'Could not load profile. Please try again.' });
      return false;
    } finally {
      setIsLoadingProfile(false);
    }
  }

  const handleDiscardChanges = async () => {
    if (isDirty) {
      const confirmed = await confirm({
        title: 'Discard changes?',
        message: 'You have unsaved profile changes. Discard them?',
        confirmText: 'Discard',
        variant: 'warning',
      });
      if (!confirmed) {
        return;
      }
    }

    setConflictError(null);
    setProfileMessage(null);
    setFirstName(coachProfile?.firstName ?? '');
    setLastName(coachProfile?.lastName ?? '');
    setShareLastName(coachProfile?.shareLastNameWithCoaches ?? true);
  };

  const handleRetryConflict = async () => {
    const isReloaded = await loadCoachProfile();
    if (isReloaded) {
      setConflictError(null);
      firstNameInputRef.current?.focus();
    }
  };

  const handleSaveCoachProfile = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!normalizedFirstName) {
      return;
    }

    setIsSavingProfile(true);
    setProfileMessage(null);

    try {
      const result = await client.mutations.upsertMyCoachProfile({
        firstName: normalizeName(firstName),
        lastName: normalizeName(lastName),
        shareLastNameWithCoaches: shareLastName,
        expectedUpdatedAt: coachProfile?.updatedAt,
      });

      if (result.errors && result.errors.length > 0) {
        const message = result.errors[0].message ?? 'Could not save profile. Please try again.';
        if (message.includes('CONFLICT_PROFILE_UPDATED_ELSEWHERE')) {
          setConflictError('Your profile was updated elsewhere.');
          return;
        }
        throw new Error(message);
      }

      const updated = result.data;
      if (!updated) {
        throw new Error('Could not save profile. Please try again.');
      }

      setCoachProfile(updated);
      setFirstName(updated.firstName ?? '');
      setLastName(updated.lastName ?? '');
      setShareLastName(updated.shareLastNameWithCoaches ?? true);
      setConflictError(null);
      setProfileMessage({ type: 'success', text: 'Profile updated.' });
    } catch (error) {
      console.error('Error saving coach profile:', error);
      setProfileMessage({ type: 'error', text: 'Could not save profile. Please try again.' });
    } finally {
      setIsSavingProfile(false);
    }
  };

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      trackEvent(AnalyticsEvents.INVITATION_ACCEPTED.category, AnalyticsEvents.INVITATION_ACCEPTED.action);
      await loadPendingInvitations();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to accept invitation' });
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
      trackEvent(AnalyticsEvents.INVITATION_DECLINED.category, AnalyticsEvents.INVITATION_DECLINED.action);
      await loadPendingInvitations();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to decline invitation' });
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
      trackEvent(AnalyticsEvents.PASSWORD_CHANGED.category, AnalyticsEvents.PASSWORD_CHANGED.action);
    } catch (error) {
      console.error('Error changing password:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to change password. Please check your current password.'
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
      trackEvent(AnalyticsEvents.ACCOUNT_DELETED.category, AnalyticsEvents.ACCOUNT_DELETED.action);
      await deleteUser();
      // User will be automatically signed out after deletion
    } catch (error) {
      console.error('Error deleting account:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to delete account. Please try again.'
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

      <div className="profile-section">
        <h3>Coach Profile</h3>
        <p className="section-hint">Names are visible only to coaches on your teams.</p>

        {conflictError && (
          <div className="message message-error profile-conflict" role="alert">
            <span>{conflictError}</span>
            <div className="profile-conflict-actions">
              <button type="button" className="btn-secondary" onClick={() => { void handleRetryConflict(); }}>
                Retry
              </button>
              <button type="button" className="btn-secondary" onClick={() => setConflictError(null)}>
                Discard
              </button>
            </div>
          </div>
        )}

        {profileMessage && (
          <div className={`message message-${profileMessage.type}`} aria-live="polite">
            {profileMessage.text}
          </div>
        )}

        <form className="password-form profile-form" onSubmit={handleSaveCoachProfile}>
          <div className="profile-name-grid">
            <div className="form-group">
              <label htmlFor="coachFirstName">First Name</label>
              <input
                id="coachFirstName"
                ref={firstNameInputRef}
                type="text"
                maxLength={50}
                value={firstName}
                disabled={isLoadingProfile || isSavingProfile}
                onBlur={(e) => setFirstName(e.target.value.trim())}
                onChange={(e) => setFirstName(e.target.value)}
                autoCapitalize="words"
              />
              {!normalizedFirstName && (
                <small className="profile-validation">First name required</small>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="coachLastName">Last Name</label>
              <input
                id="coachLastName"
                type="text"
                maxLength={50}
                value={lastName}
                disabled={isLoadingProfile || isSavingProfile}
                onBlur={(e) => setLastName(e.target.value.trim())}
                onChange={(e) => setLastName(e.target.value)}
                autoCapitalize="words"
              />
            </div>
          </div>

          <label className="checkbox-label profile-checkbox-label" htmlFor="shareLastNameWithCoaches">
            <input
              id="shareLastNameWithCoaches"
              type="checkbox"
              checked={shareLastName}
              disabled={isLoadingProfile || isSavingProfile}
              onChange={(e) => setShareLastName(e.target.checked)}
            />
            Share my last name with coaches
          </label>

          <div className="profile-form-actions">
            <button type="submit" className="btn-primary" disabled={saveDisabled}>
              {isSavingProfile ? 'Saving...' : 'Save Profile'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={isSavingProfile || isLoadingProfile}
              onClick={() => { void handleDiscardChanges(); }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>

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
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
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

      <div className="profile-section version-info">
        <small style={{ color: '#666', fontSize: '0.85rem' }}>
          Version {import.meta.env.VITE_APP_VERSION || '1.1.0'}
        </small>
      </div>
    </div>
  );
}
