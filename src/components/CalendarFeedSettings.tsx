import { useState } from 'react';
import type { Team, CalendarSyncResult } from '../types/schema';
import { isTeamArchived } from '../utils/teamUtils';
import { useConfirm } from './ConfirmModal';
import { syncTeamCalendar, unlinkTeamCalendar } from '../services/calendarSyncService';
import { showError, showSuccess, showWarning } from '../utils/toast';

interface CalendarFeedSettingsProps {
  team: Team;
  /** Bumps the caller's own team-refresh key so the newly-written
   * calendarFeed* status fields show up — SDK writes inside the Lambda
   * don't fire AppSync subscriptions, the same gap Home.tsx's
   * `gameRefreshKey` already works around for Game. */
  onTeamDataChanged: () => void;
}

function isNoOpResult(result: CalendarSyncResult): boolean {
  return (result.createdGames?.length ?? 0) === 0 &&
    (result.updatedGames?.length ?? 0) === 0 &&
    (result.adoptedCount ?? 0) === 0 &&
    (result.cancelledCount ?? 0) === 0;
}

function describeResult(result: CalendarSyncResult): string {
  const parts: string[] = [];
  const createdCount = result.createdGames?.length ?? 0;
  const updatedCount = (result.updatedGames?.length ?? 0) - (result.adoptedCount ?? 0);
  if (createdCount > 0) parts.push(`created ${createdCount}`);
  if (updatedCount > 0) parts.push(`updated ${updatedCount}`);
  if (result.adoptedCount) parts.push(`linked ${result.adoptedCount} you already entered`);
  if (result.cancelledCount) parts.push(`flagged ${result.cancelledCount} cancelled`);

  let message = parts.length > 0 ? `Calendar linked — ${parts.join(', ')}` : 'Calendar linked';

  // Per-event write failures during a real sync are swallowed by the
  // handler so the rest of the batch keeps processing (sync-team-calendar
  // handler.ts ~line 416-430) — surface that here rather than silently
  // dropping it, since there's no other UI surface for it.
  const failedCount = result.failedCount ?? 0;
  if (failedCount > 0) {
    message += `, but ${failedCount} game${failedCount === 1 ? '' : 's'} failed to sync`;
  }

  const warningsCount = result.warnings?.length ?? 0;
  if (warningsCount > 0) {
    message += ` (${warningsCount} warning${warningsCount === 1 ? '' : 's'})`;
  }

  return `${message}.`;
}

function formatSyncedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * Team-settings panel: link a URL feed, Replace, read-only status display,
 * Unlink behind a confirm step. Status fields (`calendarFeedHost`, last
 * synced, last error) are sourced entirely from `Team` — this component
 * never reads the feed URL back, because nothing can (CalendarFeed is
 * Lambda-only). Hidden for archived teams.
 */
export function CalendarFeedSettings({ team, onTeamDataChanged }: CalendarFeedSettingsProps) {
  const confirm = useConfirm();
  const [feedUrlInput, setFeedUrlInput] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [preview, setPreview] = useState<CalendarSyncResult | null>(null);

  if (isTeamArchived(team)) {
    return null;
  }

  const hasFeed = Boolean(team.calendarFeedHost);

  const commitLink = async (url: string) => {
    setIsApplying(true);
    try {
      const result = await syncTeamCalendar({ teamId: team.id, feedUrl: url, saveFeedUrl: true, dryRun: false });
      const message = describeResult(result);
      if ((result.failedCount ?? 0) > 0) {
        showWarning(message);
      } else {
        showSuccess(message);
      }
      setFeedUrlInput('');
      setPreview(null);
      onTeamDataChanged();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to link calendar feed');
    } finally {
      setIsApplying(false);
    }
  };

  const handleLinkOrReplace = async () => {
    const url = feedUrlInput.trim();
    if (!url) {
      showError('Enter a calendar feed URL');
      return;
    }
    setIsChecking(true);
    try {
      const result = await syncTeamCalendar({ teamId: team.id, feedUrl: url, saveFeedUrl: true, dryRun: true });
      if (isNoOpResult(result)) {
        // dryRun never persists the URL — still need one real (non-dryRun)
        // call to actually save+apply it, even when there's nothing to
        // import (e.g. an empty feed).
        await commitLink(url);
        return;
      }
      setPreview(result);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to check calendar feed');
    } finally {
      setIsChecking(false);
    }
  };

  const handleConfirmPreview = async () => {
    await commitLink(feedUrlInput.trim());
  };

  const handleCancelPreview = () => {
    setPreview(null);
  };

  const handleUnlink = async () => {
    const confirmed = await confirm({
      title: 'Unlink Calendar',
      message: 'This stops syncing and clears the saved feed. Games already imported from it are not affected.',
      confirmText: 'Unlink',
      variant: 'danger',
    });
    if (!confirmed) return;

    setIsUnlinking(true);
    try {
      await unlinkTeamCalendar(team.id);
      showSuccess('Calendar unlinked');
      onTeamDataChanged();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to unlink calendar');
    } finally {
      setIsUnlinking(false);
    }
  };

  const lastSyncedLabel = formatSyncedAt(team.calendarFeedLastSyncedAt);

  return (
    <div className="calendar-feed-settings">
      <h4>Calendar Sync</h4>

      {hasFeed ? (
        <p className="calendar-feed-settings__status">
          Linked to <strong>{team.calendarFeedHost}</strong>
          {lastSyncedLabel && ` — last synced ${lastSyncedLabel}`}
        </p>
      ) : (
        <p className="calendar-feed-settings__status">No calendar feed linked yet.</p>
      )}

      {team.calendarFeedLastError && (
        <p className="calendar-feed-settings__error" role="alert">⚠ {team.calendarFeedLastError}</p>
      )}

      <p className="calendar-import-overwrite-note">
        Imported venue and arrive-by details may be overwritten on the next sync.
      </p>

      <input
        type="url"
        placeholder="https://calendar.playmetrics.com/..."
        value={feedUrlInput}
        onChange={(e) => setFeedUrlInput(e.target.value)}
        disabled={isChecking || isApplying}
        aria-label="Calendar feed URL"
      />

      <div className="calendar-feed-settings__actions">
        <button
          onClick={handleLinkOrReplace}
          className="btn-primary"
          disabled={isChecking || isApplying || !feedUrlInput.trim()}
        >
          {isChecking ? 'Checking…' : hasFeed ? 'Replace' : 'Link'}
        </button>
        {hasFeed && (
          <button onClick={handleUnlink} className="btn-secondary" disabled={isUnlinking}>
            {isUnlinking ? 'Unlinking…' : 'Unlink'}
          </button>
        )}
      </div>

      {preview && (
        <div className="modal-overlay" onClick={handleCancelPreview}>
          <div className="modal-content calendar-import-preview-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Import Preview</h2>
            <ul className="calendar-import-summary">
              {(preview.createdGames?.length ?? 0) > 0 && (
                <li>This will create {preview.createdGames!.length} game(s).</li>
              )}
              {(preview.adoptedCount ?? 0) > 0 && (
                <li>Link {preview.adoptedCount} game(s) you already entered by hand.</li>
              )}
              {((preview.updatedGames?.length ?? 0) - (preview.adoptedCount ?? 0)) > 0 && (
                <li>Update {(preview.updatedGames!.length) - (preview.adoptedCount ?? 0)} existing game(s).</li>
              )}
              {(preview.cancelledCount ?? 0) > 0 && (
                <li>Flag {preview.cancelledCount} game(s) as cancelled by the organizer.</li>
              )}
              {(preview.skippedCount ?? 0) > 0 && (
                <li>{preview.skippedCount} game(s) are already up to date.</li>
              )}
            </ul>
            {preview.warnings && preview.warnings.length > 0 && (
              <div className="calendar-import-warnings">
                <h4>Warnings</h4>
                <ul>
                  {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
            <div className="form-actions">
              <button onClick={handleConfirmPreview} className="btn-primary" disabled={isApplying}>
                {isApplying ? 'Applying…' : 'Confirm'}
              </button>
              <button onClick={handleCancelPreview} className="btn-secondary" disabled={isApplying}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
