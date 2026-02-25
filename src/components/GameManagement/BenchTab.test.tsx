import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BenchTab } from "./BenchTab";

const HALF_LENGTH = 1800; // 30 minutes

const makePlayer = (id: string, playerNumber: number, firstName: string) => ({
  id,
  playerNumber,
  firstName,
  lastName: "Test",
  isActive: true,
  preferredPositions: "",
});

// Creates a play-time record that puts `seconds` of play time on a player
const makeRecord = (playerId: string, seconds: number) => ({
  id: `rec-${playerId}`,
  playerId,
  positionId: "pos-1",
  startGameSeconds: 0,
  endGameSeconds: seconds,
  gameId: "game-1",
});

// Creates an active (no endGameSeconds) record — player is currently on field
const makeActiveRecord = (playerId: string) => ({
  id: `rec-active-${playerId}`,
  playerId,
  positionId: "pos-1",
  startGameSeconds: 0,
  endGameSeconds: null,
  gameId: "game-1",
});

const makeLineupAssignment = (playerId: string) => ({
  id: `la-${playerId}`,
  gameId: "game-1",
  playerId,
  positionId: "pos-1",
  isStarter: true,
});

const defaultProps = {
  players: [] as any[],
  lineup: [] as any[],
  playTimeRecords: [] as any[],
  currentTime: 900, // 15 minutes elapsed
  halfLengthSeconds: HALF_LENGTH,
  onSelectPlayer: vi.fn(),
};

describe("BenchTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Empty state ──────────────────────────────────────────────────────────
  it("shows empty bench message when all players are in the lineup", () => {
    const players = [makePlayer("p1", 7, "Alice")];
    const lineup = [makeLineupAssignment("p1")];
    render(<BenchTab {...defaultProps} players={players as any} lineup={lineup as any} />);
    expect(screen.getByText(/No players on the bench/i)).toBeInTheDocument();
  });

  it("does not show the bench section header when bench is empty", () => {
    const players = [makePlayer("p1", 7, "Alice")];
    const lineup = [makeLineupAssignment("p1")];
    render(<BenchTab {...defaultProps} players={players as any} lineup={lineup as any} />);
    expect(screen.queryByText(/Bench — tap to substitute/i)).not.toBeInTheDocument();
  });

  // ── Sorting ──────────────────────────────────────────────────────────────
  it("sorts bench players by play time ascending (least time first)", () => {
    const players = [
      makePlayer("p1", 10, "Alice"), // 600s
      makePlayer("p2", 7, "Bob"),    // 200s
      makePlayer("p3", 5, "Carol"),  // 900s
    ];
    const records = [
      makeRecord("p1", 600),
      makeRecord("p2", 200),
      makeRecord("p3", 900),
    ];
    render(
      <BenchTab
        {...defaultProps}
        players={players as any}
        playTimeRecords={records as any}
      />
    );
    const names = screen.getAllByText(/Alice|Bob|Carol/).map(el => el.textContent);
    const bobIndex = names.findIndex(n => n?.includes("Bob"));
    const aliceIndex = names.findIndex(n => n?.includes("Alice"));
    const carolIndex = names.findIndex(n => n?.includes("Carol"));
    expect(bobIndex).toBeLessThan(aliceIndex);
    expect(aliceIndex).toBeLessThan(carolIndex);
  });

  it("breaks ties in play time by jersey number ascending", () => {
    const players = [
      makePlayer("p1", 7, "Alice"),  // 300s
      makePlayer("p2", 5, "Bob"),    // 300s — lower jersey number → first
    ];
    const records = [
      makeRecord("p1", 300),
      makeRecord("p2", 300),
    ];
    render(
      <BenchTab
        {...defaultProps}
        players={players as any}
        playTimeRecords={records as any}
      />
    );
    const names = screen.getAllByText(/Alice|Bob/).map(el => el.textContent);
    const bobIndex = names.findIndex(n => n?.includes("Bob"));
    const aliceIndex = names.findIndex(n => n?.includes("Alice"));
    expect(bobIndex).toBeLessThan(aliceIndex);
  });

  // ── Urgency color classes ────────────────────────────────────────────────
  const getProgressFill = (container: HTMLElement) =>
    container.querySelector(".bench-tab__progress-fill");

  it("applies red class when play time is below 20% of halfLengthSeconds", () => {
    // 300s / 1800s = 16.7% — red
    const players = [makePlayer("p1", 7, "Alice")];
    const records = [makeRecord("p1", 300)];
    const { container } = render(
      <BenchTab {...defaultProps} players={players as any} playTimeRecords={records as any} />
    );
    expect(getProgressFill(container)).toHaveClass("bench-tab__progress-fill--red");
  });

  it("applies orange class when play time is between 20% and 60% of halfLengthSeconds", () => {
    // 720s / 1800s = 40% — orange
    const players = [makePlayer("p1", 7, "Alice")];
    const records = [makeRecord("p1", 720)];
    const { container } = render(
      <BenchTab {...defaultProps} players={players as any} playTimeRecords={records as any} />
    );
    expect(getProgressFill(container)).toHaveClass("bench-tab__progress-fill--orange");
  });

  it("applies green class when play time is at or above 60% of halfLengthSeconds", () => {
    // 1200s / 1800s = 66.7% — green
    const players = [makePlayer("p1", 7, "Alice")];
    const records = [makeRecord("p1", 1200)];
    const { container } = render(
      <BenchTab {...defaultProps} players={players as any} playTimeRecords={records as any} />
    );
    expect(getProgressFill(container)).toHaveClass("bench-tab__progress-fill--green");
  });

  it("applies orange class (not red) when play time equals exactly 20% of halfLengthSeconds", () => {
    // 360s / 1800s = exactly 20% — boundary: strict < 0.2 means this should be orange
    const players = [makePlayer("p1", 7, "Alice")];
    const records = [makeRecord("p1", 360)];
    const { container } = render(
      <BenchTab {...defaultProps} players={players as any} playTimeRecords={records as any} />
    );
    expect(getProgressFill(container)).toHaveClass("bench-tab__progress-fill--orange");
    expect(getProgressFill(container)).not.toHaveClass("bench-tab__progress-fill--red");
  });

  // ── Progress bar width cap ───────────────────────────────────────────────
  it("caps progress bar width at 100% when play time exceeds halfLengthSeconds", () => {
    // 2400s > 1800s halfLength — should not produce more than 100%
    const players = [makePlayer("p1", 7, "Alice")];
    const records = [makeRecord("p1", 2400)];
    const { container } = render(
      <BenchTab {...defaultProps} players={players as any} playTimeRecords={records as any} />
    );
    const fill = getProgressFill(container) as HTMLElement;
    expect(fill.style.width).toBe("100%");
  });

  // ── Zero halfLengthSeconds guard ─────────────────────────────────────────
  it("renders without crashing when halfLengthSeconds is 0", () => {
    const players = [makePlayer("p1", 7, "Alice")];
    const records = [makeRecord("p1", 300)];
    expect(() =>
      render(
        <BenchTab
          {...defaultProps}
          halfLengthSeconds={0}
          players={players as any}
          playTimeRecords={records as any}
        />
      )
    ).not.toThrow();
  });

  // ── Interactive vs non-interactive rows ──────────────────────────────────
  it("renders bench players as clickable button elements", () => {
    const players = [makePlayer("p1", 7, "Alice")];
    render(<BenchTab {...defaultProps} players={players as any} />);
    // All bench rows rendered as <button>
    expect(screen.getByRole("button", { name: /Alice/ })).toBeInTheDocument();
  });

  it("renders on-field players as non-interactive (not buttons)", () => {
    const players = [
      makePlayer("p1", 7, "Alice"),  // on bench (not in lineup)
      makePlayer("p2", 5, "Bob"),    // on field (in lineup + active record)
    ];
    // Bob is in the lineup, so he's excluded from benchPlayers
    const lineup = [makeLineupAssignment("p2")];
    const records = [makeActiveRecord("p2")];
    render(
      <BenchTab
        {...defaultProps}
        players={players as any}
        lineup={lineup as any}
        playTimeRecords={records as any}
        currentTime={300}
      />
    );
    // Alice is a bench button; Bob appears only in the on-field section (not a button)
    expect(screen.getByRole("button", { name: /Alice/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Bob/ })).not.toBeInTheDocument();
  });

  // ── onSelectPlayer callback ──────────────────────────────────────────────
  it("calls onSelectPlayer with the correct player id when a bench player is tapped", async () => {
    const user = userEvent.setup();
    const onSelectPlayer = vi.fn();
    const players = [makePlayer("p1", 7, "Alice")];
    render(
      <BenchTab
        {...defaultProps}
        players={players as any}
        onSelectPlayer={onSelectPlayer}
      />
    );
    await user.click(screen.getByRole("button", { name: /Alice/ }));
    expect(onSelectPlayer).toHaveBeenCalledWith("p1");
  });
});
