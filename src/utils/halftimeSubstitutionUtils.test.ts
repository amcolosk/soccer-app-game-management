import { describe, it, expect } from "vitest";
import { planHalftimeLineupChanges } from "./halftimeSubstitutionUtils";

const starter = (id: string, playerId: string, positionId: string) => ({ id, playerId, positionId, isStarter: true });

/** Applies the planned writes to a lineup, mimicking the DB. */
function applyChanges(
  lineup: ReturnType<typeof starter>[],
  changes: ReturnType<typeof planHalftimeLineupChanges>,
) {
  const deleted = new Set(changes.deleteAssignmentIds);
  return [
    ...lineup.filter((row) => !deleted.has(row.id)),
    ...changes.createAssignments.map((c, i) => starter(`new-${i}`, c.playerId, c.positionId)),
  ];
}

function expectOnePlayerPerPositionAndPositionPerPlayer(lineup: ReturnType<typeof starter>[]) {
  const players = lineup.map((row) => row.playerId);
  const positions = lineup.map((row) => row.positionId);
  expect(new Set(players).size).toBe(players.length);
  expect(new Set(positions).size).toBe(positions.length);
}

describe("planHalftimeLineupChanges", () => {
  it("replaces the occupant for a straight bench-for-starter sub", () => {
    const lineup = [starter("la-1", "A", "LB")];
    const changes = planHalftimeLineupChanges(lineup, [{ playerOutId: "A", playerInId: "C", positionId: "LB" }]);

    expect(changes.deleteAssignmentIds).toEqual(["la-1"]);
    expect(changes.createAssignments).toEqual([{ playerId: "C", positionId: "LB" }]);
    expect(changes.substitutions).toEqual([{ positionId: "LB", playerOutId: "A", playerInId: "C" }]);
  });

  it("vacates the old spot of a player who moves positions (single sub of a planned move)", () => {
    const lineup = [starter("la-a", "A", "LB"), starter("la-b", "B", "RB")];
    const changes = planHalftimeLineupChanges(lineup, [{ playerOutId: "B", playerInId: "A", positionId: "RB" }]);

    expect(changes.deleteAssignmentIds.sort()).toEqual(["la-a", "la-b"]);
    const after = applyChanges(lineup, changes);
    expect(after).toEqual([expect.objectContaining({ playerId: "A", positionId: "RB" })]);
  });

  it("resolves a position swap within one batch regardless of order", () => {
    const lineup = [starter("la-a", "A", "LB"), starter("la-b", "B", "RB")];
    const subs = [
      { playerOutId: "A", playerInId: "B", positionId: "LB" },
      { playerOutId: "B", playerInId: "A", positionId: "RB" },
    ];
    for (const ordered of [subs, [...subs].reverse()]) {
      const changes = planHalftimeLineupChanges(lineup, ordered);
      const after = applyChanges(lineup, changes);
      expectOnePlayerPerPositionAndPositionPerPlayer(after);
      expect(after).toHaveLength(2);
      expect(after).toEqual(expect.arrayContaining([
        expect.objectContaining({ playerId: "B", positionId: "LB" }),
        expect.objectContaining({ playerId: "A", positionId: "RB" }),
      ]));
      expect(changes.substitutions).toEqual(expect.arrayContaining([
        { positionId: "LB", playerOutId: "A", playerInId: "B" },
        { positionId: "RB", playerOutId: "B", playerInId: "A" },
      ]));
    }
  });

  it("handles a move plus a bench player filling the vacated spot", () => {
    const lineup = [starter("la-a", "A", "LB"), starter("la-b", "B", "RB")];
    const changes = planHalftimeLineupChanges(lineup, [
      { playerOutId: "B", playerInId: "A", positionId: "RB" },
      { playerOutId: "A", playerInId: "C", positionId: "LB" },
    ]);
    const after = applyChanges(lineup, changes);
    expectOnePlayerPerPositionAndPositionPerPlayer(after);
    expect(after).toEqual(expect.arrayContaining([
      expect.objectContaining({ playerId: "A", positionId: "RB" }),
      expect.objectContaining({ playerId: "C", positionId: "LB" }),
    ]));
  });

  it("fills a vacated position, recording the plan's outgoing player", () => {
    // A already moved LB -> RB in an earlier Apply.
    const changes = planHalftimeLineupChanges([starter("la-a", "A", "RB")], [
      { playerOutId: "A", playerInId: "C", positionId: "LB" },
    ]);
    expect(changes.deleteAssignmentIds).toEqual([]);
    expect(changes.createAssignments).toEqual([{ playerId: "C", positionId: "LB" }]);
    expect(changes.substitutions).toEqual([{ positionId: "LB", playerOutId: "A", playerInId: "C" }]);
    expect(changes.vacatedPositionIds).toEqual([]);
  });

  it("reports the position a move leaves empty", () => {
    const changes = planHalftimeLineupChanges([starter("la-a", "A", "LB"), starter("la-b", "B", "RB")], [
      { playerOutId: "B", playerInId: "A", positionId: "RB" },
    ]);
    expect(changes.vacatedPositionIds).toEqual(["LB"]);
  });

  it("resolves a three-way rotation of positions", () => {
    const lineup = [starter("la-a", "A", "LB"), starter("la-b", "B", "RB"), starter("la-c", "C", "CB")];
    const changes = planHalftimeLineupChanges(lineup, [
      { playerOutId: "B", playerInId: "A", positionId: "RB" },
      { playerOutId: "C", playerInId: "B", positionId: "CB" },
      { playerOutId: "A", playerInId: "C", positionId: "LB" },
    ]);
    const after = applyChanges(lineup, changes);
    expectOnePlayerPerPositionAndPositionPerPlayer(after);
    expect(after.map((row) => `${row.positionId}:${row.playerId}`).sort()).toEqual(["CB:B", "LB:C", "RB:A"]);
    expect(changes.vacatedPositionIds).toEqual([]);
  });

  it("is a no-op for subs already applied", () => {
    const changes = planHalftimeLineupChanges([starter("la-1", "C", "LB")], [
      { playerOutId: "A", playerInId: "C", positionId: "LB" },
    ]);
    expect(changes).toEqual({
      deleteAssignmentIds: [], createAssignments: [], substitutions: [], skipped: [], vacatedPositionIds: [],
    });
  });

  it("an already-applied sub still claims its player, so a conflicting later sub is skipped", () => {
    const lineup = [starter("la-a", "A", "RB"), starter("la-b", "B", "LB")];
    const conflicting = { playerOutId: "B", playerInId: "A", positionId: "LB" };
    const changes = planHalftimeLineupChanges(lineup, [
      { playerOutId: "X", playerInId: "A", positionId: "RB" },
      conflicting,
    ]);
    expect(changes.skipped).toEqual([conflicting]);
    expect(changes.deleteAssignmentIds).toEqual([]);
  });

  it("skips a second sub into a position already filled in this batch", () => {
    const lineup = [starter("la-1", "A", "LB")];
    const second = { playerOutId: "A", playerInId: "D", positionId: "LB" };
    const changes = planHalftimeLineupChanges(lineup, [{ playerOutId: "A", playerInId: "C", positionId: "LB" }, second]);
    expect(changes.skipped).toEqual([second]);
    expectOnePlayerPerPositionAndPositionPerPlayer(applyChanges(lineup, changes));
  });

  it("skips placing the same incoming player twice in one batch", () => {
    const lineup = [starter("la-1", "A", "LB"), starter("la-2", "B", "RB")];
    const second = { playerOutId: "B", playerInId: "C", positionId: "RB" };
    const changes = planHalftimeLineupChanges(lineup, [{ playerOutId: "A", playerInId: "C", positionId: "LB" }, second]);
    expect(changes.skipped).toEqual([second]);
    expectOnePlayerPerPositionAndPositionPerPlayer(applyChanges(lineup, changes));
  });

  it("an already-applied sub clears a stale duplicate of that player elsewhere", () => {
    const lineup = [starter("la-a1", "A", "RB"), starter("la-a2", "A", "CB")];
    const changes = planHalftimeLineupChanges(lineup, [{ playerOutId: "B", playerInId: "A", positionId: "RB" }]);
    expect(changes.deleteAssignmentIds).toEqual(["la-a2"]);
    expect(changes.createAssignments).toEqual([]);
  });

  it("clears a pre-existing duplicate of the incoming player", () => {
    const lineup = [starter("la-a1", "A", "LB"), starter("la-a2", "A", "CB"), starter("la-b", "B", "RB")];
    const changes = planHalftimeLineupChanges(lineup, [{ playerOutId: "B", playerInId: "A", positionId: "RB" }]);
    expect(applyChanges(lineup, changes)).toEqual([expect.objectContaining({ playerId: "A", positionId: "RB" })]);
  });
});
