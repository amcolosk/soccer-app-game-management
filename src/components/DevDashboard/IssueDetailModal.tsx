import { useState, useEffect } from 'react';
import { getUrl } from 'aws-amplify/storage';
import type { IssueStatus, Issue } from '../../hooks/useBugReports';
import { IssueStatusBadge } from './IssueStatusBadge';

interface IssueDetailModalProps {
  issue: Issue;
  updating: boolean;
  onClose: () => void;
  onUpdateStatus: (issueNumber: number, status: IssueStatus, resolution?: string) => Promise<void>;
}

const STATUS_TRANSITIONS: Record<string, IssueStatus[]> = {
  OPEN: ['IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['FIXED', 'CLOSED'],
  FIXED: ['DEPLOYED', 'CLOSED'],
  DEPLOYED: ['CLOSED'],
  CLOSED: [],
};

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}

function parseSystemInfo(raw: string | null | undefined): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

function requiresResolution(status: IssueStatus): boolean {
  return status === 'CLOSED';
}

function showResolution(status: IssueStatus): boolean {
  return status === 'FIXED' || status === 'DEPLOYED' || status === 'CLOSED';
}

export function IssueDetailModal({ issue, updating, onClose, onUpdateStatus }: IssueDetailModalProps) {
  const currentStatus = (issue.status ?? 'OPEN') as IssueStatus;
  const transitions = STATUS_TRANSITIONS[currentStatus] ?? [];

  const [nextStatus, setNextStatus] = useState<IssueStatus>(transitions[0] ?? currentStatus);
  const [resolution, setResolution] = useState('');
  const [sysInfoOpen, setSysInfoOpen] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [screenshotFailed, setScreenshotFailed] = useState(false);

  useEffect(() => {
    // Reset state when issue changes to avoid stale screenshot from previous issue
    setScreenshotUrl(null);
    setScreenshotFailed(false);
    if (!issue.screenshotKey) return;
    // Amplify v6 Storage uses path-based API
    getUrl({ path: issue.screenshotKey, options: { expiresIn: 3600 } })
      .then((result) => setScreenshotUrl(result.url.toString()))
      .catch(() => setScreenshotFailed(true));
  }, [issue.screenshotKey]);

  const isClosed = transitions.length === 0;
  const sysInfoFormatted = parseSystemInfo(issue.systemInfo);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isClosed) return;
    await onUpdateStatus(
      issue.issueNumber ?? 0,
      nextStatus,
      resolution || undefined,
    );
    onClose();
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  return (
    <div className="modal-overlay" onClick={handleBackdropClick}>
      <div className="dev-modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="dev-modal-header">
          <span className="dev-modal-issue-number">#{issue.issueNumber}</span>
          <div className="dev-modal-badge-row">
            <IssueStatusBadge value={(issue.type ?? 'BUG') as 'BUG' | 'FEATURE_REQUEST'} variant="type" />
            <IssueStatusBadge value={(issue.severity ?? 'medium') as 'low' | 'medium' | 'high' | 'feature-request'} variant="severity" />
            <IssueStatusBadge value={currentStatus} variant="status" />
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="dev-modal-body">
          {/* Description */}
          <div className="dev-modal-section">
            <div className="dev-modal-section-label">Description</div>
            <div className="dev-modal-text-content">{issue.description ?? '—'}</div>
          </div>

          {/* Steps to reproduce */}
          {issue.steps && (
            <div className="dev-modal-section">
              <div className="dev-modal-section-label">Steps to Reproduce</div>
              <pre className="dev-modal-text-pre">{issue.steps}</pre>
            </div>
          )}

          {/* System Info (collapsible) */}
          {sysInfoFormatted && (
            <div className="dev-modal-section">
              <button
                type="button"
                className="dev-sysinfo-toggle"
                onClick={() => setSysInfoOpen((o) => !o)}
                aria-expanded={sysInfoOpen}
              >
                System Info {sysInfoOpen ? '▲' : '▼'}
              </button>
              <div className="dev-sysinfo-panel" hidden={!sysInfoOpen}>
                <pre className="dev-modal-text-pre">{sysInfoFormatted}</pre>
              </div>
            </div>
          )}

          {/* Screenshot */}
          {issue.screenshotKey && (
            <div className="dev-modal-section">
              <div className="dev-modal-section-label">Screenshot</div>
              {screenshotFailed ? (
                <p className="dev-screenshot-unavailable">Screenshot no longer available</p>
              ) : screenshotUrl ? (
                <>
                  <img
                    src={screenshotUrl}
                    alt="Bug report screenshot"
                    className="dev-screenshot-img"
                  />
                  <a
                    href={screenshotUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="dev-screenshot-link"
                  >
                    Open full size ↗
                  </a>
                </>
              ) : (
                <p className="dev-screenshot-loading">Loading screenshot…</p>
              )}
            </div>
          )}

          {/* Existing resolution */}
          {issue.resolution && (
            <div className="dev-modal-section">
              <div className="dev-modal-section-label">Resolution</div>
              <div className="dev-existing-resolution">{issue.resolution}</div>
            </div>
          )}

          {/* Meta grid */}
          <div className="dev-modal-meta-grid">
            <div className="dev-meta-cell">
              <div className="dev-meta-label">Reporter</div>
              <div className="dev-meta-value">{issue.reporterEmail ?? '—'}</div>
            </div>
            <div className="dev-meta-cell">
              <div className="dev-meta-label">Created</div>
              <div className="dev-meta-value">{formatDateTime(issue.createdAt)}</div>
            </div>
            <div className="dev-meta-cell">
              <div className="dev-meta-label">Updated</div>
              <div className="dev-meta-value dev-meta-value--muted">{formatDateTime(issue.updatedAt)}</div>
            </div>
            {issue.closedAt && (
              <div className="dev-meta-cell">
                <div className="dev-meta-label">Closed</div>
                <div className="dev-meta-value dev-meta-value--muted">{formatDateTime(issue.closedAt)}</div>
              </div>
            )}
          </div>
        </div>

        <div className="dev-modal-divider" />

        {/* Footer — status update form */}
        <div className="dev-modal-footer">
          {isClosed ? (
            <div className="dev-status-readonly-notice">
              This issue is closed. No further status changes are available.
            </div>
          ) : (
            <form className="dev-status-form" onSubmit={handleSubmit}>
              <div className="dev-modal-section-label">Update Status</div>
              <select
                className="dev-status-select"
                value={nextStatus}
                onChange={(e) => setNextStatus(e.target.value as IssueStatus)}
                disabled={updating}
              >
                {transitions.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>

              {showResolution(nextStatus) && (
                <textarea
                  className="dev-resolution-textarea"
                  placeholder={
                    requiresResolution(nextStatus)
                      ? 'Resolution is required'
                      : 'Resolution (optional)'
                  }
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  rows={3}
                  disabled={updating}
                  required={requiresResolution(nextStatus)}
                />
              )}

              <button
                type="submit"
                className="btn-primary"
                disabled={updating}
              >
                {updating ? 'Saving…' : 'Save Status'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
