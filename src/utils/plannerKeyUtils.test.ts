import { describe, it, expect } from "vitest";
import {
  generateCanonicalKey,
  getHalftimeSentinelKey,
  parseCanonicalKey,
  isHaltimeSentinel,
  normalizeKey,
  resolveDuplicateWinner,
  buildNormalizedRotationSet,
} from "../utils/plannerKeyUtils";
import type { PlannedRotation } from "../types/schema";

describe("plannerKeyUtils", () => {
  describe("generateCanonicalKey", () => {
    it("should generate canonical key for normal rotation", () => {
      const key = generateCanonicalKey(1, 5, false);
      expect(key).toBe("H1:M05:ROT");
    });

    it("should generate canonical key for halftime sentinel", () => {
      const key = generateCanonicalKey(2, 0, true);
      expect(key).toBe("H2:M00:HT");
    });

    it("should throw on invalid half", () => {
      expect(() => generateCanonicalKey(3, 5, false)).toThrow();
      expect(() => generateCanonicalKey(0, 5, false)).toThrow();
    });

    it("should throw on invalid minute", () => {
      expect(() => generateCanonicalKey(1, 100, false)).toThrow();
      expect(() => generateCanonicalKey(1, -1, false)).toThrow();
    });

    it("should zero-pad minutes", () => {
      const key = generateCanonicalKey(1, 0, false);
      expect(key).toBe("H1:M00:ROT");
    });
  });

  describe("getHalftimeSentinelKey", () => {
    it("should return H2:M00:HT", () => {
      expect(getHalftimeSentinelKey()).toBe("H2:M00:HT");
    });
  });

  describe("parseCanonicalKey", () => {
    it("should parse normal rotation key", () => {
      const parsed = parseCanonicalKey("H1:M05:ROT");
      expect(parsed).toEqual({ half: 1, gameMinute: 5, slotType: "ROT" });
    });

    it("should parse halftime sentinel key", () => {
      const parsed = parseCanonicalKey("H2:M00:HT");
      expect(parsed).toEqual({ half: 2, gameMinute: 0, slotType: "HT" });
    });

    it("should throw on invalid key format", () => {
      expect(() => parseCanonicalKey("invalid")).toThrow();
      expect(() => parseCanonicalKey("H1:M05")).toThrow();
    });
  });

  describe("isHaltimeSentinel", () => {
    it("should identify halftime sentinel", () => {
      expect(isHaltimeSentinel("H2:M00:HT")).toBe(true);
      expect(isHaltimeSentinel("H1:M05:ROT")).toBe(false);
    });
  });

  describe("normalizeKey", () => {
    it("should trim and validate", () => {
      const normalized = normalizeKey("  H1:M05:ROT  ");
      expect(normalized).toBe("H1:M05:ROT");
    });

    it("should throw on invalid format", () => {
      expect(() => normalizeKey("invalid")).toThrow();
    });
  });

  describe("resolveDuplicateWinner", () => {
    it("should pick by highest updatedAt", () => {
      const candidates: PlannedRotation[] = [
        {
          id: "rot1",
          gamePlanId: "gp1",
          half: 1,
          gameMinute: 5,
          rotationNumber: 1,
          plannedSubstitutions: "[]",
          updatedAt: new Date("2026-01-01").toISOString(),
          createdAt: "2026-01-01T00:00:00Z",
          coaches: [],
        },
        {
          id: "rot2",
          gamePlanId: "gp1",
          half: 1,
          gameMinute: 5,
          rotationNumber: 1,
          plannedSubstitutions: "[]",
          updatedAt: new Date("2026-01-02").toISOString(),
          createdAt: "2026-01-01T00:00:00Z",
          coaches: [],
        },
      ];

      const winner = resolveDuplicateWinner(candidates);
      expect(winner?.id).toBe("rot2");
    });

    it("should pick by highest id if timestamps tied", () => {
      const timestamp = new Date("2026-01-01").toISOString();
      const candidates: PlannedRotation[] = [
        {
          id: "rot1",
          gamePlanId: "gp1",
          half: 1,
          gameMinute: 5,
          rotationNumber: 1,
          plannedSubstitutions: "[]",
          updatedAt: timestamp,
          createdAt: "2026-01-01T00:00:00Z",
          coaches: [],
        },
        {
          id: "rot2",
          gamePlanId: "gp1",
          half: 1,
          gameMinute: 5,
          rotationNumber: 1,
          plannedSubstitutions: "[]",
          updatedAt: timestamp,
          createdAt: "2026-01-01T00:00:00Z",
          coaches: [],
        },
      ];

      const winner = resolveDuplicateWinner(candidates);
      expect(winner?.id).toBe("rot2");
    });

    it("should return null for empty array", () => {
      expect(resolveDuplicateWinner([])).toBeNull();
    });
  });

  describe("buildNormalizedRotationSet", () => {
    it("should deduplicate by canonical key", () => {
      const candidates: PlannedRotation[] = [
        {
          id: "rot1",
          gamePlanId: "gp1",
          half: 1,
          gameMinute: 5,
          rotationNumber: 1,
          plannedSubstitutions: "[]",
          updatedAt: new Date("2026-01-01").toISOString(),
          createdAt: "2026-01-01T00:00:00Z",
          coaches: [],
        },
        {
          id: "rot2",
          gamePlanId: "gp1",
          half: 1,
          gameMinute: 5,
          rotationNumber: 1,
          plannedSubstitutions: "[]",
          updatedAt: new Date("2026-01-02").toISOString(),
          createdAt: "2026-01-01T00:00:00Z",
          coaches: [],
        },
      ];

      const result = buildNormalizedRotationSet(candidates);
      expect(result.normalized).toHaveLength(1);
      expect(result.normalized[0].id).toBe("rot2");
      expect(result.conflictCount).toBe(1);
    });

    it("should report errors for invalid rotations", () => {
      const candidates: PlannedRotation[] = [
        {
          id: "rot1",
          gamePlanId: "gp1",
          half: 99 as unknown as 1 | 2, // Invalid
          gameMinute: 5,
          rotationNumber: 1,
          plannedSubstitutions: "[]",
          updatedAt: new Date("2026-01-01").toISOString(),
          createdAt: "2026-01-01T00:00:00Z",
          coaches: [],
        },
      ];

      const result = buildNormalizedRotationSet(candidates);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Failed to normalize");
    });
  });
});
