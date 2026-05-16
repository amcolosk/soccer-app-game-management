import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGamePlanner } from "./useGamePlanner";
import type { Game, GamePlan, LineupAssignment, Team } from "../types";

const { mockGameGet, mockGamePlanCreate, mockGamePlanUpdate } = vi.hoisted(() => ({
  mockGameGet: vi.fn(),
  mockGamePlanCreate: vi.fn(),
  mockGamePlanUpdate: vi.fn(),
}));

vi.mock("aws-amplify/data", () => ({
  generateClient: vi.fn(() => ({
    models: {
      Game: { get: mockGameGet },
      GamePlan: {
        create: mockGamePlanCreate,
        update: mockGamePlanUpdate,
      },
    },
  })),
}));

vi.mock("aws-amplify/auth", () => ({
  getCurrentUser: vi.fn(async () => ({ userId: "coach-1" })),
}));

vi.mock("../../../utils/toast", () => ({
  showError: vi.fn(),
}));

function createGamePlan(startingPlayerId: string, interval = 10): GamePlan {
  return {
    id: "plan-1",
    gameId: "game-1",
    rotationIntervalMinutes: interval,
    startingLineup: JSON.stringify([{ positionId: "pos-1", playerId: startingPlayerId }]),
    halftimeLineup: JSON.stringify([{ positionId: "pos-1", playerId: "player-9" }]),
  } as GamePlan;
}

function createAssignments(playerId: string): LineupAssignment[] {
  return [
    {
      id: `assignment-${playerId}`,
      gameId: "game-1",
      positionId: "pos-1",
      playerId,
      isStarter: true,
    } as LineupAssignment,
  ];
}

describe("useGamePlanner", () => {
  const game = {
    id: "game-1",
    status: "scheduled",
  } as Game;

  const team = {
    id: "team-1",
    coaches: ["coach-1"],
  } as Team;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGameGet.mockResolvedValue({ data: { id: "game-1", status: "scheduled" } });
    mockGamePlanCreate.mockResolvedValue({ data: { id: "plan-1" } });
    mockGamePlanUpdate.mockResolvedValue({ data: { id: "plan-1" } });
  });

  it("preserves selectedTimelineKey across rehydrate", () => {
    const { result, rerender } = renderHook(
      ({ gamePlan, assignments }) => useGamePlanner(game, team, gamePlan, [], assignments),
      {
        initialProps: {
          gamePlan: createGamePlan("player-1", 10),
          assignments: createAssignments("player-1"),
        },
      }
    );

    act(() => {
      result.current.selectTimelineKey("halftime");
    });

    expect(result.current.draft.selectedTimelineKey).toBe("halftime");

    rerender({
      gamePlan: createGamePlan("player-2", 12),
      assignments: createAssignments("player-2"),
    });

    expect(result.current.draft.selectedTimelineKey).toBe("halftime");
    expect(result.current.draft.startingLineup.get("pos-1")).toBe("player-2");
  });

  it("rehydrates clean no-plan draft from latest startingLineupAssignments", () => {
    const { result, rerender } = renderHook(
      ({ assignments }) => useGamePlanner(game, team, null, [], assignments),
      {
        initialProps: {
          assignments: createAssignments("player-1"),
        },
      }
    );

    expect(result.current.draft.startingLineup.get("pos-1")).toBe("player-1");

    rerender({ assignments: createAssignments("player-2") });

    expect(result.current.draft.startingLineup.get("pos-1")).toBe("player-2");
  });

  it("does not clobber dirty local edits during rehydrate attempts", async () => {
    const { result, rerender } = renderHook(
      ({ assignments }) => useGamePlanner(game, team, null, [], assignments),
      {
        initialProps: {
          assignments: createAssignments("player-1"),
        },
      }
    );

    await act(async () => {
      await result.current.updateRotationInterval(12);
    });

    expect(result.current.isDirty).toBe(true);
    expect(result.current.draft.rotationIntervalMinutes).toBe(12);

    rerender({ assignments: createAssignments("player-2") });

    expect(result.current.draft.rotationIntervalMinutes).toBe(12);
    expect(result.current.draft.startingLineup.get("pos-1")).toBe("player-1");
  });

  it("updateHalftimeLineup creates a GamePlan when none exists and preserves selectedTimelineKey", async () => {
    const { result } = renderHook(
      ({ assignments }) => useGamePlanner(game, team, null, [], assignments),
      { initialProps: { assignments: createAssignments("player-1") } }
    );

    act(() => {
      result.current.selectTimelineKey("halftime");
    });

    expect(result.current.draft.selectedTimelineKey).toBe("halftime");

    const newLineup = new Map([["pos-1", "player-2"]]);
    await act(async () => {
      await result.current.updateHalftimeLineup(newLineup);
    });

    expect(mockGamePlanCreate).toHaveBeenCalledTimes(1);
    expect(mockGamePlanUpdate).not.toHaveBeenCalled();
    expect(result.current.draft.halftimeLineup.get("pos-1")).toBe("player-2");
    expect(result.current.draft.selectedTimelineKey).toBe("halftime");
  });

  it("does not overwrite draft when gamePlan prop is stale after a save", async () => {
    const { result, rerender } = renderHook(
      ({ gamePlan, assignments }: { gamePlan: GamePlan | null; assignments: LineupAssignment[] }) =>
        useGamePlanner(game, team, gamePlan, [], assignments),
      {
        initialProps: {
          gamePlan: createGamePlan("player-1", 10),
          assignments: createAssignments("player-1"),
        },
      }
    );

    const newLineup = new Map([["pos-1", "player-2"]]);
    await act(async () => {
      await result.current.updateHalftimeLineup(newLineup);
    });

    expect(result.current.draft.halftimeLineup.get("pos-1")).toBe("player-2");

    rerender({
      gamePlan: createGamePlan("player-1", 10),
      assignments: createAssignments("player-1"),
    });

    expect(result.current.draft.halftimeLineup.get("pos-1")).toBe("player-2");
  });
});
