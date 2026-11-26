import { resolveSecondHalfStarters } from "./halftimeStarters";
import type { FormationPosition, LineupAssignment } from "./types";

interface HalftimeLineupSummaryProps {
  lineup: LineupAssignment[];
  positions: FormationPosition[];
  pendingRemovalIds: Set<string>;
  maxPlayersOnField: number;
}

/**
 * Compact, anomaly-only strip shown at halftime, between `LineupPanel` and the
 * "Start Second Half" CTA — it does not duplicate LineupPanel's full roster.
 * When nothing is wrong it renders one reassuring line; otherwise one line per
 * anomaly (an empty position, or fewer starters than expected).
 *
 * This is informational only, not a guarantee: it's synchronous and can't
 * predict `handleStartSecondHalf`'s async DB-fallback outcome — it may flag an
 * under-count that the DB re-query would then resolve.
 */
export function HalftimeLineupSummary({
  lineup,
  positions,
  pendingRemovalIds,
  maxPlayersOnField,
}: HalftimeLineupSummaryProps) {
  const { starters, expectedCount, emptyPositionIds } = resolveSecondHalfStarters({
    lineup,
    positions,
    pendingRemovalIds,
    maxPlayersOnField,
  });

  const emptyPositions = emptyPositionIds
    .map((id) => positions.find((position) => position.id === id))
    .filter((position): position is FormationPosition => !!position?.positionName);

  const countGap = Math.max(expectedCount - starters.length, 0);
  // Only surface the under-count line when it represents an unexplained
  // shortfall beyond the specifically-named empty positions above — an
  // ordinary single missing starter is already fully explained by its own
  // "{position} is empty" line, so showing both would be redundant.
  const showCountGapLine = countGap > emptyPositionIds.length;
  const hasAnomaly = emptyPositions.length > 0 || showCountGapLine;

  return (
    <div className="halftime-lineup-summary" role="status" aria-live="polite">
      {!hasAnomaly ? (
        <p className="halftime-lineup-summary__line halftime-lineup-summary__line--ok">
          All positions filled
        </p>
      ) : (
        <>
          {emptyPositions.map((position) => (
            <p key={position.id} className="halftime-lineup-summary__line halftime-lineup-summary__line--warning">
              {position.positionName} is empty
            </p>
          ))}
          {showCountGapLine && (
            <p className="halftime-lineup-summary__line halftime-lineup-summary__line--warning">
              {starters.length} of {expectedCount} starters assigned — may still resolve when the second half starts.
            </p>
          )}
        </>
      )}
    </div>
  );
}
