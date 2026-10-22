export const MAX_LINEUP_TEMPLATES = 10;
export const MAX_TEMPLATE_NAME_LENGTH = 60;

export interface TemplateLineupEntry {
  playerId: string;
  positionId: string;
}

export interface LineupTemplate {
  id: string;
  name: string;
  formationId?: string;
  startingLineup: TemplateLineupEntry[];
  halftimeLineup?: TemplateLineupEntry[];
  savedAt: string;
  updatedAt: string;
}

export type LineupTemplateInput = Omit<LineupTemplate, "id" | "savedAt" | "updatedAt">;

export type SkippedReason = "player-not-on-roster" | "position-missing" | "duplicate-player";

export const SKIP_REASON_LABEL: Record<SkippedReason, string> = {
  "player-not-on-roster": "player is no longer on the roster",
  "position-missing": "position is no longer in the formation",
  "duplicate-player": "player was already placed in another position",
};

export interface SkippedSlot {
  half: "starting" | "halftime";
  positionId: string;
  playerId: string;
  reason: SkippedReason;
}

interface TemplateMapContext {
  rosterPlayerIds: ReadonlySet<string>;
  /** Current formation position IDs, in display order. */
  positionIds: readonly string[];
  teamFormationId?: string | null;
}

export interface TemplateMapResult {
  startingLineup: Map<string, string>;
  /** Map<positionId, playerId>; "" is an explicit clear. Null when the template has no halftime lineup. */
  halftimeLineup: Map<string, string> | null;
  skipped: SkippedSlot[];
  formationMismatch: boolean;
  nothingApplicable: boolean;
}

function isEntryArray(value: unknown): value is TemplateLineupEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (e) =>
        e !== null &&
        typeof e === "object" &&
        typeof (e as TemplateLineupEntry).positionId === "string" &&
        typeof (e as TemplateLineupEntry).playerId === "string"
    )
  );
}

function isTemplate(value: unknown): value is LineupTemplate {
  if (value === null || typeof value !== "object") return false;
  const t = value as Partial<LineupTemplate>;
  return (
    typeof t.id === "string" &&
    typeof t.name === "string" &&
    isEntryArray(t.startingLineup) &&
    (t.halftimeLineup === undefined || isEntryArray(t.halftimeLineup)) &&
    (t.formationId === undefined || typeof t.formationId === "string")
  );
}

/** Parses Team.lineupTemplates. Throws on malformed JSON or a non-array value so callers never write over data they could not read. */
export function parseLineupTemplates(raw: unknown): LineupTemplate[] {
  if (raw === null || raw === undefined || raw === "") return [];
  const value = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (!Array.isArray(value)) {
    throw new Error("Saved templates are in an unexpected format.");
  }
  if (!value.every(isTemplate)) {
    throw new Error("Saved templates are in an unexpected format.");
  }
  return value;
}

/** Display-path variant: still throws on unparseable JSON or a non-array value, but drops individual malformed entries so one bad entry cannot hide the rest. Never use it for a write. */
export function parseLineupTemplatesLenient(raw: unknown): LineupTemplate[] {
  if (raw === null || raw === undefined || raw === "") return [];
  const value = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (!Array.isArray(value)) {
    throw new Error("Saved templates are in an unexpected format.");
  }
  return value.filter(isTemplate);
}

export function serializeLineupTemplates(templates: LineupTemplate[]): string {
  return JSON.stringify(templates);
}

export function normalizeTemplateName(name: string): string {
  return name.trim().slice(0, MAX_TEMPLATE_NAME_LENGTH);
}

/**
 * Builds a template from the planner's persisted lineups.
 * `effectiveHalftimeLineup` is the lineup the coach sees at halftime (end of first half merged with
 * overrides), not the stored overrides; every formation position is recorded, "" for an empty slot.
 */
export function serializePlanToTemplate(args: {
  name: string;
  formationId?: string | null;
  startingLineup: ReadonlyMap<string, string>;
  effectiveHalftimeLineup: ReadonlyMap<string, string> | null;
  positionIds: readonly string[];
}): LineupTemplateInput {
  const startingLineup: TemplateLineupEntry[] = [];
  for (const positionId of args.positionIds) {
    const playerId = args.startingLineup.get(positionId);
    if (playerId) startingLineup.push({ playerId, positionId });
  }

  const input: LineupTemplateInput = {
    name: normalizeTemplateName(args.name),
    startingLineup,
  };
  if (args.formationId) input.formationId = args.formationId;
  if (args.effectiveHalftimeLineup) {
    input.halftimeLineup = args.positionIds.map((positionId) => ({
      positionId,
      playerId: args.effectiveHalftimeLineup!.get(positionId) ?? "",
    }));
  }
  return input;
}

/** Maps a template onto the team's current roster and formation, reporting every slot it could not apply. */
export function mapTemplateToTeam(template: LineupTemplate, ctx: TemplateMapContext): TemplateMapResult {
  const validPositions = new Set(ctx.positionIds);
  const skipped: SkippedSlot[] = [];

  const hasMatchingPosition = [...template.startingLineup, ...(template.halftimeLineup ?? [])].some((e) =>
    validPositions.has(e.positionId)
  );
  const formationMismatch =
    template.formationId && ctx.teamFormationId
      ? template.formationId !== ctx.teamFormationId
      : !hasMatchingPosition;

  const orderIndex = new Map(ctx.positionIds.map((id, i) => [id, i]));
  const byPositionOrder = (a: TemplateLineupEntry, b: TemplateLineupEntry) =>
    (orderIndex.get(a.positionId) ?? Number.MAX_SAFE_INTEGER) -
    (orderIndex.get(b.positionId) ?? Number.MAX_SAFE_INTEGER);

  const startingLineup = new Map<string, string>();
  const usedInStarting = new Set<string>();
  for (const entry of [...template.startingLineup].sort(byPositionOrder)) {
    if (!validPositions.has(entry.positionId)) {
      skipped.push({ half: "starting", ...entry, reason: "position-missing" });
    } else if (!ctx.rosterPlayerIds.has(entry.playerId)) {
      skipped.push({ half: "starting", ...entry, reason: "player-not-on-roster" });
    } else if (usedInStarting.has(entry.playerId)) {
      skipped.push({ half: "starting", ...entry, reason: "duplicate-player" });
    } else {
      startingLineup.set(entry.positionId, entry.playerId);
      usedInStarting.add(entry.playerId);
    }
  }

  let halftimeLineup: Map<string, string> | null = null;
  if (template.halftimeLineup) {
    halftimeLineup = new Map();
    const usedInHalftime = new Set<string>();
    for (const entry of [...template.halftimeLineup].sort(byPositionOrder)) {
      if (!validPositions.has(entry.positionId)) {
        skipped.push({ half: "halftime", ...entry, reason: "position-missing" });
      } else if (entry.playerId === "") {
        halftimeLineup.set(entry.positionId, "");
      } else if (!ctx.rosterPlayerIds.has(entry.playerId)) {
        halftimeLineup.set(entry.positionId, "");
        skipped.push({ half: "halftime", ...entry, reason: "player-not-on-roster" });
      } else if (usedInHalftime.has(entry.playerId)) {
        halftimeLineup.set(entry.positionId, "");
        skipped.push({ half: "halftime", ...entry, reason: "duplicate-player" });
      } else {
        halftimeLineup.set(entry.positionId, entry.playerId);
        usedInHalftime.add(entry.playerId);
      }
    }
  }

  return {
    startingLineup,
    halftimeLineup,
    skipped,
    formationMismatch,
    nothingApplicable: startingLineup.size === 0,
  };
}
