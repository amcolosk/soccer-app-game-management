import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CompletedPlayTimeSummary } from "./CompletedPlayTimeSummary";
import type { PlayerWithRoster, PlayTimeRecord } from "./types";

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------
const makePlayer = (
  id: string,
  playerNumber: number | null | undefined,
  firstName: string,
  lastName: string
): PlayerWithRoster => ({
  id,
  playerNumber: playerNumber ?? undefined,
  firstName,
  lastName,
  isActive: true,
  preferredPositions: "",
} as PlayerWithRoster);

const makeRecord = (
  id: string,
  playerId: string,
  startGameSeconds: number,
  endGameSeconds: number | null | undefined
): PlayTimeRecord => ({
  id,
  gameId: "game-1",
  playerId,
  positionId: "pos-1",
  startGameSeconds,
  endGameSeconds: endGameSeconds ?? null,
  coaches: [],
} as unknown as PlayTimeRecord);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("CompletedPlayTimeSummary", () => {
  it("renders the '⏱ Play Time' heading", () => {
    render(
      <CompletedPlayTimeSummary
        players={[makePlayer("p1", 10, "Alice", "Smith")]}
        playTimeRecords={[]}
        gameEndSeconds={1800}
      />
    );
    expect(
      screen.getByRole("heading", { name: /⏱ Play Time/i })
    ).toBeInTheDocument();
  });

  it("renders a row for each player", () => {
    const players = [
      makePlayer("p1", 5, "Alice", "Smith"),
      makePlayer("p2", 7, "Bob", "Jones"),
      makePlayer("p3", 9, "Charlie", "Brown"),
    ];
    render(
      <CompletedPlayTimeSummary
        players={players}
        playTimeRecords={[]}
        gameEndSeconds={1800}
      />
    );
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
    expect(screen.getByText("Charlie Brown")).toBeInTheDocument();
  });

  it("shows formatted play time for players with recorded time", () => {
    const players = [makePlayer("p1", 10, "Alice", "Smith")];
    const records = [makeRecord("r1", "p1", 0, 1800)]; // 30 minutes
    render(
      <CompletedPlayTimeSummary
        players={players}
        playTimeRecords={records}
        gameEndSeconds={1800}
      />
    );
    // 1800 seconds = 30 minutes → "30m" in 'long' format
    expect(screen.getByText("30m")).toBeInTheDocument();
  });

  it("shows em-dash for players with 0 seconds played", () => {
    const players = [makePlayer("p1", 10, "Alice", "Smith")];
    render(
      <CompletedPlayTimeSummary
        players={players}
        playTimeRecords={[]}
        gameEndSeconds={1800}
      />
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("applies --no-time CSS class to rows with 0 seconds", () => {
    const players = [
      makePlayer("p1", 10, "Alice", "Smith"),
      makePlayer("p2", 11, "Bob", "Jones"),
    ];
    const records = [makeRecord("r1", "p1", 0, 600)]; // Alice has time, Bob has none
    render(
      <CompletedPlayTimeSummary
        players={players}
        playTimeRecords={records}
        gameEndSeconds={1800}
      />
    );
    // Bob's row should have the no-time class
    const rows = screen.getAllByRole("row");
    // rows[0] is the header row, rows[1] is Alice (with time), rows[2] is Bob (no time)
    const aliceRow = rows[1];
    const bobRow = rows[2];
    expect(aliceRow).not.toHaveClass("completed-playtime-summary__row--no-time");
    expect(bobRow).toHaveClass("completed-playtime-summary__row--no-time");
  });

  it("sorts players by jersey number ascending", () => {
    const players = [
      makePlayer("p3", 15, "Charlie", "Brown"),
      makePlayer("p1", 3, "Alice", "Smith"),
      makePlayer("p2", 9, "Bob", "Jones"),
    ];
    render(
      <CompletedPlayTimeSummary
        players={players}
        playTimeRecords={[]}
        gameEndSeconds={1800}
      />
    );
    const rows = screen.getAllByRole("row");
    // rows[0] is header; rows[1..3] are data rows in sorted order
    expect(rows[1]).toHaveTextContent("Alice Smith");
    expect(rows[2]).toHaveTextContent("Bob Jones");
    expect(rows[3]).toHaveTextContent("Charlie Brown");
  });

  it("normalizes null endGameSeconds using gameEndSeconds", () => {
    const players = [makePlayer("p1", 10, "Alice", "Smith")];
    // Record is unclosed (endGameSeconds is null); should use gameEndSeconds=1200
    const records = [makeRecord("r1", "p1", 0, null)];
    render(
      <CompletedPlayTimeSummary
        players={players}
        playTimeRecords={records}
        gameEndSeconds={1200}
      />
    );
    // 1200 seconds = 20 minutes → "20m" in 'long' format
    expect(screen.getByText("20m")).toBeInTheDocument();
  });

  it("shows empty-state message when players array is empty", () => {
    render(
      <CompletedPlayTimeSummary
        players={[]}
        playTimeRecords={[]}
        gameEndSeconds={1800}
      />
    );
    expect(screen.getByText("No players on roster.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("sorts players with null jersey numbers last (using 999 fallback)", () => {
    const players = [
      makePlayer("p2", undefined, "Null", "Number"),
      makePlayer("p1", 5, "Alice", "Smith"),
    ];
    render(
      <CompletedPlayTimeSummary
        players={players}
        playTimeRecords={[]}
        gameEndSeconds={1800}
      />
    );
    const rows = screen.getAllByRole("row");
    // Alice (#5) should be first, Null Number (undefined) should be last
    expect(rows[1]).toHaveTextContent("Alice Smith");
    expect(rows[2]).toHaveTextContent("Null Number");
  });
});
