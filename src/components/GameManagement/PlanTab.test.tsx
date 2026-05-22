/* eslint-disable @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanTab, RotationSubstitutionsList } from "./PlanTab";
import type {
  FormationPosition,
  Game,
  GamePlan,
  LineupAssignment,
  PlannedRotation,
  Team,
} from "./types";

Element.prototype.scrollIntoView = vi.fn();

const { mockConfirm } = vi.hoisted(() => ({
  mockConfirm: vi.fn().mockResolvedValue(true),
}));

vi.mock("../ConfirmModal", () => ({
  useConfirm: () => mockConfirm,
}));

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
      halftimeLineup: new Map(), // empty — no explicit HT overrides in default scenario
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
    mockConfirm.mockResolvedValue(true);
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

  it("projects correct minutes when stored HT rotation has empty subs but halftimeLineup swaps the goalkeeper (issue #119 regression)", () => {
    // Scenario: 30-min halves, 10-min interval → rotationsPerHalf=2, halftimeRotationNumber=3.
    // H1 GK is Ryan (player-gk1). The coach sets Ethan (player-gk2) as H2 GK via the halftime
    // lineup editor AFTER generating rotations, so the stored HT PlannedRotation (rotNum=3,
    // gameMinute=30) still has plannedSubstitutions='[]'. Without the fix, calculatePlayTime
    // sees no HT sub → Ryan stays on field all 60 min (wrong). With the fix, the syntheticHtRotation
    // subs are injected into the projection-only pass and Ryan correctly gets 30m.
    const gkPos: FormationPosition = { id: "pos-gk", name: "Goalkeeper", abbreviation: "GK" } as FormationPosition;
    const fwPos: FormationPosition = { id: "pos-f", name: "Forward", abbreviation: "FW" } as FormationPosition;

    const issueGame: Game = { id: "game-119", status: "scheduled", halfLengthMinutes: 30 } as Game;
    const issueTeam: Team = {
      id: "team-1",
      coaches: ["coach-1"],
      halfLengthMinutes: 30,
      formation: { positions: [gkPos, fwPos] } as any,
    } as Team;

    const issuePlayers = [
      { id: "player-gk1", firstName: "Ryan", lastName: "H1GK" },
      { id: "player-gk2", firstName: "Ethan", lastName: "H2GK" },
      { id: "player-f1", firstName: "Field", lastName: "Player" },
    ];

    // HT rotation (rotNum=3) stored with empty subs — this is the bug trigger.
    const issuePlannedRotations: PlannedRotation[] = [
      { id: "rot-1", half: 1, gameMinute: 10, rotationNumber: 1, plannedSubstitutions: "[]" } as PlannedRotation,
      { id: "rot-2", half: 1, gameMinute: 20, rotationNumber: 2, plannedSubstitutions: "[]" } as PlannedRotation,
      { id: "rot-3", half: 2, gameMinute: 30, rotationNumber: 3, plannedSubstitutions: "[]" } as PlannedRotation,
      { id: "rot-4", half: 2, gameMinute: 40, rotationNumber: 4, plannedSubstitutions: "[]" } as PlannedRotation,
      { id: "rot-5", half: 2, gameMinute: 50, rotationNumber: 5, plannedSubstitutions: "[]" } as PlannedRotation,
    ];

    (useGamePlanner as any).mockReturnValue({
      ...mockPlannerResult,
      draft: {
        ...mockPlannerResult.draft,
        startingLineup: new Map([
          ["pos-gk", "player-gk1"],
          ["pos-f", "player-f1"],
        ]),
        halftimeLineup: new Map(), // planner draft has no explicit overrides
        rotationIntervalMinutes: 10,
      },
    });

    render(
      <PlanTab
        {...defaultProps}
        game={issueGame}
        gameState={issueGame}
        team={issueTeam}
        players={issuePlayers as any}
        positions={[gkPos, fwPos]}
        lineup={[
          { positionId: "pos-gk", playerId: "player-gk1", isStarter: true } as LineupAssignment,
          { positionId: "pos-f", playerId: "player-f1", isStarter: true } as LineupAssignment,
        ]}
        plannedRotations={issuePlannedRotations}
        gamePlan={{ id: "plan-119", gameId: "game-119", rotationIntervalMinutes: 10, startingLineup: JSON.stringify([{ positionId: "pos-gk", playerId: "player-gk1" }, { positionId: "pos-f", playerId: "player-f1" }]) } as any}
        // H2 GK swap: player-gk2 takes over at pos-gk for the entire second half
        halftimeLineup={new Map([["pos-gk", "player-gk2"]])}
      />
    );

    // Ryan H1GK should show 30m (H1 only — swapped out at HT via the effective halftime lineup)
    const ryanLabel = screen.getByText("Ryan H1GK", { selector: ".playtime-label" });
    const ryanContainer = ryanLabel.closest(".playtime-bar-container")!;
    expect(within(ryanContainer).getByText("30m", { selector: ".playtime-minutes" })).toBeInTheDocument();

    // Ethan H2GK should show 30m (H2 only — enters at HT)
    const ethanLabel = screen.getByText("Ethan H2GK", { selector: ".playtime-label" });
    const ethanContainer = ethanLabel.closest(".playtime-bar-container")!;
    expect(within(ethanContainer).getByText("30m", { selector: ".playtime-minutes" })).toBeInTheDocument();

    // Field Player should show 60m (entire game, no subs)
    const fieldLabel = screen.getByText("Field Player", { selector: ".playtime-label" });
    const fieldContainer = fieldLabel.closest(".playtime-bar-container")!;
    expect(within(fieldContainer).getByText("60m", { selector: ".playtime-minutes" })).toBeInTheDocument();
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

  it("swaps players when assigning an already-selected starter to another position", async () => {
    render(<PlanTab {...defaultProps} />);

    const pos1Select = screen.getByTestId("position-select-pos-1");
    await userEvent.selectOptions(pos1Select, "player-2");

    expect(mockPlannerResult.updateStartingLineup).toHaveBeenCalledTimes(1);
    const updatedMap = mockPlannerResult.updateStartingLineup.mock.calls[0][0] as Map<string, string>;

    expect(updatedMap.get("pos-1")).toBe("player-2");
    expect(updatedMap.get("pos-2")).toBe("player-1");
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

  it("keeps second-half rotations fully assigned when halftime overrides are partial", () => {
    const partialHalftimeDraft = {
      ...mockPlannerResult,
      draft: {
        ...mockPlannerResult.draft,
        selectedTimelineKey: "rotation-4-rot-4",
        // Only one halftime override is stored; other positions must inherit end-of-H1 lineup.
        halftimeLineup: new Map([[
          "pos-2",
          "player-3",
        ]]),
      },
    };

    (useGamePlanner as any).mockReturnValue(partialHalftimeDraft);

    const fiveRotationPlan: PlannedRotation[] = [
      { id: "rot-1", half: 1, gameMinute: 8, rotationNumber: 1, plannedSubstitutions: "[]" } as PlannedRotation,
      { id: "rot-2", half: 1, gameMinute: 16, rotationNumber: 2, plannedSubstitutions: "[]" } as PlannedRotation,
      { id: "rot-3", half: 2, gameMinute: 25, rotationNumber: 3, plannedSubstitutions: "[]" } as PlannedRotation,
      { id: "rot-4", half: 2, gameMinute: 33, rotationNumber: 4, plannedSubstitutions: "[]" } as PlannedRotation,
      { id: "rot-5", half: 2, gameMinute: 41, rotationNumber: 5, plannedSubstitutions: "[]" } as PlannedRotation,
    ];

    render(
      <PlanTab
        {...defaultProps}
        plannedRotations={fiveRotationPlan}
      />
    );

    expect(screen.getByTestId("position-select-pos-1")).toHaveValue("player-1");
    expect(screen.getByTestId("position-select-pos-2")).toHaveValue("player-3");
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
      {
        playerOutId: "player-2",
        playerInId: "player-3",
        positionId: "pos-2",
      },
    ]);
  });

  it("shows who goes off/on in rotation details", () => {
    (useGamePlanner as any).mockReturnValue({
      ...mockPlannerResult,
      draft: {
        ...mockPlannerResult.draft,
        selectedTimelineKey: "rotation-1-rot-1",
      },
    });

    render(<PlanTab {...defaultProps} />);

    expect(screen.getByText("Who goes off/on")).toBeInTheDocument();
    const subsSummary = screen.getByLabelText("Rotation substitutions summary");
    expect(within(subsSummary).getByText("OFF")).toBeInTheDocument();
    expect(within(subsSummary).getByText("ON")).toBeInTheDocument();
    expect(within(subsSummary).getByText("Player One")).toBeInTheDocument();
    expect(within(subsSummary).getByText("Player Three")).toBeInTheDocument();
  });

  it("explains Reset to saved behavior in rotation details", () => {
    (useGamePlanner as any).mockReturnValue({
      ...mockPlannerResult,
      draft: {
        ...mockPlannerResult.draft,
        selectedTimelineKey: "rotation-1-rot-1",
      },
    });

    render(<PlanTab {...defaultProps} />);

    expect(screen.getByRole("button", { name: /reset to saved/i })).toHaveAttribute(
      "title",
      "Revert this rotation to the last saved version from the server"
    );
    expect(screen.getByText("Reverts this rotation to your last saved plan.")).toBeInTheDocument();
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
          {
            playerOutId: "player-2",
            playerInId: "player-3",
            positionId: "pos-2",
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

  it("Save Plan persists half-length edits even when planner draft is otherwise clean", async () => {
    const onHalfLengthChange = vi.fn().mockResolvedValue(undefined);
    const onEnsureRotationSchedule = vi.fn().mockResolvedValue(undefined);
    const onGenerateRotations = vi.fn().mockResolvedValue(undefined);
    render(
      <PlanTab
        {...defaultProps}
        onHalfLengthChange={onHalfLengthChange}
        onEnsureRotationSchedule={onEnsureRotationSchedule}
        onGenerateRotations={onGenerateRotations}
      />
    );

    const saveBtn = screen.getByRole("button", { name: /save plan/i });
    expect(saveBtn).toBeDisabled();

    const halfLengthInput = screen.getByLabelText("Half length (minutes)");
    fireEvent.change(halfLengthInput, { target: { value: "35" } });

    expect(saveBtn).toBeEnabled();
    await userEvent.click(saveBtn);

    await waitFor(() => {
      expect(onHalfLengthChange).toHaveBeenCalledWith(35);
    });
    expect(mockPlannerResult.savePlan).not.toHaveBeenCalled();
    // Save calls onEnsureRotationSchedule, NOT onGenerateRotations
    expect(onEnsureRotationSchedule).toHaveBeenCalledWith({ halfLengthMinutes: 35, rotationIntervalMinutes: 10 });
    expect(onGenerateRotations).not.toHaveBeenCalled();
  });

  it("Save Plan calls onEnsureRotationSchedule when rotation interval is dirty", async () => {
    const onEnsureRotationSchedule = vi.fn().mockResolvedValue(undefined);
    const onGenerateRotations = vi.fn().mockResolvedValue(undefined);

    (useGamePlanner as any).mockReturnValue({
      ...mockPlannerResult,
      isDirty: true,
      draft: {
        ...mockPlannerResult.draft,
        rotationIntervalMinutes: 15, // different from gamePlan.rotationIntervalMinutes (10)
      },
    });

    render(
      <PlanTab
        {...defaultProps}
        onEnsureRotationSchedule={onEnsureRotationSchedule}
        onGenerateRotations={onGenerateRotations}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /save plan/i }));

    await waitFor(() => {
      expect(mockPlannerResult.savePlan).toHaveBeenCalled();
    });
    expect(onEnsureRotationSchedule).toHaveBeenCalledWith({ halfLengthMinutes: 30, rotationIntervalMinutes: 15 });
    expect(onGenerateRotations).not.toHaveBeenCalled();
  });

  it("Save Plan does NOT call onEnsureRotationSchedule when only lineup is dirty (no schedule change)", async () => {
    const onEnsureRotationSchedule = vi.fn().mockResolvedValue(undefined);

    (useGamePlanner as any).mockReturnValue({
      ...mockPlannerResult,
      isDirty: true,
      // rotationIntervalMinutes matches gamePlan (10)
    });

    render(
      <PlanTab
        {...defaultProps}
        onEnsureRotationSchedule={onEnsureRotationSchedule}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /save plan/i }));

    await waitFor(() => {
      expect(mockPlannerResult.savePlan).toHaveBeenCalled();
    });
    expect(onEnsureRotationSchedule).not.toHaveBeenCalled();
  });

  it("Generate Rotations button passes plannerSnapshot with current draft state", async () => {
    const onGenerateRotations = vi.fn().mockResolvedValue(undefined);

    render(
      <PlanTab
        {...defaultProps}
        onGenerateRotations={onGenerateRotations}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /generate rotations/i }));

    expect(onGenerateRotations).toHaveBeenCalledTimes(1);
    const opts = onGenerateRotations.mock.calls[0][0];
    expect(opts).toHaveProperty("plannerSnapshot");
    expect(opts.plannerSnapshot.halfLengthMinutes).toBe(30); // matches mockGame.halfLengthMinutes
    expect(opts.plannerSnapshot.rotationIntervalMinutes).toBe(10); // matches mockPlannerResult draft
    expect(opts.plannerSnapshot.startingLineup).toBeInstanceOf(Map);
    expect(opts.plannerSnapshot.startingLineup.get("pos-1")).toBe("player-1");
  });

  it("shows updated empty-state copy when plan exists but rotations are empty", () => {
    render(
      <PlanTab
        {...defaultProps}
        gamePlan={mockGamePlan}
        plannedRotations={[]}
      />
    );

    expect(
      screen.getByText("Configure schedule settings and save to create your timeline.")
    ).toBeInTheDocument();
    // Old copy must not appear
    expect(
      screen.queryByText(/Use Auto-Generate to create a timeline/)
    ).not.toBeInTheDocument();
  });

  it("disables Save Plan when live gameState half-length matches saved value even if game prop is stale", async () => {
    const onHalfLengthChange = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<PlanTab {...defaultProps} onHalfLengthChange={onHalfLengthChange} />);

    const halfLengthInput = screen.getByLabelText("Half length (minutes)");
    fireEvent.change(halfLengthInput, { target: { value: "35" } });

    const saveBtn = screen.getByRole("button", { name: /save plan/i });
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

    expect(screen.getByRole("button", { name: /save plan/i })).toBeDisabled();
  });

  it("disables Save Plan button while isRecalculating is true", async () => {
    (useGamePlanner as any).mockReturnValue({
      ...mockPlannerResult,
      isDirty: true,
    });

    render(<PlanTab {...defaultProps} isRecalculating={true} />);

    const saveBtn = screen.getByRole("button", { name: /save plan/i });
    expect(saveBtn).toBeDisabled();
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

  describe("Halftime lineup explicit-override contract", () => {
    it("clearing a halftime slot inherited from end-of-H1 persists explicit empty-string override", async () => {
      const updateHalftimeLineup = vi.fn().mockResolvedValue(undefined);
      (useGamePlanner as any).mockReturnValue({
        ...mockPlannerResult,
        draft: {
          ...mockPlannerResult.draft,
          selectedTimelineKey: "halftime",
          halftimeLineup: new Map(), // no explicit overrides — all positions inherited
        },
        updateHalftimeLineup,
      });

      // Use plannedRotations: [] so endOfH1 = startingLineup (no H1 rotations changing pos-1)
      render(<PlanTab {...defaultProps} plannedRotations={[]} />);

      // pos-1 is inherited from end-of-H1 (= startingLineup) and shows player-1
      const pos1Select = screen.getByTestId("position-select-pos-1");
      expect(pos1Select).toHaveValue("player-1");

      // Clear pos-1
      await userEvent.selectOptions(pos1Select, "");

      expect(updateHalftimeLineup).toHaveBeenCalledOnce();
      const persistedMap = updateHalftimeLineup.mock.calls[0][0] as Map<string, string>;
      // The persisted map must carry an explicit "" sentinel for pos-1
      expect(persistedMap.get("pos-1")).toBe("");
      // pos-2 was not touched and still matches end-of-H1 — no override needed
      expect(persistedMap.has("pos-2")).toBe(false);
    });

    it("rerender with empty-string sentinel keeps the halftime slot empty", () => {
      (useGamePlanner as any).mockReturnValue({
        ...mockPlannerResult,
        draft: {
          ...mockPlannerResult.draft,
          selectedTimelineKey: "halftime",
          halftimeLineup: new Map([["pos-1", ""]]), // explicit clear for pos-1
        },
      });

      render(<PlanTab {...defaultProps} />);

      // pos-1 must be empty — explicit clear overrides the end-of-H1 player
      const pos1Select = screen.getByTestId("position-select-pos-1");
      expect(pos1Select).toHaveValue("");
      // pos-2 still inherits from end-of-H1
      expect(screen.getByTestId("position-select-pos-2")).toHaveValue("player-2");
    });

    it("clear-all button visible when halftime lineup has assigned players and editor is interactive", () => {
      (useGamePlanner as any).mockReturnValue({
        ...mockPlannerResult,
        draft: {
          ...mockPlannerResult.draft,
          selectedTimelineKey: "halftime",
        },
      });

      render(<PlanTab {...defaultProps} />);
      expect(screen.getByRole("button", { name: /clear all positions/i })).toBeInTheDocument();
    });

    it("clear-all button is hidden when readOnly", () => {
      (useGamePlanner as any).mockReturnValue({
        ...mockPlannerResult,
        draft: {
          ...mockPlannerResult.draft,
          selectedTimelineKey: "halftime",
        },
      });

      render(
        <PlanTab
          {...defaultProps}
          readOnly={true}
          game={{ ...mockGame, status: "halftime" } as Game}
        />
      );
      expect(screen.queryByRole("button", { name: /clear all positions/i })).not.toBeInTheDocument();
    });

    it("clear-all button is hidden when all halftime positions are already empty", () => {
      (useGamePlanner as any).mockReturnValue({
        ...mockPlannerResult,
        draft: {
          ...mockPlannerResult.draft,
          selectedTimelineKey: "halftime",
          startingLineup: new Map(), // empty end-of-H1
          halftimeLineup: new Map(),
        },
      });

      // Use plannedRotations: [] so endOfH1 = startingLineup = new Map() (truly empty)
      render(<PlanTab {...defaultProps} plannedRotations={[]} />);
      expect(screen.queryByRole("button", { name: /clear all positions/i })).not.toBeInTheDocument();
    });

    it("clear-all confirm accepted clears all halftime positions via explicit overrides", async () => {
      const updateHalftimeLineup = vi.fn().mockResolvedValue(undefined);
      (useGamePlanner as any).mockReturnValue({
        ...mockPlannerResult,
        draft: {
          ...mockPlannerResult.draft,
          selectedTimelineKey: "halftime",
        },
        updateHalftimeLineup,
      });

      render(<PlanTab {...defaultProps} />);

      const clearBtn = screen.getByRole("button", { name: /clear all positions/i });
      await userEvent.click(clearBtn);

      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Clear Halftime Lineup",
          confirmText: "Clear All",
          variant: "warning",
        })
      );
      expect(updateHalftimeLineup).toHaveBeenCalledOnce();
      const persistedMap = updateHalftimeLineup.mock.calls[0][0] as Map<string, string>;
      // All positions from endOfH1 (= startingLineup here) must have "" clear sentinels
      expect(persistedMap.get("pos-1")).toBe("");
      expect(persistedMap.get("pos-2")).toBe("");
    });

    it("clear-all confirm cancelled does not persist changes", async () => {
      const updateHalftimeLineup = vi.fn().mockResolvedValue(undefined);
      mockConfirm.mockResolvedValueOnce(false);
      (useGamePlanner as any).mockReturnValue({
        ...mockPlannerResult,
        draft: {
          ...mockPlannerResult.draft,
          selectedTimelineKey: "halftime",
        },
        updateHalftimeLineup,
      });

      render(<PlanTab {...defaultProps} />);

      const clearBtn = screen.getByRole("button", { name: /clear all positions/i });
      await userEvent.click(clearBtn);

      expect(mockConfirm).toHaveBeenCalledOnce();
      expect(updateHalftimeLineup).not.toHaveBeenCalled();
    });
  });

  describe("Copy from game button", () => {
    it("renders 'Copy from game' button when onOpenCopyModal is provided and not readOnly", () => {
      const onOpenCopyModal = vi.fn();
      render(
        <PlanTab
          {...defaultProps}
          onOpenCopyModal={onOpenCopyModal}
        />
      );
      expect(screen.getByRole("button", { name: /copy from game/i })).toBeInTheDocument();
    });

    it("does not render 'Copy from game' button when readOnly is true", () => {
      render(
        <PlanTab
          {...defaultProps}
          readOnly={true}
          game={{ ...mockGame, status: "in-progress" } as Game}
          onOpenCopyModal={vi.fn()}
        />
      );
      expect(screen.queryByRole("button", { name: /copy from game/i })).not.toBeInTheDocument();
    });

    it("does not render 'Copy from game' button when onOpenCopyModal is not provided", () => {
      render(<PlanTab {...defaultProps} />);
      expect(screen.queryByRole("button", { name: /copy from game/i })).not.toBeInTheDocument();
    });

    it("'Copy from game' button is disabled when isCopyingPlan is true", () => {
      render(
        <PlanTab
          {...defaultProps}
          onOpenCopyModal={vi.fn()}
          isCopyingPlan={true}
        />
      );
      expect(screen.getByRole("button", { name: /copy from game/i })).toBeDisabled();
    });
  });
});

describe("RotationSubstitutionsList — empty playerOutId", () => {
  it('shows "(unfilled)" when playerOutId is empty string', () => {
    const sub = JSON.stringify([{ playerOutId: "", playerInId: "player-1", positionId: "pos-1" }]);
    render(
      <RotationSubstitutionsList
        substitutions={sub}
        players={[{ id: "player-1", firstName: "Player", lastName: "One" } as any]}
        positions={[{ id: "pos-1", abbreviation: "FW", positionName: "Forward" } as any]}
      />
    );
    expect(screen.getByText("(unfilled)")).toBeInTheDocument();
    expect(screen.queryByText("Unknown")).not.toBeInTheDocument();
  });

  it('shows "Unknown" for a non-empty playerOutId not in the player list', () => {
    const sub = JSON.stringify([{ playerOutId: "ghost-id", playerInId: "player-1", positionId: "pos-1" }]);
    render(
      <RotationSubstitutionsList
        substitutions={sub}
        players={[{ id: "player-1", firstName: "Player", lastName: "One" } as any]}
        positions={[{ id: "pos-1", abbreviation: "FW", positionName: "Forward" } as any]}
      />
    );
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });
});
