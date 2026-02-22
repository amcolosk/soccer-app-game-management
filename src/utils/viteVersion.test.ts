/**
 * Tests for the version-string construction logic from vite.config.ts.
 *
 * The relevant logic in vite.config.ts is:
 *
 *   const buildId = process.env.AWS_JOB_ID;
 *   const fullVersion = buildId ? `${version}-${buildId}` : version;
 *
 * That logic is pure and stateless, so we replicate it here to keep these
 * tests independent of the Vite build-tool module (which cannot be imported
 * in a Vitest/jsdom environment due to top-level await and plugin imports).
 */

import { describe, it, expect } from "vitest";

/** Mirrors the fullVersion calculation in vite.config.ts. */
function buildFullVersion(version: string, awsJobId: string | undefined): string {
  const buildId = awsJobId;
  return buildId ? `${version}-${buildId}` : version;
}

describe("vite.config.ts – fullVersion construction", () => {
  describe("when AWS_JOB_ID is not set (local dev)", () => {
    it("returns the bare semver version", () => {
      expect(buildFullVersion("1.1.0", undefined)).toBe("1.1.0");
    });

    it("returns the bare version for an empty string AWS_JOB_ID", () => {
      // An empty string is falsy in JS, so no suffix should be appended.
      expect(buildFullVersion("1.1.0", "")).toBe("1.1.0");
    });
  });

  describe("when AWS_JOB_ID is set (Amplify CI build)", () => {
    it("appends the job ID with a dash separator", () => {
      expect(buildFullVersion("1.1.0", "42")).toBe("1.1.0-42");
    });

    it("works with larger job ID numbers", () => {
      expect(buildFullVersion("1.1.0", "1234")).toBe("1.1.0-1234");
    });

    it("works with different base versions", () => {
      expect(buildFullVersion("2.0.0", "7")).toBe("2.0.0-7");
    });

    it("uses the job ID verbatim (no trimming or transformation)", () => {
      expect(buildFullVersion("1.1.0", "build-99")).toBe("1.1.0-build-99");
    });
  });

  describe("format invariants", () => {
    it("never produces a version starting with a dash", () => {
      const result = buildFullVersion("1.1.0", undefined);
      expect(result).not.toMatch(/^-/);
    });

    it("never produces a version ending with a dash when job ID is absent", () => {
      const result = buildFullVersion("1.1.0", undefined);
      expect(result).not.toMatch(/-$/);
    });

    it("always starts with the base semver string", () => {
      const base = "1.1.0";
      expect(buildFullVersion(base, "99")).toMatch(new RegExp(`^${base}`));
      expect(buildFullVersion(base, undefined)).toMatch(new RegExp(`^${base}`));
    });
  });
});
