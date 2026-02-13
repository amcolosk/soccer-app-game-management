import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameTimer } from "./GameTimer";

vi.mock("../PlayerAvailabilityGrid", () => ({
  PlayerAvailabilityGrid: () => <div data-testid="availability-grid" />,
}));

const makeGameState = (overrides = {}) => ({
  id: "game-1",
  status: "scheduled",
  currentHalf: 1,
  opponent: "Eagles",
  ourScore: 0,
  opponentScore: 0,
  ...overrides,
});

const players = [
  { id: "p1", playerNumber: 10, firstName: "Alice", lastName: "Smith", isActive: true },
  { id: "p2", playerNumber: 7, firstName: "Bob", lastName: "Jones", isActive: true },
] as any[];

const positions = [
  { id: "pos1", positionName: "Forward", abbreviation: "FW" },
] as any[];

const noopCallbacks = {
  onStartGame: vi.fn(),
  onPauseTimer: vi.fn(),
  onResumeTimer: vi.fn(),
  onHalftime: vi.fn(),
  onStartSecondHalf: vi.fn(),
  onEndGame: vi.fn(),
  onAddTestTime: vi.fn(),
  onRecalculateRotations: vi.fn(),
  getPlayerAvailability: () => "available",
  getPlanConflicts: () => [],
};

const defaultProps = {
  gameState: makeGameState() as any,
  game: { id: "game-1" } as any,
  team: { coaches: ["coach-1"] } as any,
  players,
  positions,
  currentTime: 300,
  isRunning: false,
  halfLengthSeconds: 1800,
  gamePlan: null,
  plannedRotations: [] as any[],
  isRecalculating: false,
  ...noopCallbacks,
};

describe("GameTimer", () => {
  describe("rendering", () => {
    it("shows First Half when currentHalf is 1", () => {
      render(<GameTimer {...defaultProps} />);
      expect(screen.getByText("First Half")).toBeInTheDocument();
    });

    it("shows Second Half when currentHalf is 2", () => {
      render(
        <GameTimer
          {...defaultProps}
          gameState={makeGameState({ currentHalf: 2 }) as any}
        />
      );
      expect(screen.getByText("Second Half")).toBeInTheDocument();
    });
  });

  describe("scheduled status", () => {
    it("shows Start Game button", () => {
      render(<GameTimer {...defaultProps} />);
      expect(screen.getByText("Start Game")).toBeInTheDocument();
    });

    it("does not show Pause or Resume buttons", () => {
      render(<GameTimer {...defaultProps} />);
      expect(screen.queryByText(/Pause/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Resume/)).not.toBeInTheDocument();
    });

    it("shows plan conflict banner when conflicts exist", () => {
      const conflicts = [
        { type: "starter" as const, playerId: "p1", playerName: "#10 Alice Smith", status: "absent", rotationNumbers: [] },
      ];
      render(
        <GameTimer
          {...defaultProps}
          gamePlan={{ id: "gp1" } as any}
          getPlanConflicts={() => conflicts}
        />
      );
      expect(screen.getByText("Plan Conflicts", { exact: false })).toBeInTheDocument();
      expect(screen.getByText("#10 Alice Smith")).toBeInTheDocument();
      expect(screen.getByText(/absent/)).toBeInTheDocument();
    });

    it("does not show conflict banner when no conflicts", () => {
      render(
        <GameTimer
          {...defaultProps}
          gamePlan={{ id: "gp1" } as any}
          getPlanConflicts={() => []}
        />
      );
      expect(screen.queryByText("Plan Conflicts", { exact: false })).not.toBeInTheDocument();
    });

    it("shows recalculate button in conflict banner", async () => {
      const user = userEvent.setup();
      const onRecalc = vi.fn();
      const conflicts = [
        { type: "rotation" as const, playerId: "p1", playerName: "#10 Alice", status: "injured", rotationNumbers: [1, 2] },
      ];
      render(
        <GameTimer
          {...defaultProps}
          gamePlan={{ id: "gp1" } as any}
          getPlanConflicts={() => conflicts}
          onRecalculateRotations={onRecalc}
        />
      );
      await user.click(screen.getByText(/Recalculate Rotations/));
      expect(onRecalc).toHaveBeenCalled();
    });

    it("shows conflict with rotation numbers", () => {
      const conflicts = [
        { type: "rotation" as const, playerId: "p1", playerName: "#10 Alice", status: "absent", rotationNumbers: [1, 3] },
      ];
      render(
        <GameTimer
          {...defaultProps}
          gamePlan={{ id: "gp1" } as any}
          getPlanConflicts={() => conflicts}
        />
      );
      expect(screen.getByText(/Rotations 1, 3/)).toBeInTheDocument();
    });

    it("renders PlayerAvailabilityGrid when gamePlan exists", () => {
      render(
        <GameTimer
          {...defaultProps}
          gamePlan={{ id: "gp1" } as any}
        />
      );
      expect(screen.getByTestId("availability-grid")).toBeInTheDocument();
    });

    it("does not render PlayerAvailabilityGrid without gamePlan", () => {
      render(<GameTimer {...defaultProps} />);
      expect(screen.queryByTestId("availability-grid")).not.toBeInTheDocument();
    });
  });

  describe("in-progress status", () => {
    const inProgressProps = {
      ...defaultProps,
      gameState: makeGameState({ status: "in-progress", currentHalf: 1 }) as any,
      isRunning: true,
    };

    it("shows Pause button when running", () => {
      render(<GameTimer {...inProgressProps} />);
      expect(screen.getByText(/Pause/)).toBeInTheDocument();
      expect(screen.queryByText(/Resume/)).not.toBeInTheDocument();
    });

    it("shows Resume button when paused", () => {
      render(<GameTimer {...inProgressProps} isRunning={false} />);
      expect(screen.getByText(/Resume/)).toBeInTheDocument();
      expect(screen.queryByText(/Pause/)).not.toBeInTheDocument();
    });

    it("shows End First Half in first half", () => {
      render(<GameTimer {...inProgressProps} />);
      expect(screen.getByText("End First Half")).toBeInTheDocument();
    });

    it("shows End Game in second half", () => {
      render(
        <GameTimer
          {...inProgressProps}
          gameState={makeGameState({ status: "in-progress", currentHalf: 2 }) as any}
        />
      );
      expect(screen.getByText("End Game")).toBeInTheDocument();
    });

    it("does not show Start Game button", () => {
      render(<GameTimer {...inProgressProps} />);
      expect(screen.queryByText("Start Game")).not.toBeInTheDocument();
    });

    it("shows testing controls", () => {
      render(<GameTimer {...inProgressProps} />);
      expect(screen.getByText("+1 min")).toBeInTheDocument();
      expect(screen.getByText("+5 min")).toBeInTheDocument();
    });

    it("calls onAddTestTime(1) when +1 min clicked", async () => {
      const user = userEvent.setup();
      const onAddTestTime = vi.fn();
      render(<GameTimer {...inProgressProps} onAddTestTime={onAddTestTime} />);
      await user.click(screen.getByText("+1 min"));
      expect(onAddTestTime).toHaveBeenCalledWith(1);
    });

    it("calls onAddTestTime(5) when +5 min clicked", async () => {
      const user = userEvent.setup();
      const onAddTestTime = vi.fn();
      render(<GameTimer {...inProgressProps} onAddTestTime={onAddTestTime} />);
      await user.click(screen.getByText("+5 min"));
      expect(onAddTestTime).toHaveBeenCalledWith(5);
    });

    it("calls onPauseTimer when Pause clicked", async () => {
      const user = userEvent.setup();
      const onPauseTimer = vi.fn();
      render(<GameTimer {...inProgressProps} onPauseTimer={onPauseTimer} />);
      await user.click(screen.getByText(/Pause/));
      expect(onPauseTimer).toHaveBeenCalled();
    });

    it("calls onResumeTimer when Resume clicked", async () => {
      const user = userEvent.setup();
      const onResumeTimer = vi.fn();
      render(<GameTimer {...inProgressProps} isRunning={false} onResumeTimer={onResumeTimer} />);
      await user.click(screen.getByText(/Resume/));
      expect(onResumeTimer).toHaveBeenCalled();
    });
  });

  describe("halftime status", () => {
    const halftimeProps = {
      ...defaultProps,
      gameState: makeGameState({ status: "halftime", currentHalf: 1 }) as any,
    };

    it("shows halftime message", () => {
      render(<GameTimer {...halftimeProps} />);
      expect(screen.getByText("Halftime", { exact: false })).toBeInTheDocument();
    });

    it("shows Start Second Half button", () => {
      render(<GameTimer {...halftimeProps} />);
      expect(screen.getByText("Start Second Half")).toBeInTheDocument();
    });

    it("calls onStartSecondHalf when button clicked", async () => {
      const user = userEvent.setup();
      const onStartSecondHalf = vi.fn();
      render(<GameTimer {...halftimeProps} onStartSecondHalf={onStartSecondHalf} />);
      await user.click(screen.getByText("Start Second Half"));
      expect(onStartSecondHalf).toHaveBeenCalled();
    });

    it("shows planned halftime substitutions when rotation data exists", () => {
      const plannedRotations = [{
        id: "rot1",
        half: 2,
        gameMinute: 30,
        rotationNumber: 1,
        plannedSubstitutions: JSON.stringify([
          { playerOutId: "p1", playerInId: "p2", positionId: "pos1" },
        ]),
      }] as any[];

      render(
        <GameTimer
          {...halftimeProps}
          plannedRotations={plannedRotations}
        />
      );
      expect(screen.getByText("Planned Substitutions", { exact: false })).toBeInTheDocument();
      expect(screen.getByText(/Alice/)).toBeInTheDocument();
      expect(screen.getByText(/Bob/)).toBeInTheDocument();
    });

    it("does not show substitutions when no halftime rotation", () => {
      render(<GameTimer {...halftimeProps} />);
      expect(screen.queryByText("Planned Substitutions", { exact: false })).not.toBeInTheDocument();
    });
  });

  describe("completed status", () => {
    const completedProps = {
      ...defaultProps,
      gameState: makeGameState({ status: "completed" }) as any,
    };

    it("shows Game Completed message", () => {
      render(<GameTimer {...completedProps} />);
      expect(screen.getByText(/Game Completed/)).toBeInTheDocument();
    });

    it("does not show any control buttons", () => {
      render(<GameTimer {...completedProps} />);
      expect(screen.queryByText("Start Game")).not.toBeInTheDocument();
      expect(screen.queryByText(/Pause/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Resume/)).not.toBeInTheDocument();
      expect(screen.queryByText("Start Second Half")).not.toBeInTheDocument();
    });
  });
});
