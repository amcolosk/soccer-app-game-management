/**
 * Tests for the BugReport React component.
 *
 * Key behaviours covered:
 *  - Version in systemInfo uses VITE_APP_VERSION || '1.1.0'
 *  - Fallback '1.1.0' when VITE_APP_VERSION is absent/empty
 *  - Hash-bearing versions (e.g. '1.1.0+abc123ef' and '1.1.0-42+abc123ef') are passed through
 *  - UI renders correctly (form fields, severity options, char-count labels)
 *  - Empty description shows a warning and does NOT call the API
 *  - Successful submission shows the success screen
 *  - Issue number is displayed when the API returns one
 *  - Cancel button calls onClose
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Mocks — use vi.hoisted so variables are available inside vi.mock factories.
// ---------------------------------------------------------------------------

const { mockCreateGitHubIssue, mockShowWarning, mockHandleApiError } = vi.hoisted(() => ({
  mockCreateGitHubIssue: vi.fn(),
  mockShowWarning: vi.fn(),
  mockHandleApiError: vi.fn(),
}));

vi.mock("aws-amplify/data", () => ({
  generateClient: () => ({
    mutations: {
      createGitHubIssue: mockCreateGitHubIssue,
    },
  }),
}));

vi.mock("../utils/toast", () => ({
  showWarning: (...args: unknown[]) => mockShowWarning(...args),
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock("../utils/errorHandler", () => ({
  handleApiError: (...args: unknown[]) => mockHandleApiError(...args),
}));

import { BugReport } from "./BugReport";
import type { GamePlannerDebugContext } from "../types/debug";
import { buildDebugSnapshot } from "../utils/gamePlannerDebugUtils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stub VITE_APP_VERSION for a single test via the proper Vitest API. */
function setViteAppVersion(value: string) {
  vi.stubEnv("VITE_APP_VERSION", value);
}

function renderBugReport(onClose = vi.fn(), extraProps: { debugContext?: string | null } = {}) {
  return { onClose, ...render(<BugReport onClose={onClose} {...extraProps} />) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BugReport – version in systemInfo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateGitHubIssue.mockResolvedValue({ data: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes fallback version '1.1.0' in systemInfo when VITE_APP_VERSION is absent or empty", async () => {
    setViteAppVersion("");
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "Something broke");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mockCreateGitHubIssue).toHaveBeenCalled());

    const callArg = mockCreateGitHubIssue.mock.calls[0][0];
    const systemInfo = JSON.parse(callArg.systemInfo);
    expect(systemInfo.version).toBe("1.1.0");
  });

  it("passes the real version when VITE_APP_VERSION is set to a plain semver", async () => {
    setViteAppVersion("1.2.3");
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "Something broke");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mockCreateGitHubIssue).toHaveBeenCalled());

    const callArg = mockCreateGitHubIssue.mock.calls[0][0];
    const systemInfo = JSON.parse(callArg.systemInfo);
    expect(systemInfo.version).toBe("1.2.3");
  });

  it("passes the hash-suffixed version when VITE_APP_VERSION includes a commit hash", async () => {
    setViteAppVersion("1.1.0+abc123ef");
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "Something broke");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mockCreateGitHubIssue).toHaveBeenCalled());

    const callArg = mockCreateGitHubIssue.mock.calls[0][0];
    const systemInfo = JSON.parse(callArg.systemInfo);
    expect(systemInfo.version).toBe("1.1.0+abc123ef");
  });

  it("passes build-and-hash version when both suffixes are present", async () => {
    setViteAppVersion("1.1.0-42+abc123ef");
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "Something broke");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mockCreateGitHubIssue).toHaveBeenCalled());

    const callArg = mockCreateGitHubIssue.mock.calls[0][0];
    const systemInfo = JSON.parse(callArg.systemInfo);
    expect(systemInfo.version).toBe("1.1.0-42+abc123ef");
  });

  it("does not include the old fallback '1.0.0' anywhere in systemInfo", async () => {
    setViteAppVersion("");
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "Something broke");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mockCreateGitHubIssue).toHaveBeenCalled());

    const callArg = mockCreateGitHubIssue.mock.calls[0][0];
    expect(callArg.systemInfo).not.toContain("1.0.0");
  });
});

describe("BugReport – rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateGitHubIssue.mockResolvedValue({ data: null });
  });

  it("renders the form heading", () => {
    renderBugReport();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/Report a Bug/);
  });

  it("renders the description textarea", () => {
    renderBugReport();
    expect(screen.getByRole("textbox", { name: /what went wrong/i })).toBeInTheDocument();
  });

  it("renders the steps textarea", () => {
    renderBugReport();
    expect(screen.getByRole("textbox", { name: /steps to reproduce/i })).toBeInTheDocument();
  });

  it("renders the severity select with all four options", () => {
    renderBugReport();
    const select = screen.getByRole("combobox", { name: /severity/i });
    expect(select).toBeInTheDocument();
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(options).toContain("low");
    expect(options).toContain("medium");
    expect(options).toContain("high");
    expect(options).toContain("feature-request");
  });

  it("defaults the severity select to 'medium'", () => {
    renderBugReport();
    expect(screen.getByRole("combobox", { name: /severity/i })).toHaveValue("medium");
  });

  it("shows character count for description", () => {
    renderBugReport();
    expect(screen.getByText("0/5000")).toBeInTheDocument();
  });

  it("shows character count for steps", () => {
    renderBugReport();
    expect(screen.getByText("0/10000")).toBeInTheDocument();
  });

  it("renders Submit Report and Cancel buttons", () => {
    renderBugReport();
    expect(screen.getByRole("button", { name: /submit report/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("calls onClose when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const { onClose } = renderBugReport();
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when the close (✕) button is clicked", async () => {
    const user = userEvent.setup();
    const { onClose } = renderBugReport();
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("BugReport – validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateGitHubIssue.mockResolvedValue({ data: null });
  });

  it("shows a warning and does not call the API when description is empty", () => {
    renderBugReport();

    // fireEvent.submit bypasses the textarea's HTML5 `required` constraint so
    // the component's own JS validation (and showWarning call) is exercised.
    const form = screen.getByRole("button", { name: /submit report/i }).closest("form")!;
    fireEvent.submit(form);

    expect(mockShowWarning).toHaveBeenCalledWith("Please describe the issue");
    expect(mockCreateGitHubIssue).not.toHaveBeenCalled();
  });

  it("shows a warning and does not call the API when description is only whitespace", async () => {
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "   ");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    expect(mockShowWarning).toHaveBeenCalledWith("Please describe the issue");
    expect(mockCreateGitHubIssue).not.toHaveBeenCalled();
  });

  it("shows a warning and does not call the API when steps exceed max length", async () => {
    renderBugReport();

    // Simulate pasting a very long debug snapshot (> 10 000 chars) via fireEvent, which is
    // how the "Copy debug context" button pre-populates steps programmatically.
    // JS validation must block the submit even though the textarea has no maxLength attribute.
    fireEvent.change(screen.getByRole("textbox", { name: /steps to reproduce/i }), {
      target: { value: "x".repeat(10001) },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /what went wrong/i }), {
      target: { value: "Bug description" },
    });

    const form = screen.getByRole("button", { name: /submit report/i }).closest("form")!;
    fireEvent.submit(form);

    expect(mockShowWarning).toHaveBeenCalledWith(expect.stringContaining("maximum length"));
    expect(mockCreateGitHubIssue).not.toHaveBeenCalled();
  });
});

describe("BugReport – submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows success screen after successful submission", async () => {
    mockCreateGitHubIssue.mockResolvedValue({ data: null });
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "App crashed");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(screen.getByText(/thank you/i)).toBeInTheDocument());
  });

  it("displays issue number in success screen when API returns one", async () => {
    mockCreateGitHubIssue.mockResolvedValue({
      data: JSON.stringify({ issueNumber: 99, issueUrl: "https://github.com/owner/repo/issues/99" }),
    });
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "App crashed");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(screen.getByText(/GitHub Issue #99/)).toBeInTheDocument());
  });

  it("shows 'View on GitHub' link with correct href after successful submission", async () => {
    mockCreateGitHubIssue.mockResolvedValue({
      data: JSON.stringify({ issueNumber: 99, issueUrl: "https://github.com/owner/repo/issues/99" }),
    });
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "App crashed");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    const link = await screen.findByRole("link", { name: /view on github/i });
    expect(link).toHaveAttribute("href", "https://github.com/owner/repo/issues/99");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("shows generic success message when API returns no issue number", async () => {
    mockCreateGitHubIssue.mockResolvedValue({ data: null });
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "App crashed");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() =>
      expect(screen.getByText(/bug report has been submitted successfully/i)).toBeInTheDocument()
    );
  });

  it("passes description, severity, and steps to the API", async () => {
    mockCreateGitHubIssue.mockResolvedValue({ data: null });
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "Crash on save");
    await user.type(screen.getByRole("textbox", { name: /steps to reproduce/i }), "1. Click save");
    await user.selectOptions(screen.getByRole("combobox", { name: /severity/i }), "high");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mockCreateGitHubIssue).toHaveBeenCalled());

    const arg = mockCreateGitHubIssue.mock.calls[0][0];
    expect(arg.description).toBe("Crash on save");
    expect(arg.steps).toBe("1. Click save");
    expect(arg.severity).toBe("high");
  });

  it("calls handleApiError when the API throws", async () => {
    mockCreateGitHubIssue.mockRejectedValue(new Error("Network error"));
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "Crash");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mockHandleApiError).toHaveBeenCalled());
    expect(screen.queryByText(/thank you/i)).not.toBeInTheDocument();
  });

  it("includes systemInfo with required fields in the submission", async () => {
    mockCreateGitHubIssue.mockResolvedValue({ data: null });
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "Crash");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mockCreateGitHubIssue).toHaveBeenCalled());

    const arg = mockCreateGitHubIssue.mock.calls[0][0];
    const systemInfo = JSON.parse(arg.systemInfo);
    expect(systemInfo).toHaveProperty("userAgent");
    expect(systemInfo).toHaveProperty("screenSize");
    expect(systemInfo).toHaveProperty("viewport");
    expect(systemInfo).toHaveProperty("timestamp");
    expect(systemInfo).toHaveProperty("url");
    expect(systemInfo).toHaveProperty("version");
  });

  it("includes full window.location.href in systemInfo url", async () => {
    mockCreateGitHubIssue.mockResolvedValue({ data: null });
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "Crash");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mockCreateGitHubIssue).toHaveBeenCalled());

    const arg = mockCreateGitHubIssue.mock.calls[0][0];
    const systemInfo = JSON.parse(arg.systemInfo);
    expect(systemInfo.url).toBe(window.location.href);
  });

  it("does not show success screen when API returns errors array", async () => {
    mockCreateGitHubIssue.mockResolvedValue({
      data: null,
      errors: [{ message: "Rate limit exceeded. Try again later." }],
    });
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "Crash");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mockHandleApiError).toHaveBeenCalled());
    expect(screen.queryByText(/thank you/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// debugContext fixture
// ---------------------------------------------------------------------------

const mockContext: GamePlannerDebugContext = {
  rotationIntervalMinutes: 10,
  halfLengthMinutes: 30,
  maxPlayersOnField: 7,
  availablePlayerCount: 9,
  players: [
    { number: 7, status: 'available', availableFromMinute: null, availableUntilMinute: null },
    { number: 12, status: 'late-arrival', availableFromMinute: 30, availableUntilMinute: null },
  ],
};

// Pre-build the debug string once — tests pass this to the debugContext prop
const mockDebugString = buildDebugSnapshot(mockContext);

describe("BugReport – debugContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateGitHubIssue.mockResolvedValue({ data: null });
  });

  it("does not render debug snapshot button without debugContext", () => {
    renderBugReport();
    expect(screen.queryByRole("button", { name: /Copy debug context/i })).not.toBeInTheDocument();
  });

  it("renders debug snapshot button when debugContext is provided", () => {
    renderBugReport(vi.fn(), { debugContext: mockDebugString });
    expect(screen.getByRole("button", { name: /Copy debug context/i })).toBeInTheDocument();
  });

  it("clicking the button pre-populates steps textarea with snapshot text", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });

    renderBugReport(vi.fn(), { debugContext: mockDebugString });
    await user.click(screen.getByRole("button", { name: /Copy debug context/i }));

    const stepsTextarea = screen.getByRole("textbox", { name: /steps to reproduce/i });
    expect((stepsTextarea as HTMLTextAreaElement).value).toContain('Game Planner Debug Snapshot');
  });

  it("snapshot includes rotation interval, half length, max players, player count", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });

    renderBugReport(vi.fn(), { debugContext: mockDebugString });
    await user.click(screen.getByRole("button", { name: /Copy debug context/i }));

    const stepsTextarea = screen.getByRole("textbox", { name: /steps to reproduce/i });
    const value = (stepsTextarea as HTMLTextAreaElement).value;
    expect(value).toContain('Rotation interval: 10 min');
    expect(value).toContain('Half length: 30 min');
    expect(value).toContain('Max players on field: 7');
    expect(value).toContain('Available players: 9');
  });

  it("snapshot includes player jersey number and status", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });

    renderBugReport(vi.fn(), { debugContext: mockDebugString });
    await user.click(screen.getByRole("button", { name: /Copy debug context/i }));

    const stepsTextarea = screen.getByRole("textbox", { name: /steps to reproduce/i });
    const value = (stepsTextarea as HTMLTextAreaElement).value;
    expect(value).toContain('#7 — available');
    expect(value).toContain('#12 — late-arrival');
  });

  it("clicking the button calls navigator.clipboard.writeText", async () => {
    const user = userEvent.setup();
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mockWriteText },
      writable: true,
      configurable: true,
    });

    renderBugReport(vi.fn(), { debugContext: mockDebugString });
    await user.click(screen.getByRole("button", { name: /Copy debug context/i }));

    expect(mockWriteText).toHaveBeenCalledWith(expect.stringContaining('Game Planner Debug Snapshot'));
  });

  it("shows Copied feedback and then resets after timeout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });

    renderBugReport(vi.fn(), { debugContext: mockDebugString });
    await user.click(screen.getByRole("button", { name: /Copy debug context/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Copied to clipboard/i })).toBeInTheDocument()
    );

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Copy debug context/i })).toBeInTheDocument()
    );

    vi.useRealTimers();
  });

  it("still pre-populates steps when clipboard API is unavailable", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    renderBugReport(vi.fn(), { debugContext: mockDebugString });
    await user.click(screen.getByRole("button", { name: /Copy debug context/i }));

    const stepsTextarea = screen.getByRole("textbox", { name: /steps to reproduce/i });
    expect((stepsTextarea as HTMLTextAreaElement).value).toContain('Game Planner Debug Snapshot');
  });
});
