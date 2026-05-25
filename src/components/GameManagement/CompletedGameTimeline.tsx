import { useMemo } from "react";
import type { PlayerWithRoster, PlayTimeRecord, Goal, FormationPosition } from "./types";
import { buildTimelineViewModel } from "./completedGameTimelineTransform";

interface CompletedGameTimelineProps {
  players: PlayerWithRoster[];
  playTimeRecords: PlayTimeRecord[];
  goals: Goal[];
  positions: FormationPosition[];
  gameEndSeconds: number;
  halfLengthSeconds: number;
}

export function CompletedGameTimeline({
  players,
  playTimeRecords,
  goals,
  positions,
  gameEndSeconds,
  halfLengthSeconds,
}: CompletedGameTimelineProps) {
  const vm = useMemo(
    () =>
      buildTimelineViewModel({
        players,
        playTimeRecords,
        goals,
        positions,
        gameEndSeconds,
        halfLengthSeconds,
      }),
    [players, playTimeRecords, goals, positions, gameEndSeconds, halfLengthSeconds]
  );

  return (
    <section
      className="completed-game-timeline"
      aria-labelledby="cgt-heading"
    >
      <h3 id="cgt-heading" className="completed-game-timeline__heading">
        ⏱ Player Timeline
      </h3>

      {!vm.isRenderableDuration ? (
        <div className="empty-state">
          <p>{vm.emptyStateReason ?? "Timeline unavailable."}</p>
        </div>
      ) : (
        <div className="completed-game-timeline__scroll-area">
          <div className="completed-game-timeline__inner">

            {/* ── Header row: axis ticks + goal markers ── */}
            <div
              className="completed-game-timeline__row completed-game-timeline__row--header"
              aria-hidden="true"
            >
              <div className="completed-game-timeline__label-cell" />
              <div className="completed-game-timeline__track-area completed-game-timeline__track-area--header">
                {vm.axisTicks.map(tick => (
                  <span
                    key={tick.minuteLabel}
                    className="cgt-axis-tick"
                    style={{ left: `${tick.leftPct}%` }}
                    aria-hidden="true"
                  >
                    {tick.minuteLabel}
                  </span>
                ))}
                {vm.halftimeDividerPct !== null && (
                  <span
                    className="cgt-halftime-divider cgt-halftime-divider--header"
                    style={{ left: `${vm.halftimeDividerPct}%` }}
                    aria-hidden="true"
                  />
                )}
                {vm.goalMarkers.map(marker => (
                  <span
                    key={marker.key}
                    className={`cgt-goal-marker${marker.isForUs ? " cgt-goal-marker--for-us" : " cgt-goal-marker--opponent"}`}
                    style={{ left: `${marker.leftPct}%` }}
                  >
                    <span className="cgt-goal-marker__icon" aria-hidden="true">⚽</span>
                    <span className="cgt-goal-marker__label" aria-hidden="true">
                      {marker.minuteLabel}
                    </span>
                  </span>
                ))}
              </div>
            </div>

            {/* Accessible goal marker descriptions for screen readers */}
            {vm.goalMarkers.length > 0 && (
              <div className="sr-only">
                {vm.goalMarkers.map(marker => (
                  <span key={marker.key}>{marker.accessibleText}. </span>
                ))}
              </div>
            )}

            {/* ── Player lane rows ── */}
            {vm.laneRows.map(row => (
              <div
                key={row.playerId}
                className="completed-game-timeline__row"
              >
                <div className="completed-game-timeline__label-cell">
                  {row.playerLabel}
                </div>
                <div className="completed-game-timeline__track-area">
                  {vm.halftimeDividerPct !== null && (
                    <span
                      className="cgt-halftime-divider"
                      style={{ left: `${vm.halftimeDividerPct}%` }}
                      aria-hidden="true"
                    />
                  )}
                  {row.segments.map(seg => (
                    <span
                      key={seg.key}
                      className="cgt-segment"
                      style={{
                        left: `${seg.leftPct}%`,
                        width: `${seg.widthPct}%`,
                      }}
                      role="img"
                      aria-label={seg.accessibleText}
                      title={seg.accessibleText}
                    >
                      <span className="cgt-segment__label" aria-hidden="true">
                        {seg.positionLabel}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ))}

          </div>
        </div>
      )}
    </section>
  );
}
