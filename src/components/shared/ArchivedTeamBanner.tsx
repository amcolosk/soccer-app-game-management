import { isTeamArchived, formatArchivedOn } from '../../utils/teamUtils';
import type { Team } from '../../types/schema';

interface ArchivedTeamBannerProps {
  team: Pick<Team, 'status' | 'archivedAt'>;
}

/**
 * Persistent, prominent read-only indicator for every surface that displays
 * an archived team's data (Season Reports, in-game management). Renders
 * nothing for active teams — safe to mount unconditionally at every call
 * site. See docs/plans/TEAM-ARCHIVE-PLAN.md Phase 5 step 4 / Phase 6 for the
 * canonical copy. Intentionally not sticky/CSS-position-locked — see
 * docs/plans/TEAM-ARCHIVE-STEP9-REPORTS-READONLY-BANNERS.md, "Decision:
 * banner is non-sticky."
 */
export function ArchivedTeamBanner({ team }: ArchivedTeamBannerProps) {
  if (!isTeamArchived(team)) return null;

  const archivedOn = formatArchivedOn(team.archivedAt);

  return (
    <div className="archived-team-banner" role="status" aria-live="polite">
      <span aria-hidden="true">🔒</span>
      {' '}Archived Team — Read-Only{archivedOn ? ` (Archived ${archivedOn})` : ''}
    </div>
  );
}
