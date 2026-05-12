import { describe, it, expect } from "vitest";
import {
  projectHalftimeRotation,
  recoverHalftimeLineupFromRotation,
  parseHalftimeLineup,
  serializeHalftimeLineup,
  halftimeLineupsEqual,
  mergeHalftimeLineup,
  deriveExplicitOverrides,
} from "../utils/halftimeProjectionUtils";
import type { PlannedRotation } from "../types/schema";

describe("halftimeProjectionUtils", () => {
  describe("projectHalftimeRotation", () => {
    it("should compute substitutions from starting to halftime lineup", () => {
      const starting = new Map<string, string>([
        ["pos1", "p1"],
        ["pos2", "p2"],
      ]);
      const halftime = new Map<string, string>([
        ["pos1", "p3"], // Changed
        ["pos2", "p2"], // Unchanged
      ]);

      const rotation = projectHalftimeRotation(starting, halftime);

      expect(rotation.half).toBe(2);
      expect(rotation.gameMinute).toBe(0);
      expect(rotation.rotationNumber).toBe(0);

      const subs = JSON.parse(rotation.plannedSubstitutions as string);
      expect(subs).toHaveLength(1);
      expect(subs[0]).toEqual({
        playerOutId: "p1",
        playerInId: "p3",
        positionId: "pos1",
      });
    });

    it("should handle no changes", () => {
      const lineup = new Map<string, string>([
        ["pos1", "p1"],
        ["pos2", "p2"],
      ]);

      const rotation = projectHalftimeRotation(lineup, lineup);
      const subs = JSON.parse(rotation.plannedSubstitutions as string);
      expect(subs).toHaveLength(0);
    });
  });

  describe("recoverHalftimeLineupFromRotation", () => {
    it("should reconstruct halftime lineup from rotation", () => {
      const starting = new Map<string, string>([
        ["pos1", "p1"],
        ["pos2", "p2"],
      ]);
      const halftimeRotation: PlannedRotation = {
        id: "rot1",
        gamePlanId: "gp1",
        half: 2,
        gameMinute: 0,
        rotationNumber: 0,
        plannedSubstitutions: JSON.stringify([
          { playerOutId: "p1", playerInId: "p3", positionId: "pos1" },
        ]),
        updatedAt: "2026-01-01T00:00:00Z",
        createdAt: "2026-01-01T00:00:00Z",
        coaches: [],
      };

      const recovered = recoverHalftimeLineupFromRotation(starting, halftimeRotation);

      expect(recovered.get("pos1")).toBe("p3");
      expect(recovered.get("pos2")).toBe("p2");
    });

    it("should handle invalid JSON gracefully", () => {
      const starting = new Map<string, string>([
        ["pos1", "p1"],
      ]);
      const badRotation: PlannedRotation = {
        id: "rot1",
        gamePlanId: "gp1",
        half: 2,
        gameMinute: 0,
        rotationNumber: 0,
        plannedSubstitutions: "invalid json",
        updatedAt: "2026-01-01T00:00:00Z",
        createdAt: "2026-01-01T00:00:00Z",
        coaches: [],
      };

      const recovered = recoverHalftimeLineupFromRotation(starting, badRotation);
      expect(recovered.get("pos1")).toBe("p1"); // Fallback to starting
    });
  });

  describe("parseHalftimeLineup", () => {
    it("should parse halftime lineup JSON", () => {
      const json = JSON.stringify([
        { playerId: "p1", positionId: "pos1" },
        { playerId: "p2", positionId: "pos2" },
      ]);

      const lineup = parseHalftimeLineup(json);
      expect(lineup.get("pos1")).toBe("p1");
      expect(lineup.get("pos2")).toBe("p2");
    });

    it("should return empty map for null/undefined", () => {
      expect(parseHalftimeLineup(null)).toEqual(new Map());
      expect(parseHalftimeLineup(undefined)).toEqual(new Map());
      expect(parseHalftimeLineup("")).toEqual(new Map());
    });

    it("should handle invalid JSON gracefully", () => {
      expect(parseHalftimeLineup("invalid")).toEqual(new Map());
    });

    it("should preserve empty-string playerId as explicit clear sentinel", () => {
      const json = JSON.stringify([
        { playerId: "", positionId: "pos1" },
        { playerId: "p2", positionId: "pos2" },
      ]);
      const lineup = parseHalftimeLineup(json);
      expect(lineup.has("pos1")).toBe(true);
      expect(lineup.get("pos1")).toBe("");
      expect(lineup.get("pos2")).toBe("p2");
    });

    it("should skip entries without positionId", () => {
      const json = JSON.stringify([
        { playerId: "p1", positionId: "" },
        { playerId: "p2", positionId: "pos2" },
      ]);
      const lineup = parseHalftimeLineup(json);
      expect(lineup.size).toBe(1);
      expect(lineup.get("pos2")).toBe("p2");
    });
  });

  describe("serializeHalftimeLineup", () => {
    it("should serialize lineup to JSON", () => {
      const lineup = new Map<string, string>([
        ["pos1", "p1"],
        ["pos2", "p2"],
      ]);

      const json = serializeHalftimeLineup(lineup);
      const parsed = JSON.parse(json) as Array<{
        playerId: string;
        positionId: string;
      }>;

      expect(parsed).toContainEqual({ playerId: "p1", positionId: "pos1" });
      expect(parsed).toContainEqual({ playerId: "p2", positionId: "pos2" });
    });

    it("should preserve unassigned slots with empty playerId", () => {
      const lineup = new Map<string, string>([
        ["pos1", ""],
        ["pos2", "p2"],
      ]);

      const json = serializeHalftimeLineup(lineup);
      const parsed = JSON.parse(json) as Array<{
        playerId: string;
        positionId: string;
      }>;

      expect(parsed).toContainEqual({ playerId: "", positionId: "pos1" });
    });

    it("should return empty array for empty map", () => {
      const json = serializeHalftimeLineup(new Map());
      expect(JSON.parse(json)).toEqual([]);
    });
  });

  describe("halftimeLineupsEqual", () => {
    it("should return true for identical maps", () => {
      const a = new Map<string, string>([["pos1", "p1"]]);
      const b = new Map<string, string>([["pos1", "p1"]]);
      expect(halftimeLineupsEqual(a, b)).toBe(true);
    });

    it("should return false for different size", () => {
      const a = new Map<string, string>([["pos1", "p1"]]);
      const b = new Map<string, string>([["pos1", "p1"], ["pos2", "p2"]]);
      expect(halftimeLineupsEqual(a, b)).toBe(false);
    });

    it("should return false for different values", () => {
      const a = new Map<string, string>([["pos1", "p1"]]);
      const b = new Map<string, string>([["pos1", "p2"]]);
      expect(halftimeLineupsEqual(a, b)).toBe(false);
    });
  });

  describe("mergeHalftimeLineup", () => {
    it("inherits end-of-H1 player when position absent from overrides", () => {
      const endOfH1 = new Map([["pos1", "p1"], ["pos2", "p2"]]);
      const overrides = new Map<string, string>([["pos1", "p3"]]);
      const merged = mergeHalftimeLineup(endOfH1, overrides);
      expect(merged.get("pos1")).toBe("p3");
      expect(merged.get("pos2")).toBe("p2"); // inherited
    });

    it("applies non-empty player override", () => {
      const endOfH1 = new Map([["pos1", "p1"]]);
      const overrides = new Map([["pos1", "p99"]]);
      const merged = mergeHalftimeLineup(endOfH1, overrides);
      expect(merged.get("pos1")).toBe("p99");
    });

    it("removes position when override is empty string (explicit clear)", () => {
      const endOfH1 = new Map([["pos1", "p1"], ["pos2", "p2"]]);
      const overrides = new Map([["pos1", ""]]);
      const merged = mergeHalftimeLineup(endOfH1, overrides);
      expect(merged.has("pos1")).toBe(false);
      expect(merged.get("pos2")).toBe("p2");
    });

    it("returns copy of endOfH1 when overrides are empty", () => {
      const endOfH1 = new Map([["pos1", "p1"]]);
      const merged = mergeHalftimeLineup(endOfH1, new Map());
      expect(merged.get("pos1")).toBe("p1");
      expect(merged).not.toBe(endOfH1); // must be a new map
    });

    it("does not mutate endOfH1 map", () => {
      const endOfH1 = new Map([["pos1", "p1"]]);
      const overrides = new Map([["pos1", ""]]);
      mergeHalftimeLineup(endOfH1, overrides);
      expect(endOfH1.get("pos1")).toBe("p1"); // original unchanged
    });
  });

  describe("deriveExplicitOverrides", () => {
    it("records positions with changed players relative to end-of-H1", () => {
      const endOfH1 = new Map([["pos1", "p1"], ["pos2", "p2"]]);
      const effective = new Map([["pos1", "p3"], ["pos2", "p2"]]);
      const overrides = deriveExplicitOverrides(effective, endOfH1);
      expect(overrides.get("pos1")).toBe("p3");
      expect(overrides.has("pos2")).toBe(false); // unchanged, not stored
    });

    it("records empty-string sentinel for positions cleared relative to end-of-H1", () => {
      const endOfH1 = new Map([["pos1", "p1"], ["pos2", "p2"]]);
      const effective = new Map([["pos2", "p2"]]); // pos1 cleared
      const overrides = deriveExplicitOverrides(effective, endOfH1);
      expect(overrides.get("pos1")).toBe("");
      expect(overrides.has("pos2")).toBe(false); // unchanged
    });

    it("returns empty map when effective lineup equals end-of-H1", () => {
      const endOfH1 = new Map([["pos1", "p1"], ["pos2", "p2"]]);
      const effective = new Map([["pos1", "p1"], ["pos2", "p2"]]);
      const overrides = deriveExplicitOverrides(effective, endOfH1);
      expect(overrides.size).toBe(0);
    });

    it("records empty-string sentinels for all positions when effective lineup is empty", () => {
      const endOfH1 = new Map([["pos1", "p1"], ["pos2", "p2"]]);
      const overrides = deriveExplicitOverrides(new Map(), endOfH1);
      expect(overrides.get("pos1")).toBe("");
      expect(overrides.get("pos2")).toBe("");
      expect(overrides.size).toBe(2);
    });

    it("round-trips through mergeHalftimeLineup: derive then merge restores effective lineup", () => {
      const endOfH1 = new Map([["pos1", "p1"], ["pos2", "p2"]]);
      const effective = new Map([["pos1", "p3"]]); // pos2 cleared
      const overrides = deriveExplicitOverrides(effective, endOfH1);
      const restored = mergeHalftimeLineup(endOfH1, overrides);
      expect(restored.get("pos1")).toBe("p3");
      expect(restored.has("pos2")).toBe(false); // stays cleared
    });
  });
});
