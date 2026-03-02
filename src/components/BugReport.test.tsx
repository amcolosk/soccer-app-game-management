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
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Mocks — use vi.hoisted so variables are available inside vi.mock factories.
// ---------------------------------------------------------------------------

const { mockSubmitBugReport, mockShowWarning, mockHandleApiError, mockUploadData, mockFetchAuthSession } = vi.hoisted(() => ({
  mockSubmitBugReport: vi.fn(),
  mockShowWarning: vi.fn(),
  mockHandleApiError: vi.fn(),
  mockUploadData: vi.fn(),
  mockFetchAuthSession: vi.fn(),
}));

vi.mock("aws-amplify/data", () => ({
  generateClient: () => ({
    mutations: {
      submitBugReport: mockSubmitBugReport,
    },
  }),
}));

vi.mock("aws-amplify/storage", () => ({
  uploadData: (...args: unknown[]) => mockUploadData(...args),
}));

vi.mock("aws-amplify/auth", () => ({
  fetchAuthSession: (...args: unknown[]) => mockFetchAuthSession(...args),
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stub VITE_APP_VERSION for a single test via the proper Vitest API. */
function setViteAppVersion(value: string) {
  vi.stubEnv("VITE_APP_VERSION", value);
}

function renderBugReport(onClose = vi.fn(), extraProps: { gamePlannerContext?: GamePlannerDebugContext } = {}) {
  return { onClose, ...render(<BugReport onClose={onClose} {...extraProps} />) };
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

  it("submits without screenshotKey when no file is attached", async () => {
    mockSubmitBugReport.mockResolvedValue({ data: null });
    const user = userEvent.setup();
    renderBugReport();

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "Crash");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mockSubmitBugReport).toHaveBeenCalled());

    const arg = mockSubmitBugReport.mock.calls[0][0];
    expect(arg.screenshotKey).toBeUndefined();
    expect(mockUploadData).not.toHaveBeenCalled();
  });
});

describe("BugReport – screenshot attachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubmitBugReport.mockResolvedValue({ data: null });
    mockUploadData.mockReturnValue({ result: Promise.resolve({}) });
    mockFetchAuthSession.mockResolvedValue({ identityId: 'us-east-1:mock-identity-id' });
  });

  function makePngFile(sizeBytes = 1024) {
    return new File([new Uint8Array(sizeBytes)], "screenshot.png", { type: "image/png" });
  }

  function makeJpegFile() {
    return new File([new Uint8Array(512)], "screenshot.jpg", { type: "image/jpeg" });
  }

  it("renders the screenshot attach button", () => {
    renderBugReport();
    expect(screen.getByText(/attach screenshot/i)).toBeInTheDocument();
    expect(screen.getByText(/PNG or JPEG, max 5 MB/i)).toBeInTheDocument();
  });

  it("shows file preview after selecting a valid PNG", async () => {
    const user = userEvent.setup();
    renderBugReport();

    const input = document.getElementById("screenshot") as HTMLInputElement;
    const file = makePngFile();
    await user.upload(input, file);

    expect(screen.getByText(/screenshot\.png/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove screenshot/i })).toBeInTheDocument();
  });

  it("shows file preview after selecting a valid JPEG", async () => {
    const user = userEvent.setup();
    renderBugReport();

    const input = document.getElementById("screenshot") as HTMLInputElement;
    await user.upload(input, makeJpegFile());

    expect(screen.getByText(/screenshot\.jpg/)).toBeInTheDocument();
  });

  it("shows error and blocks submit for a file over 5 MB", async () => {
    const user = userEvent.setup();
    renderBugReport();

    const input = document.getElementById("screenshot") as HTMLInputElement;
    const bigFile = new File([new Uint8Array(6 * 1024 * 1024)], "big.png", { type: "image/png" });
    await user.upload(input, bigFile);

    expect(screen.getByText(/must be under 5 MB/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit report/i })).toBeDisabled();
  });

  it("shows error and blocks submit for a non-PNG/JPEG file type", async () => {
    renderBugReport();

    const input = document.getElementById("screenshot") as HTMLInputElement;
    const gifFile = new File([new Uint8Array(512)], "anim.gif", { type: "image/gif" });
    // Use fireEvent.change to bypass the input's `accept` attribute filter so we can
    // test our JS validation logic catches disallowed types.
    Object.defineProperty(input, "files", { value: [gifFile], configurable: true });
    fireEvent.change(input);

    expect(screen.getByText(/only PNG and JPEG/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit report/i })).toBeDisabled();
  });

  it("clears the file preview when the remove button is clicked", async () => {
    const user = userEvent.setup();
    renderBugReport();

    const input = document.getElementById("screenshot") as HTMLInputElement;
    await user.upload(input, makePngFile());
    expect(screen.getByText(/screenshot\.png/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /remove screenshot/i }));

    expect(screen.queryByText(/screenshot\.png/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit report/i })).not.toBeDisabled();
  });

  it("uploads file and passes screenshotKey to submitBugReport", async () => {
    const user = userEvent.setup();
    renderBugReport();

    const input = document.getElementById("screenshot") as HTMLInputElement;
    await user.upload(input, makePngFile());

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "Crash");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mockSubmitBugReport).toHaveBeenCalled());

    expect(mockUploadData).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringMatching(/^bug-screenshots\/.+\.png$/),
        data: expect.any(File),
        options: expect.objectContaining({ contentType: "image/png" }),
      })
    );

    const arg = mockSubmitBugReport.mock.calls[0][0];
    expect(arg.screenshotKey).toMatch(/^bug-screenshots\/.+\.png$/);
  });

  it("uses .jpg extension for JPEG files", async () => {
    const user = userEvent.setup();
    renderBugReport();

    const input = document.getElementById("screenshot") as HTMLInputElement;
    await user.upload(input, makeJpegFile());

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "Crash");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mockSubmitBugReport).toHaveBeenCalled());

    const arg = mockSubmitBugReport.mock.calls[0][0];
    expect(arg.screenshotKey).toMatch(/^bug-screenshots\/.+\.jpg$/);
  });

  it("submits report without screenshotKey when S3 upload fails", async () => {
    // Use mockImplementation (not mockReturnValue) so the rejected promise is created lazily
    // when uploadData() is actually called, preventing an unhandled rejection warning.
    mockUploadData.mockImplementation(() => ({ result: Promise.reject(new Error("S3 error")) }));

    const user = userEvent.setup();
    renderBugReport();

    const input = document.getElementById("screenshot") as HTMLInputElement;
    await user.upload(input, makePngFile());

    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "Crash");
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mockSubmitBugReport).toHaveBeenCalled());

    expect(mockShowWarning).toHaveBeenCalledWith(
      expect.stringContaining("Screenshot could not be uploaded")
    );

    const arg = mockSubmitBugReport.mock.calls[0][0];
    expect(arg.screenshotKey).toBeUndefined();
  });

  it("accepts a file that is exactly 5 MB (boundary — not over limit)", async () => {
    const user = userEvent.setup();
    renderBugReport();

    const input = document.getElementById("screenshot") as HTMLInputElement;
    const exactly5MB = new File([new Uint8Array(5 * 1024 * 1024)], "exact.png", { type: "image/png" });
    await user.upload(input, exactly5MB);

    // No error shown and submit button is enabled
    expect(screen.queryByText(/must be under 5 MB/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit report/i })).not.toBeDisabled();
  });

  it("shows 'Uploading screenshot…' label on the submit button during upload", async () => {
    // Keep the upload promise pending so we can observe the in-progress label
    let resolveUpload!: () => void;
    mockUploadData.mockImplementation(() => ({
      result: new Promise<void>((resolve) => { resolveUpload = resolve; }),
    }));

    const user = userEvent.setup();
    renderBugReport();

    const input = document.getElementById("screenshot") as HTMLInputElement;
    await user.upload(input, makePngFile());
    await user.type(screen.getByRole("textbox", { name: /what went wrong/i }), "Crash");

    // Click submit — upload starts but stays pending
    await user.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /uploading screenshot/i })).toBeInTheDocument()
    );

    // Resolve the upload to avoid lingering async work
    resolveUpload();
    await waitFor(() => expect(mockSubmitBugReport).toHaveBeenCalled());
  });

  it("clears the error and re-enables submit when a valid file replaces an invalid one", () => {
    renderBugReport();

    const input = document.getElementById("screenshot") as HTMLInputElement;

    // Upload an invalid file type first using fireEvent (bypasses accept filter)
    const gifFile = new File([new Uint8Array(512)], "anim.gif", { type: "image/gif" });
    Object.defineProperty(input, "files", { value: [gifFile], configurable: true });
    fireEvent.change(input);
    expect(screen.getByText(/only PNG and JPEG/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit report/i })).toBeDisabled();

    // Replace with a valid PNG using the same fireEvent approach for consistency
    const pngFile = makePngFile();
    Object.defineProperty(input, "files", { value: [pngFile], configurable: true });
    fireEvent.change(input);

    expect(screen.queryByText(/only PNG and JPEG/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit report/i })).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// gamePlannerContext fixture
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

describe("BugReport – gamePlannerContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubmitBugReport.mockResolvedValue({ data: null });
  });

  it("does not render debug snapshot button without gamePlannerContext", () => {
    renderBugReport();
    expect(screen.queryByRole("button", { name: /Copy planner state/i })).not.toBeInTheDocument();
  });

  it("renders debug snapshot button when gamePlannerContext is provided", () => {
    renderBugReport(vi.fn(), { gamePlannerContext: mockContext });
    expect(screen.getByRole("button", { name: /Copy planner state/i })).toBeInTheDocument();
  });

  it("clicking the button pre-populates steps textarea with snapshot text", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });

    renderBugReport(vi.fn(), { gamePlannerContext: mockContext });
    await user.click(screen.getByRole("button", { name: /Copy planner state/i }));

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

    renderBugReport(vi.fn(), { gamePlannerContext: mockContext });
    await user.click(screen.getByRole("button", { name: /Copy planner state/i }));

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

    renderBugReport(vi.fn(), { gamePlannerContext: mockContext });
    await user.click(screen.getByRole("button", { name: /Copy planner state/i }));

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

    renderBugReport(vi.fn(), { gamePlannerContext: mockContext });
    await user.click(screen.getByRole("button", { name: /Copy planner state/i }));

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

    renderBugReport(vi.fn(), { gamePlannerContext: mockContext });
    await user.click(screen.getByRole("button", { name: /Copy planner state/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Copied to clipboard/i })).toBeInTheDocument()
    );

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Copy planner state/i })).toBeInTheDocument()
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

    renderBugReport(vi.fn(), { gamePlannerContext: mockContext });
    await user.click(screen.getByRole("button", { name: /Copy planner state/i }));

    const stepsTextarea = screen.getByRole("textbox", { name: /steps to reproduce/i });
    expect((stepsTextarea as HTMLTextAreaElement).value).toContain('Game Planner Debug Snapshot');
  });
});
