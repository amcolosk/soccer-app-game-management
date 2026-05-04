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

vi.mock("./PlannerLineupView", () => ({
  PlannerLineupView: ({ onPositionAssign, displayLineup, positions, players, isReadOnly }: any) => (
    <div data-testid="planner-lineup-view">
      {positions.map((pos: any) => {
        const posLabel = pos.abbreviation || pos.positionName || "Position";
        const assignedPlayerId =
          (displayLineup instanceof Map ? displayLineup.get(pos.id) : displayLineup?.[pos.id]) ?? "";
        if (isReadOnly) {
          const player = players.find((p: any) => p.id === assignedPlayerId);
          return (
            <span key={pos.id}>
              {player
                ? `${player.firstName ?? ""} ${player.lastName ?? ""}`.trim() || player.id
                : "Unassigned"}
            </span>
          );
        }
        return (
          <select
            key={pos.id}
            data-testid={`position-select-${pos.id}`}
            aria-label={`Player for ${posLabel}`}
            value={assignedPlayerId}
            onChange={(e) => onPositionAssign?.(pos.id, e.target.value)}
          >
            <option value="">Unassigned</option>
            {players.map((p: any) => (
              <option key={p.id} value={p.id}>
                {`${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.id}
              </option>
            ))}
          </select>
        );
      })}
    </div>
  ),
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
    updateStartingLineup: vi.fn().mockResolvedValue(undefined),
    computeHalftimeRotation: vi.fn().mockReturnValue(null),
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
    onUpdatePlannedRotations: vi.fn().mockResolvedValue({
      status: "ok",
      serverFingerprint: "remote-fp-next",
    }),
  };

  it("renders scheduled planner controls", () => {
    render(<PlanTab {...defaultProps} />);

    expect(screen.getByText("Rotation Settings")).toBeInTheDocument();
    expect(screen.getByText("Half length (minutes)")).toBeInTheDocument();
    expect(screen.getByText("Every (min)")).toBeInTheDocument();
    expect(screen.getByText("Rotations / half")).toBeInTheDocument();
  });

  it("renders projected play time per player from lineup and planned rotations", () => {
    render(<PlanTab {...defaultProps} />);

    expect(screen.getByRole("heading", { name: "Projected Play Time" })).toBeInTheDocument();
    expect(screen.getByText("Player One", { selector: ".playtime-label" })).toBeInTheDocument();
    expect(screen.getByText("Player Two", { selector: ".playtime-label" })).toBeInTheDocument();
    expect(screen.getByText("Player Three", { selector: ".playtime-label" })).toBeInTheDocument();
    expect(screen.getByText("10m", { selector: ".playtime-minutes" })).toBeInTheDocument();
    expect(screen.getByText("50m", { selector: ".playtime-minutes" })).toBeInTheDocument();
    expect(screen.getByText("60m", { selector: ".playtime-minutes" })).toBeInTheDocument();
  });

  it("renders projected play time with zero minutes when starting lineup and rotations are empty", () => {
    (useGamePlanner as any).mockReturnValue({
      ...mockPlannerResult,
      draft: {
        ...mockPlannerResult.draft,
        startingLineup: new Map(),
      },
    });

    render(<PlanTab {...defaultProps} gamePlan={null} plannedRotations={[]} />);

    expect(screen.getByRole("heading", { name: "Projected Play Time" })).toBeInTheDocument();
    expect(screen.getByText("Player One", { selector: ".playtime-label" })).toBeInTheDocument();
    expect(screen.getByText("Player Two", { selector: ".playtime-label" })).toBeInTheDocument();
    expect(screen.getByText("Player Three", { selector: ".playtime-label" })).toBeInTheDocument();
    expect(screen.getAllByText("0m", { selector: ".playtime-minutes" })).toHaveLength(3);
  });

  it("shows unknown player label when projection includes a player not in current players list", () => {
    const plannedRotationsWithUnknown: PlannedRotation[] = [
      {
        ...mockPlannedRotations[0],
        plannedSubstitutions: JSON.stringify([
          {
            playerOutId: "player-1",
            playerInId: "player-999",
            positionId: "pos-1",
          },
        ]),
      } as PlannedRotation,
    ];

    render(<PlanTab {...defaultProps} plannedRotations={plannedRotationsWithUnknown} />);

    expect(screen.getByText("Unknown Player (player-999)")).toBeInTheDocument();
    expect(screen.getByText("50m")).toBeInTheDocument();
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
        selectedTimelineKey: "halftime",
      },
    });

    render(<PlanTab {...defaultProps} />);

    const selects = screen.getAllByRole("combobox");
    await userEvent.selectOptions(selects[0], "player-3");

    expect(mockPlannerResult.updateHalftimeLineup).toHaveBeenCalled();
  });

  it("keeps halftime lineup selection on rerender and prop refresh", () => {
    const selectTimelineKey = vi.fn();

    (useGamePlanner as any).mockReturnValue({
      ...mockPlannerResult,
      selectTimelineKey,
      draft: {
        ...mockPlannerResult.draft,
        selectedTimelineKey: "halftime",
        startingLineup: new Map([
          ["pos-1", "player-1"],
          ["pos-2", "player-2"],
        ]),
        halftimeLineup: new Map([
          ["pos-1", "player-1"],
          ["pos-2", "player-3"],
        ]),
      },
    });

    const { rerender } = render(<PlanTab {...defaultProps} />);

    const halftimeSelect = screen.getByTestId("position-select-pos-2");
    expect(halftimeSelect).toHaveValue("player-3");

    const refreshedLineup: LineupAssignment[] = [
      { positionId: "pos-1", playerId: "player-2", isStarter: true } as LineupAssignment,
      { positionId: "pos-2", playerId: "player-1", isStarter: true } as LineupAssignment,
    ];

    rerender(
      <PlanTab
        {...defaultProps}
        lineup={refreshedLineup}
        plannedRotations={[...mockPlannedRotations]}
      />
    );

    expect(screen.getByTestId("position-select-pos-2")).toHaveValue("player-3");
    expect(selectTimelineKey).not.toHaveBeenCalledWith("starting");
  });

  it("allows editing a rotation and submits through parent-owned update callback", async () => {
    const onUpdatePlannedRotations = vi.fn().mockResolvedValue({
      status: "ok",
      serverFingerprint: "remote-fp-next",
    });

    (useGamePlanner as any).mockReturnValue({
      ...mockPlannerResult,
      draft: {
        ...mockPlannerResult.draft,
        selectedTimelineKey: "rotation-1-rot-1",
      },
    });

    render(
      <PlanTab
        {...defaultProps}
        onUpdatePlannedRotations={onUpdatePlannedRotations}
        gamePlan={{ ...mockGamePlan, rotationIntervalMinutes: 15 } as GamePlan}
      />
    );

    // Rotation panel shows PlannerLineupView: pos-1 select shows player-3 (lineup after rotation 1 applied)
    const posSelect = screen.getByTestId("position-select-pos-1");
    await userEvent.selectOptions(posSelect, "player-2");

    // Wait for the 300ms debounce to fire
    await waitFor(
      () => expect(onUpdatePlannedRotations).toHaveBeenCalledTimes(1),
      { timeout: 1000 }
    );

    const payload = onUpdatePlannedRotations.mock.calls[0][0];
    expect(payload.expectedFingerprint).toBe("remote-fp");
    expect(payload.plannedRotations).toHaveLength(1);
    const parsedSubs = JSON.parse(payload.plannedRotations[0].plannedSubstitutions);
    expect(parsedSubs).toEqual([
      {
        playerOutId: "player-1",
        playerInId: "player-2",
        positionId: "pos-1",
      },
    ]);
  });

  it("persists explicit clear when selecting Unassigned in rotation editor", async () => {
    const onUpdatePlannedRotations = vi.fn().mockResolvedValue({
      status: "ok",
      serverFingerprint: "remote-fp-next",
    });

    (useGamePlanner as any).mockReturnValue({
      ...mockPlannerResult,
      draft: {
        ...mockPlannerResult.draft,
        selectedTimelineKey: "rotation-1-rot-1",
      },
    });

    render(
      <PlanTab
        {...defaultProps}
        onUpdatePlannedRotations={onUpdatePlannedRotations}
      />
    );

    const posSelect = screen.getByTestId("position-select-pos-1");
    await userEvent.selectOptions(posSelect, "");

    await waitFor(
      () => expect(onUpdatePlannedRotations).toHaveBeenCalledTimes(1),
      { timeout: 1000 }
    );

    const payload = onUpdatePlannedRotations.mock.calls[0][0];
    const parsedSubs = JSON.parse(payload.plannedRotations[0].plannedSubstitutions);
    expect(parsedSubs).toEqual([
      {
        playerOutId: "player-1",
        playerInId: "",
        positionId: "pos-1",
      },
    ]);
  });

  it("shows conflict feedback when parent update reports conflict", async () => {
    const onUpdatePlannedRotations = vi.fn().mockResolvedValue({
      status: "conflict",
      serverFingerprint: "remote-fp-server",
      conflictReason: "Plan changed remotely.",
    });

    (useGamePlanner as any).mockReturnValue({
      ...mockPlannerResult,
      draft: {
        ...mockPlannerResult.draft,
        selectedTimelineKey: "rotation-1-rot-1",
      },
    });

    render(
      <PlanTab
        {...defaultProps}
        onUpdatePlannedRotations={onUpdatePlannedRotations}
      />
    );

    const posSelect = screen.getByTestId("position-select-pos-1");
    await userEvent.selectOptions(posSelect, "player-2");

    await waitFor(
      () => expect(onUpdatePlannedRotations).toHaveBeenCalledTimes(1),
      { timeout: 1000 }
    );

    expect(screen.getByText("Plan Updated Elsewhere")).toBeInTheDocument();
    expect(screen.getByText("Plan changed remotely.")).toBeInTheDocument();
    // Rotation panel (PlannerLineupView) is still visible after conflict
    expect(screen.getByTestId("planner-lineup-view")).toBeInTheDocument();
  });

  it("clears staged local override after subscription update matches and allows later server divergence", async () => {
    const onUpdatePlannedRotations = vi.fn().mockResolvedValue({
      status: "ok",
      serverFingerprint: "remote-fp-next",
    });

    (useGamePlanner as any).mockReturnValue({
      ...mockPlannerResult,
      draft: {
        ...mockPlannerResult.draft,
        selectedTimelineKey: "rotation-1-rot-1",
      },
    });

    const initialRotations: PlannedRotation[] = [
      {
        ...mockPlannedRotations[0],
        plannedSubstitutions: JSON.stringify([
          {
            playerOutId: "player-1",
            playerInId: "player-3",
            positionId: "pos-1",
          },
        ]),
      } as PlannedRotation,
    ];

    const { rerender } = render(
      <PlanTab
        {...defaultProps}
        plannedRotations={initialRotations}
        onUpdatePlannedRotations={onUpdatePlannedRotations}
      />
    );

    // Change pos-1 from player-3 to player-2 (immediate-save)
    const posSelect = screen.getByTestId("position-select-pos-1");
    await userEvent.selectOptions(posSelect, "player-2");

    await waitFor(
      () => expect(onUpdatePlannedRotations).toHaveBeenCalledTimes(1),
      { timeout: 1000 }
    );

    // Local override in effect: pos-1 select now shows player-2
    expect(screen.getByTestId("position-select-pos-1")).toHaveValue("player-2");

    const matchedServerRotations: PlannedRotation[] = [
      {
        ...mockPlannedRotations[0],
        plannedSubstitutions: JSON.stringify([
          {
            playerOutId: "player-1",
            playerInId: "player-2",
            positionId: "pos-1",
          },
        ]),
      } as PlannedRotation,
    ];

    rerender(
      <PlanTab
        {...defaultProps}
        plannedRotations={matchedServerRotations}
        onUpdatePlannedRotations={onUpdatePlannedRotations}
      />
    );

    // Override cleared but server data matches: still shows player-2
    expect(screen.getByTestId("position-select-pos-1")).toHaveValue("player-2");

    const divergedServerRotations: PlannedRotation[] = [
      {
        ...mockPlannedRotations[0],
        plannedSubstitutions: JSON.stringify([
          {
            playerOutId: "player-1",
            playerInId: "player-3",
            positionId: "pos-1",
          },
        ]),
      } as PlannedRotation,
    ];

    rerender(
      <PlanTab
        {...defaultProps}
        plannedRotations={divergedServerRotations}
        onUpdatePlannedRotations={onUpdatePlannedRotations}
      />
    );

    // Server data wins: back to player-3
    expect(screen.getByTestId("position-select-pos-1")).toHaveValue("player-3");
  });

  it("clears staged local override when keyed server row is removed", async () => {
    const onUpdatePlannedRotations = vi.fn().mockResolvedValue({
      status: "ok",
      serverFingerprint: "remote-fp-next",
    });

    (useGamePlanner as any).mockReturnValue({
      ...mockPlannerResult,
      draft: {
        ...mockPlannerResult.draft,
        selectedTimelineKey: "rotation-1-rot-1",
      },
    });

    const { rerender } = render(
      <PlanTab
        {...defaultProps}
        onUpdatePlannedRotations={onUpdatePlannedRotations}
      />
    );

    // Make a change (creates local override)
    const posSelect = screen.getByTestId("position-select-pos-1");
    await userEvent.selectOptions(posSelect, "player-2");

    await waitFor(
      () => expect(onUpdatePlannedRotations).toHaveBeenCalledTimes(1),
      { timeout: 1000 }
    );

    rerender(
      <PlanTab
        {...defaultProps}
        plannedRotations={[]}
        onUpdatePlannedRotations={onUpdatePlannedRotations}
      />
    );

    // Override cleared, no R1 rotation pill remains
    expect(screen.queryByRole("tab", { name: /r1/i })).not.toBeInTheDocument();
  });

  it("keyboard timeline navigation does not block in immediate-save mode", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");

    (useGamePlanner as any).mockReturnValue({
      ...mockPlannerResult,
      draft: {
        ...mockPlannerResult.draft,
        selectedTimelineKey: "rotation-1-rot-1",
      },
    });

    render(<PlanTab {...defaultProps} />);

    // Navigate away with keyboard — no confirm dialog expected in immediate-save mode
    mockPlannerResult.selectTimelineKey.mockClear();
    const timeline = screen.getByRole("tablist", { name: /plan timeline/i });
    fireEvent.keyDown(timeline, { key: "ArrowLeft" });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mockPlannerResult.selectTimelineKey).toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it("handles non-array plannedSubstitutions payloads without crashing", () => {
    (useGamePlanner as any).mockReturnValue({
      ...mockPlannerResult,
      draft: {
        ...mockPlannerResult.draft,
        selectedTimelineKey: "rotation-1-rot-1",
      },
    });

    const nonArrayRotations: PlannedRotation[] = [
      {
        ...mockPlannedRotations[0],
        plannedSubstitutions: JSON.stringify({ invalid: true }),
      } as PlannedRotation,
    ];

    render(<PlanTab {...defaultProps} plannedRotations={nonArrayRotations} />);

    // Component renders without crashing — PlannerLineupView shown for rotation state
    expect(screen.getByTestId("planner-lineup-view")).toBeInTheDocument();
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
