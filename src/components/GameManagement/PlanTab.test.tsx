/* eslint-disable @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanTab } from "./PlanTab";
import type {
  FormationPosition,
  Game,
  GamePlan,
  LineupAssignment,
  PlannedRotation,
  Team,
} from "./types";

Element.prototype.scrollIntoView = vi.fn();

vi.mock("./hooks/useGamePlanner", () => ({
  useGamePlanner: vi.fn(),
}));

vi.mock("../PlayerAvailabilityGrid", () => ({
  PlayerAvailabilityGrid: () => <div data-testid="player-availability-grid" />,
}));

vi.mock("./LineupPanel", () => ({
  LineupPanel: () => <div data-testid="lineup-panel" />,
}));

import { useGamePlanner } from "./hooks/useGamePlanner";

describe("PlanTab", () => {
  const mockGame: Game = {
    id: "game-1",
    status: "scheduled",
    halfLengthMinutes: 30,
  } as Game;

  const mockTeam: Team = {
    id: "team-1",
    coaches: ["coach-1"],
    halfLengthMinutes: 30,
    formation: {
      positions: [
        { id: "pos-1", name: "Forward", abbreviation: "FW" },
        { id: "pos-2", name: "Midfielder", abbreviation: "MF" },
      ],
    } as any,
  } as Team;

  const mockPlayers = [
    { id: "player-1", firstName: "Player", lastName: "One" },
    { id: "player-2", firstName: "Player", lastName: "Two" },
    { id: "player-3", firstName: "Player", lastName: "Three" },
  ];

  const mockPositions: FormationPosition[] = [
    { id: "pos-1", name: "Forward", abbreviation: "FW" } as FormationPosition,
    { id: "pos-2", name: "Midfielder", abbreviation: "MF" } as FormationPosition,
  ];

  const mockLineup: LineupAssignment[] = [
    { positionId: "pos-1", playerId: "player-1", isStarter: true } as LineupAssignment,
    { positionId: "pos-2", playerId: "player-2", isStarter: true } as LineupAssignment,
  ];

  const mockPlannedRotations: PlannedRotation[] = [
    {
      id: "rot-1",
      half: 1,
      gameMinute: 10,
      rotationNumber: 1,
      plannedSubstitutions: JSON.stringify([
        {
          playerOutId: "player-1",
          playerInId: "player-3",
          positionId: "pos-1",
        },
      ]),
    } as PlannedRotation,
  ];

  const mockGamePlan: GamePlan = {
    id: "plan-1",
    gameId: "game-1",
    startingLineup: JSON.stringify([
      { positionId: "pos-1", playerId: "player-1" },
      { positionId: "pos-2", playerId: "player-2" },
    ]),
    halftimeLineup: JSON.stringify([
      { positionId: "pos-1", playerId: "player-1" },
      { positionId: "pos-2", playerId: "player-3" },
    ]),
    rotationIntervalMinutes: 10,
  } as GamePlan;

  const mockPlannerResult = {
    draft: {
      rotationIntervalMinutes: 10,
      startingLineup: new Map([
        ["pos-1", "player-1"],
        ["pos-2", "player-2"],
      ]),
      halftimeLineup: new Map([
        ["pos-1", "player-1"],
        ["pos-2", "player-3"],
      ]),
      selectedTimelineKey: null,
    },
    isDirty: false,
    remoteFingerprint: "remote-fp",
    localFingerprint: "local-fp",
    isLocked: false,
    errors: [],
    updateRotationInterval: vi.fn().mockResolvedValue(undefined),
    updateHalftimeLineup: vi.fn().mockResolvedValue(undefined),
    selectTimelineKey: vi.fn(),
    savePlan: vi.fn().mockResolvedValue(undefined),
    computeHalftimeRotation: vi.fn(() => ({
      id: "",
      gamePlanId: "plan-1",
      coaches: ["coach-1"],
      half: 2,
      gameMinute: 0,
      rotationNumber: 0,
      plannedSubstitutions: JSON.stringify([
        {
          playerOutId: "player-2",
          playerInId: "player-3",
          positionId: "pos-2",
        },
      ]),
    })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useGamePlanner as any).mockReturnValue(mockPlannerResult);
  });

  const defaultProps = {
    readOnly: false,
    gamePlan: mockGamePlan,
    plannedRotations: mockPlannedRotations,
    planConflicts: [],
    isRecalculating: false,
    onRecalculateRotations: vi.fn(),
    gameState: mockGame,
    game: mockGame,
    team: mockTeam,
    players: mockPlayers as any,
    positions: mockPositions,
    lineup: mockLineup,
    playTimeRecords: [],
    currentTime: 0,
    onSubstitute: vi.fn(),
    mutations: {} as any,
    currentUserId: "coach-1",
    viewMode: "list" as const,
    onViewModeChange: vi.fn(),
    onResetViewPreference: vi.fn(),
  };

  it("renders scheduled planner controls", () => {
    render(<PlanTab {...defaultProps} />);

    expect(screen.getByText("Rotation Settings")).toBeInTheDocument();
    expect(screen.getByText("Half length (minutes)")).toBeInTheDocument();
    expect(screen.getByText("Every (min)")).toBeInTheDocument();
    expect(screen.getByText("Rotations / half")).toBeInTheDocument();
  });

  it("uses canonical rotations-per-half formula floor(halfLength/interval)-1", () => {
    render(<PlanTab {...defaultProps} />);

    const rotationsLabel = screen.getByText("Rotations / half");
    const rotationsCard = rotationsLabel.closest(".rotation-stepper");
    expect(rotationsCard?.textContent).toContain("2");
  });

  it("updates rotation interval from scheduled controls", () => {
    render(<PlanTab {...defaultProps} />);

    const intervalInput = screen.getByLabelText("Every (min)");
    fireEvent.change(intervalInput, { target: { value: "12" } });

    expect(mockPlannerResult.updateRotationInterval).toHaveBeenCalledWith(12);
  });

  it("persists halftime lineup edits through planner callback", async () => {
    (useGamePlanner as any).mockReturnValue({
      ...mockPlannerResult,
      draft: {
        ...mockPlannerResult.draft,
        selectedTimelineKey: "H2:M00:HT",
      },
    });

    render(<PlanTab {...defaultProps} />);

    const selects = screen.getAllByRole("combobox");
    await userEvent.selectOptions(selects[0], "player-3");

    expect(mockPlannerResult.updateHalftimeLineup).toHaveBeenCalled();
  });

  it("keeps live plan tab read-only while allowing timeline inspection selection", () => {
    render(
      <PlanTab
        {...defaultProps}
        readOnly={true}
        game={{ ...mockGame, status: "in-progress" } as Game}
      />
    );

    expect(screen.getByText(/read-only during live play/i)).toBeInTheDocument();
    expect(screen.queryByText("Rotation Settings")).not.toBeInTheDocument();
    expect(screen.queryByTestId("player-availability-grid")).not.toBeInTheDocument();

    const timelinePills = screen.getAllByRole("tab");
    fireEvent.click(timelinePills[0]);
    expect(mockPlannerResult.selectTimelineKey).toHaveBeenCalled();
  });

  it("keeps timeline keyboard inspection active in read-only mode", async () => {
    render(
      <PlanTab
        {...defaultProps}
        readOnly={true}
        game={{ ...mockGame, status: "halftime" } as Game}
      />
    );

    const timeline = screen.getByRole("tablist", { name: /plan timeline/i });
    fireEvent.keyDown(timeline, { key: "ArrowRight" });

    await waitFor(() => {
      expect(mockPlannerResult.selectTimelineKey).toHaveBeenCalled();
    });
  });

  it("shows scheduled empty state copy when no saved plan exists", () => {
    (useGamePlanner as any).mockReturnValue({
      ...mockPlannerResult,
      draft: {
        ...mockPlannerResult.draft,
        startingLineup: new Map(),
      },
    });

    render(<PlanTab {...defaultProps} gamePlan={null} plannedRotations={[]} />);

    expect(
      screen.getByText("No plan yet. Set rotation settings and lineup to create your plan.")
    ).toBeInTheDocument();
  });

  it("shows Generate Rotations button in scheduled state and calls onGenerateRotations on click", () => {
    const onGenerateRotations = vi.fn().mockResolvedValue(undefined);
    render(<PlanTab {...defaultProps} onGenerateRotations={onGenerateRotations} />);

    const generateBtn = screen.getByRole("button", { name: /generate rotations/i });
    expect(generateBtn).toBeInTheDocument();

    fireEvent.click(generateBtn);
    expect(onGenerateRotations).toHaveBeenCalledOnce();
  });

  it("Save Settings persists half-length edits even when planner draft is otherwise clean", async () => {
    const onHalfLengthChange = vi.fn().mockResolvedValue(undefined);
    render(<PlanTab {...defaultProps} onHalfLengthChange={onHalfLengthChange} />);

    const saveBtn = screen.getByRole("button", { name: /save settings/i });
    expect(saveBtn).toBeDisabled();

    const halfLengthInput = screen.getByLabelText("Half length (minutes)");
    fireEvent.change(halfLengthInput, { target: { value: "35" } });

    expect(saveBtn).toBeEnabled();
    await userEvent.click(saveBtn);

    await waitFor(() => {
      expect(onHalfLengthChange).toHaveBeenCalledWith(35);
    });
    expect(mockPlannerResult.savePlan).not.toHaveBeenCalled();
  });

  it("disables Save Settings when live gameState half-length matches saved value even if game prop is stale", async () => {
    const onHalfLengthChange = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<PlanTab {...defaultProps} onHalfLengthChange={onHalfLengthChange} />);

    const halfLengthInput = screen.getByLabelText("Half length (minutes)");
    fireEvent.change(halfLengthInput, { target: { value: "35" } });

    const saveBtn = screen.getByRole("button", { name: /save settings/i });
    expect(saveBtn).toBeEnabled();

    await userEvent.click(saveBtn);
    await waitFor(() => {
      expect(onHalfLengthChange).toHaveBeenCalledWith(35);
    });

    rerender(
      <PlanTab
        {...defaultProps}
        onHalfLengthChange={onHalfLengthChange}
        game={{ ...mockGame, halfLengthMinutes: 30 } as Game}
        gameState={{ ...mockGame, halfLengthMinutes: 35 } as Game}
      />
    );

    expect(screen.getByRole("button", { name: /save settings/i })).toBeDisabled();
  });

  it("hides halftime lineup editor and rotation settings in readOnly mode", () => {
    render(
      <PlanTab
        {...defaultProps}
        readOnly={true}
        game={{ ...mockGame, status: "in-progress" } as Game}
      />
    );

    expect(screen.queryByText("Rotation Settings")).not.toBeInTheDocument();
    expect(screen.queryByText("Halftime Lineup (2nd Half Start)")).not.toBeInTheDocument();
  });

  it("status-gate: mutation handlers are not reachable when game is not scheduled", () => {
    const onIntervalChange = vi.fn();
    const onHalftimeLineupChange = vi.fn();
    const onGenerateRotations = vi.fn();

    render(
      <PlanTab
        {...defaultProps}
        readOnly={true}
        game={{ ...mockGame, status: "in-progress" } as Game}
        onIntervalChange={onIntervalChange}
        onHalftimeLineupChange={onHalftimeLineupChange as any}
        onGenerateRotations={onGenerateRotations}
      />
    );

    // Controls are hidden in non-scheduled state; no mutations should be possible
    expect(screen.queryByLabelText("Every (min)")).not.toBeInTheDocument();
    expect(screen.queryByText("Halftime Lineup (2nd Half Start)")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate rotations/i })).not.toBeInTheDocument();

    expect(onIntervalChange).not.toHaveBeenCalled();
    expect(onHalftimeLineupChange).not.toHaveBeenCalled();
    expect(onGenerateRotations).not.toHaveBeenCalled();
  });
});
