import { useState, useEffect } from 'react';
import { generateClient } from 'aws-amplify/data';
import { getCurrentUser } from 'aws-amplify/auth';
import type { Schema } from '../../amplify/data/resource';
import {
  sendTeamInvitation,
  revokeCoachAccess,
  type InvitationRole,
} from '../services/invitationService';

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
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InvitationRole>('COACH');
  const [coaches, setCoaches] = useState<string[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string>('');

  useEffect(() => {
    getCurrentUser().then(user => setCurrentUserId(user.userId)).catch(() => {});
    loadData();
  }, [resourceId, type]);

  async function loadData() {
    try {
      // Load team coaches
      const teamResponse = await client.models.Team.get({ id: resourceId });
      setCoaches(teamResponse.data?.coaches || []);

      // Load team invitations
      const invsResponse = await client.models.TeamInvitation.list({
        filter: { teamId: { eq: resourceId } },
      });
      setInvitations(invsResponse.data || []);
    } catch (error) {
      console.error('Error loading data:', error);
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
      setMessage(`Invitation sent to ${inviteEmail}`);
      setInviteEmail('');
      await loadData();
    } catch (error: any) {
      setMessage(`Error: ${error.message || 'Failed to send invitation'}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleRevokeAccess(userId: string) {
    if (!confirm('Are you sure you want to revoke access for this coach?')) {
      return;
    }

    setLoading(true);
    try {
      await revokeCoachAccess(resourceId, userId);
      setMessage('Coach access revoked successfully');
      await loadData();
    } catch (error: any) {
      setMessage(`Error: ${error.message || 'Failed to revoke access'}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleCancelInvitation(invitationId: string) {
    if (!confirm('Are you sure you want to cancel this invitation?')) {
      return;
    }

    setLoading(true);
    try {
      await client.models.TeamInvitation.delete({ id: invitationId });
      setMessage('Invitation cancelled');
      await loadData();
    } catch (error: any) {
      setMessage(`Error: ${error.message || 'Failed to cancel invitation'}`);
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
                    Link: {window.location.origin}/?invitationId={inv.id}
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
      `}</style>
    </div>
  );
}
