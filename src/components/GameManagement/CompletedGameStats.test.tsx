import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CompletedGameStats } from "./CompletedGameStats";
import type { Shot } from "./types";

const makeShot = (takenByUs: boolean, outcome: Shot['outcome'] | null): Shot => ({
  id: `shot-${Math.random()}`,
  gameId: "game-1",
  playerId: null,
  takenByUs,
  outcome,
  gameSeconds: 0,
  half: 1,
  timestamp: new Date().toISOString(),
  coaches: [],
} as unknown as Shot);

describe("CompletedGameStats", () => {
  it("shows Shots on Goal (GOAL or SAVED outcomes) split by side", () => {
    const shots: Shot[] = [
      makeShot(true, 'GOAL'),
      makeShot(true, 'SAVED'),
      makeShot(true, 'WIDE'),
      makeShot(false, 'BLOCKED'),
      makeShot(false, 'GOAL'),
    ];

    render(<CompletedGameStats shots={shots} opponentName="Riverside FC" />);

    expect(screen.getByText('Shots on Goal', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Us')).toBeInTheDocument();
    expect(screen.getByText('Riverside FC')).toBeInTheDocument();
    // Us on-target: GOAL + SAVED = 2. Opponent on-target: GOAL = 1.
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it("renders nothing for a game with no shots logged (e.g. pre-shot-tracking history)", () => {
    const { container } = render(<CompletedGameStats shots={[]} opponentName="Opponent" />);
    expect(container).toBeEmptyDOMElement();
  });
});
