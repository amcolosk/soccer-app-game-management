import { describe, expect, it } from "vitest";
import {
  applyRotationEditWithSameHalfCascade,
  computeLineupAtRotation,
  computeLineupDiff,
} from "./gamePlannerUtils";

describe("gamePlannerUtils.applyRotationEditWithSameHalfCascade", () => {
  it("cascades edits only within the same half", () => {
    const startingLineup = new Map<string, string>([
      ["pos-1", "p1"],
      ["pos-2", "p2"],
    ]);

    const rotations = [
      {
        id: "r1",
        rotationNumber: 1,
        half: 1,
        plannedSubstitutions: JSON.stringify([
          { playerOutId: "p1", playerInId: "p3", positionId: "pos-1" },
        ]),
      },
      {
        id: "r2",
        rotationNumber: 2,
        half: 1,
        plannedSubstitutions: JSON.stringify([
          { playerOutId: "p2", playerInId: "p4", positionId: "pos-2" },
        ]),
      },
      {
        id: "r3",
        rotationNumber: 3,
        half: 2,
        plannedSubstitutions: JSON.stringify([
          { playerOutId: "p3", playerInId: "p5", positionId: "pos-1" },
        ]),
      },
    ];

    const result = applyRotationEditWithSameHalfCascade(
      startingLineup,
      rotations,
      1,
      [{ playerOutId: "p1", playerInId: "p6", positionId: "pos-1" }]
    );

    expect(result.changedRotationNumbers).toEqual([1, 2]);

    const r1 = result.rotations.find((rotation) => rotation.rotationNumber === 1);
    const r2 = result.rotations.find((rotation) => rotation.rotationNumber === 2);
    const r3 = result.rotations.find((rotation) => rotation.rotationNumber === 3);

    expect(JSON.parse(r1?.plannedSubstitutions ?? "[]")).toEqual([
      { playerOutId: "p1", playerInId: "p6", positionId: "pos-1" },
    ]);
    expect(JSON.parse(r2?.plannedSubstitutions ?? "[]")).toEqual([
      { playerOutId: "p2", playerInId: "p4", positionId: "pos-2" },
    ]);
    expect(JSON.parse(r3?.plannedSubstitutions ?? "[]")).toEqual([
      { playerOutId: "p3", playerInId: "p5", positionId: "pos-1" },
    ]);
  });

  it("rebinds downstream playerOut values using the updated lineup", () => {
    const startingLineup = new Map<string, string>([
      ["pos-1", "p1"],
      ["pos-2", "p2"],
    ]);

    const rotations = [
      {
        id: "r1",
        rotationNumber: 1,
        half: 1,
        plannedSubstitutions: JSON.stringify([
          { playerOutId: "p1", playerInId: "p3", positionId: "pos-1" },
        ]),
      },
      {
        id: "r2",
        rotationNumber: 2,
        half: 1,
        plannedSubstitutions: JSON.stringify([
          { playerOutId: "p3", playerInId: "p4", positionId: "pos-1" },
        ]),
      },
    ];

    const result = applyRotationEditWithSameHalfCascade(
      startingLineup,
      rotations,
      1,
      [{ playerOutId: "p1", playerInId: "p6", positionId: "pos-1" }]
    );

    const r2 = result.rotations.find((rotation) => rotation.rotationNumber === 2);
    expect(JSON.parse(r2?.plannedSubstitutions ?? "[]")).toEqual([
      { playerOutId: "p6", playerInId: "p4", positionId: "pos-1" },
    ]);
  });

  it("computeLineupDiff includes explicit clear operations for unassigned positions", () => {
    const previousLineup = new Map<string, string>([
      ["pos-1", "p1"],
      ["pos-2", "p2"],
    ]);
    const nextLineup = new Map<string, string>([
      ["pos-1", ""],
      ["pos-2", "p2"],
    ]);

    const subs = computeLineupDiff(previousLineup, nextLineup);

    expect(subs).toEqual([
      { playerOutId: "p1", playerInId: "", positionId: "pos-1" },
    ]);
  });

  it("computeLineupAtRotation applies clear substitutions by removing position assignments", () => {
    const startingLineup = new Map<string, string>([
      ["pos-1", "p1"],
      ["pos-2", "p2"],
    ]);

    const lineupAfterRotation = computeLineupAtRotation(
      startingLineup,
      [
        {
          rotationNumber: 1,
          plannedSubstitutions: JSON.stringify([
            { playerOutId: "p1", playerInId: "", positionId: "pos-1" },
          ]),
        },
      ],
      1
    );

    expect(lineupAfterRotation.has("pos-1")).toBe(false);
    expect(lineupAfterRotation.get("pos-2")).toBe("p2");
  });
});
