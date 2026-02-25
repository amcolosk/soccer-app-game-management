export type GameTab = "field" | "bench" | "goals" | "notes";

interface TabNavProps {
  activeTab: GameTab;
  onTabChange: (tab: GameTab) => void;
  substitutionQueueCount: number;
}

const TABS: { id: GameTab; label: string }[] = [
  { id: "field", label: "Field" },
  { id: "bench", label: "Bench" },
  { id: "goals", label: "Goals" },
  { id: "notes", label: "Notes" },
];

export function TabNav({
  activeTab,
  onTabChange,
  substitutionQueueCount,
}: TabNavProps) {
  return (
    <div className="game-tab-nav" role="tablist">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          className={`game-tab-nav__tab${activeTab === tab.id ? " active" : ""}`}
          onClick={() => onTabChange(tab.id)}
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
