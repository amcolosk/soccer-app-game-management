import { beforeEach, describe, expect, it, vi } from "vitest";

const cleanup = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("./lineupCleanupService", () => ({ cleanupDuplicateAssignmentsForPosition: cleanup }));

import { findSendOffTarget, performSendOff } from "./sendOffService";

const lineup = [
  { id: "la-1", playerId: "p1", positionId: "cb", isStarter: true, createdAt: "2026-10-26T10:00:00Z" },
  { id: "la-2", playerId: "p2", positionId: "st", isStarter: true, createdAt: "2026-10-26T10:00:00Z" },
] as never[];
const records = [
  { id: "ptr-1", playerId: "p1", positionId: "cb", startGameSeconds: 0, endGameSeconds: null },
  { id: "ptr-0", playerId: "p1", positionId: "st", startGameSeconds: 0, endGameSeconds: 300 },
] as never[];

function makeMutations() {
  return {
    createGameNote: vi.fn().mockResolvedValue(undefined),
    updatePlayTimeRecord: vi.fn().mockResolvedValue(undefined),
    deleteLineupAssignment: vi.fn().mockResolvedValue(undefined),
  };
}

const base = { game: { id: "g1" }, team: { coaches: ["c1"] }, gameSeconds: 600, half: 1, notes: "reckless tackle" };

describe("sendOffService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("finds the starter slot a player is vacating, and null for a bench player", () => {
    expect(findSendOffTarget("p1", lineup)?.positionId).toBe("cb");
    expect(findSendOffTarget("bench", lineup)).toBeNull();
  });

  it("records the card with the vacated position, closes only the open play-time record, and clears the slot", async () => {
    const mutations = makeMutations();
    const result = await performSendOff({ ...base, playerId: "p1", lineup, playTimeRecords: records, mutations });

    expect(mutations.createGameNote).toHaveBeenCalledWith(expect.objectContaining({
      gameId: "g1", noteType: "red-card", playerId: "p1", positionId: "cb", gameSeconds: 600, half: 1, coaches: ["c1"],
    }));
    expect(mutations.updatePlayTimeRecord).toHaveBeenCalledTimes(1);
    expect(mutations.updatePlayTimeRecord).toHaveBeenCalledWith("ptr-1", { endGameSeconds: 600 });
    expect(mutations.deleteLineupAssignment).toHaveBeenCalledWith("la-1");
    expect(cleanup).toHaveBeenCalledWith("g1", "cb", "2026-10-26T10:00:00Z");
    expect(result).toEqual({ vacateFailed: false });
  });

  it("writes the note before touching play time or the lineup", async () => {
    const order: string[] = [];
    const mutations = makeMutations();
    mutations.createGameNote.mockImplementation(async () => { order.push("note"); });
    mutations.updatePlayTimeRecord.mockImplementation(async () => { order.push("ptr"); });
    mutations.deleteLineupAssignment.mockImplementation(async () => { order.push("lineup"); });
    await performSendOff({ ...base, playerId: "p1", lineup, playTimeRecords: records, mutations });
    expect(order).toEqual(["note", "ptr", "lineup"]);
  });

  it("only logs the card for a bench player (no position, nothing to vacate)", async () => {
    const mutations = makeMutations();
    const result = await performSendOff({ ...base, playerId: "bench", lineup, playTimeRecords: records, mutations });
    expect(mutations.createGameNote).toHaveBeenCalledTimes(1);
    expect(mutations.createGameNote.mock.calls[0][0]).not.toHaveProperty("positionId");
    expect(mutations.updatePlayTimeRecord).not.toHaveBeenCalled();
    expect(mutations.deleteLineupAssignment).not.toHaveBeenCalled();
    expect(result).toEqual({ vacateFailed: false });
  });

  it("still closes play time and clears the slot at halftime when no record is open", async () => {
    const mutations = makeMutations();
    await performSendOff({ ...base, playerId: "p1", lineup, playTimeRecords: [], mutations });
    expect(mutations.updatePlayTimeRecord).not.toHaveBeenCalled();
    expect(mutations.deleteLineupAssignment).toHaveBeenCalledWith("la-1");
  });

  it("reports vacateFailed (card stays recorded) when clearing the lineup fails", async () => {
    const mutations = makeMutations();
    mutations.deleteLineupAssignment.mockRejectedValue(new Error("network down"));
    const result = await performSendOff({ ...base, playerId: "p1", lineup, playTimeRecords: records, mutations });
    expect(mutations.createGameNote).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ vacateFailed: true });
  });

  it("treats an already-deleted assignment as success", async () => {
    const mutations = makeMutations();
    mutations.deleteLineupAssignment.mockRejectedValue(new Error("Item not found"));
    const result = await performSendOff({ ...base, playerId: "p1", lineup, playTimeRecords: records, mutations });
    expect(result).toEqual({ vacateFailed: false });
  });

  it("does not touch play time or lineup when the card itself fails to save", async () => {
    const mutations = makeMutations();
    mutations.createGameNote.mockRejectedValue(new Error("denied"));
    await expect(performSendOff({ ...base, playerId: "p1", lineup, playTimeRecords: records, mutations })).rejects.toThrow("denied");
    expect(mutations.updatePlayTimeRecord).not.toHaveBeenCalled();
    expect(mutations.deleteLineupAssignment).not.toHaveBeenCalled();
  });
});
