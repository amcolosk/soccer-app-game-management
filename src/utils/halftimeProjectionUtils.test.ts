import { describe, it, expect } from "vitest";
import {
  projectHalftimeRotation,
  recoverHalftimeLineupFromRotation,
  parseHalftimeLineup,
  serializeHalftimeLineup,
  halftimeLineupsEqual,
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
});
