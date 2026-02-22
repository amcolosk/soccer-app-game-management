/**
 * Tests for the BugReport React component.
 *
 * Key behaviours covered:
 *  - Version in systemInfo uses VITE_APP_VERSION || '1.1.0'
 *  - Fallback '1.1.0' when VITE_APP_VERSION is absent/empty
 *  - Version with build-ID suffix (e.g. '1.1.0-42') is passed through
 *  - UI renders correctly (form fields, severity options, char-count labels)
 *  - Empty description shows a warning and does NOT call the API
 *  - Successful submission shows the success screen
 *  - Issue number is displayed when the API returns one
 *  - Cancel button calls onClose
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Mocks — use vi.hoisted so variables are available inside vi.mock factories.
// ---------------------------------------------------------------------------

const { mockSubmitBugReport, mockShowWarning, mockHandleApiError } = vi.hoisted(() => ({
  mockSubmitBugReport: vi.fn(),
  mockShowWarning: vi.fn(),
  mockHandleApiError: vi.fn(),
}));

vi.mock("aws-amplify/data", () => ({
  generateClient: () => ({
    mutations: {
      submitBugReport: mockSubmitBugReport,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stub VITE_APP_VERSION for a single test via the proper Vitest API. */
function setViteAppVersion(value: string) {
  vi.stubEnv("VITE_APP_VERSION", value);
}

function renderBugReport(onClose = vi.fn()) {
  return { onClose, ...render(<BugReport onClose={onClose} />) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BugReport – version in systemInfo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubmitBugReport.mockResolvedValue({ data: null });
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

    await waitFor(() => expect(mockSubmitBugReport).toHaveBeenCalled());

    const callArg = mockSubmitBugReport.mock.calls[0][0];
    const systemInfo = JSON.parse(callArg.systemInfo);
    expect(systemInfo.version).toBe("1.1.0");
  });

  it("passes the real version when VITE_APP_VERSION is set to a plain semver", async () => {
    setViteAppVersion("1.2.3");
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "Something broke");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mockSubmitBugReport).toHaveBeenCalled());

    const callArg = mockSubmitBugReport.mock.calls[0][0];
    const systemInfo = JSON.parse(callArg.systemInfo);
    expect(systemInfo.version).toBe("1.2.3");
  });

  it("passes the build-ID-suffixed version when VITE_APP_VERSION includes AWS_JOB_ID", async () => {
    // Reflects vite.config.ts: fullVersion = `${version}-${buildId}` when AWS_JOB_ID is set.
    setViteAppVersion("1.1.0-42");
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "Something broke");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mockSubmitBugReport).toHaveBeenCalled());

    const callArg = mockSubmitBugReport.mock.calls[0][0];
    const systemInfo = JSON.parse(callArg.systemInfo);
    expect(systemInfo.version).toBe("1.1.0-42");
  });

  it("does not include the old fallback '1.0.0' anywhere in systemInfo", async () => {
    setViteAppVersion("");
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "Something broke");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mockSubmitBugReport).toHaveBeenCalled());

    const callArg = mockSubmitBugReport.mock.calls[0][0];
    expect(callArg.systemInfo).not.toContain("1.0.0");
  });
});

describe("BugReport – rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubmitBugReport.mockResolvedValue({ data: null });
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
    expect(screen.getByText("0/3000")).toBeInTheDocument();
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
    mockSubmitBugReport.mockResolvedValue({ data: null });
  });

  it("shows a warning and does not call the API when description is empty", () => {
    renderBugReport();

    // fireEvent.submit bypasses the textarea's HTML5 `required` constraint so
    // the component's own JS validation (and showWarning call) is exercised.
    const form = screen.getByRole("button", { name: /submit report/i }).closest("form")!;
    fireEvent.submit(form);

    expect(mockShowWarning).toHaveBeenCalledWith("Please describe the issue");
    expect(mockSubmitBugReport).not.toHaveBeenCalled();
  });

  it("shows a warning and does not call the API when description is only whitespace", async () => {
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "   ");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    expect(mockShowWarning).toHaveBeenCalledWith("Please describe the issue");
    expect(mockSubmitBugReport).not.toHaveBeenCalled();
  });
});

describe("BugReport – submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows success screen after successful submission", async () => {
    mockSubmitBugReport.mockResolvedValue({ data: null });
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "App crashed");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(screen.getByText(/thank you/i)).toBeInTheDocument());
  });

  it("displays issue number in success screen when API returns one", async () => {
    mockSubmitBugReport.mockResolvedValue({ data: JSON.stringify({ issueNumber: 99 }) });
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "App crashed");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(screen.getByText(/Issue #99/)).toBeInTheDocument());
  });

  it("shows generic success message when API returns no issue number", async () => {
    mockSubmitBugReport.mockResolvedValue({ data: null });
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "App crashed");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() =>
      expect(screen.getByText(/bug report has been submitted successfully/i)).toBeInTheDocument()
    );
  });

  it("passes description, severity, and steps to the API", async () => {
    mockSubmitBugReport.mockResolvedValue({ data: null });
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "Crash on save");
    await user.type(screen.getByRole("textbox", { name: /steps to reproduce/i }), "1. Click save");
    await user.selectOptions(screen.getByRole("combobox", { name: /severity/i }), "high");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mockSubmitBugReport).toHaveBeenCalled());

    const arg = mockSubmitBugReport.mock.calls[0][0];
    expect(arg.description).toBe("Crash on save");
    expect(arg.steps).toBe("1. Click save");
    expect(arg.severity).toBe("high");
  });

  it("calls handleApiError when the API throws", async () => {
    mockSubmitBugReport.mockRejectedValue(new Error("Network error"));
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "Crash");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mockHandleApiError).toHaveBeenCalled());
    expect(screen.queryByText(/thank you/i)).not.toBeInTheDocument();
  });

  it("includes systemInfo with required fields in the submission", async () => {
    mockSubmitBugReport.mockResolvedValue({ data: null });
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "Crash");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mockSubmitBugReport).toHaveBeenCalled());

    const arg = mockSubmitBugReport.mock.calls[0][0];
    const systemInfo = JSON.parse(arg.systemInfo);
    expect(systemInfo).toHaveProperty("userAgent");
    expect(systemInfo).toHaveProperty("screenSize");
    expect(systemInfo).toHaveProperty("viewport");
    expect(systemInfo).toHaveProperty("timestamp");
    expect(systemInfo).toHaveProperty("url");
    expect(systemInfo).toHaveProperty("version");
  });
});
