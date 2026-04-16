import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useOnboardingProgress } from "./useOnboardingProgress";

describe("useOnboardingProgress", () => {
  it("returns all steps incomplete when there is no data", () => {
    const { result } = renderHook(() => useOnboardingProgress([], [], [], []));

    expect(result.current.completedCount).toBe(0);
    expect(result.current.allComplete).toBe(false);
    expect(result.current.steps).toHaveLength(6);
    expect(result.current.steps.every(step => !step.completed)).toBe(true);
  });

  it("marks all steps complete when each requirement is met", () => {
    const teams = [{ id: "team-1", formationId: "formation-1" }] as any[];
    const rosters = [{ id: "r-1", teamId: "team-1" }] as any[];
    const games = [{ id: "g-1", status: "completed" }] as any[];
    const gamePlans = [{ id: "gp-1" }] as any[];

    const { result } = renderHook(() => useOnboardingProgress(teams, games, rosters, gamePlans));

    expect(result.current.completedCount).toBe(6);
    expect(result.current.allComplete).toBe(true);
    expect(result.current.steps.every(step => step.completed)).toBe(true);
  });

  it("keeps roster step incomplete when roster entries do not belong to known teams", () => {
    const teams = [{ id: "team-1", formationId: "formation-1" }] as any[];
    const rosters = [{ id: "r-1", teamId: "team-2" }] as any[];
    const games = [{ id: "g-1", status: "scheduled" }] as any[];

    const { result } = renderHook(() => useOnboardingProgress(teams, games, rosters, []));

    expect(result.current.steps.find(step => step.id === 2)?.completed).toBe(false);
    expect(result.current.steps.find(step => step.id === 3)?.completed).toBe(true);
    expect(result.current.steps.find(step => step.id === 4)?.completed).toBe(true);
    expect(result.current.steps.find(step => step.id === 6)?.completed).toBe(false);
  });

  it("marks live-game step complete for in-progress games", () => {
    const teams = [{ id: "team-1", formationId: "formation-1" }] as any[];
    const rosters = [{ id: "r-1", teamId: "team-1" }] as any[];
    const games = [{ id: "g-1", status: "in-progress" }] as any[];

    const { result } = renderHook(() => useOnboardingProgress(teams, games, rosters, []));

    expect(result.current.steps.find(step => step.id === 6)?.completed).toBe(true);
  });
});
