import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlannerLineupView } from "./PlannerLineupView";
import type { FormationPosition, Game, PlayerWithRoster, Team } from "./types";

vi.mock("./shape/LineupShapeView", () => ({
  LineupShapeView: () => <div data-testid="lineup-shape-view" />,
}));

describe("PlannerLineupView", () => {
  const positions = [
    { id: "pos-1", abbreviation: "FW", positionName: "Forward" } as FormationPosition,
  ];

  const players = [
    { id: "player-1", firstName: "Alex", lastName: "Morgan" } as PlayerWithRoster,
  ];

  const game = { id: "game-1", status: "scheduled" } as Game;
  const team = { id: "team-1", maxPlayersOnField: 7 } as Team;

  it("renders grouped list-shape toggle with selected state semantics", () => {
    const onViewModeChange = vi.fn();

    render(
      <PlannerLineupView
        displayLineup={new Map([["pos-1", "player-1"]])}
        positions={positions}
        players={players}
        isReadOnly={false}
        game={game}
        team={team}
        viewMode="list"
        onViewModeChange={onViewModeChange}
      />
    );

    const toggleGroup = screen.getByRole("group", { name: "Planner lineup view mode" });
    expect(toggleGroup).toBeInTheDocument();

    const listButton = screen.getByRole("button", { name: "List view" });
    const shapeButton = screen.getByRole("button", { name: "Shape view" });

    expect(listButton).toHaveAttribute("aria-pressed", "true");
    expect(shapeButton).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(shapeButton);
    expect(onViewModeChange).toHaveBeenCalledWith("shape");
  });

  it("renders explicit empty state when no positions exist", () => {
    render(
      <PlannerLineupView
        displayLineup={new Map()}
        positions={[]}
        players={players}
        isReadOnly={false}
        game={game}
        team={team}
        viewMode="list"
        onViewModeChange={vi.fn()}
      />
    );

    expect(screen.getByText("No positions defined for this formation yet.")).toBeInTheDocument();
  });
});
