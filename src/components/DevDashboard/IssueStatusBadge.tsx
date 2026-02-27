import type { IssueStatus } from '../../hooks/useBugReports';

type SeverityValue = 'low' | 'medium' | 'high' | 'feature-request';
type TypeValue = 'BUG' | 'FEATURE_REQUEST';

interface IssueStatusBadgeProps {
  value: IssueStatus | SeverityValue | TypeValue;
  variant: 'status' | 'severity' | 'type';
}

export function IssueStatusBadge({ value, variant }: IssueStatusBadgeProps) {
  const slug = value.toLowerCase().replace(/_/g, '-').replace(/\s/g, '-');
  const className = `dev-badge dev-badge--${variant}-${slug}`;
  const label = value.replace(/_/g, ' ');
  return <span className={className}>{label}</span>;
}
