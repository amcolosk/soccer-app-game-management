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

  it("surfaces preferred players first in dropdown options", () => {
    const multiPlayers = [
      { id: "player-1", firstName: "Alex", lastName: "Morgan", playerNumber: 10, preferredPositions: "pos-2" },
      { id: "player-2", firstName: "Sam", lastName: "Kerr", playerNumber: 8, preferredPositions: "pos-1" },
      { id: "player-3", firstName: "Mia", lastName: "Hamm", playerNumber: 9 },
    ] as PlayerWithRoster[];

    render(
      <PlannerLineupView
        displayLineup={new Map()}
        positions={[
          { id: "pos-1", abbreviation: "FW", positionName: "Forward" } as FormationPosition,
        ]}
        players={multiPlayers}
        isReadOnly={false}
      />
    );

    const select = screen.getByRole("combobox", { name: "Player for FW" });
    const options = Array.from(select.querySelectorAll("option")).map((option) => option.textContent);

    expect(options[1]).toBe("⭐ #8 Sam Kerr");
    expect(options).toContain("#10 Alex Morgan");
    expect(options).toContain("#9 Mia Hamm");
  });
});
