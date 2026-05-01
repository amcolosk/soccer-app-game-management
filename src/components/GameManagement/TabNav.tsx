import { useRef, type KeyboardEvent } from "react";

export type GameTab = "plan" | "field" | "bench" | "goals" | "notes";

interface TabNavProps {
  activeTab: GameTab;
  onTabChange: (tab: GameTab) => void;
  substitutionQueueCount: number;
  tabPanelIdPrefix?: string;
}

const TABS: { id: GameTab; label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "field", label: "Field" },
  { id: "bench", label: "Bench" },
  { id: "goals", label: "Goals" },
  { id: "notes", label: "Notes" },
];

export function TabNav({
  activeTab,
  onTabChange,
  substitutionQueueCount,
  tabPanelIdPrefix = "game-tab-panel",
}: TabNavProps) {
  const tabRefs = useRef<Record<GameTab, HTMLButtonElement | null>>({
    plan: null,
    field: null,
    bench: null,
    goals: null,
    notes: null,
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tabId: GameTab) => {
    const currentIndex = TABS.findIndex((tab) => tab.id === tabId);
    if (currentIndex === -1) return;

    let nextIndex = currentIndex;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = (currentIndex + 1) % TABS.length;
        break;
      case "ArrowLeft":
        nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = TABS.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const nextTab = TABS[nextIndex];
    onTabChange(nextTab.id);
    tabRefs.current[nextTab.id]?.focus();
  };

  return (
    <div className="game-tab-nav" role="tablist" aria-label="Game management tabs">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          ref={(element) => {
            tabRefs.current[tab.id] = element;
          }}
          role="tab"
          id={`${tabPanelIdPrefix}-tab-${tab.id}`}
          aria-controls={`${tabPanelIdPrefix}-${tab.id}`}
          aria-selected={activeTab === tab.id}
          tabIndex={activeTab === tab.id ? 0 : -1}
          className={`game-tab-nav__tab${activeTab === tab.id ? " active" : ""}`}
          onClick={() => onTabChange(tab.id)}
          onKeyDown={(event) => handleKeyDown(event, tab.id)}
        >
          {tab.label}
          {tab.id === "field" && substitutionQueueCount > 0 && (
            <span className="game-tab-nav__badge">{substitutionQueueCount}</span>
          )}
        </button>
      ))}
    </div>
  );
}
