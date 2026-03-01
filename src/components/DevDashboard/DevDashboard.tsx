import { useState } from 'react';
import { Toaster } from 'react-hot-toast';
import toast from 'react-hot-toast';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { useBugReports, type IssueStatus, type Issue } from '../../hooks/useBugReports';
import { IssueList } from './IssueList';
import { IssueDetailModal } from './IssueDetailModal';
import { IssueStatusBadge } from './IssueStatusBadge';

interface DevDashboardProps {
  userEmail: string;
}

const ALL_STATUSES: IssueStatus[] = ['OPEN', 'IN_PROGRESS', 'FIXED', 'DEPLOYED', 'CLOSED'];

export function DevDashboard({ userEmail }: DevDashboardProps) {
  const { signOut } = useAuthenticator();
  const { issues, isSynced, updating, updateError, updateStatus } = useBugReports();

  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [filterStatus, setFilterStatus] = useState<IssueStatus | 'ALL'>('ALL');

  const displayIssues = filterStatus === 'ALL'
    ? issues
    : issues.filter((i) => i.status === filterStatus);

  function countByStatus(status: IssueStatus): number {
    return issues.filter((i) => i.status === status).length;
  }

  async function handleUpdateStatus(
    issueNumber: number,
    status: IssueStatus,
    resolution?: string,
  ) {
    try {
      await updateStatus(issueNumber, status, resolution);
      toast.success(`Issue #${issueNumber} updated to ${status}`);
      setSelectedIssue(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    }
  }

  return (
    <div className="dev-dashboard-page">
      <Toaster position="top-right" />

      {/* Header */}
      <header className="dev-dashboard-header">
        <div className="dev-dashboard-inner">
          <div className="dev-dashboard-wordmark">
            <span className="dev-dashboard-title">TeamTrack Dev Dashboard</span>
          </div>
          <div className="dev-header-right">
            <div className="dev-dashboard-identity">{userEmail}</div>
            <button className="btn-secondary" onClick={signOut}>
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="dev-dashboard-inner">
        {/* Stat chips toolbar */}
        <div className="dev-dashboard-toolbar">
          <div className="dev-stat-chips">
            <button
              type="button"
              className={`dev-stat-chip${filterStatus === 'ALL' ? ' active' : ''}`}
              onClick={() => setFilterStatus('ALL')}
            >
              All <strong>{issues.length}</strong>
            </button>
            {ALL_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={`dev-stat-chip dev-stat-chip--${s.toLowerCase().replace(/_/g, '-')}${filterStatus === s ? ' active' : ''}`}
                onClick={() => setFilterStatus(s)}
              >
                <IssueStatusBadge value={s} variant="status" />
                <strong>{countByStatus(s)}</strong>
              </button>
            ))}
          </div>
        </div>

        {/* Issue list */}
        <IssueList
          issues={displayIssues}
          isSynced={isSynced}
          filterStatus={filterStatus}
          onFilterChange={setFilterStatus}
          onSelectIssue={setSelectedIssue}
        />
      </main>

      {/* Detail modal */}
      {selectedIssue && (
        <IssueDetailModal
          issue={selectedIssue}
          updating={updating}
          onClose={() => setSelectedIssue(null)}
          onUpdateStatus={handleUpdateStatus}
        />
      )}
    </div>
  );
}
