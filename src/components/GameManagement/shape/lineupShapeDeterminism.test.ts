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

  it("maps 3-2-3 positions into expected lanes", () => {
    const shape323: FormationPosition[] = [
      pos("p-gk", "Goalkeeper", "GK", 0),
      pos("p-ld", "Left Defender", "LD", 1),
      pos("p-cd", "Center Defender", "CD", 2),
      pos("p-rd", "Right Defender", "RD", 3),
      pos("p-ldm", "Left Defensive Mid", "LDM", 4),
      pos("p-rdm", "Right Defensive Mid", "RDM", 5),
      pos("p-lf", "Left Forward", "LF", 6),
      pos("p-cf", "Center Forward", "CF", 7),
      pos("p-rf", "Right Forward", "RF", 8),
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

  it("maps team-specific abbreviations to expected lanes", () => {
    const teamAbbreviations: FormationPosition[] = [
      pos("a-gol", "Position", "GOL", 0),
      pos("a-cb", "Position", "CB", 1),
      pos("a-ld", "Position", "LD", 2),
      pos("a-rd", "Position", "RD", 3),
      pos("a-dm", "Position", "DM", 4),
      pos("a-om", "Position", "OM", 5),
      pos("a-lw", "Position", "LW", 6),
      pos("a-rw", "Position", "RW", 7),
      pos("a-str", "Position", "STR", 8),
    ];

    const snapshot = buildLineupShapeGoldenSnapshot(teamAbbreviations);
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
});
