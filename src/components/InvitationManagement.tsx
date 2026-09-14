import { useState, useEffect, useCallback } from 'react';
import { generateClient } from 'aws-amplify/data';
import { getCurrentUser } from 'aws-amplify/auth';
import type { Schema } from '../../amplify/data/resource';
import type { ShareLinkSummary } from '../types/schema';
import { trackEvent, AnalyticsEvents } from '../utils/analytics';
import {
  sendTeamInvitation,
  revokeCoachAccess,
  type InvitationRole,
} from '../services/invitationService';
import { useConfirm } from './ConfirmModal';
import { useAmplifyQuery } from '../hooks/useAmplifyQuery';

const client = generateClient<Schema>();

interface InvitationManagementProps {
  type: 'team';
  resourceId: string;
  resourceName: string;
}

export function InvitationManagement({
  type,
  resourceId,
  resourceName,
}: InvitationManagementProps) {
  const confirm = useConfirm();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InvitationRole>('COACH');
  const [coaches, setCoaches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string>('');

  // Share Links (Milestone B1 — Fan Mode): ShareLink is a zero-client-grant
  // model, so there is no observeQuery subscription available — state is
  // fetched/refreshed explicitly via the listTeamShareLinks/generateShareLink/
  // revokeShareLink custom operations instead of useAmplifyQuery.
  const [shareLinks, setShareLinks] = useState<ShareLinkSummary[]>([]);

  const { data: invitations } = useAmplifyQuery('TeamInvitation', {
    filter: { teamId: { eq: resourceId } },
  }, [resourceId]);

  const refreshShareLinks = useCallback(async () => {
    try {
      const response = await client.queries.listTeamShareLinks({ teamId: resourceId });
      setShareLinks((response.data ?? []).filter((link): link is ShareLinkSummary => !!link));
    } catch (error) {
      console.error('Error loading share links:', error);
    }
  }, [resourceId]);

  useEffect(() => {
    void refreshShareLinks();
  }, [refreshShareLinks]);

  useEffect(() => {
    getCurrentUser().then(user => setCurrentUserId(user.userId)).catch(() => {});

    // Load team coaches (one-time fetch, team changes are rare)
    client.models.Team.get({ id: resourceId }).then(teamResponse => {
      setCoaches(teamResponse.data?.coaches || []);
    }).catch(error => {
      console.error('Error loading team:', error);
    });
  }, [resourceId, type]);

  async function refreshCoaches() {
    try {
      const teamResponse = await client.models.Team.get({ id: resourceId });
      setCoaches(teamResponse.data?.coaches || []);
    } catch (error) {
      console.error('Error refreshing coaches:', error);
    }
  }

  async function handleSendInvite(e: React.FormEvent) {
    e.preventDefault();

    if (!inviteEmail.trim()) {
      setMessage('Please enter an email address');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(inviteEmail)) {
      setMessage('Please enter a valid email address');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      await sendTeamInvitation(resourceId, inviteEmail, inviteRole);
      trackEvent(AnalyticsEvents.INVITATION_SENT.category, AnalyticsEvents.INVITATION_SENT.action);
      setMessage(`Invitation sent to ${inviteEmail}`);
      setInviteEmail('');
      // Invitations update automatically via observeQuery
    } catch (error) {
      setMessage(`Error: ${error instanceof Error ? error.message : 'Failed to send invitation'}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleRevokeAccess(userId: string) {
    const confirmed = await confirm({
      title: 'Revoke Access',
      message: 'Are you sure you want to revoke access for this coach?',
      confirmText: 'Revoke',
      variant: 'danger',
    });
    if (!confirmed) return;

    setLoading(true);
    try {
      await revokeCoachAccess(resourceId, userId);
      setMessage('Coach access revoked successfully');
      await refreshCoaches(); // Refresh coaches list after revoking
    } catch (error) {
      setMessage(`Error: ${error instanceof Error ? error.message : 'Failed to revoke access'}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleCancelInvitation(invitationId: string) {
    const confirmed = await confirm({
      title: 'Cancel Invitation',
      message: 'Are you sure you want to cancel this invitation?',
      confirmText: 'Cancel Invitation',
      variant: 'warning',
    });
    if (!confirmed) return;

    setLoading(true);
    try {
      await client.models.TeamInvitation.delete({ id: invitationId });
      setMessage('Invitation cancelled');
      // Invitations update automatically via observeQuery
    } catch (error) {
      setMessage(`Error: ${error instanceof Error ? error.message : 'Failed to cancel invitation'}`);
    } finally {
      setLoading(false);
    }
  }

  const activeFanLink = shareLinks.find((link) => link.type === 'FAN' && !link.revokedAt);

  function fanLinkUrl(token: string): string {
    return `${window.location.origin}/watch/${token}`;
  }

  async function handleCopyFanLink(token: string) {
    try {
      await navigator.clipboard.writeText(fanLinkUrl(token));
      setMessage('Fan link copied to clipboard');
    } catch {
      setMessage(`Fan link: ${fanLinkUrl(token)}`);
    }
  }

  async function handleGenerateFanLink() {
    if (activeFanLink) {
      const confirmed = await confirm({
        title: 'Replace this link?',
        message: 'This replaces the current link — anyone still using it will lose access.',
        confirmText: 'Replace Link',
        variant: 'warning',
      });
      if (!confirmed) return;
    }

    setLoading(true);
    try {
      const response = await client.mutations.generateShareLink({ teamId: resourceId, type: 'FAN' });
      if (response.errors && response.errors.length > 0) {
        throw new Error(response.errors[0]?.message || 'Failed to generate share link');
      }
      setMessage('Fan link generated');
      await refreshShareLinks();
    } catch (error) {
      setMessage(`Error: ${error instanceof Error ? error.message : 'Failed to generate share link'}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleRevokeFanLink(token: string) {
    const confirmed = await confirm({
      title: 'Revoke this link?',
      message: 'Anyone using it will immediately lose access.',
      confirmText: 'Revoke',
      variant: 'danger',
    });
    if (!confirmed) return;

    setLoading(true);
    try {
      const response = await client.mutations.revokeShareLink({ token });
      if (response.errors && response.errors.length > 0) {
        throw new Error(response.errors[0]?.message || 'Failed to revoke share link');
      }
      setMessage('Fan link revoked');
      await refreshShareLinks();
    } catch (error) {
      setMessage(`Error: ${error instanceof Error ? error.message : 'Failed to revoke share link'}`);
    } finally {
      setLoading(false);
    }
  }

  const getCoachDisplay = (userId: string) => {
    const acceptedInvite = invitations.find(
      (inv) => inv.status === 'ACCEPTED' && inv.acceptedBy === userId
    );
    return acceptedInvite ? acceptedInvite.email : `User ID: ${userId}`;
  };

  const pendingInvitations = invitations.filter((inv) => inv.status === 'PENDING');

  return (
    <div className="invitation-management">
      <h3>Sharing & Permissions: {resourceName}</h3>
      <p className="form-hint">
        Invite coaches to help manage this team, or add parents for read-only access.
      </p>

      <form className="invite-form" onSubmit={handleSendInvite}>
        <h4>Send Invitation</h4>
        <input
          type="email"
          placeholder="Email address"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          disabled={loading}
          required
        />
        <select
          value={inviteRole}
          onChange={(e) => setInviteRole(e.target.value as InvitationRole)}
          disabled={loading}
        >
          <option value="COACH">Coach (Can edit)</option>
          <option value="PARENT">Parent (Read-only)</option>
        </select>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Sending...' : 'Send Invitation'}
        </button>
      </form>

      {message && (
        <div
          className={`message ${
            message.startsWith('Error') ? 'message-error' : 'message-success'
          }`}
        >
          {message}
        </div>
      )}

      {coaches.length > 0 && (
        <div className="permissions-section">
          <h4>Current Coaches ({coaches.filter(id => id !== currentUserId).length})</h4>
          <div className="permissions-list">
            {coaches
              .filter(userId => userId !== currentUserId)
              .map((userId) => (
              <div key={userId} className="permission-item">
                <div className="permission-info">
                  <span className="permission-user">{getCoachDisplay(userId)}</span>
                </div>
                <button
                  onClick={() => handleRevokeAccess(userId)}
                  className="btn-secondary"
                  disabled={loading}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingInvitations.length > 0 && (
        <div className="invitations-section">
          <h4>Pending Invitations ({pendingInvitations.length})</h4>
          <div className="invitations-list">
            {pendingInvitations.map((inv) => (
              <div key={inv.id} className="invitation-item">
                <div className="invitation-info">
                  <span className="invitation-email">{inv.email}</span>
                  <span className="invitation-role">
                    {inv.role === 'PARENT' ? 'Parent (Read-only)' : inv.role}
                  </span>
                  <span className="invitation-expiry">
                    Expires: {new Date(inv.expiresAt).toLocaleDateString()}
                  </span>
                  {/* For testing - display invitation link */}
                  <span className="invitation-link" data-invitation-id={inv.id}>
                    Link: {window.location.origin}/invite/{inv.id}
                  </span>
                </div>
                <button
                  onClick={() => handleCancelInvitation(inv.id)}
                  className="btn-secondary"
                  disabled={loading}
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {coaches.length === 0 && pendingInvitations.length === 0 && (
        <p className="empty-message">
          No coaches or pending invitations. Send an invitation to get started!
        </p>
      )}

      {/* Share Links — a materially different trust boundary (public,
          unauthenticated) than inviting a coach or parent above, so it's
          visually separated with its own divider/heading rather than folded
          into the existing regions. */}
      <hr className="share-links-divider" />
      <div className="share-links-section">
        <h4>Share Links</h4>
        <p className="form-hint">
          Generate a public link so parents/fans can follow the live score and
          lineup — no account needed.
        </p>

        {activeFanLink ? (
          <div className="share-link-item" data-testid="fan-share-link-active">
            <div className="share-link-info">
              <span className="share-link-label">Fan link (live view)</span>
              <span className="share-link-url">{fanLinkUrl(activeFanLink.token)}</span>
            </div>
            <div className="share-link-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => handleCopyFanLink(activeFanLink.token)}
                disabled={loading}
              >
                Copy Link
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleGenerateFanLink}
                disabled={loading}
              >
                Replace
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => handleRevokeFanLink(activeFanLink.token)}
                disabled={loading}
              >
                Revoke
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn-primary"
            onClick={handleGenerateFanLink}
            disabled={loading}
          >
            Generate Fan Link
          </button>
        )}
      </div>

      <style>{`
        .invitation-management {
          margin-top: 20px;
        }

        .invite-form {
          background: #f5f5f5;
          padding: 20px;
          border-radius: 8px;
          margin-bottom: 20px;
        }

        .invite-form h4 {
          margin-top: 0;
        }

        .invite-form input,
        .invite-form select {
          margin-right: 10px;
          margin-bottom: 10px;
        }

        .permissions-section,
        .invitations-section {
          margin-top: 20px;
        }

        .permissions-list,
        .invitations-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .permission-item,
        .invitation-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 15px;
          background: white;
          border: 1px solid #ddd;
          border-radius: 8px;
        }

        .permission-info,
        .invitation-info {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .permission-role {
          font-weight: 600;
          color: #2196f3;
        }

        .invitation-role {
          background: #667eea;
          color: white;
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 0.85em;
          font-weight: 600;
        }

        .permission-date,
        .invitation-expiry {
          font-size: 0.85em;
          color: #666;
        }

        .permission-user,
        .invitation-email {
          font-weight: 500;
        }

        .message {
          padding: 10px 15px;
          border-radius: 4px;
          margin-top: 10px;
        }

        .message-success {
          background: #d4edda;
          color: #155724;
          border: 1px solid #c3e6cb;
        }

        .message-error {
          background: #f8d7da;
          color: #721c24;
          border: 1px solid #f5c6cb;
        }

        .empty-message {
          text-align: center;
          color: #666;
          padding: 20px;
          font-style: italic;
        }

        .share-links-divider {
          margin: 24px 0;
          border: none;
          border-top: 1px solid #ddd;
        }

        .share-links-section {
          margin-top: 10px;
        }

        .share-links-section h4 {
          margin-top: 0;
        }

        .share-link-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          padding: 15px;
          background: white;
          border: 1px solid #ddd;
          border-radius: 8px;
        }

        .share-link-info {
          display: flex;
          flex-direction: column;
          gap: 5px;
          min-width: 0;
        }

        .share-link-label {
          font-weight: 600;
        }

        .share-link-url {
          font-size: 0.85em;
          color: #666;
          word-break: break-all;
        }

        .share-link-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
      `}</style>
    </div>
  );
}
