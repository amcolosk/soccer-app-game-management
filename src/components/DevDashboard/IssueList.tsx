import type { IssueStatus, Issue } from '../../hooks/useBugReports';
import { IssueStatusBadge } from './IssueStatusBadge';

const STATUS_OPTIONS: Array<IssueStatus | 'ALL'> = ['ALL', 'OPEN', 'IN_PROGRESS', 'FIXED', 'DEPLOYED', 'CLOSED'];

export function formatRelativeTime(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 60) return `${Math.max(minutes, 1)} min ago`;
    const hours = Math.floor(diff / 3_600_000);
    if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    const days = Math.floor(diff / 86_400_000);
    if (days <= 7) return `${days} day${days !== 1 ? 's' : ''} ago`;
    return dateStr.slice(0, 10);
  } catch {
    return dateStr;
  }
}

interface IssueListProps {
  issues: Issue[];
  isSynced: boolean;
  filterStatus: IssueStatus | 'ALL';
  onFilterChange: (s: IssueStatus | 'ALL') => void;
  onSelectIssue: (i: Issue) => void;
}

export function IssueList({
  issues,
  isSynced,
  filterStatus,
  onFilterChange,
  onSelectIssue,
}: IssueListProps) {
  if (!isSynced) {
    return (
      <div className="dev-issue-list-loading">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="dev-skeleton-row" />
        ))}
      </div>
    );
  }

  return (
    <div className="dev-issue-list">
      {/* Filter select for mobile */}
      <div className="dev-issue-list-header">
        <select
          className="dev-filter-select"
          value={filterStatus}
          onChange={(e) => onFilterChange(e.target.value as IssueStatus | 'ALL')}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === 'ALL' ? 'All Statuses' : s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      {issues.length === 0 ? (
        <div className="dev-issue-list-empty">No issues found</div>
      ) : (
        issues.map((issue) => (
          <div
            key={issue.id}
            className="dev-issue-row"
            tabIndex={0}
            role="button"
            aria-label={`Issue #${issue.issueNumber}: ${issue.description}`}
            onClick={() => onSelectIssue(issue)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectIssue(issue);
              }
            }}
          >
            <div className="dev-issue-number">#{issue.issueNumber}</div>
            <div className="dev-issue-description-cell">
              <div className="dev-issue-description">{issue.description}</div>
              <div className="dev-issue-meta">
                {issue.reporterEmail && <span>{issue.reporterEmail}</span>}
                {issue.createdAt && (
                  <span>{formatRelativeTime(issue.createdAt)}</span>
                )}
              </div>
            </div>
            <IssueStatusBadge
              value={(issue.type ?? 'BUG') as 'BUG' | 'FEATURE_REQUEST'}
              variant="type"
            />
            <IssueStatusBadge
              value={(issue.severity ?? 'medium') as 'low' | 'medium' | 'high' | 'feature-request'}
              variant="severity"
            />
            <IssueStatusBadge
              value={(issue.status ?? 'OPEN') as IssueStatus}
              variant="status"
            />
          </div>
        ))
      )}
    </div>
  );
}
