import { describe, it, expect } from "vitest";
import {
  computeRotationDiff,
  isRotationDiffNoOp,
  filterScopedDeletes,
  computeRevisionFingerprint,
} from "../utils/rotationDiffUtils";
import type { PlannedRotation } from "../types/schema";

describe("rotationDiffUtils", () => {
  describe("computeRotationDiff", () => {
    it("should detect create operations", () => {
      const stored: PlannedRotation[] = [];
      const desired: PlannedRotation[] = [
        {
          id: "new1",
          gamePlanId: "gp1",
          half: 1,
          gameMinute: 5,
          rotationNumber: 1,
          plannedSubstitutions: "[]",
          updatedAt: "2026-01-01T00:00:00Z",
          createdAt: "2026-01-01T00:00:00Z",
          coaches: [],
        },
      ];

      const { operations } = computeRotationDiff(stored, desired);
      expect(operations).toHaveLength(1);
      expect(operations[0].action).toBe("create");
    });

    it("should detect delete operations", () => {
      const stored: PlannedRotation[] = [
        {
          id: "old1",
          gamePlanId: "gp1",
          half: 1,
          gameMinute: 5,
          rotationNumber: 1,
          plannedSubstitutions: "[]",
          updatedAt: "2026-01-01T00:00:00Z",
          createdAt: "2026-01-01T00:00:00Z",
          coaches: [],
        },
      ];
      const desired: PlannedRotation[] = [];

      const { operations } = computeRotationDiff(stored, desired);
      expect(operations).toHaveLength(1);
      expect(operations[0].action).toBe("delete");
    });

    it("should detect update operations", () => {
      const stored: PlannedRotation[] = [
        {
          id: "rot1",
          gamePlanId: "gp1",
          half: 1,
          gameMinute: 5,
          rotationNumber: 1,
          plannedSubstitutions: "[]",
          updatedAt: "2026-01-01T00:00:00Z",
          createdAt: "2026-01-01T00:00:00Z",
          coaches: [],
        },
      ];
      const desired: PlannedRotation[] = [
        {
          id: "rot1",
          gamePlanId: "gp1",
          half: 1,
          gameMinute: 5,
          rotationNumber: 1,
          plannedSubstitutions: "[{}]", // Changed
          updatedAt: "2026-01-02T00:00:00Z",
          createdAt: "2026-01-01T00:00:00Z",
          coaches: [],
        },
      ];

      const { operations } = computeRotationDiff(stored, desired);
      expect(operations).toHaveLength(1);
      expect(operations[0].action).toBe("update");
    });

    it("should skip no-op entries", () => {
      const rotation: PlannedRotation = {
        id: "rot1",
        gamePlanId: "gp1",
        half: 1,
        gameMinute: 5,
        rotationNumber: 1,
        plannedSubstitutions: "[]",
        updatedAt: "2026-01-01T00:00:00Z",
        createdAt: "2026-01-01T00:00:00Z",
        coaches: [],
      };

      const { operations } = computeRotationDiff([rotation], [rotation]);
      expect(operations).toHaveLength(0);
    });

    it("should sort operations deterministically", () => {
      const stored: PlannedRotation[] = [
        {
          id: "rot1",
          gamePlanId: "gp1",
          half: 1,
          gameMinute: 5,
          rotationNumber: 1,
          plannedSubstitutions: "[]",
          updatedAt: "2026-01-01T00:00:00Z",
          createdAt: "2026-01-01T00:00:00Z",
          coaches: [],
        },
      ];
      const desired: PlannedRotation[] = [
        {
          id: "rot2",
          gamePlanId: "gp1",
          half: 1,
          gameMinute: 10,
          rotationNumber: 2,
          plannedSubstitutions: "[]",
          updatedAt: "2026-01-01T00:00:00Z",
          createdAt: "2026-01-01T00:00:00Z",
          coaches: [],
        },
      ];

      const { operations } = computeRotationDiff(stored, desired);
      // Should be [delete, create]
      expect(operations[0].action).toBe("delete");
      expect(operations[1].action).toBe("create");
    });
  });

  describe("isRotationDiffNoOp", () => {
    it("should return true for empty operations", () => {
      expect(isRotationDiffNoOp([])).toBe(true);
    });

    it("should return false for non-empty operations", () => {
      expect(
        isRotationDiffNoOp([
          {
            action: "create",
            key: "H1:M05:ROT",
            desired: {
              id: "rot1",
              gamePlanId: "gp1",
              half: 1,
              gameMinute: 5,
              rotationNumber: 1,
              plannedSubstitutions: "[]",
              updatedAt: "2026-01-01T00:00:00Z",
              createdAt: "2026-01-01T00:00:00Z",
              coaches: [],
            },
          },
        ])
      ).toBe(false);
    });
  });

  describe("filterScopedDeletes", () => {
    it("should filter deletes outside scope", () => {
      const operations = [
        {
          action: "delete" as const,
          key: "H1:M05:ROT",
          current: {
            id: "rot1",
            gamePlanId: "gp-other",
            half: 1,
            gameMinute: 5,
            rotationNumber: 1,
            plannedSubstitutions: "[]",
            updatedAt: "2026-01-01T00:00:00Z",
            createdAt: "2026-01-01T00:00:00Z",
            coaches: [],
          },
        },
        {
          action: "delete" as const,
          key: "H1:M10:ROT",
          current: {
            id: "rot2",
            gamePlanId: "gp1",
            half: 1,
            gameMinute: 10,
            rotationNumber: 2,
            plannedSubstitutions: "[]",
            updatedAt: "2026-01-01T00:00:00Z",
            createdAt: "2026-01-01T00:00:00Z",
            coaches: [],
          },
        },
      ];

      const filtered = filterScopedDeletes(operations, "gp1");
      expect(filtered).toHaveLength(1);
      expect(filtered[0].key).toBe("H1:M10:ROT");
    });

    it("should keep non-delete operations", () => {
      const operations = [
        {
          action: "create" as const,
          key: "H1:M05:ROT",
          desired: {
            id: "rot1",
            gamePlanId: "gp-other",
            half: 1,
            gameMinute: 5,
            rotationNumber: 1,
            plannedSubstitutions: "[]",
            updatedAt: "2026-01-01T00:00:00Z",
            createdAt: "2026-01-01T00:00:00Z",
            coaches: [],
          },
        },
      ];

      const filtered = filterScopedDeletes(operations, "gp1");
      expect(filtered).toHaveLength(1);
      expect(filtered[0].action).toBe("create");
    });
  });

  describe("computeRevisionFingerprint", () => {
    it("should produce consistent fingerprint for identical data", () => {
      const payload = {
        startingLineup: "[{playerId: 'p1', positionId: 'pos1'}]",
        halftimeLineup: "[{playerId: 'p2', positionId: 'pos1'}]",
        rotationIntervalMinutes: 10,
      };
      const rotations: PlannedRotation[] = [];

      const fp1 = computeRevisionFingerprint(payload, rotations);
      const fp2 = computeRevisionFingerprint(payload, rotations);

      expect(fp1).toBe(fp2);
    });

    it("should produce different fingerprints for different data", () => {
      const payload1 = {
        startingLineup: "[{playerId: 'p1', positionId: 'pos1'}]",
        halftimeLineup: "[{playerId: 'p2', positionId: 'pos1'}]",
        rotationIntervalMinutes: 10,
      };
      const payload2 = {
        startingLineup: "[{playerId: 'p1', positionId: 'pos1'}]",
        halftimeLineup: "[{playerId: 'p3', positionId: 'pos1'}]", // Different
        rotationIntervalMinutes: 10,
      };
      const rotations: PlannedRotation[] = [];

      const fp1 = computeRevisionFingerprint(payload1, rotations);
      const fp2 = computeRevisionFingerprint(payload2, rotations);

      expect(fp1).not.toBe(fp2);
    });

    it("should include rotation count in fingerprint", () => {
      const payload = {
        startingLineup: "[{playerId: 'p1', positionId: 'pos1'}]",
        halftimeLineup: null,
        rotationIntervalMinutes: 10,
      };
      const rot1: PlannedRotation = {
        id: "rot1",
        gamePlanId: "gp1",
        half: 1,
        gameMinute: 5,
        rotationNumber: 1,
        plannedSubstitutions: "[]",
        updatedAt: "2026-01-01T00:00:00Z",
        createdAt: "2026-01-01T00:00:00Z",
        coaches: [],
      };

      const fp1 = computeRevisionFingerprint(payload, []);
      const fp2 = computeRevisionFingerprint(payload, [rot1]);

      expect(fp1).not.toBe(fp2);
    });
  });
});
