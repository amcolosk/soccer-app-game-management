/**
 * Tests for UserProfile version display.
 *
 * The component renders:
 *   Version {import.meta.env.VITE_APP_VERSION || '1.1.0'}
 *
 * We verify:
 *  - The fallback '1.1.0' is shown when VITE_APP_VERSION is absent/empty.
 *  - A plain semver value (e.g. '1.2.3') is shown when set.
 *  - Hash-bearing versions (e.g. '1.1.0+abc123ef' and '1.1.0-42+abc123ef') are shown when set.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockUpsertMyCoachProfile, mockCoachProfileGet } = vi.hoisted(() => ({
  mockUpsertMyCoachProfile: vi.fn().mockResolvedValue({ data: null, errors: [] }),
  mockCoachProfileGet: vi.fn().mockResolvedValue({ data: null }),
}));

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
  getCurrentUser: vi.fn().mockResolvedValue({ userId: 'coach-1' }),
}));

vi.mock("aws-amplify/data", () => ({
  generateClient: () => ({
    models: {
      Team: { get: vi.fn().mockResolvedValue({ data: null }) },
      CoachProfile: { get: (...args: unknown[]) => mockCoachProfileGet(...args) },
    },
    mutations: {
      upsertMyCoachProfile: (...args: unknown[]) => mockUpsertMyCoachProfile(...args),
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

vi.mock("../contexts/HelpFabContext", () => ({
  useHelpFab: () => ({
    setHelpContext: vi.fn(),
    helpContext: null,
    debugContext: null,
    setDebugContext: vi.fn(),
  }),
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
    mockUpsertMyCoachProfile.mockClear();
    mockCoachProfileGet.mockClear();
  });

  it("shows fallback version '1.1.0' when VITE_APP_VERSION is absent or empty", async () => {
    setViteAppVersion("");
    await act(async () => {
      render(<UserProfile />);
    });
    expect(screen.getByText(/Version 1\.1\.0/)).toBeInTheDocument();
  });

  it("shows the version from VITE_APP_VERSION when it is set to a plain semver", async () => {
    setViteAppVersion("1.2.3");
    await act(async () => {
      render(<UserProfile />);
    });
    expect(screen.getByText(/Version 1\.2\.3/)).toBeInTheDocument();
  });

  it("shows the version with hash suffix when VITE_APP_VERSION includes a commit hash", async () => {
    setViteAppVersion("1.1.0+abc123ef");
    await act(async () => {
      render(<UserProfile />);
    });
    expect(screen.getByText(/Version 1\.1\.0\+abc123ef/)).toBeInTheDocument();
  });

  it("shows the version with build and hash suffixes when both are present", async () => {
    setViteAppVersion("1.1.0-42+abc123ef");
    await act(async () => {
      render(<UserProfile />);
    });
    expect(screen.getByText(/Version 1\.1\.0-42\+abc123ef/)).toBeInTheDocument();
  });

  it("does not show the old '1.0.0' fallback string anywhere in the version area", async () => {
    setViteAppVersion("");
    await act(async () => {
      render(<UserProfile />);
    });
    const versionSection = document.querySelector(".version-info");
    expect(versionSection).not.toBeNull();
    expect(versionSection!.textContent).not.toContain("1.0.0");
  });
});

describe('UserProfile – coach profile form', () => {
  it('disables Save Profile and shows "First name required" when first name is blank', async () => {
    await act(async () => {
      render(<UserProfile />);
    });

    expect(screen.getByText('First name required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Profile' })).toBeDisabled();
  });

  it('shows persistent conflict alert with Retry + Discard on concurrency conflict', async () => {
    mockUpsertMyCoachProfile.mockResolvedValueOnce({
      data: null,
      errors: [{ message: 'CONFLICT_PROFILE_UPDATED_ELSEWHERE' }],
    });

    await act(async () => {
      render(<UserProfile />);
    });

    await userEvent.type(screen.getByLabelText('First Name'), 'Alex');
    await userEvent.click(screen.getByRole('button', { name: 'Save Profile' }));

    expect(await screen.findByText('Your profile was updated elsewhere.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  });

  it('keeps conflict alert visible when Retry refetch fails', async () => {
    mockUpsertMyCoachProfile.mockResolvedValueOnce({
      data: null,
      errors: [{ message: 'CONFLICT_PROFILE_UPDATED_ELSEWHERE' }],
    });

    await act(async () => {
      render(<UserProfile />);
    });

    await userEvent.type(screen.getByLabelText('First Name'), 'Alex');
    await userEvent.click(screen.getByRole('button', { name: 'Save Profile' }));

    expect(await screen.findByText('Your profile was updated elsewhere.')).toBeInTheDocument();

    mockCoachProfileGet.mockRejectedValueOnce(new Error('network failure'));
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Your profile was updated elsewhere.')).toBeInTheDocument();
  });

  it('clears conflict alert only after a successful Retry refetch', async () => {
    mockUpsertMyCoachProfile.mockResolvedValueOnce({
      data: null,
      errors: [{ message: 'CONFLICT_PROFILE_UPDATED_ELSEWHERE' }],
    });

    mockCoachProfileGet
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({
        data: {
          id: 'coach-1',
          firstName: 'Jamie',
          lastName: 'Coach',
          shareLastNameWithCoaches: true,
          updatedAt: '2026-03-30T00:00:00Z',
        },
      });

    await act(async () => {
      render(<UserProfile />);
    });

    await userEvent.type(screen.getByLabelText('First Name'), 'Alex');
    await userEvent.click(screen.getByRole('button', { name: 'Save Profile' }));

    expect(await screen.findByText('Your profile was updated elsewhere.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText('Your profile was updated elsewhere.')).not.toBeInTheDocument();
  });
});
