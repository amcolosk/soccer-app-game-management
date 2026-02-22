/**
 * Tests for UserProfile version display.
 *
 * The component renders:
 *   Version {import.meta.env.VITE_APP_VERSION || '1.1.0'}
 *
 * We verify:
 *  - The fallback '1.1.0' is shown when VITE_APP_VERSION is absent/empty.
 *  - A plain semver value (e.g. '1.2.3') is shown when set.
 *  - A build-ID-suffixed version (e.g. '1.1.0-42') is shown when set.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module-level mocks — must be hoisted before any import of the component.
// ---------------------------------------------------------------------------

vi.mock("@aws-amplify/ui-react", () => ({
  useAuthenticator: () => ({
    user: {
      username: "testuser",
      signInDetails: { loginId: "testuser@example.com" },
    },
  }),
}));

vi.mock("react-router-dom", () => ({
  useOutletContext: () => ({ signOut: vi.fn() }),
}));

vi.mock("aws-amplify/auth", () => ({
  updatePassword: vi.fn().mockResolvedValue(undefined),
  deleteUser: vi.fn().mockResolvedValue(undefined),
  fetchUserAttributes: vi.fn().mockResolvedValue({ email: "testuser@example.com" }),
}));

vi.mock("aws-amplify/data", () => ({
  generateClient: () => ({
    models: {
      Team: { get: vi.fn().mockResolvedValue({ data: null }) },
    },
  }),
}));

vi.mock("../services/invitationService", () => ({
  getUserPendingInvitations: vi.fn().mockResolvedValue({ teamInvitations: [] }),
  acceptTeamInvitation: vi.fn().mockResolvedValue(undefined),
  declineTeamInvitation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./ConfirmModal", () => ({
  useConfirm: () => vi.fn().mockResolvedValue(false),
}));

import { UserProfile } from "./UserProfile";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stub VITE_APP_VERSION for a single test via the proper Vitest API. */
function setViteAppVersion(value: string) {
  vi.stubEnv("VITE_APP_VERSION", value);
}

describe("UserProfile – version display", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("shows fallback version '1.1.0' when VITE_APP_VERSION is absent or empty", () => {
    setViteAppVersion("");
    render(<UserProfile />);
    expect(screen.getByText(/Version 1\.1\.0/)).toBeInTheDocument();
  });

  it("shows the version from VITE_APP_VERSION when it is set to a plain semver", () => {
    setViteAppVersion("1.2.3");
    render(<UserProfile />);
    expect(screen.getByText(/Version 1\.2\.3/)).toBeInTheDocument();
  });

  it("shows the version with build-ID suffix when VITE_APP_VERSION includes a build ID", () => {
    // This reflects the vite.config.ts behaviour when AWS_JOB_ID is set:
    // fullVersion = `${version}-${buildId}`  →  e.g. "1.1.0-42"
    setViteAppVersion("1.1.0-42");
    render(<UserProfile />);
    expect(screen.getByText(/Version 1\.1\.0-42/)).toBeInTheDocument();
  });

  it("does not show the old '1.0.0' fallback string anywhere in the version area", () => {
    setViteAppVersion("");
    render(<UserProfile />);
    const versionSection = document.querySelector(".version-info");
    expect(versionSection).not.toBeNull();
    expect(versionSection!.textContent).not.toContain("1.0.0");
  });
});
