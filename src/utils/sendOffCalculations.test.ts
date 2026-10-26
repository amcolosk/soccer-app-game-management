import { describe, expect, it } from "vitest";
import { getLockedPositionIds, getSentOffPlayerIds, isActiveSendOff, withPendingSendOffs } from "./sendOffCalculations";

const positions = [
  { id: "gk", role: "GOALKEEPER" as const },
  { id: "cb", role: "DEFENDER" as const },
  { id: "st", role: "FORWARD" as const },
];

const note = (overrides: Record<string, unknown> = {}) => ({
  noteType: "red-card",
  playerId: "p1",
  positionId: "cb",
  rescindedAt: null,
  ...overrides,
}) as never;

describe("sendOffCalculations", () => {
  it("treats only un-rescinded red cards with a player as send-offs", () => {
    expect(isActiveSendOff(note())).toBe(true);
    expect(isActiveSendOff(note({ rescindedAt: "2026-10-26T00:00:00Z" }))).toBe(false);
    expect(isActiveSendOff(note({ noteType: "yellow-card" }))).toBe(false);
    expect(isActiveSendOff(note({ playerId: null }))).toBe(false);
  });

  it("collects sent-off players, including bench players with no position", () => {
    const ids = getSentOffPlayerIds([note(), note({ playerId: "p2", positionId: null }), note({ playerId: "p3", rescindedAt: "x" })]);
    expect([...ids].sort()).toEqual(["p1", "p2"]);
  });

  it("locks the vacated position of each active send-off (multiple cards supported)", () => {
    const ids = getLockedPositionIds([note(), note({ playerId: "p2", positionId: "st" })], positions);
    expect([...ids].sort()).toEqual(["cb", "st"]);
  });

  it("does not lock a position whose send-off was rescinded", () => {
    expect(getLockedPositionIds([note({ rescindedAt: "x" })], positions).size).toBe(0);
  });

  it("re-locks a position after a rescind followed by a new card there", () => {
    const ids = getLockedPositionIds([note({ rescindedAt: "x" }), note({ playerId: "p9" })], positions);
    expect([...ids]).toEqual(["cb"]);
  });

  it("never locks a goalkeeper position", () => {
    expect(getLockedPositionIds([note({ positionId: "gk" })], positions).size).toBe(0);
  });

  it("applies a locally recorded send-off before its note has synced", () => {
    const merged = withPendingSendOffs([], [{ playerId: "p1", positionId: "cb" }]);
    expect([...getSentOffPlayerIds(merged)]).toEqual(["p1"]);
    expect([...getLockedPositionIds(merged, positions)]).toEqual(["cb"]);
  });

  it("stops applying the pending entry once any card note for that player has synced (including a rescinded one)", () => {
    const rescinded = note({ rescindedAt: "x" });
    const merged = withPendingSendOffs([rescinded], [{ playerId: "p1", positionId: "cb" }]);
    expect(getSentOffPlayerIds(merged).size).toBe(0);
    expect(getLockedPositionIds(merged, positions).size).toBe(0);
  });

  it("ignores red cards without a vacated position", () => {
    expect(getLockedPositionIds([note({ positionId: null })], positions).size).toBe(0);
  });
});
