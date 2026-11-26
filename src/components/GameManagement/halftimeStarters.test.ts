import { describe, it, expect } from "vitest";
import { resolveSecondHalfStarters } from "./halftimeStarters";
import type { FormationPosition, LineupAssignment } from "./types";

const pos1 = { id: "pos1", positionName: "Goalkeeper", abbreviation: "GK" } as unknown as FormationPosition;
const pos2 = { id: "pos2", positionName: "Defender", abbreviation: "DEF" } as unknown as FormationPosition;
const positions = [pos1, pos2];

function makeAssignment(overrides: Partial<LineupAssignment>): LineupAssignment {
  return {
    id: "la-1",
    gameId: "game-1",
    playerId: "p1",
    positionId: "pos1",
    isStarter: true,
    ...overrides,
  } as unknown as LineupAssignment;
}

describe("resolveSecondHalfStarters", () => {
  it("resolves a normal, fully-filled lineup with no anomalies", () => {
    const lineup = [
      makeAssignment({ id: "la-1", playerId: "p1", positionId: "pos1" }),
      makeAssignment({ id: "la-2", playerId: "p2", positionId: "pos2" }),
    ];

    const result = resolveSecondHalfStarters({
      lineup,
      positions,
      pendingRemovalIds: new Set(),
      maxPlayersOnField: 2,
    });

    expect(result.starters).toEqual([
      { playerId: "p1", positionId: "pos1" },
      { playerId: "p2", positionId: "pos2" },
    ]);
    expect(result.expectedCount).toBe(2);
    expect(result.emptyPositionIds).toEqual([]);
  });

  it("flags an empty position", () => {
    const lineup = [
      makeAssignment({ id: "la-1", playerId: "p1", positionId: "pos1" }),
    ];

    const result = resolveSecondHalfStarters({
      lineup,
      positions,
      pendingRemovalIds: new Set(),
      maxPlayersOnField: 2,
    });

    expect(result.starters).toHaveLength(1);
    expect(result.expectedCount).toBe(2);
    expect(result.emptyPositionIds).toEqual(["pos2"]);
  });

  it("reports an under-count when fewer starters than maxPlayersOnField are assigned", () => {
    const lineup = [
      makeAssignment({ id: "la-1", playerId: "p1", positionId: "pos1" }),
    ];

    const result = resolveSecondHalfStarters({
      lineup,
      positions,
      pendingRemovalIds: new Set(),
      maxPlayersOnField: 2,
    });

    expect(result.starters.length).toBeLessThan(result.expectedCount);
  });

  it("excludes ids in pendingRemovalIds from both starters and emptyPositionIds resolution", () => {
    const lineup = [
      makeAssignment({ id: "la-1", playerId: "p1", positionId: "pos1" }),
      makeAssignment({ id: "la-2", playerId: "p2", positionId: "pos2" }),
    ];

    const result = resolveSecondHalfStarters({
      lineup,
      positions,
      pendingRemovalIds: new Set(["la-1"]),
      maxPlayersOnField: 2,
    });

    expect(result.starters).toEqual([{ playerId: "p2", positionId: "pos2" }]);
    expect(result.emptyPositionIds).toEqual(["pos1"]);
    expect(result.expectedCount).toBe(2);
  });

  it("falls back expectedCount to the resolved starter count when maxPlayersOnField is nullish", () => {
    const lineup = [
      makeAssignment({ id: "la-1", playerId: "p1", positionId: "pos1" }),
    ];

    const result = resolveSecondHalfStarters({
      lineup,
      positions,
      pendingRemovalIds: new Set(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      maxPlayersOnField: undefined as any,
    });

    expect(result.expectedCount).toBe(1);
  });
});
