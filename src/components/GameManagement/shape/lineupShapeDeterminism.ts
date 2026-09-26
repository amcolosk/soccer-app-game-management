// This module is imported by BOTH the coach-authenticated GameManagement
// lineup shape editor/view (LineupShapeView.tsx, FormationVisualEditor.tsx)
// AND the public, unauthenticated Sideline Stat Tracker pitch view
// (src/components/FanMode/TrackerFieldLineup.tsx) -- it must therefore stay
// free of any runtime imports (types only), same posture as
// StatTrackerView.tsx's other dependencies. Do not import
// react-hot-toast/lineupInteractionAdapter/exportLineupShape/
// playTimeCalculations or anything else with side effects into this file.

export const LINEUP_SHAPE_LAYOUT_VERSION = "soccer-shape-v1" as const;

// Explicit structural interface, NOT `Pick<FormationPosition, ...>` -- Pick
// would still require the exact enum/required-field shape from the Amplify
// schema type, which doesn't match the Stat Tracker Lambda's plain-string/
// nullable `StatTrackerPosition` payload and would force an unsafe cast at
// that call site. `FormationPosition` remains structurally assignable to
// this interface, so existing coach-side call sites need no changes.
export interface LineupShapePositionInput {
  id: string;
  positionName?: string | null;
  abbreviation?: string | null;
  role?: string | null;
  sortOrder?: number | null;
  xPct?: number | null;
  yPct?: number | null;
}

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

function inferLane(position: Pick<LineupShapePositionInput, "role">): ShapeLane {
  switch (position.role) {
    case "GOALKEEPER": return "gk";
    case "FORWARD": return "fwd";
    case "MIDFIELDER": return "mid";
    case "DEFENDER": return "def";
    default:
      // Legacy positions saved before roles were required; default to the
      // defensive lane rather than blocking the presentational layout editor.
      return "def";
  }
}

function sortPositionsDeterministically(positions: LineupShapePositionInput[]): LineupShapePositionInput[] {
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

function hasPersistedLayout(position: LineupShapePositionInput): position is LineupShapePositionInput & { xPct: number; yPct: number } {
  return (
    typeof position.xPct === "number"
    && Number.isFinite(position.xPct)
    && typeof position.yPct === "number"
    && Number.isFinite(position.yPct)
  );
}

export function buildLineupShapeNodes(positions: LineupShapePositionInput[]): LineupShapeNode[] {
  const byLane = new Map<ShapeLane, LineupShapePositionInput[]>();
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
      const usePersisted = hasPersistedLayout(position);
      nodes.push({
        positionId: position.id,
        positionName: position.positionName ?? "Unknown",
        abbreviation: position.abbreviation ?? "",
        lane,
        laneIndex,
        slotIndex,
        xPct: usePersisted ? position.xPct : getLaneX(slotIndex, lanePositions.length),
        yPct: usePersisted ? position.yPct : LANE_Y[lane],
      });
    });
  });

  return nodes;
}

export function buildLineupShapeGoldenSnapshot(positions: LineupShapePositionInput[]): {
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
