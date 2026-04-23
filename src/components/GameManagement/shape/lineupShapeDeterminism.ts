import type { FormationPosition } from "../types";

export const LINEUP_SHAPE_LAYOUT_VERSION = "soccer-shape-v1" as const;

type ShapeLane = "gk" | "def" | "mid" | "fwd";

export interface LineupShapeNode {
  positionId: string;
  positionName: string;
  abbreviation: string;
  lane: ShapeLane;
  laneIndex: number;
  slotIndex: number;
  xPct: number;
  yPct: number;
}

const LANE_ORDER: ShapeLane[] = ["fwd", "mid", "def", "gk"];
const LANE_Y: Record<ShapeLane, number> = {
  // Orientation is intentionally fixed for soccer: forwards toward top, GK at bottom.
  fwd: 17,
  mid: 40,
  def: 63,
  gk: 86,
};

function inferLane(position: Pick<FormationPosition, "positionName" | "abbreviation">): ShapeLane {
  const raw = `${position.positionName ?? ""} ${position.abbreviation ?? ""}`.trim().toUpperCase();
  if (/(^|\W)(GK|GOL|GOAL|GOALKEEPER)(\W|$)/.test(raw)) {
    return "gk";
  }
  if (/(^|\W)(F|FW|ST|STR|STRIKER|ATT|ATTACK|WING|WINGER|FORWARD|LF|CF|RF|LW|RW)(\W|$)/.test(raw)) {
    return "fwd";
  }
  if (/(^|\W)(M|MF|MID|CM|DM|AM|OM)(\W|$)/.test(raw)) {
    return "mid";
  }
  return "def";
}

function sortPositionsDeterministically(positions: FormationPosition[]): FormationPosition[] {
  return [...positions].sort((a, b) => {
    const aSort = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const bSort = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (aSort !== bSort) return aSort - bSort;

    const aAbbr = (a.abbreviation ?? "").trim().toUpperCase();
    const bAbbr = (b.abbreviation ?? "").trim().toUpperCase();
    const abbrCmp = aAbbr.localeCompare(bAbbr);
    if (abbrCmp !== 0) return abbrCmp;

    const aName = (a.positionName ?? "").trim().toUpperCase();
    const bName = (b.positionName ?? "").trim().toUpperCase();
    const nameCmp = aName.localeCompare(bName);
    if (nameCmp !== 0) return nameCmp;

    return String(a.id).localeCompare(String(b.id));
  });
}

function getLaneX(index: number, laneSize: number): number {
  if (laneSize <= 1) return 50;
  const left = 12;
  const right = 88;
  const step = (right - left) / (laneSize - 1);
  return Number((left + (index * step)).toFixed(2));
}

export function buildLineupShapeNodes(positions: FormationPosition[]): LineupShapeNode[] {
  const byLane = new Map<ShapeLane, FormationPosition[]>();
  for (const lane of LANE_ORDER) {
    byLane.set(lane, []);
  }

  for (const position of sortPositionsDeterministically(positions)) {
    const lane = inferLane(position);
    byLane.get(lane)?.push(position);
  }

  const nodes: LineupShapeNode[] = [];
  LANE_ORDER.forEach((lane, laneIndex) => {
    const lanePositions = byLane.get(lane) ?? [];
    lanePositions.forEach((position, slotIndex) => {
      nodes.push({
        positionId: position.id,
        positionName: position.positionName ?? "Unknown",
        abbreviation: position.abbreviation ?? "",
        lane,
        laneIndex,
        slotIndex,
        xPct: getLaneX(slotIndex, lanePositions.length),
        yPct: LANE_Y[lane],
      });
    });
  });

  return nodes;
}

export function buildLineupShapeGoldenSnapshot(positions: FormationPosition[]): {
  version: typeof LINEUP_SHAPE_LAYOUT_VERSION;
  nodes: Array<Pick<LineupShapeNode, "positionId" | "lane" | "slotIndex" | "xPct" | "yPct">>;
} {
  const nodes = buildLineupShapeNodes(positions).map((node) => ({
    positionId: node.positionId,
    lane: node.lane,
    slotIndex: node.slotIndex,
    xPct: node.xPct,
    yPct: node.yPct,
  }));

  return {
    version: LINEUP_SHAPE_LAYOUT_VERSION,
    nodes,
  };
}
