import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameHeader } from "./GameHeader";

const makeGameState = (overrides = {}) => ({
  id: "game-1",
  opponent: "Eagles",
  isHome: true,
  ourScore: 2,
  opponentScore: 1,
  ...overrides,
});

describe("GameHeader", () => {
  it("renders opponent name", () => {
    render(<GameHeader gameState={makeGameState() as any} onBack={() => {}} />);
    expect(screen.getByText("vs Eagles")).toBeInTheDocument();
  });

  it("shows Home badge when isHome is true", () => {
    render(<GameHeader gameState={makeGameState({ isHome: true }) as any} onBack={() => {}} />);
    expect(screen.getByText(/Home/)).toBeInTheDocument();
  });

  it("shows Away badge when isHome is false", () => {
    render(<GameHeader gameState={makeGameState({ isHome: false }) as any} onBack={() => {}} />);
    expect(screen.getByText(/Away/)).toBeInTheDocument();
  });

  it("displays scores", () => {
    render(<GameHeader gameState={makeGameState() as any} onBack={() => {}} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("displays zero scores by default", () => {
    render(
      <GameHeader
        gameState={makeGameState({ ourScore: 0, opponentScore: 0 }) as any}
        onBack={() => {}}
      />
    );
    expect(screen.getAllByText("0")).toHaveLength(2);
  });

  it("calls onBack when back button clicked", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<GameHeader gameState={makeGameState() as any} onBack={onBack} />);
    await user.click(screen.getByText(/Back to Games/));
    expect(onBack).toHaveBeenCalled();
  });
});
