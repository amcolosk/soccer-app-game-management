import type { LineupShapeNode } from "./lineupShapeDeterminism";
import type { LineupAssignment, PlayerWithRoster } from "../types";

export interface ExportBenchPlayer {
  playerId: string;
  playerNumber: number | null;
  name: string;
  playTimeSeconds: number;
}

export interface ExportLineupShapeParams {
  fileStem: string;
  layoutVersion: string;
  nodes: LineupShapeNode[];
  lineup: LineupAssignment[];
  playersById: Map<string, PlayerWithRoster>;
  benchStrip: ExportBenchPlayer[];
  exportedAtIso?: string;
}

interface ExportPayload {
  meta: {
    exportedAt: string;
    localOnly: true;
    offlineFirst: true;
    layoutVersion: string;
  };
  nodes: Array<{
    positionId: string;
    positionName: string;
    abbreviation: string;
    lane: string;
    xPct: number;
    yPct: number;
    assignment: {
      playerId: string;
      playerNumber: number | null;
      name: string;
    } | null;
  }>;
  benchStrip: ExportBenchPlayer[];
}

function buildPayload(params: ExportLineupShapeParams): ExportPayload {
  const exportedAt = params.exportedAtIso ?? new Date().toISOString();
  const lineupByPosition = new Map<string, LineupAssignment>();
  for (const assignment of params.lineup) {
    if (assignment.isStarter && assignment.positionId) {
      lineupByPosition.set(assignment.positionId, assignment);
    }
  }

  return {
    meta: {
      exportedAt,
      localOnly: true,
      offlineFirst: true,
      layoutVersion: params.layoutVersion,
    },
    nodes: params.nodes.map((node) => {
      const assignment = lineupByPosition.get(node.positionId);
      const player = assignment?.playerId ? params.playersById.get(assignment.playerId) : undefined;
      return {
        positionId: node.positionId,
        positionName: node.positionName,
        abbreviation: node.abbreviation,
        lane: node.lane,
        xPct: node.xPct,
        yPct: node.yPct,
        assignment: assignment?.playerId
          ? {
              playerId: assignment.playerId,
              playerNumber: player?.playerNumber ?? null,
              name: player ? `${player.firstName} ${player.lastName}`.trim() : "Unknown player",
            }
          : null,
      };
    }),
    benchStrip: params.benchStrip,
  };
}

export function exportLineupShapeLocally(params: ExportLineupShapeParams): { filename: string } {
  const payload = buildPayload(params);
  const filename = `${params.fileStem}.lineup-shape.json`;
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.click();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  return { filename };
}
