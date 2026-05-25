import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CompletedGameTimeline } from "./CompletedGameTimeline";
import type { PlayerWithRoster, PlayTimeRecord, Goal, FormationPosition } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makePlayer = (
  id: string,
  playerNumber: number | null | undefined,
  firstName = "Alice",
  lastName = "Smith"
): PlayerWithRoster =>
  ({
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
  endGameSeconds: number | null,
  positionId = "pos-1"
): PlayTimeRecord =>
  ({
    id,
    gameId: "game-1",
    playerId,
    positionId,
    startGameSeconds,
    endGameSeconds,
    coaches: [],
  } as unknown as PlayTimeRecord);

const makeGoal = (
  id: string,
  scoredByUs: boolean,
  gameSeconds: number
): Goal =>
  ({
    id,
    gameId: "game-1",
    scoredByUs,
    gameSeconds,
    timestamp: new Date().toISOString(),
    coaches: [],
  } as unknown as Goal);

const makePosition = (id: string, positionName: string): FormationPosition =>
  ({ id, positionName } as unknown as FormationPosition);

const BASE_PROPS = {
  players: [makePlayer("p1", 5)],
  playTimeRecords: [] as PlayTimeRecord[],
  goals: [] as Goal[],
  positions: [makePosition("pos-1", "Forward")],
  gameEndSeconds: 3600,
  halfLengthSeconds: 1800,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CompletedGameTimeline", () => {
  it("renders the Player Timeline heading", () => {
    render(<CompletedGameTimeline {...BASE_PROPS} />);
    expect(
      screen.getByRole("heading", { name: /Player Timeline/i })
    ).toBeInTheDocument();
  });

  it("renders empty-state when gameEndSeconds is 0", () => {
    render(<CompletedGameTimeline {...BASE_PROPS} gameEndSeconds={0} />);
    expect(screen.getByText(/Game duration is not available/i)).toBeInTheDocument();
  });

  it("renders empty-state when gameEndSeconds is NaN", () => {
    render(<CompletedGameTimeline {...BASE_PROPS} gameEndSeconds={NaN} />);
    expect(screen.getByText(/Game duration is not available/i)).toBeInTheDocument();
  });

  it("renders a lane row for each player", () => {
    const players = [
      makePlayer("p1", 5, "Alice", "Smith"),
      makePlayer("p2", 7, "Bob", "Jones"),
    ];
    render(<CompletedGameTimeline {...BASE_PROPS} players={players} />);
    expect(screen.getByText("#5 Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("#7 Bob Jones")).toBeInTheDocument();
  });

  it("renders a lane row for zero-play-time players", () => {
    const players = [
      makePlayer("p1", 5, "Alice", "Smith"),
      makePlayer("p2", 7, "Bob", "Jones"),
    ];
    // Only p1 has a record; p2 should still have a visible row
    const records = [makeRecord("r1", "p1", 0, 1800)];
    render(
      <CompletedGameTimeline {...BASE_PROPS} players={players} playTimeRecords={records} />
    );
    expect(screen.getByText("#7 Bob Jones")).toBeInTheDocument();
  });

  it("renders play-time segments with accessible labels", () => {
    const records = [makeRecord("r1", "p1", 720, 1080, "pos-1")]; // 12'–18'
    render(
      <CompletedGameTimeline
        {...BASE_PROPS}
        playTimeRecords={records}
        positions={[makePosition("pos-1", "Defender")]}
      />
    );
    expect(screen.getByRole("img", { name: "Defender from 12' to 18'" })).toBeInTheDocument();
  });

  it("renders accessible text for team goals in sr-only region", () => {
    const goals = [makeGoal("g1", true, 1380)]; // 23 minutes
    render(<CompletedGameTimeline {...BASE_PROPS} goals={goals} />);
    expect(screen.getByText(/Goal for us at 23'/i)).toBeInTheDocument();
  });

  it("renders accessible text for opponent goals in sr-only region", () => {
    const goals = [makeGoal("g1", false, 2460)]; // 41 minutes
    render(<CompletedGameTimeline {...BASE_PROPS} goals={goals} />);
    expect(screen.getByText(/Goal against at 41'/i)).toBeInTheDocument();
  });

  it("renders one marker per goal", () => {
    const goals = [
      makeGoal("g1", true, 900),
      makeGoal("g2", false, 2700),
    ];
    render(<CompletedGameTimeline {...BASE_PROPS} goals={goals} />);
    expect(screen.getByText(/Goal for us at 15'/i)).toBeInTheDocument();
    expect(screen.getByText(/Goal against at 45'/i)).toBeInTheDocument();
  });

  it("does not render goal markers section when no goals", () => {
    const { container } = render(<CompletedGameTimeline {...BASE_PROPS} goals={[]} />);
    // sr-only region should not be present
    expect(container.querySelector(".sr-only")).not.toBeInTheDocument();
  });

  it("renders player label without jersey number when playerNumber is undefined", () => {
    const players = [makePlayer("p1", undefined, "No", "Number")];
    render(<CompletedGameTimeline {...BASE_PROPS} players={players} />);
    expect(screen.getByText("No Number")).toBeInTheDocument();
  });
});
