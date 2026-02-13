import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LineupBuilder } from "./LineupBuilder";

const positions = [
  { id: "pos1", positionName: "Goalkeeper", abbreviation: "GK" },
  { id: "pos2", positionName: "Defender", abbreviation: "DEF" },
  { id: "pos3", positionName: "Forward", abbreviation: "FW" },
];

const players = [
  { id: "p1", firstName: "Alice", lastName: "Smith", playerNumber: 10, preferredPositions: "pos1" },
  { id: "p2", firstName: "Bob", lastName: "Jones", playerNumber: 3, preferredPositions: "pos2,pos3" },
  { id: "p3", firstName: "Charlie", lastName: "Brown", playerNumber: 7, preferredPositions: "" },
  { id: "p4", firstName: "Diana", lastName: "Lee", playerNumber: 1, preferredPositions: "pos1" },
];

const emptyLineup = new Map<string, string>();

function lineupWith(entries: [string, string][]) {
  return new Map(entries);
}

describe("LineupBuilder", () => {
  // ---------- Rendering ----------

  describe("rendering", () => {
    it("renders position labels for each position", () => {
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={emptyLineup}
          onLineupChange={() => {}}
        />
      );
      expect(screen.getByText("GK")).toBeInTheDocument();
      expect(screen.getByText("DEF")).toBeInTheDocument();
      expect(screen.getByText("FW")).toBeInTheDocument();
    });

    it("shows select dropdown for unassigned positions", () => {
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={emptyLineup}
          onLineupChange={() => {}}
        />
      );
      const selects = screen.getAllByRole("combobox");
      expect(selects).toHaveLength(3);
    });

    it("shows assigned player name in position slot", () => {
      const lineup = lineupWith([["pos1", "p1"]]);
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={lineup}
          onLineupChange={() => {}}
        />
      );
      expect(screen.getByText("A. Smith")).toBeInTheDocument();
      // Position with assigned player should not have a select
      expect(screen.getAllByRole("combobox")).toHaveLength(2);
    });

    it("shows remove button when not disabled", () => {
      const lineup = lineupWith([["pos1", "p1"]]);
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={lineup}
          onLineupChange={() => {}}
        />
      );
      expect(screen.getByText("✕")).toBeInTheDocument();
    });
  });

  // ---------- Select dropdown ----------

  describe("select dropdown", () => {
    it("excludes already-assigned players from options", () => {
      const lineup = lineupWith([["pos1", "p1"]]);
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={lineup}
          onLineupChange={() => {}}
        />
      );
      // pos2 select should NOT include Alice (p1) since she's assigned
      const selects = screen.getAllByRole("combobox");
      const pos2Options = selects[0].querySelectorAll("option");
      const optionTexts = Array.from(pos2Options).map((o) => o.textContent);
      expect(optionTexts.some((t) => t?.includes("Alice"))).toBe(false);
    });

    it("sorts preferred players first then by playerNumber", () => {
      // For pos1: p1 (preferred, #10) and p4 (preferred, #1) should come before p2 (#3) and p3 (#7)
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={emptyLineup}
          onLineupChange={() => {}}
        />
      );
      // Find the GK position select (first one)
      const selects = screen.getAllByRole("combobox");
      const gkOptions = Array.from(selects[0].querySelectorAll("option")).slice(1); // skip placeholder
      // Preferred for pos1: p4 (#1), p1 (#10) — then non-preferred: p2 (#3), p3 (#7)
      expect(gkOptions[0]).toHaveTextContent("#1");   // Diana (preferred, lowest number)
      expect(gkOptions[1]).toHaveTextContent("#10");  // Alice (preferred)
      expect(gkOptions[2]).toHaveTextContent("#3");   // Bob (non-preferred)
      expect(gkOptions[3]).toHaveTextContent("#7");   // Charlie (non-preferred)
    });

    it("shows star prefix for preferred position matches", () => {
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={emptyLineup}
          onLineupChange={() => {}}
        />
      );
      const selects = screen.getAllByRole("combobox");
      // GK (pos1) dropdown - p1 and p4 have pos1 as preferred
      const gkOptions = Array.from(selects[0].querySelectorAll("option")).slice(1);
      expect(gkOptions[0].textContent).toMatch(/^⭐/); // Diana preferred for GK
      expect(gkOptions[1].textContent).toMatch(/^⭐/); // Alice preferred for GK
      expect(gkOptions[2].textContent).not.toMatch(/^⭐/); // Bob not preferred for GK
    });

    it("shows preferred position abbreviations in parentheses", () => {
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={emptyLineup}
          onLineupChange={() => {}}
        />
      );
      const selects = screen.getAllByRole("combobox");
      // DEF (pos2) dropdown - Bob has preferred pos2,pos3
      const defOptions = Array.from(selects[1].querySelectorAll("option")).slice(1);
      // Bob (preferred for DEF) should show his preferred positions
      const bobOption = defOptions.find((o) => o.textContent?.includes("Bob"));
      expect(bobOption?.textContent).toContain("(DEF, FW)");
    });

    it("calls onLineupChange on player selection", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={emptyLineup}
          onLineupChange={onChange}
        />
      );
      const selects = screen.getAllByRole("combobox");
      await user.selectOptions(selects[0], "p1");
      expect(onChange).toHaveBeenCalledWith("pos1", "p1");
    });
  });

  // ---------- Remove / bench ----------

  describe("remove and bench", () => {
    it("calls onLineupChange with empty string on remove click", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const lineup = lineupWith([["pos1", "p1"]]);
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={lineup}
          onLineupChange={onChange}
        />
      );
      await user.click(screen.getByText("✕"));
      expect(onChange).toHaveBeenCalledWith("pos1", "");
    });

    it("hides remove button when disabled", () => {
      const lineup = lineupWith([["pos1", "p1"]]);
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={lineup}
          onLineupChange={() => {}}
          disabled
        />
      );
      expect(screen.queryByText("✕")).not.toBeInTheDocument();
    });

    it("renders unassigned players in bench area", () => {
      const lineup = lineupWith([["pos1", "p1"]]);
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={lineup}
          onLineupChange={() => {}}
        />
      );
      const bench = document.querySelector(".bench-players")!;
      // p2, p3, p4 should be on bench
      expect(bench.textContent).toContain("Bob Jones");
      expect(bench.textContent).toContain("Charlie Brown");
      expect(bench.textContent).toContain("Diana Lee");
      // p1 should NOT be on bench
      expect(bench.textContent).not.toContain("Alice Smith");
    });

    it("does not show assigned players in bench", () => {
      const lineup = lineupWith([["pos1", "p1"], ["pos2", "p2"]]);
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={lineup}
          onLineupChange={() => {}}
        />
      );
      const bench = document.querySelector(".bench-players")!;
      expect(bench.textContent).not.toContain("Alice");
      expect(bench.textContent).not.toContain("Bob");
    });
  });

  // ---------- Disabled state ----------

  describe("disabled state", () => {
    it("disables all select dropdowns", () => {
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={emptyLineup}
          onLineupChange={() => {}}
          disabled
        />
      );
      screen.getAllByRole("combobox").forEach((s) => {
        expect(s).toBeDisabled();
      });
    });

    it("sets draggable=false on bench players when disabled", () => {
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={emptyLineup}
          onLineupChange={() => {}}
          disabled
        />
      );
      const benchPlayers = document.querySelectorAll(".bench-player");
      benchPlayers.forEach((el) => {
        expect(el).not.toHaveAttribute("draggable", "true");
      });
    });
  });

  // ---------- Availability indicators ----------

  describe("availability indicators", () => {
    it("shows warning for absent assigned players", () => {
      const lineup = lineupWith([["pos1", "p1"]]);
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={lineup}
          onLineupChange={() => {}}
          getPlayerAvailability={() => "absent"}
        />
      );
      expect(screen.getByText(/Absent/)).toBeInTheDocument();
      expect(document.querySelector(".lineup-availability-warning")).toBeInTheDocument();
    });

    it("shows warning for injured assigned players", () => {
      const lineup = lineupWith([["pos1", "p1"]]);
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={lineup}
          onLineupChange={() => {}}
          getPlayerAvailability={() => "injured"}
        />
      );
      expect(screen.getByText(/Injured/)).toBeInTheDocument();
      expect(document.querySelector(".lineup-availability-warning")).toBeInTheDocument();
    });

    it("does not show warning for available assigned players", () => {
      const lineup = lineupWith([["pos1", "p1"]]);
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={lineup}
          onLineupChange={() => {}}
          getPlayerAvailability={() => "available"}
        />
      );
      expect(document.querySelector(".lineup-availability-warning")).not.toBeInTheDocument();
    });

    it("does not show warning for late-arrival assigned players", () => {
      const lineup = lineupWith([["pos1", "p1"]]);
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={lineup}
          onLineupChange={() => {}}
          getPlayerAvailability={() => "late-arrival"}
        />
      );
      expect(document.querySelector(".lineup-availability-warning")).not.toBeInTheDocument();
    });

    it("applies unavailable class and status icon on bench for absent players", () => {
      const lineup = lineupWith([["pos1", "p1"]]);
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={lineup}
          onLineupChange={() => {}}
          getPlayerAvailability={() => "absent"}
        />
      );
      const benchPlayers = document.querySelectorAll(".bench-player");
      benchPlayers.forEach((el) => {
        expect(el).toHaveClass("unavailable");
      });
      // Status icons should be present in bench
      expect(document.querySelectorAll(".bench-status").length).toBeGreaterThan(0);
    });

    it("does not show availability indicators when getPlayerAvailability is omitted", () => {
      const lineup = lineupWith([["pos1", "p1"]]);
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={lineup}
          onLineupChange={() => {}}
        />
      );
      expect(document.querySelector(".lineup-availability-warning")).not.toBeInTheDocument();
      expect(document.querySelector(".bench-status")).not.toBeInTheDocument();
    });
  });

  // ---------- Drag and drop ----------

  describe("drag and drop", () => {
    it("drag from bench to position calls onLineupChange", () => {
      const onChange = vi.fn();
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={emptyLineup}
          onLineupChange={onChange}
        />
      );

      const benchPlayer = document.querySelector(".bench-player")!;
      const positionSlot = document.querySelector(".position-slot")!;

      fireEvent.dragStart(benchPlayer);
      fireEvent.dragOver(positionSlot);
      fireEvent.drop(positionSlot);

      expect(onChange).toHaveBeenCalledWith("pos1", expect.any(String));
    });

    it("drag from position to bench calls onLineupChange to remove", () => {
      const onChange = vi.fn();
      const lineup = lineupWith([["pos1", "p1"]]);
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={lineup}
          onLineupChange={onChange}
        />
      );

      const assignedPlayer = document.querySelector(".assigned-player")!;
      const benchArea = document.querySelector(".bench-area")!;

      fireEvent.dragStart(assignedPlayer);
      fireEvent.dragOver(benchArea);
      fireEvent.drop(benchArea);

      expect(onChange).toHaveBeenCalledWith("pos1", "");
    });

    it("does not trigger drag actions when disabled", () => {
      const onChange = vi.fn();
      render(
        <LineupBuilder
          positions={positions}
          availablePlayers={players}
          lineup={emptyLineup}
          onLineupChange={onChange}
          disabled
        />
      );

      const benchPlayer = document.querySelector(".bench-player")!;
      const positionSlot = document.querySelector(".position-slot")!;

      fireEvent.dragStart(benchPlayer);
      fireEvent.dragOver(positionSlot);
      fireEvent.drop(positionSlot);

      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
