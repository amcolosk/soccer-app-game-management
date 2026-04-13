/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlayerNotesPanel } from "./PlayerNotesPanel";

vi.mock("../../utils/toast", () => ({
  showWarning: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
  showInfo: vi.fn(),
}));

const speechState = {
  isSupported: true,
  status: "idle",
  isListening: false,
  interimTranscript: "",
  errorCode: null,
  lowConfidenceDetected: false,
  start: vi.fn(),
  stop: vi.fn(),
};

vi.mock("./hooks/useSpeechToText", () => ({
  useSpeechToText: vi.fn(() => speechState),
}));

vi.mock("../PlayerSelect", () => ({
  PlayerSelect: ({ id, placeholder }: any) => (
    <select data-testid={id}>
      <option>{placeholder}</option>
    </select>
  ),
}));

const makeGameState = (overrides = {}) => ({
  id: "game-1",
  status: "in-progress",
  currentHalf: 1,
  opponent: "Eagles",
  ...overrides,
});

const players = [
  { id: "p1", playerNumber: 10, firstName: "Alice", lastName: "Smith" },
] as any[];

const createGameNote = vi.fn().mockResolvedValue(undefined);
const defaultProps = {
  gameState: makeGameState() as any,
  game: { id: "game-1" } as any,
  team: { coaches: ["coach-1"] } as any,
  players,
  gameNotes: [] as any[],
  currentTime: 600,
  mutations: {
    createGameNote,
  } as any,
};

describe("PlayerNotesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    speechState.isSupported = true;
    speechState.status = "idle";
    speechState.isListening = false;
    speechState.interimTranscript = "";
    speechState.errorCode = null;
    speechState.lowConfidenceDetected = false;
  });

  it("shows in-progress note buttons", () => {
    render(<PlayerNotesPanel {...defaultProps} />);
    expect(screen.getByText(/Gold Star/)).toBeInTheDocument();
    expect(screen.getByText(/Yellow Card/)).toBeInTheDocument();
    expect(screen.getByText(/Red Card/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /note/i })).toBeInTheDocument();
  });

  it("opens modal when note action button is clicked", async () => {
    const user = userEvent.setup();
    render(<PlayerNotesPanel {...defaultProps} />);

    await user.click(screen.getByText(/Gold Star/));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Gold Star");
    expect(screen.getByText("Save Note")).toBeInTheDocument();
  });

  it("keeps persistence behind explicit Save only", async () => {
    const user = userEvent.setup();
    render(<PlayerNotesPanel {...defaultProps} />);

    await user.click(screen.getByText(/Gold Star/));
    await user.click(screen.getByRole("button", { name: /start english dictation/i }));

    expect(createGameNote).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Note"), "Great press");
    await user.click(screen.getByRole("button", { name: "Save Note" }));

    expect(createGameNote).toHaveBeenCalledTimes(1);
    expect(createGameNote).toHaveBeenCalledWith(expect.objectContaining({
      noteType: "gold-star",
      notes: "Great press",
    }));
  });

  it("shows unsupported fallback helper when speech API is unavailable", async () => {
    const user = userEvent.setup();
    speechState.isSupported = false;

    render(<PlayerNotesPanel {...defaultProps} />);
    await user.click(screen.getByText(/Gold Star/));

    expect(screen.getByText(/Voice capture is not supported in this browser/i)).toBeInTheDocument();
  });

  it("shows low-confidence advisory when confidence is below threshold", async () => {
    const user = userEvent.setup();
    speechState.lowConfidenceDetected = true;

    render(<PlayerNotesPanel {...defaultProps} />);
    await user.click(screen.getByText(/Gold Star/));

    expect(screen.getByText(/Transcription may be inaccurate/i)).toBeInTheDocument();
  });

  it("supports externally controlled shared modal open intent", () => {
    render(
      <PlayerNotesPanel
        {...defaultProps}
        showPanelContent={false}
        isNoteModalOpen={true}
        noteModalRequestId={1}
        noteModalIntent={{ source: "command-band", defaultType: "other" }}
        onRequestOpenNote={vi.fn()}
        onRequestCloseNote={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Note");
  });

  it("enforces 500-character limit in note input", async () => {
    const user = userEvent.setup();
    render(<PlayerNotesPanel {...defaultProps} />);

    await user.click(screen.getByText(/Gold Star/));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "a".repeat(600) } });

    const textarea = screen.getByLabelText("Note") as HTMLTextAreaElement;
    expect(textarea.value.length).toBe(500);
    expect(screen.getByText("500 / 500")).toBeInTheDocument();
  });

  // ── Transient state tests ────────────────────────────────────────────────

  it("(a) disables dictation button and shows helper copy when status is 'starting'", async () => {
    const user = userEvent.setup();
    speechState.status = "starting";

    render(<PlayerNotesPanel {...defaultProps} />);
    await user.click(screen.getByRole("button", { name: /Gold Star/i }));

    const dictBtn = screen.getByRole("button", { name: /dictation/i });
    expect(dictBtn).toBeDisabled();
    // Text appears in both the sr-only polite region and the visible helper copy
    expect(screen.getAllByText("Starting microphone...").length).toBeGreaterThanOrEqual(1);
  });

  it("(b) disables dictation button and shows helper copy when status is 'stopping'", async () => {
    const user = userEvent.setup();
    speechState.status = "stopping";

    render(<PlayerNotesPanel {...defaultProps} />);
    await user.click(screen.getByRole("button", { name: /Gold Star/i }));

    const dictBtn = screen.getByRole("button", { name: /dictation/i });
    expect(dictBtn).toBeDisabled();
    // Text appears in both the sr-only polite region and the visible helper copy
    expect(screen.getAllByText("Stopping microphone...").length).toBeGreaterThanOrEqual(1);
  });

  // ── Permission-denied assertive message ──────────────────────────────────

  it("(c) shows assertive inline message when mic permission is denied", async () => {
    const user = userEvent.setup();
    speechState.errorCode = "not-allowed";

    render(<PlayerNotesPanel {...defaultProps} />);
    await user.click(screen.getByRole("button", { name: /Gold Star/i }));

    expect(screen.getByText(/Microphone permission denied/i)).toBeInTheDocument();
  });

  // ── aria-live routing ─────────────────────────────────────────────────────

  it("(d) routes polite message through sr-only live region; interim paragraph has no aria-live", async () => {
    const user = userEvent.setup();
    speechState.status = "starting";
    speechState.interimTranscript = "testing one two";

    render(<PlayerNotesPanel {...defaultProps} />);
    await user.click(screen.getByRole("button", { name: /Gold Star/i }));

    // Only the sr-only div should carry aria-live="polite" (not the interim paragraph)
    const politeRegion = document.querySelector('.sr-only[aria-live="polite"]');
    expect(politeRegion).toBeInTheDocument();

    const interimPara = document.querySelector(".note-modal__interim");
    expect(interimPara).toBeInTheDocument();
    expect(interimPara).not.toHaveAttribute("aria-live");
  });

  // ── Focus return after close ──────────────────────────────────────────────

  it("(e) returns focus to the opener button after modal is closed via Cancel", async () => {
    const user = userEvent.setup();
    render(<PlayerNotesPanel {...defaultProps} />);

    const goldStarBtn = screen.getByRole("button", { name: /Gold Star/i });
    await user.click(goldStarBtn);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(goldStarBtn);
  });

  // ── Quick-intent pre-selection ────────────────────────────────────────────

  it("(f1) opens with Gold Star type pre-selected when opened via gold-star button", async () => {
    const user = userEvent.setup();
    render(<PlayerNotesPanel {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: /Gold Star/i }));

    const typeChips = screen.getAllByRole("button", { name: /Gold Star/i });
    const activeChip = typeChips.find((el) => el.classList.contains("note-modal__type-chip"));
    expect(activeChip).toBeDefined();
    expect(activeChip).toHaveClass("active");
  });

  it("(f2) opens with Yellow Card type pre-selected when opened via yellow-card button", async () => {
    const user = userEvent.setup();
    render(<PlayerNotesPanel {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: /Yellow Card/i }));

    const typeChips = screen.getAllByRole("button", { name: /Yellow Card/i });
    const activeChip = typeChips.find((el) => el.classList.contains("note-modal__type-chip"));
    expect(activeChip).toBeDefined();
    expect(activeChip).toHaveClass("active");
  });

  it("Cancel button dismisses modal in internal mode", async () => {
    const user = userEvent.setup();
    render(<PlayerNotesPanel {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: /Gold Star/i }));
    expect(screen.queryByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("external control: Cancel calls onRequestCloseNote", async () => {
    const user = userEvent.setup();
    const onRequestCloseNote = vi.fn();

    render(
      <PlayerNotesPanel
        {...defaultProps}
        isNoteModalOpen={true}
        noteModalRequestId={1}
        noteModalIntent={{ source: "command-band", defaultType: "other" }}
        onRequestOpenNote={vi.fn()}
        onRequestCloseNote={onRequestCloseNote}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onRequestCloseNote).toHaveBeenCalledOnce();
  });

  // ── Regression: issue #84 — notes not appearing after save ─────────────────

  it("(regression #84) note with valid gameSeconds and half appears in the notes list", () => {
    const existingNote = {
      id: "note-1",
      noteType: "gold-star",
      gameSeconds: 600,
      half: 1,
      playerId: null,
      notes: "Great press",
      timestamp: new Date().toISOString(),
    } as any;

    render(
      <PlayerNotesPanel
        {...defaultProps}
        gameNotes={[existingNote]}
        showPanelContent={true}
      />
    );

    // The note must be visible — documents the invariant that valid records pass the inGameNotes filter
    const noteCard = document.querySelector(".note-card");
    expect(noteCard).toBeInTheDocument();
  });

  it("(regression #84) note arriving from subscription with null gameSeconds is filtered out (bug reproduction)", () => {
    const noteSavedViaLambda = {
      id: "note-lambda-1",
      noteType: "gold-star",
      gameSeconds: null,       // ← arrives null from subscription (the bug)
      half: null,
      playerId: null,
      notes: "Great press",
      timestamp: new Date().toISOString(),
    } as any;

    render(
      <PlayerNotesPanel
        {...defaultProps}
        gameNotes={[noteSavedViaLambda]}
        showPanelContent={true}
      />
    );

    // BUG: the note is NOT shown even though it was just saved.
    // After the fix (notes refresh after save so the note arrives with real gameSeconds/half),
    // the note should appear with correct data — this assertion will pass after the fix.
    const noteCard = document.querySelector(".note-card");
    expect(noteCard).toBeInTheDocument(); // FAILS currently — will pass after fix
  });
});
