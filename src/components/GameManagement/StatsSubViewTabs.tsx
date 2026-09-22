import { useCallback, useRef } from "react";

export type StatSubView = "goals" | "shots" | "saves";

const SUB_VIEWS: Array<{ key: StatSubView; label: string }> = [
  { key: "goals", label: "Goals" },
  { key: "shots", label: "Shots" },
  { key: "saves", label: "Saves" },
];

interface StatsSubViewTabsProps {
  activeSubView: StatSubView;
  onChange: (view: StatSubView) => void;
  /** Unique id prefix so aria-controls/id pairs don't collide when this
   *  control is (conditionally) mounted at more than one layout site. */
  idPrefix: string;
}

/**
 * Segmented control for switching between the Goals/Shots/Saves sub-views
 * inside the Goals tab (and, in the completed layout, as a standalone
 * section header). Reuses the tablist/pill interaction and aria-selected/
 * arrow-key semantics UI-SPEC §7.7 already specifies for the Game Planner
 * timeline (`PlanTab.tsx`'s `planner-timeline-pill` tablist) rather than
 * inventing a new pattern. Carries its own `aria-label` distinct from the
 * outer `TabNav`'s `aria-label="Game management tabs"` so a screen-reader
 * user landmark-navigating the page doesn't see two identically-labeled
 * tablists.
 */
export function StatsSubViewTabs({ activeSubView, onChange, idPrefix }: StatsSubViewTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = SUB_VIEWS.map((view) => view.key);
    const currentIndex = keys.indexOf(activeSubView);
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
          `[data-subview-key="${nextKey}"]`
        ) as HTMLButtonElement | null;
        btn?.focus({ preventScroll: true });
      }, 0);
    }
  }, [activeSubView, onChange]);

  return (
    <div
      ref={containerRef}
      className="stats-subview-tabs"
      role="tablist"
      aria-label="Goals sub-view"
      onKeyDown={handleKeyDown}
    >
      {SUB_VIEWS.map((view) => {
        const isActive = activeSubView === view.key;
        return (
          <button
            key={view.key}
            type="button"
            data-subview-key={view.key}
            role="tab"
            id={`${idPrefix}-subview-tab-${view.key}`}
            aria-selected={isActive}
            aria-controls={`${idPrefix}-subview-panel-${view.key}`}
            tabIndex={isActive ? 0 : -1}
            className={`stats-subview-tab${isActive ? " stats-subview-tab--active" : ""}`}
            onClick={() => onChange(view.key)}
          >
            {view.label}
          </button>
        );
      })}
    </div>
  );
}
