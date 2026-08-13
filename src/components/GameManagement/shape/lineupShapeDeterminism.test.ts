import { describe, expect, it } from "vitest";
import goldenSnapshot from "./__fixtures__/lineup-shape-golden-v1.json";
import {
  buildLineupShapeGoldenSnapshot,
  LINEUP_SHAPE_LAYOUT_VERSION,
  type LineupShapeNode,
} from "./lineupShapeDeterminism";
import type { FormationPosition } from "../types";

function pos(id: string, positionName: string, abbreviation: string, sortOrder: number, role?: string): FormationPosition {
  return {
    id,
    positionName,
    abbreviation,
    sortOrder,
    role,
  } as unknown as FormationPosition;
}

describe("lineupShapeDeterminism", () => {
  const positions: FormationPosition[] = [
    pos("pos-st", "Striker", "ST", 3, "FORWARD"),
    pos("pos-gk", "Goalkeeper", "GK", 0, "GOALKEEPER"),
    pos("pos-cb", "Center Back", "CB", 1, "DEFENDER"),
    pos("pos-lb", "Left Back", "LB", 2, "DEFENDER"),
    pos("pos-rb", "Right Back", "RB", 4, "DEFENDER"),
    pos("pos-cm", "Center Mid", "CM", 5, "MIDFIELDER"),
    pos("pos-am", "Attacking Mid", "AM", 6, "MIDFIELDER"),
    pos("pos-lw", "Left Wing", "LW", 7, "FORWARD"),
    pos("pos-rw", "Right Wing", "RW", 8, "FORWARD"),
  ];

  it("uses a versioned soccer layout contract", () => {
    expect(LINEUP_SHAPE_LAYOUT_VERSION).toBe("soccer-shape-v1");
  });

  it("matches the v1 golden fixture for deterministic node placement", () => {
    const snapshot = buildLineupShapeGoldenSnapshot(positions);
    expect(snapshot).toEqual(goldenSnapshot);
  });

  it("keeps orientation fixed with GK deepest", () => {
    const snapshot = buildLineupShapeGoldenSnapshot(positions);
    const gk = snapshot.nodes.find((node) => node.positionId === "pos-gk") as LineupShapeNode;
    const striker = snapshot.nodes.find((node) => node.positionId === "pos-st") as LineupShapeNode;
    expect(gk.yPct).toBeGreaterThan(striker.yPct);
  });

  it("maps 3-2-3 positions into expected lanes", () => {
    const shape323: FormationPosition[] = [
      pos("p-gk", "Goalkeeper", "GK", 0, "GOALKEEPER"),
      pos("p-ld", "Left Defender", "LD", 1, "DEFENDER"),
      pos("p-cd", "Center Defender", "CD", 2, "DEFENDER"),
      pos("p-rd", "Right Defender", "RD", 3, "DEFENDER"),
      pos("p-ldm", "Left Defensive Mid", "LDM", 4, "MIDFIELDER"),
      pos("p-rdm", "Right Defensive Mid", "RDM", 5, "MIDFIELDER"),
      pos("p-lf", "Left Forward", "LF", 6, "FORWARD"),
      pos("p-cf", "Center Forward", "CF", 7, "FORWARD"),
      pos("p-rf", "Right Forward", "RF", 8, "FORWARD"),
    ];

    const snapshot = buildLineupShapeGoldenSnapshot(shape323);
    const laneByPositionId = Object.fromEntries(snapshot.nodes.map((node) => [node.positionId, node.lane]));

    expect(laneByPositionId["p-ld"]).toBe("def");
    expect(laneByPositionId["p-cd"]).toBe("def");
    expect(laneByPositionId["p-rd"]).toBe("def");
    expect(laneByPositionId["p-ldm"]).toBe("mid");
    expect(laneByPositionId["p-rdm"]).toBe("mid");
    expect(laneByPositionId["p-lf"]).toBe("fwd");
    expect(laneByPositionId["p-cf"]).toBe("fwd");
    expect(laneByPositionId["p-rf"]).toBe("fwd");
    expect(laneByPositionId["p-gk"]).toBe("gk");
  });

  it("maps positions with unrelated custom labels to expected lanes based on role, not abbreviation/name (regression)", () => {
    // These positionName/abbreviation values are intentionally unrelated to the lane
    // they should land in — only `role` should drive lane assignment.
    const customLabels: FormationPosition[] = [
      pos("a-gol", "The Wall", "W1", 0, "GOALKEEPER"),
      pos("a-cb", "Rock", "R1", 1, "DEFENDER"),
      pos("a-ld", "Anchor", "A1", 2, "DEFENDER"),
      pos("a-rd", "Anchor", "A2", 3, "DEFENDER"),
      pos("a-dm", "Engine", "E1", 4, "MIDFIELDER"),
      pos("a-om", "Playmaker", "P1", 5, "MIDFIELDER"),
      pos("a-lw", "Poacher", "PCH", 6, "FORWARD"),
      pos("a-rw", "Poacher", "PCH", 7, "FORWARD"),
      pos("a-str", "Sweeper", "SWP", 8, "FORWARD"), // unusual label, still FORWARD role
    ];

    const snapshot = buildLineupShapeGoldenSnapshot(customLabels);
    const laneByPositionId = Object.fromEntries(snapshot.nodes.map((node) => [node.positionId, node.lane]));

    expect(laneByPositionId["a-gol"]).toBe("gk");
    expect(laneByPositionId["a-cb"]).toBe("def");
    expect(laneByPositionId["a-ld"]).toBe("def");
    expect(laneByPositionId["a-rd"]).toBe("def");
    expect(laneByPositionId["a-dm"]).toBe("mid");
    expect(laneByPositionId["a-om"]).toBe("mid");
    expect(laneByPositionId["a-lw"]).toBe("fwd");
    expect(laneByPositionId["a-rw"]).toBe("fwd");
    expect(laneByPositionId["a-str"]).toBe("fwd");
  });

  it("defaults legacy positions with no role to the def lane (defensive fallback)", () => {
    const legacyPositions: FormationPosition[] = [
      pos("p-legacy1", "Goalkeeper", "GK", 0), // no role
      pos("p-legacy2", "Forward", "F", 1), // no role
    ];

    const snapshot = buildLineupShapeGoldenSnapshot(legacyPositions);
    const laneByPositionId = Object.fromEntries(snapshot.nodes.map((node) => [node.positionId, node.lane]));

    expect(laneByPositionId["p-legacy1"]).toBe("def");
    expect(laneByPositionId["p-legacy2"]).toBe("def");
  });

  it("honors persisted xPct/yPct coordinates when present", () => {
    const customLayout: FormationPosition[] = [
      { ...pos("p-gk", "Goalkeeper", "GK", 0, "GOALKEEPER"), xPct: 42, yPct: 91 } as unknown as FormationPosition,
      { ...pos("p-cm", "Center Mid", "CM", 1, "MIDFIELDER"), xPct: 60, yPct: 33 } as unknown as FormationPosition,
    ];

    const snapshot = buildLineupShapeGoldenSnapshot(customLayout);
    const nodeById = Object.fromEntries(snapshot.nodes.map((node) => [node.positionId, node]));

    expect(nodeById["p-gk"].xPct).toBe(42);
    expect(nodeById["p-gk"].yPct).toBe(91);
    expect(nodeById["p-cm"].xPct).toBe(60);
    expect(nodeById["p-cm"].yPct).toBe(33);
  });
});
