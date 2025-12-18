import { useState, useEffect } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import {
  acceptTeamInvitation,
  declineTeamInvitation
} from '../services/invitationService';

const client = generateClient<Schema>();

interface InvitationAcceptanceProps {
  invitationId: string;
  onComplete?: () => void;
}

function InvitationAcceptance({ invitationId, onComplete }: InvitationAcceptanceProps) {
  const [loading, setLoading] = useState(true);
  const [invitation, setInvitation] = useState<any>(null);
  const [resourceName, setResourceName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    loadInvitation();
  }, [invitationId]);

  async function loadInvitation() {
    if (!invitationId) {
      setError('Invalid invitation link');
      setLoading(false);
      return;
    }

    try {
      // Load team invitation
      const teamInvResponse = await client.models.TeamInvitation.get({
        id: invitationId,
      });

      if (teamInvResponse.data) {
        setInvitation(teamInvResponse.data);

        // Load team name
        const teamResponse = await client.models.Team.get({
          id: teamInvResponse.data.teamId,
        });
        setResourceName(teamResponse.data?.name || 'Team');
        setLoading(false);
        return;
      }

      setError('Invitation not found');
      setLoading(false);
    } catch (error: any) {
      console.error('Error loading invitation:', error);
      setError('Failed to load invitation');
      setLoading(false);
    }
  }

  async function handleAccept() {
    if (!invitationId) return;

    setProcessing(true);
    setMessage('');
    setError('');

    try {
      await acceptTeamInvitation(invitationId);
      setMessage(`Successfully joined ${resourceName}!`);
      
      // Call onComplete callback after 2 seconds
      if (onComplete) {
        setTimeout(() => {
          onComplete();
        }, 2000);
      }
    } catch (error: any) {
      setError(error.message || 'Failed to accept invitation');
      setProcessing(false);
    }
  }

  async function handleDecline() {
    if (!invitationId) return;

    if (!confirm('Are you sure you want to decline this invitation?')) {
      return;
    }

    setProcessing(true);
    setMessage('');
    setError('');

    try {
      await declineTeamInvitation(invitationId);
      setMessage('Invitation declined');
      
      // Call onComplete callback after 2 seconds
      if (onComplete) {
        setTimeout(() => {
          onComplete();
        }, 2000);
      }
    } catch (error: any) {
      setError(error.message || 'Failed to decline invitation');
      setProcessing(false);
    }
  }

  if (loading) {
    return (
      <div className="invitation-acceptance">
        <div className="loading">Loading invitation...</div>
      </div>
    );
  }

  if (error && !invitation) {
    return (
      <div className="invitation-acceptance">
        <div className="error-state">
          <h2>❌ {error}</h2>
          {onComplete && (
            <button onClick={() => onComplete()} className="btn-primary">
              Go Back
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!invitation) {
    return (
      <div className="invitation-acceptance">
        <div className="error-state">
          <h2>Invitation not found</h2>
          {onComplete && (
            <button onClick={() => onComplete()} className="btn-primary">
              Go Back
            </button>
          )}
        </div>
      </div>
    );
  }

  // Check if expired
  const isExpired = new Date(invitation.expiresAt) < new Date();
  const isAlreadyProcessed = invitation.status !== 'PENDING';

  return (
    <div className="invitation-acceptance">
      <div className="invitation-card">
        <h1>🎉 You're Invited!</h1>
        
        <div className="invitation-details">
          <p className="invitation-text">
            You've been invited to join <strong>{resourceName}</strong> as a{' '}
            <strong>
              {invitation.role === 'PARENT' ? 'Parent (Read-only)' : invitation.role}
            </strong>
          </p>

          <p className="invitation-description">
            As a {invitation.role === 'PARENT' ? 'parent' : 'coach'}, you'll be able to{' '}
            {invitation.role === 'PARENT'
              ? 'view team information and game schedules'
              : 'help manage the roster, create lineups, and track games'}
            .
          </p>

          <p className="invitation-expiry">
            {isExpired ? (
              <span className="expired">⚠️ This invitation expired on {new Date(invitation.expiresAt).toLocaleDateString()}</span>
            ) : (
              <span>Expires: {new Date(invitation.expiresAt).toLocaleDateString()}</span>
            )}
          </p>
        </div>

        {message && <div className="message message-success">{message}</div>}
        {error && <div className="message message-error">{error}</div>}

        {!isExpired && !isAlreadyProcessed && !message && (
          <div className="invitation-actions">
            <button
              onClick={handleAccept}
              className="btn-primary"
              disabled={processing}
            >
              {processing ? 'Processing...' : 'Accept Invitation'}
            </button>
            <button
              onClick={handleDecline}
              className="btn-secondary"
              disabled={processing}
            >
              Decline
            </button>
          </div>
        )}

        {isExpired && (
          <div className="invitation-actions">
            {onComplete && (
              <button onClick={() => onComplete()} className="btn-primary">
                Go Back
              </button>
            )}
          </div>
        )}

        {isAlreadyProcessed && !message && (
          <div className="invitation-actions">
            <p className="status-message">
              This invitation has already been {invitation.status.toLowerCase()}.
            </p>
            {onComplete && (
              <button onClick={() => onComplete()} className="btn-primary">
                Go Back
              </button>
            )}
          </div>
        )}
      </div>

      <style>{`
        .invitation-acceptance {
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          padding: 20px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }

        .invitation-card {
          background: white;
          border-radius: 16px;
          padding: 40px;
          max-width: 600px;
          width: 100%;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          text-align: center;
        }

        .invitation-card h1 {
          margin: 0 0 20px 0;
          color: #333;
        }

        .invitation-details {
          margin: 30px 0;
          text-align: left;
        }

        .invitation-text {
          font-size: 1.2em;
          margin-bottom: 15px;
        }

        .invitation-description {
          color: #666;
          line-height: 1.6;
          margin-bottom: 20px;
        }

        .invitation-expiry {
          font-size: 0.9em;
          color: #999;
        }

        .invitation-expiry .expired {
          color: #d32f2f;
          font-weight: 600;
        }

        .invitation-actions {
          display: flex;
          gap: 15px;
          justify-content: center;
          margin-top: 30px;
        }

        .loading, .error-state {
          text-align: center;
          background: white;
          padding: 40px;
          border-radius: 16px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        }

        .message {
          padding: 15px;
          border-radius: 8px;
          margin: 20px 0;
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

        .status-message {
          margin-bottom: 20px;
          font-size: 1.1em;
          color: #666;
        }
      `}</style>
    </div>
  );
}

export default InvitationAcceptance;
