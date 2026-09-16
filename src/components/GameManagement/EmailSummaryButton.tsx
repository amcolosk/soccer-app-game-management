import { useState } from 'react';
import { emailGameSummary } from '../../services/gameService';
import { showError, showSuccess } from '../../utils/toast';

interface EmailSummaryButtonProps {
  gameId: string;
}

/**
 * "Email Game Summary" button for the completed-game footer. Deliberately
 * not merged into CompletedPlayTimeSummary (that component is documented as
 * having no Amplify client/hooks imports — a pure display component; this
 * button keeps that boundary intact). Recipient is always the clicking
 * coach's own Cognito email, resolved server-side by the Lambda — no
 * opt-in setting, no team-wide fan-out; clicking is the consent.
 */
export function EmailSummaryButton({ gameId }: EmailSummaryButtonProps) {
  const [isSending, setIsSending] = useState(false);

  const handleClick = async () => {
    setIsSending(true);
    try {
      const result = await emailGameSummary(gameId);
      showSuccess(result.sentTo ? `Summary sent to ${result.sentTo}` : 'Summary sent');
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to send summary email');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      className="btn-secondary"
      disabled={isSending}
    >
      {isSending ? 'Sending…' : 'Email Game Summary'}
    </button>
  );
}
