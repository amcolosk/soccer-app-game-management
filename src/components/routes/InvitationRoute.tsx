import { useParams, useNavigate } from "react-router-dom";
import InvitationAcceptance from "../InvitationAcceptance";
import { ConfirmProvider } from "../ConfirmModal";

/**
 * Route wrapper for /invite/:invitationId
 * 
 * Renders the full-screen invitation acceptance UI.
 * Has its own ConfirmProvider since it renders outside the AppLayout.
 */
export function InvitationRoute() {
  const { invitationId } = useParams<{ invitationId: string }>();
  const navigate = useNavigate();

  if (!invitationId) {
    return (
      <main className="app-container">
        <div className="empty-state">
          <p>Invalid invitation link.</p>
          <button onClick={() => navigate("/")} className="btn-primary">
            Go Home
          </button>
        </div>
      </main>
    );
  }

  return (
    <ConfirmProvider>
      <main className="app-container">
        <header className="app-header">
          <div className="app-branding">
            <h1>⚽ TeamTrack</h1>
            <p className="app-tagline">Game Management for Coaches</p>
          </div>
        </header>
        <InvitationAcceptance
          invitationId={invitationId}
          onComplete={() => navigate("/")}
        />
      </main>
    </ConfirmProvider>
  );
}
