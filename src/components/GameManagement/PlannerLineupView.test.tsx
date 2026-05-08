import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlannerLineupView } from "./PlannerLineupView";
import { AvailabilityProvider } from "../../contexts/AvailabilityContext";
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

  const renderPlanner = (
    ui: React.ReactElement,
    availabilities: Array<{ playerId: string; status: string }> = [],
  ) => {
    return render(
      <AvailabilityProvider availabilities={availabilities}>{ui}</AvailabilityProvider>,
    );
  };

  it("renders grouped list-shape toggle with selected state semantics", () => {
    const onViewModeChange = vi.fn();

    renderPlanner(
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
    renderPlanner(
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

    renderPlanner(
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

  it("renders assigned players as cards with number and name", () => {
    renderPlanner(
      <PlannerLineupView
        displayLineup={new Map([["pos-1", "player-1"]])}
        positions={positions}
        players={[
          {
            id: "player-1",
            firstName: "Alex",
            lastName: "Morgan",
            playerNumber: 13,
          } as PlayerWithRoster,
        ]}
        isReadOnly={false}
      />,
    );

    const slot = screen.getByText("FW").closest(".position-slot");
    expect(slot).not.toBeNull();
    expect(within(slot as HTMLElement).getByText("#13")).toBeInTheDocument();
    expect(within(slot as HTMLElement).getByText("Alex Morgan")).toBeInTheDocument();
  });

  it("renders unassigned players in the bench area as chips", () => {
    renderPlanner(
      <PlannerLineupView
        displayLineup={new Map([["pos-1", "player-1"]])}
        positions={positions}
        players={[
          { id: "player-1", firstName: "Alex", lastName: "Morgan", playerNumber: 10 } as PlayerWithRoster,
          { id: "player-2", firstName: "Sam", lastName: "Kerr", playerNumber: 8, preferredPositions: "pos-1" } as PlayerWithRoster,
        ]}
        isReadOnly={false}
      />,
    );

    const bench = screen.getByRole("heading", { name: "Bench" }).closest(".bench-area");
    expect(bench).not.toBeNull();
    expect(within(bench as HTMLElement).getByText("#8")).toBeInTheDocument();
    expect(within(bench as HTMLElement).getByText(/Sam Kerr/)).toBeInTheDocument();
    expect(within(bench as HTMLElement).getByText("(FW)")).toBeInTheDocument();
  });

  it("clears an assigned slot when remove is clicked", () => {
    const onPositionAssign = vi.fn();

    renderPlanner(
      <PlannerLineupView
        displayLineup={new Map([["pos-1", "player-1"]])}
        positions={positions}
        players={[
          { id: "player-1", firstName: "Alex", lastName: "Morgan", playerNumber: 10 } as PlayerWithRoster,
        ]}
        onPositionAssign={onPositionAssign}
        isReadOnly={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove Alex Morgan from FW" }));

    expect(onPositionAssign).toHaveBeenCalledWith("pos-1", "");
  });

  it("assigns a bench player when dropped onto an empty slot", () => {
    const onPositionAssign = vi.fn();

    renderPlanner(
      <PlannerLineupView
        displayLineup={new Map()}
        positions={positions}
        players={[
          { id: "player-1", firstName: "Alex", lastName: "Morgan", playerNumber: 10 } as PlayerWithRoster,
        ]}
        onPositionAssign={onPositionAssign}
        isReadOnly={false}
      />,
    );

    const bench = screen.getByRole("heading", { name: "Bench" }).closest(".bench-area");
    const benchChip = within(bench as HTMLElement).getByText(/Alex Morgan/).closest(".bench-player");
    const slot = screen.getByText("FW").closest(".position-slot");

    fireEvent.dragStart(benchChip as HTMLElement);
    fireEvent.dragOver(slot as HTMLElement);
    fireEvent.drop(slot as HTMLElement);

    expect(onPositionAssign).toHaveBeenCalledWith("pos-1", "player-1");
  });

  it("swaps assigned players when one occupied slot is dropped onto another occupied slot", () => {
    const onPositionAssign = vi.fn();

    renderPlanner(
      <PlannerLineupView
        displayLineup={new Map([
          ["pos-1", "player-1"],
          ["pos-2", "player-2"],
        ])}
        positions={[
          { id: "pos-1", abbreviation: "FW", positionName: "Forward" } as FormationPosition,
          { id: "pos-2", abbreviation: "MID", positionName: "Midfielder" } as FormationPosition,
        ]}
        players={[
          { id: "player-1", firstName: "Alex", lastName: "Morgan", playerNumber: 10 } as PlayerWithRoster,
          { id: "player-2", firstName: "Sam", lastName: "Kerr", playerNumber: 8 } as PlayerWithRoster,
        ]}
        onPositionAssign={onPositionAssign}
        isReadOnly={false}
      />,
    );

    const sourceCard = screen.getByText("Alex Morgan").closest(".assigned-player");
    const targetSlot = screen.getByText("MID").closest(".position-slot");

    fireEvent.dragStart(sourceCard as HTMLElement);
    fireEvent.dragOver(targetSlot as HTMLElement);
    fireEvent.drop(targetSlot as HTMLElement);

    expect(onPositionAssign).toHaveBeenNthCalledWith(1, "pos-2", "player-1");
    expect(onPositionAssign).toHaveBeenNthCalledWith(2, "pos-1", "player-2");
  });

  it("shows the all-assigned bench empty state", () => {
    renderPlanner(
      <PlannerLineupView
        displayLineup={new Map([["pos-1", "player-1"]])}
        positions={positions}
        players={players}
        isReadOnly={false}
      />,
    );

    expect(screen.getByText("All available players assigned.")).toBeInTheDocument();
  });

  it("renders static empty slots in read-only mode without selects or remove buttons", () => {
    renderPlanner(
      <PlannerLineupView
        displayLineup={new Map()}
        positions={positions}
        players={players}
        isReadOnly={true}
      />,
    );

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove / })).not.toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });
});

describe("GK position dropdown filtering (Rule 1.5)", () => {
  const gkPosition = {
    id: "pos-gk", abbreviation: "GK", positionName: "Goalkeeper",
  } as FormationPosition;

  const players = [
    { id: "p-gk", firstName: "Keeper", lastName: "One", preferredPositions: "pos-gk" } as PlayerWithRoster,
    { id: "p-field", firstName: "Field", lastName: "Two", preferredPositions: "pos-def" } as PlayerWithRoster,
  ];

  const renderPlanner = (ui: React.ReactElement) => {
    return render(<AvailabilityProvider availabilities={[]}>{ui}</AvailabilityProvider>);
  };

  it("only shows GK-preferred players in the GK position dropdown", () => {
    renderPlanner(
      <PlannerLineupView
        displayLineup={new Map()}
        positions={[gkPosition]}
        players={players}
        isReadOnly={false}
      />
    );
    const select = screen.getByRole("combobox", { name: "Player for GK" });
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(options).toContain("p-gk");
    expect(options).not.toContain("p-field");
  });

  it("still shows the currently-assigned non-preferred player at GK in the assigned card", () => {
    renderPlanner(
      <PlannerLineupView
        displayLineup={new Map([["pos-gk", "p-field"]])}
        positions={[gkPosition]}
        players={players}
        isReadOnly={false}
      />
    );
    const slot = screen.getByText("GK").closest(".position-slot");
    expect(slot).not.toBeNull();
    expect(within(slot as HTMLElement).getByText("Field Two")).toBeInTheDocument();
  });

  it("non-GK position dropdown is unaffected and shows all players", () => {
    const defPosition = { id: "pos-def", abbreviation: "DEF", positionName: "Defender" } as FormationPosition;
    renderPlanner(
      <PlannerLineupView
        displayLineup={new Map()}
        positions={[defPosition]}
        players={players}
        isReadOnly={false}
      />
    );
    const select = screen.getByRole("combobox", { name: "Player for DEF" });
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(options).toContain("p-gk");
    expect(options).toContain("p-field");
  });

  it("rejects dropping a non-GK bench player onto a GK slot", () => {
    const onPositionAssign = vi.fn();

    renderPlanner(
      <PlannerLineupView
        displayLineup={new Map()}
        positions={[gkPosition]}
        players={players}
        onPositionAssign={onPositionAssign}
        isReadOnly={false}
      />
    );

    const benchChip = screen.getByText(/Field Two/).closest(".bench-player");
    const slot = screen.getByText("GK").closest(".position-slot");

    fireEvent.dragStart(benchChip as HTMLElement);
    fireEvent.dragOver(slot as HTMLElement);
    fireEvent.drop(slot as HTMLElement);

    expect(onPositionAssign).not.toHaveBeenCalled();
  });

  it("rejects a swap when the target player is not eligible for a GK source slot", () => {
    const onPositionAssign = vi.fn();

    renderPlanner(
      <PlannerLineupView
        displayLineup={new Map([
          ["pos-gk", "p-gk"],
          ["pos-def", "p-field"],
        ])}
        positions={[
          gkPosition,
          { id: "pos-def", abbreviation: "DEF", positionName: "Defender" } as FormationPosition,
        ]}
        players={players}
        onPositionAssign={onPositionAssign}
        isReadOnly={false}
      />
    );

    const gkCard = screen.getByText("Keeper One").closest(".assigned-player");
    const defSlot = screen.getByText("DEF").closest(".position-slot");

    fireEvent.dragStart(gkCard as HTMLElement);
    fireEvent.dragOver(defSlot as HTMLElement);
    fireEvent.drop(defSlot as HTMLElement);

    expect(onPositionAssign).not.toHaveBeenCalled();
  });
});
