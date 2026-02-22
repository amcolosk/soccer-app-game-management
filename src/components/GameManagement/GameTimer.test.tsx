import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameTimer } from "./GameTimer";

// GameTimer calls useAvailability internally – mock the context
const mockGetPlayerAvailability = vi.fn().mockReturnValue("available");
vi.mock("../../contexts/AvailabilityContext", () => ({
  useAvailability: () => ({ getPlayerAvailability: mockGetPlayerAvailability }),
}));

vi.mock("../PlayerAvailabilityGrid", () => ({
  PlayerAvailabilityGrid: () => <div data-testid="availability-grid" />,
}));

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

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
  { id: "p2", playerNumber: 7,  firstName: "Bob",   lastName: "Jones", isActive: true },
  { id: "p3", playerNumber: 5,  firstName: "Carol", lastName: "Davis", isActive: true },
  { id: "p4", playerNumber: 3,  firstName: "Dan",   lastName: "Evans", isActive: true },
] as any[];

const positions = [
  { id: "pos1", positionName: "Forward",    abbreviation: "FW" },
  { id: "pos2", positionName: "Midfielder", abbreviation: "MF" },
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
  onApplyHalftimeSub: vi.fn().mockResolvedValue(undefined),
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
  lineup: [] as any[],
  isRecalculating: false,
  ...noopCallbacks,
};

// Planned rotation fixtures
const oneSubRotation = [{
  id: "rot1", half: 2, gameMinute: 30, rotationNumber: 1,
  plannedSubstitutions: JSON.stringify([
    { playerOutId: "p1", playerInId: "p2", positionId: "pos1" },
  ]),
}] as any[];

const twoSubRotation = [{
  id: "rot1", half: 2, gameMinute: 30, rotationNumber: 1,
  plannedSubstitutions: JSON.stringify([
    { playerOutId: "p1", playerInId: "p2", positionId: "pos1" },
    { playerOutId: "p3", playerInId: "p4", positionId: "pos2" },
  ]),
}] as any[];

const makeHalftimeProps = (overrides: Record<string, unknown> = {}) => ({
  ...defaultProps,
  gameState: makeGameState({ status: "halftime", currentHalf: 1 }) as any,
  ...overrides,
});

// ---------------------------------------------------------------------------

describe("GameTimer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlayerAvailability.mockReturnValue("available");
  });

  // -------------------------------------------------------------------------
  describe("rendering", () => {
    it("shows First Half when currentHalf is 1", () => {
      render(<GameTimer {...defaultProps} />);
      expect(screen.getByText("First Half")).toBeInTheDocument();
    });

    it("shows Second Half when currentHalf is 2", () => {
      render(
        <GameTimer {...defaultProps} gameState={makeGameState({ currentHalf: 2 }) as any} />
      );
      expect(screen.getByText("Second Half")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
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
        <GameTimer {...defaultProps} gamePlan={{ id: "gp1" } as any} getPlanConflicts={() => conflicts} />
      );
      expect(screen.getByText("Plan Conflicts", { exact: false })).toBeInTheDocument();
      expect(screen.getByText("#10 Alice Smith")).toBeInTheDocument();
      expect(screen.getByText(/absent/)).toBeInTheDocument();
    });

    it("does not show conflict banner when no conflicts", () => {
      render(
        <GameTimer {...defaultProps} gamePlan={{ id: "gp1" } as any} getPlanConflicts={() => []} />
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
        <GameTimer {...defaultProps} gamePlan={{ id: "gp1" } as any} getPlanConflicts={() => conflicts} />
      );
      expect(screen.getByText(/Rotations 1, 3/)).toBeInTheDocument();
    });

    it("renders PlayerAvailabilityGrid when gamePlan exists", () => {
      render(<GameTimer {...defaultProps} gamePlan={{ id: "gp1" } as any} />);
      expect(screen.getByTestId("availability-grid")).toBeInTheDocument();
    });

    it("does not render PlayerAvailabilityGrid without gamePlan", () => {
      render(<GameTimer {...defaultProps} />);
      expect(screen.queryByTestId("availability-grid")).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  describe("halftime status", () => {
    it("shows halftime message", () => {
      render(<GameTimer {...makeHalftimeProps()} />);
      expect(screen.getByText("Halftime", { exact: false })).toBeInTheDocument();
    });

    it("shows Start Second Half button", () => {
      render(<GameTimer {...makeHalftimeProps()} />);
      expect(screen.getByText("Start Second Half")).toBeInTheDocument();
    });

    it("calls onStartSecondHalf when button clicked", async () => {
      const user = userEvent.setup();
      const onStartSecondHalf = vi.fn();
      render(<GameTimer {...makeHalftimeProps({ onStartSecondHalf })} />);
      await user.click(screen.getByText("Start Second Half"));
      expect(onStartSecondHalf).toHaveBeenCalled();
    });

    it("shows 2nd Half Lineup Changes heading when rotation data exists", () => {
      render(<GameTimer {...makeHalftimeProps({ plannedRotations: oneSubRotation })} />);
      expect(screen.getByRole("heading", { name: /2nd Half Lineup Changes/i })).toBeInTheDocument();
    });

    it("does not show lineup changes section when no halftime rotation exists", () => {
      render(<GameTimer {...makeHalftimeProps()} />);
      expect(screen.queryByRole("heading", { name: /2nd Half Lineup Changes/i })).not.toBeInTheDocument();
    });

    it("renders an Apply button for each planned substitution", () => {
      render(<GameTimer {...makeHalftimeProps({ plannedRotations: twoSubRotation })} />);
      expect(screen.getAllByRole("button", { name: /^apply$/i })).toHaveLength(2);
    });

    it("shows player names for each planned sub", () => {
      render(<GameTimer {...makeHalftimeProps({ plannedRotations: oneSubRotation })} />);
      expect(screen.getByText(/Alice/)).toBeInTheDocument();
      expect(screen.getByText(/Bob/)).toBeInTheDocument();
    });

    // --- Apply button enabled/disabled states ---

    it("Apply button is enabled when incoming player is available", () => {
      render(<GameTimer {...makeHalftimeProps({ plannedRotations: oneSubRotation })} />);
      expect(screen.getByRole("button", { name: /^apply$/i })).not.toBeDisabled();
    });

    it("Apply button is disabled when incoming player is absent", () => {
      mockGetPlayerAvailability.mockImplementation((id: string) =>
        id === "p2" ? "absent" : "available"
      );
      render(<GameTimer {...makeHalftimeProps({ plannedRotations: oneSubRotation })} />);
      expect(screen.getByRole("button", { name: /^apply$/i })).toBeDisabled();
    });

    it("Apply button is disabled when incoming player is injured", () => {
      mockGetPlayerAvailability.mockImplementation((id: string) =>
        id === "p2" ? "injured" : "available"
      );
      render(<GameTimer {...makeHalftimeProps({ plannedRotations: oneSubRotation })} />);
      expect(screen.getByRole("button", { name: /^apply$/i })).toBeDisabled();
    });

    it("shows availability badge when incoming player is absent", () => {
      mockGetPlayerAvailability.mockImplementation((id: string) =>
        id === "p2" ? "absent" : "available"
      );
      render(<GameTimer {...makeHalftimeProps({ plannedRotations: oneSubRotation })} />);
      expect(screen.getByText(/absent/i)).toBeInTheDocument();
    });

    it("Apply button shows '✓ Applied' and is disabled when incoming player is already in lineup", () => {
      const appliedLineup = [
        { id: "la-1", gameId: "game-1", playerId: "p2", positionId: "pos1", isStarter: true },
      ] as any[];
      render(
        <GameTimer {...makeHalftimeProps({ plannedRotations: oneSubRotation, lineup: appliedLineup })} />
      );
      expect(screen.getByText("✓ Applied")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /applied/i })).toBeDisabled();
    });

    it("calls onApplyHalftimeSub with the correct sub when Apply is clicked", async () => {
      const user = userEvent.setup();
      const onApplyHalftimeSub = vi.fn().mockResolvedValue(undefined);
      render(
        <GameTimer {...makeHalftimeProps({ plannedRotations: oneSubRotation, onApplyHalftimeSub })} />
      );
      await user.click(screen.getByRole("button", { name: /^apply$/i }));
      expect(onApplyHalftimeSub).toHaveBeenCalledWith({
        playerOutId: "p1",
        playerInId: "p2",
        positionId: "pos1",
      });
    });

    // --- Apply All ---

    it("shows Apply All button when planned subs exist", () => {
      render(<GameTimer {...makeHalftimeProps({ plannedRotations: oneSubRotation })} />);
      expect(screen.getByRole("button", { name: /apply all/i })).toBeInTheDocument();
    });

    it("Apply All is enabled when at least one sub is pending", () => {
      render(<GameTimer {...makeHalftimeProps({ plannedRotations: oneSubRotation })} />);
      expect(screen.getByRole("button", { name: /apply all/i })).not.toBeDisabled();
    });

    it("Apply All is disabled when all subs are already applied", () => {
      const fullyAppliedLineup = [
        { id: "la-1", gameId: "game-1", playerId: "p2", positionId: "pos1", isStarter: true },
        { id: "la-2", gameId: "game-1", playerId: "p4", positionId: "pos2", isStarter: true },
      ] as any[];
      render(
        <GameTimer
          {...makeHalftimeProps({ plannedRotations: twoSubRotation, lineup: fullyAppliedLineup })}
        />
      );
      expect(screen.getByRole("button", { name: /apply all/i })).toBeDisabled();
    });

    it("Apply All is disabled when all incoming players are unavailable", () => {
      mockGetPlayerAvailability.mockImplementation((id: string) =>
        id === "p2" ? "absent" : "available"
      );
      render(<GameTimer {...makeHalftimeProps({ plannedRotations: oneSubRotation })} />);
      expect(screen.getByRole("button", { name: /apply all/i })).toBeDisabled();
    });

    it("Apply All calls onApplyHalftimeSub for each pending sub", async () => {
      const user = userEvent.setup();
      const onApplyHalftimeSub = vi.fn().mockResolvedValue(undefined);
      render(
        <GameTimer {...makeHalftimeProps({ plannedRotations: twoSubRotation, onApplyHalftimeSub })} />
      );
      await user.click(screen.getByRole("button", { name: /apply all/i }));
      await waitFor(() => expect(onApplyHalftimeSub).toHaveBeenCalledTimes(2));
      expect(onApplyHalftimeSub).toHaveBeenCalledWith({ playerOutId: "p1", playerInId: "p2", positionId: "pos1" });
      expect(onApplyHalftimeSub).toHaveBeenCalledWith({ playerOutId: "p3", playerInId: "p4", positionId: "pos2" });
    });

    it("Apply All skips subs where the incoming player is already in the lineup", async () => {
      const user = userEvent.setup();
      const onApplyHalftimeSub = vi.fn().mockResolvedValue(undefined);
      const partialLineup = [
        { id: "la-1", gameId: "game-1", playerId: "p2", positionId: "pos1", isStarter: true },
      ] as any[];
      render(
        <GameTimer
          {...makeHalftimeProps({
            plannedRotations: twoSubRotation,
            lineup: partialLineup,
            onApplyHalftimeSub,
          })}
        />
      );
      await user.click(screen.getByRole("button", { name: /apply all/i }));
      await waitFor(() => expect(onApplyHalftimeSub).toHaveBeenCalledTimes(1));
      expect(onApplyHalftimeSub).toHaveBeenCalledWith({ playerOutId: "p3", playerInId: "p4", positionId: "pos2" });
    });

    it("Apply All shows 'Applying...' while in progress and re-enables on completion", async () => {
      const user = userEvent.setup();
      let resolveApply!: () => void;
      const onApplyHalftimeSub = vi.fn().mockReturnValue(
        new Promise<void>(r => { resolveApply = r; })
      );
      render(
        <GameTimer {...makeHalftimeProps({ plannedRotations: oneSubRotation, onApplyHalftimeSub })} />
      );

      user.click(screen.getByRole("button", { name: /apply all/i }));

      await waitFor(() =>
        expect(screen.getByRole("button", { name: /applying/i })).toBeDisabled()
      );

      resolveApply();

      await waitFor(() =>
        expect(screen.getByRole("button", { name: /apply all/i })).toBeInTheDocument()
      );
    });
  });

  // -------------------------------------------------------------------------
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
