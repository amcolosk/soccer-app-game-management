import { describe, expect, it } from "vitest";
import goldenSnapshot from "./__fixtures__/lineup-shape-golden-v1.json";
import {
  buildLineupShapeGoldenSnapshot,
  LINEUP_SHAPE_LAYOUT_VERSION,
  type LineupShapeNode,
} from "./lineupShapeDeterminism";
import type { FormationPosition } from "../types";

function pos(id: string, positionName: string, abbreviation: string, sortOrder: number): FormationPosition {
  return {
    id,
    positionName,
    abbreviation,
    sortOrder,
  } as unknown as FormationPosition;
}

describe("lineupShapeDeterminism", () => {
  const positions: FormationPosition[] = [
    pos("pos-st", "Striker", "ST", 3),
    pos("pos-gk", "Goalkeeper", "GK", 0),
    pos("pos-cb", "Center Back", "CB", 1),
    pos("pos-lb", "Left Back", "LB", 2),
    pos("pos-rb", "Right Back", "RB", 4),
    pos("pos-cm", "Center Mid", "CM", 5),
    pos("pos-am", "Attacking Mid", "AM", 6),
    pos("pos-lw", "Left Wing", "LW", 7),
    pos("pos-rw", "Right Wing", "RW", 8),
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
});
