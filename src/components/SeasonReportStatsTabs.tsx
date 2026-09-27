import { useCallback, useRef } from "react";

export type SeasonReportStatsView = "field" | "goalkeeper";

interface SeasonReportStatsTabsProps {
  activeView: SeasonReportStatsView;
  onChange: (view: SeasonReportStatsView) => void;
}

const VIEWS: Array<{ key: SeasonReportStatsView; label: string }> = [
  { key: "field", label: "Field" },
  { key: "goalkeeper", label: "Goalkeeper" },
];

/**
 * Segmented control for switching the Player Statistics table between the
 * "Field" (attacking) and "Goalkeeper" stat views on Season Report. Mirrors
 * GameManagement/StatsSubViewTabs.tsx's exact role/aria/roving-tabIndex/
 * arrow-key interaction pattern, but kept as its own component/file (per
 * this codebase's "one tablist component per distinct tablist instance"
 * precedent) since it's a different context with different tab keys/labels.
 */
export function SeasonReportStatsTabs({ activeView, onChange }: SeasonReportStatsTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = VIEWS.map((view) => view.key);
    const currentIndex = keys.indexOf(activeView);
    let nextIndex = currentIndex;

    if (e.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % keys.length;
      e.preventDefault();
    } else if (e.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + keys.length) % keys.length;
      e.preventDefault();
    } else if (e.key === "Home") {
      nextIndex = 0;
      e.preventDefault();
    } else if (e.key === "End") {
      nextIndex = keys.length - 1;
      e.preventDefault();
    } else {
      return;
    }

    if (nextIndex !== currentIndex) {
      const nextKey = keys[nextIndex];
      onChange(nextKey);
      setTimeout(() => {
        const btn = containerRef.current?.querySelector(
          `[data-stats-view-key="${nextKey}"]`
        ) as HTMLButtonElement | null;
        btn?.focus({ preventScroll: true });
      }, 0);
    }
  }, [activeView, onChange]);

  return (
    <div
      ref={containerRef}
      className="season-report-stats-tabs"
      role="tablist"
      aria-label="Player statistics view"
      onKeyDown={handleKeyDown}
    >
      {VIEWS.map((view) => {
        const isActive = activeView === view.key;
        return (
          <button
            key={view.key}
            type="button"
            data-stats-view-key={view.key}
            role="tab"
            id={`season-report-stats-tab-${view.key}`}
            aria-selected={isActive}
            aria-controls={`season-report-stats-panel-${view.key}`}
            tabIndex={isActive ? 0 : -1}
            className={`season-report-stats-tab${isActive ? " season-report-stats-tab--active" : ""}`}
            onClick={() => onChange(view.key)}
          >
            {view.label}
          </button>
        );
      })}
    </div>
  );
}
