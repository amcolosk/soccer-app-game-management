import { describe, expect, it } from "vitest";
import {
  mapTemplateToTeam,
  normalizeTemplateName,
  parseLineupTemplates,
  parseLineupTemplatesLenient,
  serializeLineupTemplates,
  serializePlanToTemplate,
  type LineupTemplate,
} from "./planTemplateUtils";
import { mergeHalftimeLineup } from "./halftimeProjectionUtils";
import { computeLineupAtRotation } from "./gamePlannerUtils";

const POSITIONS = ["gk", "lb", "rb", "st"];

function template(overrides: Partial<LineupTemplate> = {}): LineupTemplate {
  return {
    id: "t1",
    name: "Standard",
    formationId: "f1",
    startingLineup: [
      { positionId: "gk", playerId: "p1" },
      { positionId: "lb", playerId: "p2" },
      { positionId: "st", playerId: "p3" },
    ],
    halftimeLineup: [
      { positionId: "gk", playerId: "p1" },
      { positionId: "lb", playerId: "p4" },
      { positionId: "rb", playerId: "" },
      { positionId: "st", playerId: "p3" },
    ],
    savedAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    ...overrides,
  };
}

const ctx = {
  rosterPlayerIds: new Set(["p1", "p2", "p3", "p4"]),
  positionIds: POSITIONS,
  teamFormationId: "f1",
};

describe("serializePlanToTemplate", () => {
  it("records the full effective halftime lineup, including players rotated in during the first half", () => {
    const starting = new Map([["gk", "p1"], ["lb", "p2"], ["st", "p3"]]);
    const h1Rotations = [
      { rotationNumber: 1, plannedSubstitutions: JSON.stringify([{ playerOutId: "p2", playerInId: "p4", positionId: "lb" }]) },
    ];
    const endOfH1 = computeLineupAtRotation(starting, h1Rotations, 1);
    const effective = mergeHalftimeLineup(endOfH1, new Map([["gk", "p5"]]));

    const result = serializePlanToTemplate({
      name: " Standard ",
      formationId: "f1",
      startingLineup: starting,
      effectiveHalftimeLineup: effective,
      positionIds: POSITIONS,
    });

    expect(result.name).toBe("Standard");
    expect(result.startingLineup).toEqual([
      { positionId: "gk", playerId: "p1" },
      { positionId: "lb", playerId: "p2" },
      { positionId: "st", playerId: "p3" },
    ]);
    expect(result.halftimeLineup).toEqual([
      { positionId: "gk", playerId: "p5" },
      { positionId: "lb", playerId: "p4" },
      { positionId: "rb", playerId: "" },
      { positionId: "st", playerId: "p3" },
    ]);
  });

  it("omits unassigned starting slots and the halftime lineup when none is supplied", () => {
    const result = serializePlanToTemplate({
      name: "Partial",
      startingLineup: new Map([["gk", "p1"]]),
      effectiveHalftimeLineup: null,
      positionIds: POSITIONS,
    });
    expect(result.startingLineup).toEqual([{ positionId: "gk", playerId: "p1" }]);
    expect(result.halftimeLineup).toBeUndefined();
    expect(result.formationId).toBeUndefined();
  });
});

describe("mapTemplateToTeam", () => {
  it("applies a clean template without skipping anything", () => {
    const result = mapTemplateToTeam(template(), ctx);
    expect(result.skipped).toEqual([]);
    expect(result.formationMismatch).toBe(false);
    expect(result.nothingApplicable).toBe(false);
    expect([...result.startingLineup.entries()]).toEqual([["gk", "p1"], ["lb", "p2"], ["st", "p3"]]);
    expect(result.halftimeLineup?.get("rb")).toBe("");
    expect(result.halftimeLineup?.get("lb")).toBe("p4");
  });

  it("leaves a slot empty and reports it when the player is no longer on the roster", () => {
    const result = mapTemplateToTeam(template(), { ...ctx, rosterPlayerIds: new Set(["p1", "p3", "p4"]) });
    expect(result.startingLineup.has("lb")).toBe(false);
    expect(result.skipped).toContainEqual({
      half: "starting",
      positionId: "lb",
      playerId: "p2",
      reason: "player-not-on-roster",
    });
  });

  it("clears the halftime slot of a removed player so the starter is not inherited", () => {
    const result = mapTemplateToTeam(template(), { ...ctx, rosterPlayerIds: new Set(["p1", "p2", "p3"]) });
    expect(result.halftimeLineup?.get("lb")).toBe("");
    expect(result.skipped).toContainEqual({
      half: "halftime",
      positionId: "lb",
      playerId: "p4",
      reason: "player-not-on-roster",
    });
  });

  it("reports slots whose position no longer exists", () => {
    const result = mapTemplateToTeam(template(), { ...ctx, positionIds: ["gk", "lb", "st"] });
    expect(result.skipped).toContainEqual({ half: "halftime", positionId: "rb", playerId: "", reason: "position-missing" });
    expect(result.halftimeLineup?.has("rb")).toBe(false);
  });

  it("keeps the first slot (by position order) for a player listed twice and reports the rest", () => {
    const result = mapTemplateToTeam(
      template({
        startingLineup: [
          { positionId: "st", playerId: "p1" },
          { positionId: "gk", playerId: "p1" },
        ],
      }),
      ctx
    );
    expect(result.startingLineup.get("gk")).toBe("p1");
    expect(result.startingLineup.has("st")).toBe(false);
    expect(result.skipped).toContainEqual({ half: "starting", positionId: "st", playerId: "p1", reason: "duplicate-player" });
  });

  it("allows the same player in both lineups", () => {
    const result = mapTemplateToTeam(template(), ctx);
    expect(result.startingLineup.get("gk")).toBe("p1");
    expect(result.halftimeLineup?.get("gk")).toBe("p1");
    expect(result.skipped).toEqual([]);
  });

  it("flags nothingApplicable when every starting slot is skipped", () => {
    const result = mapTemplateToTeam(template(), { ...ctx, rosterPlayerIds: new Set() });
    expect(result.nothingApplicable).toBe(true);
  });

  it("flags a formation mismatch when the formation ids differ", () => {
    expect(mapTemplateToTeam(template(), { ...ctx, teamFormationId: "f2" }).formationMismatch).toBe(true);
  });

  it("without a stored formation id, mismatches only when no position id still exists", () => {
    const noFormation = template({ formationId: undefined });
    expect(mapTemplateToTeam(noFormation, ctx).formationMismatch).toBe(false);
    expect(mapTemplateToTeam(noFormation, { ...ctx, positionIds: ["x", "y"] }).formationMismatch).toBe(true);
  });

  it("returns a null halftime lineup when the template has none", () => {
    expect(mapTemplateToTeam(template({ halftimeLineup: undefined }), ctx).halftimeLineup).toBeNull();
  });
});

describe("parseLineupTemplates", () => {
  it("returns an empty list for null, undefined and empty strings", () => {
    expect(parseLineupTemplates(null)).toEqual([]);
    expect(parseLineupTemplates(undefined)).toEqual([]);
    expect(parseLineupTemplates("")).toEqual([]);
  });

  it("round-trips through serializeLineupTemplates", () => {
    const list = [template()];
    expect(parseLineupTemplates(serializeLineupTemplates(list))).toEqual(list);
  });

  it("throws on invalid JSON and on the wrong shape rather than treating it as empty", () => {
    expect(() => parseLineupTemplates("{not json")).toThrow();
    expect(() => parseLineupTemplates('{"a":1}')).toThrow();
    expect(() => parseLineupTemplates('[{"id":"x"}]')).toThrow();
  });
});

describe("normalizeTemplateName", () => {
  it("trims and caps at 60 characters", () => {
    expect(normalizeTemplateName("  hi  ")).toBe("hi");
    expect(normalizeTemplateName("a".repeat(80))).toHaveLength(60);
  });
});

describe("parseLineupTemplatesLenient", () => {
  const good = { id: "a", name: "A", startingLineup: [{ positionId: "p", playerId: "x" }], savedAt: "t", updatedAt: "t" };
  it("drops malformed entries but keeps valid ones", () => {
    const raw = JSON.stringify([good, { id: "bad" }, 7]);
    expect(parseLineupTemplatesLenient(raw).map((t) => t.id)).toEqual(["a"]);
    expect(() => parseLineupTemplates(raw)).toThrow();
  });
  it("still throws on unparseable JSON or a non-array", () => {
    expect(() => parseLineupTemplatesLenient("{broken")).toThrow();
    expect(() => parseLineupTemplatesLenient("{}")).toThrow();
  });
});
