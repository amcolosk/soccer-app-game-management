export interface RotationPlanColumn {
  /** Human-readable label for this column, e.g. "Start", "R1 8'", "HT", "R3 36'". */
  label: string;
  /** Lineup at this point in the game: positionId → playerId. */
  lineup: Map<string, string>;
}

export interface ExportRotationPlanParams {
  /** Stem for the downloaded filename (no extension). */
  fileStem: string;
  /** Ordered list of positions to emit as rows. */
  positions: Array<{ id: string; positionName: string }>;
  /** Ordered columns: Start, H1 rotations, HT, H2 rotations. */
  columns: RotationPlanColumn[];
  /** Projected play-time summary rows (one per player). */
  playTimeRows: Array<{ playerName: string; totalMinutes: number }>;
  /** Maps playerId → display name for resolving cell values. */
  playersById: Map<string, string>;
  /** ISO timestamp override (useful for deterministic tests). */
  exportedAtIso?: string;
}

/**
 * Wraps a CSV field with double-quotes when the value contains a comma,
 * double-quote, or newline character. Internal double-quotes are escaped
 * by doubling them (RFC 4180).
 */
export function csvEscapeField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Builds a UTF-8 CSV string (without BOM) from the rotation plan params.
 *
 * Layout:
 *   Row 1      – header: "Position", [column labels …]
 *   Rows 2-N   – one row per position
 *   Blank row  – visual separator
 *   Section    – "Projected Play Time"
 *   Header     – "Player", "Minutes"
 *   Rows       – one row per player
 */
export function buildRotationPlanCsv(params: ExportRotationPlanParams): string {
  const { positions, columns, playTimeRows, playersById } = params;
  const lines: string[] = [];

  // Header row
  const headerFields = ["Position", ...columns.map((c) => c.label)];
  lines.push(headerFields.map(csvEscapeField).join(","));

  // One row per position
  for (const position of positions) {
    const posName = position.positionName || position.id;
    const playerCells = columns.map((col) => {
      const playerId = col.lineup.get(position.id) ?? "";
      if (!playerId) return "";
      return playersById.get(playerId) ?? playerId;
    });
    lines.push([posName, ...playerCells].map(csvEscapeField).join(","));
  }

  // Blank separator
  lines.push("");

  // Projected play time section
  lines.push(csvEscapeField("Projected Play Time"));
  lines.push(["Player", "Minutes"].map(csvEscapeField).join(","));
  for (const row of playTimeRows) {
    lines.push(
      [csvEscapeField(row.playerName), csvEscapeField(String(row.totalMinutes))].join(",")
    );
  }

  return lines.join("\n");
}

/**
 * Serialises the rotation plan to CSV and triggers a browser download.
 * Uses the Blob + anchor pattern (same as exportLineupShape) with no network
 * requests and no new runtime dependencies.
 *
 * Returns the generated filename so callers can surface it if needed.
 */
export function exportRotationPlanLocally(
  params: ExportRotationPlanParams
): { filename: string } {
  const csv = buildRotationPlanCsv(params);
  // Prepend UTF-8 BOM so Excel opens the file with correct encoding.
  const bom = "\uFEFF";
  const filename = `${params.fileStem}.rotation-plan.csv`;
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
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
