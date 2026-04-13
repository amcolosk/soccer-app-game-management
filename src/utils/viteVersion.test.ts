/**
 * Tests for the version-string construction logic from vite.config.ts.
 *
 * The relevant logic in vite.config.ts is:
 *
 *   fullVersion = version[-buildId][+hash]
 *
 * buildId:
 *   - sourced from AWS_JOB_ID
 *   - allowed characters: [A-Za-z0-9._-]
 *
 * hash precedence:
 *   1) VITE_GIT_SHA
 *   2) GITHUB_SHA
 *   3) AWS_COMMIT_ID
 *   4) guarded git rev-parse fallback
 *
 * hash format:
 *   - lowercase hex only
 *   - max 8 chars
 *
 * That logic is pure and stateless, so we replicate it here to keep these
 * tests independent of the Vite build-tool module (which cannot be imported
 * in a Vitest/jsdom environment due to top-level await and plugin imports).
 */

import { describe, it, expect } from "vitest";

type VersionEnv = {
  AWS_JOB_ID?: string;
  VITE_GIT_SHA?: string;
  GITHUB_SHA?: string;
  AWS_COMMIT_ID?: string;
};

function sanitizeBuildId(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const candidate = value.trim().replace(/[^A-Za-z0-9._-]/g, "");
  if (!candidate) {
    return null;
  }

  return candidate;
}

function sanitizeHash(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const candidate = value.trim().toLowerCase();
  if (!candidate) {
    return null;
  }

  if (!/^[0-9a-f]+$/.test(candidate)) {
    return null;
  }

  return candidate.slice(0, 8);
}

function resolveHash(env: VersionEnv, gitFallback: string | undefined): string | null {
  return (
    sanitizeHash(env.VITE_GIT_SHA) ??
    sanitizeHash(env.GITHUB_SHA) ??
    sanitizeHash(env.AWS_COMMIT_ID) ??
    sanitizeHash(gitFallback)
  );
}

/** Mirrors the fullVersion calculation in vite.config.ts. */
function buildFullVersion(version: string, env: VersionEnv, gitFallback?: string): string {
  const buildId = sanitizeBuildId(env.AWS_JOB_ID);
  const hash = resolveHash(env, gitFallback);
  const versionWithBuildId = buildId ? `${version}-${buildId}` : version;
  return hash ? `${versionWithBuildId}+${hash}` : versionWithBuildId;
}

describe("vite.config.ts – fullVersion construction", () => {
  describe("build ID handling", () => {
    it("returns the bare semver when AWS_JOB_ID is absent", () => {
      expect(buildFullVersion("1.1.0", {})).toBe("1.1.0");
    });

    it("returns the bare semver for an empty AWS_JOB_ID", () => {
      expect(buildFullVersion("1.1.0", { AWS_JOB_ID: "" })).toBe("1.1.0");
    });

    it("appends a valid build ID using a dash separator", () => {
      expect(buildFullVersion("1.1.0", { AWS_JOB_ID: "42" })).toBe("1.1.0-42");
    });

    it("allows alphanumeric, dot, underscore, and dash in build ID", () => {
      expect(buildFullVersion("1.1.0", { AWS_JOB_ID: "release_2.5-rc1" })).toBe("1.1.0-release_2.5-rc1");
    });

    it("filters invalid characters from mixed build IDs", () => {
      expect(buildFullVersion("1.1.0", { AWS_JOB_ID: "bad build id" })).toBe("1.1.0-badbuildid");
    });

    it("omits build ID when all characters are invalid after filtering", () => {
      expect(buildFullVersion("1.1.0", { AWS_JOB_ID: " !!! " })).toBe("1.1.0");
    });
  });

  describe("hash composition and sanitization", () => {
    it("adds +hash from VITE_GIT_SHA", () => {
      expect(buildFullVersion("1.1.0", { VITE_GIT_SHA: "abc123ef" })).toBe("1.1.0+abc123ef");
    });

    it("normalizes uppercase hex and truncates to max 8 chars", () => {
      expect(buildFullVersion("1.1.0", { VITE_GIT_SHA: "ABCDEF123456" })).toBe("1.1.0+abcdef12");
    });

    it("omits invalid hash values", () => {
      expect(buildFullVersion("1.1.0", { VITE_GIT_SHA: "abc123zz" })).toBe("1.1.0");
    });

    it("composes build ID and hash together", () => {
      expect(buildFullVersion("1.1.0", { AWS_JOB_ID: "42", VITE_GIT_SHA: "deadbeef" })).toBe("1.1.0-42+deadbeef");
    });
  });

  describe("hash precedence", () => {
    it("prefers VITE_GIT_SHA over other sources", () => {
      const env: VersionEnv = {
        VITE_GIT_SHA: "11111111",
        GITHUB_SHA: "22222222",
        AWS_COMMIT_ID: "33333333",
      };
      expect(buildFullVersion("1.1.0", env)).toBe("1.1.0+11111111");
    });

    it("falls back to GITHUB_SHA when VITE_GIT_SHA is invalid", () => {
      const env: VersionEnv = {
        VITE_GIT_SHA: "not-a-hash",
        GITHUB_SHA: "abcdef12",
      };
      expect(buildFullVersion("1.1.0", env)).toBe("1.1.0+abcdef12");
    });

    it("falls back to AWS_COMMIT_ID when higher-priority sources are absent", () => {
      const env: VersionEnv = {
        AWS_COMMIT_ID: "feedf00d",
      };
      expect(buildFullVersion("1.1.0", env)).toBe("1.1.0+feedf00d");
    });

    it("uses git fallback when env hashes are unavailable", () => {
      expect(buildFullVersion("1.1.0", {}, "cafebabe")).toBe("1.1.0+cafebabe");
    });

    it("omits hash entirely when all sources are invalid", () => {
      const env: VersionEnv = {
        VITE_GIT_SHA: "invalid",
        GITHUB_SHA: "also-invalid",
        AWS_COMMIT_ID: "xyz",
      };
      expect(buildFullVersion("1.1.0", env, "nothex")).toBe("1.1.0");
    });
  });
});
