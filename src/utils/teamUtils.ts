import type { Team } from '../types/schema';

/**
 * Legacy teams predating the archive feature have no `status` attribute at all
 * — Amplify's `.default('active')` only applies to newly created records, and
 * nothing backfills existing rows. Every consumer must treat status == null as
 * active. See docs/plans/TEAM-ARCHIVE-PLAN.md, Correction 2.
 */
export function isTeamArchived(team: Pick<Team, 'status'>): boolean {
  return team.status === 'archived';
}

export function isTeamActive(team: Pick<Team, 'status'>): boolean {
  return !isTeamArchived(team);
}

/**
 * True only when `ownerId` is set AND that id is still present in `coaches`.
 * An owner can become orphaned — removed from `coaches` via
 * `revokeCoachAccess` (which has no owner guard) without `ownerId` ever being
 * cleared (it has no update grant). `assignTeamOwner`'s backend condition
 * already treats an orphaned owner as reclaimable by any current coach
 * (TEAM-ARCHIVE-STEP1-BACKEND-WIRING.md, Decision 5) — this helper must match
 * that condition so the "Owner Unassigned" / "Assign Owner" UI stays reachable
 * for orphaned teams, not just never-owned ones. Confirmed (round 2 review)
 * to exactly match the deployed backend condition on both archiveTeam and
 * assignTeamOwner.
 */
export function isTeamOwnershipAssigned(team: Pick<Team, 'ownerId' | 'coaches'>): boolean {
  return !!team.ownerId && !!team.coaches?.includes(team.ownerId);
}

/** True only for the current user, and only when they are the *valid* owner (see isTeamOwnershipAssigned). */
export function isTeamOwner(
  team: Pick<Team, 'ownerId' | 'coaches'>,
  userId: string | null | undefined,
): boolean {
  if (!userId) return false;
  return isTeamOwnershipAssigned(team) && team.ownerId === userId;
}

/** Formats an ISO datetime for the archived-team card, e.g. "Aug 19, 2026". Returns null for missing/invalid input. */
export function formatArchivedOn(archivedAt: string | null | undefined): string | null {
  if (!archivedAt) return null;
  const date = new Date(archivedAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
