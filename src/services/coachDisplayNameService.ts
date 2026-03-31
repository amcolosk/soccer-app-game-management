/**
 * Coach Display Name Service
 *
 * Handles formatting and normalization of coach attribution labels for pre-game notes.
 * Includes support for:
 * - Current user identification
 * - Privacy-based display format selection
 * - Removed coach fallback labels
 * - Deterministic duplicate disambiguation
 */

export interface TeamCoachProfileDTO {
  coachId: string;
  displayName: string | null;
  isFallback: boolean;
  disambiguationGroupKey: string | null;
}

/**
 * Resolve the attribution label for a note author
 *
 * Rules (in priority order):
 * 1. authorId === null => "Unknown Author"
 * 2. authorId === currentUserId => "You" (no ordinal suffix)
 * 3. author not in team profiles (removed) => "Former Coach"
 * 4. author in profiles but no displayName => "Coach"
 * 5. author has displayName => use displayName (may have ordinal from server)
 */
export function resolveAttributionLabel(
  authorId: string | null | undefined,
  currentUserId: string | undefined,
  profileMap: Map<string, TeamCoachProfileDTO>
): string {
  // Rule 1: null authorId
  if (!authorId) {
    return 'Unknown Author';
  }

  // Rule 2: current user
  if (authorId === currentUserId) {
    return 'You';
  }

  // Check if author is in profile map
  const profile = profileMap.get(authorId);

  // Rule 3: author not in profiles (removed from team)
  if (!profile) {
    return 'Former Coach';
  }

  // Rule 4: author in profiles but no displayName
  if (!profile.displayName) {
    return 'Coach';
  }

  // Rule 5: author has displayName
  return profile.displayName;
}

/**
 * Get CSS class name for styling the attribution label
 */
export function getAttributionLabelClassName(
  authorId: string | null | undefined,
  currentUserId: string | undefined,
  profileMap: Map<string, TeamCoachProfileDTO>
): string {
  if (!authorId) {
    return 'attribution-label attribution-unknown';
  }

  if (authorId === currentUserId) {
    return 'attribution-label attribution-you';
  }

  const profile = profileMap.get(authorId);
  if (!profile) {
    return 'attribution-label attribution-removed';
  }

  if (!profile.displayName) {
    return 'attribution-label attribution-fallback';
  }

  return 'attribution-label attribution-named';
}

/**
 * Format the attribution footer line
 *
 * Returns: "Created by: [label]"
 */
export function formatAttributionLine(label: string): string {
  return `Created by: ${label}`;
}
