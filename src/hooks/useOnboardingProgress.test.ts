import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useOnboardingProgress } from "./useOnboardingProgress";
import type { Team, Game, TeamRoster, GamePlan } from "../types/schema";

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: "team-1",
    coaches: ["coach-1"],
    name: "Team",
    maxPlayersOnField: 7,
    halfLengthMinutes: 25,
    ...overrides,
  };
}

function makeRoster(overrides: Partial<TeamRoster> = {}): TeamRoster {
  return {
    id: "roster-1",
    teamId: "team-1",
    playerId: "player-1",
    playerNumber: 10,
    coaches: ["coach-1"],
    ...overrides,
  };
}

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "game-1",
    teamId: "team-1",
    opponent: "Opponent",
    isHome: true,
    gameDate: new Date().toISOString(),
    status: "scheduled",
    currentHalf: 1,
    elapsedSeconds: 0,
    ourScore: 0,
    opponentScore: 0,
    coaches: ["coach-1"],
    ...overrides,
  };
}

function makeGamePlan(overrides: Partial<GamePlan> = {}): GamePlan {
  return {
    id: "gp-1",
    gameId: "game-1",
    coaches: ["coach-1"],
    ...overrides,
  };
}

describe("useOnboardingProgress", () => {
  it("returns all steps incomplete when there is no data", () => {
    const { result } = renderHook(() => useOnboardingProgress([], [], [], []));

    expect(result.current.completedCount).toBe(0);
    expect(result.current.allComplete).toBe(false);
    expect(result.current.steps).toHaveLength(6);
    expect(result.current.steps.every(step => !step.completed)).toBe(true);
  });

  it("marks all steps complete when each requirement is met", () => {
    const teams: Team[] = [makeTeam({ formationId: "formation-1" })];
    const rosters: TeamRoster[] = [makeRoster({ id: "r-1", teamId: "team-1" })];
    const games: Game[] = [makeGame({ id: "g-1", status: "completed" })];
    const gamePlans: GamePlan[] = [makeGamePlan({ id: "gp-1" })];

    const { result } = renderHook(() => useOnboardingProgress(teams, games, rosters, gamePlans));

    expect(result.current.completedCount).toBe(6);
    expect(result.current.allComplete).toBe(true);
    expect(result.current.steps.every(step => step.completed)).toBe(true);
  });

  it("keeps roster step incomplete when roster entries do not belong to known teams", () => {
    const teams: Team[] = [makeTeam({ formationId: "formation-1" })];
    const rosters: TeamRoster[] = [makeRoster({ id: "r-1", teamId: "team-2" })];
    const games: Game[] = [makeGame({ id: "g-1", status: "scheduled" })];

    const { result } = renderHook(() => useOnboardingProgress(teams, games, rosters, []));

    expect(result.current.steps.find(step => step.id === 2)?.completed).toBe(false);
    expect(result.current.steps.find(step => step.id === 3)?.completed).toBe(true);
    expect(result.current.steps.find(step => step.id === 4)?.completed).toBe(true);
    expect(result.current.steps.find(step => step.id === 6)?.completed).toBe(false);
  });

  it("marks live-game step complete for in-progress games", () => {
    const teams: Team[] = [makeTeam({ formationId: "formation-1" })];
    const rosters: TeamRoster[] = [makeRoster({ id: "r-1", teamId: "team-1" })];
    const games: Game[] = [makeGame({ id: "g-1", status: "in-progress" })];

    const { result } = renderHook(() => useOnboardingProgress(teams, games, rosters, []));

    expect(result.current.steps.find(step => step.id === 6)?.completed).toBe(true);
  });
});
