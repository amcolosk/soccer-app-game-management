import { describe, expect, it, vi } from "vitest";
import {
  createLineupInteractionAdapter,
  playerHasPreferredPositions,
  playerPreferredForPosition,
  sortBenchPlayersByPriority,
} from "./lineupInteractionAdapter";
import type { FormationPosition, PlayerWithRoster } from "../types";

function makePosition(id: string): FormationPosition {
  return {
    id,
    positionName: id,
    abbreviation: id,
  } as unknown as FormationPosition;
}

function makePlayer(id: string, playerNumber: number, preferredPositions = ""): PlayerWithRoster {
  return {
    id,
    firstName: id,
    lastName: "Player",
    playerNumber,
    preferredPositions,
    isActive: true,
  } as unknown as PlayerWithRoster;
}

describe("lineupInteractionAdapter", () => {
  it("uses substitution flow for scheduled empty-node taps", () => {
    const onSubstitute = vi.fn();
    const onStarterLimitReached = vi.fn();
    const adapter = createLineupInteractionAdapter({
      gameStatus: "scheduled",
      startersCount: 2,
      maxStarters: 7,
      onSubstitute,
      onStarterLimitReached,
    });

    adapter.getEmptyNodeInteraction(makePosition("pos-1")).onTap();
    expect(onSubstitute).toHaveBeenCalledWith(expect.objectContaining({ id: "pos-1" }));
    expect(onStarterLimitReached).not.toHaveBeenCalled();
  });

  it("prevents empty-node taps when at max starters", () => {
    const onSubstitute = vi.fn();
    const onStarterLimitReached = vi.fn();
    const adapter = createLineupInteractionAdapter({
      gameStatus: "halftime",
      startersCount: 7,
      maxStarters: 7,
      onSubstitute,
      onStarterLimitReached,
    });

    adapter.getEmptyNodeInteraction(makePosition("pos-2")).onTap();
    expect(onSubstitute).not.toHaveBeenCalled();
    expect(onStarterLimitReached).toHaveBeenCalledWith("Maximum 7 starters allowed");
  });

  it("keeps in-progress assigned taps routed to substitution flow", () => {
    const onSubstitute = vi.fn();
    const adapter = createLineupInteractionAdapter({
      gameStatus: "in-progress",
      startersCount: 7,
      maxStarters: 7,
      onSubstitute,
      onStarterLimitReached: vi.fn(),
    });

    adapter.getAssignedNodeInteraction(makePosition("pos-3")).onTap();
    expect(onSubstitute).toHaveBeenCalledWith(expect.objectContaining({ id: "pos-3" }));
  });

  it("sorts bench by play time then positional fit tie-break", () => {
    const players = [
      makePlayer("p1", 11, "pos-cm"),
      makePlayer("p2", 7, "pos-rb"),
      makePlayer("p3", 4, ""),
    ];

    const sorted = sortBenchPlayersByPriority({
      benchPlayers: players,
      currentPositionId: "pos-rb",
      getPlayTimeSeconds: () => 300,
    });

    expect(sorted.map((player) => player.id)).toEqual(["p2", "p3", "p1"]);
  });

  it("treats empty or missing preferred positions as not configured", () => {
    expect(playerHasPreferredPositions(makePlayer("p1", 1, ""))).toBe(false);
    expect(playerHasPreferredPositions(makePlayer("p2", 2, "   "))).toBe(false);
    expect(
      playerHasPreferredPositions({ preferredPositions: undefined } as Pick<PlayerWithRoster, "preferredPositions">),
    ).toBe(false);
    expect(
      playerHasPreferredPositions({ preferredPositions: null } as Pick<PlayerWithRoster, "preferredPositions">),
    ).toBe(false);
  });

  it("matches position only when configured preferred positions include the id", () => {
    const player = makePlayer("p1", 1, "pos-rb, pos-cm");
    expect(playerHasPreferredPositions(player)).toBe(true);
    expect(playerPreferredForPosition(player, "pos-rb")).toBe(true);
    expect(playerPreferredForPosition(player, "pos-gk")).toBe(false);
  });
});
