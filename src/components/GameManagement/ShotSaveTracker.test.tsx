/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { showSuccess } from "../../utils/toast";
import { ShotSaveTracker } from "./ShotSaveTracker";
import { ConfirmProvider } from "../ConfirmModal";

function renderWithProvider(ui: React.ReactElement) {
  return render(<ConfirmProvider>{ui}</ConfirmProvider>);
}

vi.mock("../../utils/toast", () => ({
  showWarning: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock("../PlayerSelect", () => ({
  PlayerSelect: ({ id, placeholder, value, onChange }: any) => (
    <select
      data-testid={id ?? placeholder}
      value={value ?? ''}
      onChange={e => onChange?.(e.target.value)}
    >
      <option value="">{placeholder}</option>
      <option value="p1">p1</option>
      <option value="p2">p2</option>
    </select>
  ),
}));

const makeGameState = (overrides = {}) => ({
  id: "game-1",
  status: "in-progress",
  currentHalf: 1,
  opponent: "Eagles",
  ourScore: 1,
  opponentScore: 0,
  ...overrides,
});

const players = [
  { id: "p1", playerNumber: 10, firstName: "Alice", lastName: "Smith" },
  { id: "p2", playerNumber: 7, firstName: "Bob", lastName: "Jones" },
] as any[];

const mockDeleteShot = vi.fn().mockResolvedValue(undefined);
const mockUpdateShot = vi.fn().mockResolvedValue(undefined);
const mockDeleteSave = vi.fn().mockResolvedValue(undefined);
const mockUpdateSave = vi.fn().mockResolvedValue(undefined);

const makeMutations = (overrides: Record<string, any> = {}) => ({
  deleteShot: mockDeleteShot,
  updateShot: mockUpdateShot,
  deleteSave: mockDeleteSave,
  updateSave: mockUpdateSave,
  ...overrides,
});

// ShotSaveTracker now only needs gameState/players/shots/saves/statView/
// mutations/playTimeRecords/positions -- creation moved to
// ShotOutcomeEntry.tsx.
const defaultProps = {
  gameState: makeGameState() as any,
  players,
  shots: [] as any[],
  saves: [] as any[],
  mutations: makeMutations() as any,
  playTimeRecords: [] as any[],
  positions: [] as any[],
};

describe("ShotSaveTracker", () => {
  beforeEach(() => {
    mockDeleteShot.mockReset().mockResolvedValue(undefined);
    mockUpdateShot.mockReset().mockResolvedValue(undefined);
    mockDeleteSave.mockReset().mockResolvedValue(undefined);
    mockUpdateSave.mockReset().mockResolvedValue(undefined);
    vi.mocked(showSuccess).mockClear();
  });

  describe("stats list — outcome badge and edit-visibility gate", () => {
    const shotsData = [
      { id: "s1", takenByUs: true, outcome: "GOAL", gameSeconds: 600, half: 1, playerId: "p1" },
      { id: "s2", takenByUs: false, outcome: "BLOCKED", gameSeconds: 1200, half: 1, playerId: null },
    ] as any[];

    it("renders stat cards with minute and half", () => {
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={shotsData} />);
      expect(screen.getByText("10'")).toBeInTheDocument();
      expect(screen.getByText("20'")).toBeInTheDocument();
    });

    it("renders a color-coded outcome badge per shot (Q2/UI review)", () => {
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={shotsData} />);
      expect(screen.getByText("Goal")).toHaveClass("shot-outcome-badge--goal");
      expect(screen.getByText("Blocked")).toHaveClass("shot-outcome-badge--neutral");
    });

    it("shows Edit and Delete for an Us-attributed row", () => {
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={shotsData} />);
      expect(screen.getByRole("button", { name: /Edit Us shot at 10'/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Delete Us shot at 10'/ })).toBeInTheDocument();
    });

    it("does not render the stats section when empty", () => {
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={[]} />);
      expect(screen.queryByText("Shots")).not.toBeInTheDocument();
    });

    it("shows empty state in completed when no shots", () => {
      renderWithProvider(
        <ShotSaveTracker
          {...defaultProps}
          statView="shots"
          shots={[]}
          gameState={makeGameState({ status: "completed" }) as any}
        />
      );
      expect(screen.getByText(/No shots recorded yet/)).toBeInTheDocument();
    });

    describe("Edit-visibility gate (UI review Major) — Shot vs. Save now diverge", () => {
      it("a 'Them' Shot with outcome BLOCKED shows the Edit action", () => {
        const them = [{ id: "s-blocked", takenByUs: false, outcome: "BLOCKED", gameSeconds: 60, half: 1, playerId: null }] as any[];
        renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={them} />);
        expect(screen.getByRole("button", { name: /Edit Eagles shot at 1'/ })).toBeInTheDocument();
      });

      it("a 'Them' Shot with outcome WIDE shows the Edit action", () => {
        const them = [{ id: "s-wide", takenByUs: false, outcome: "WIDE", gameSeconds: 60, half: 1, playerId: null }] as any[];
        renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={them} />);
        expect(screen.getByRole("button", { name: /Edit Eagles shot at 1'/ })).toBeInTheDocument();
      });

      it.each(["GOAL", "SAVED", null])("a 'Them' Shot with outcome %s shows no Edit action", (outcome) => {
        const them = [{ id: "s-x", takenByUs: false, outcome, gameSeconds: 60, half: 1, playerId: null }] as any[];
        renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={them} />);
        expect(screen.queryByRole("button", { name: /Edit Eagles shot at 1'/ })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Delete Eagles shot at 1'/ })).toBeInTheDocument();
      });

      it("a 'Them' Save (any state) shows no Edit action -- gate unchanged for Save", () => {
        const them = [{ id: "sv-x", byUs: false, gameSeconds: 60, half: 1, playerId: null }] as any[];
        renderWithProvider(<ShotSaveTracker {...defaultProps} statView="saves" saves={them} />);
        expect(screen.queryByRole("button", { name: /Edit Eagles save at 1'/ })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Delete Eagles save at 1'/ })).toBeInTheDocument();
      });
    });
  });

  describe("edit modal — M1 outcome guardrail", () => {
    it("shows an editable outcome dropdown only for a BLOCKED-outcome shot", async () => {
      const user = userEvent.setup();
      const shotsData = [{ id: "s1", takenByUs: true, outcome: "BLOCKED", gameSeconds: 600, half: 1, playerId: "p1" }] as any[];
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={shotsData} />);
      await user.click(screen.getByRole("button", { name: /Edit Us shot at 10'/ }));
      expect(screen.getByLabelText("Outcome")).toBeInTheDocument();
      expect(screen.getByLabelText("Outcome").tagName).toBe("SELECT");
    });

    it("shows an editable outcome dropdown for a WIDE-outcome shot", async () => {
      const user = userEvent.setup();
      const shotsData = [{ id: "s1", takenByUs: true, outcome: "WIDE", gameSeconds: 600, half: 1, playerId: "p1" }] as any[];
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={shotsData} />);
      await user.click(screen.getByRole("button", { name: /Edit Us shot at 10'/ }));
      expect(screen.getByLabelText("Outcome").tagName).toBe("SELECT");
    });

    it("shows a read-only label (no editable dropdown) for a GOAL-outcome shot", async () => {
      const user = userEvent.setup();
      const shotsData = [{ id: "s1", takenByUs: true, outcome: "GOAL", gameSeconds: 600, half: 1, playerId: "p1" }] as any[];
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={shotsData} />);
      await user.click(screen.getByRole("button", { name: /Edit Us shot at 10'/ }));
      expect(screen.queryByRole("combobox", { name: "Outcome" })).not.toBeInTheDocument();
      expect(screen.getByText(/Goal — delete and re-log to change the outcome/)).toBeInTheDocument();
    });

    it("shows a read-only label for a SAVED-outcome shot", async () => {
      const user = userEvent.setup();
      const shotsData = [{ id: "s1", takenByUs: true, outcome: "SAVED", gameSeconds: 600, half: 1, playerId: "p1" }] as any[];
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={shotsData} />);
      await user.click(screen.getByRole("button", { name: /Edit Us shot at 10'/ }));
      expect(screen.getByText(/Saved — delete and re-log to change the outcome/)).toBeInTheDocument();
    });

    it("M1: editing the shooter on a GOAL-outcome shot keeps outcome GOAL -- updateShot is called WITHOUT an outcome key", async () => {
      const user = userEvent.setup();
      const shotsData = [{ id: "s1", takenByUs: true, outcome: "GOAL", gameSeconds: 600, half: 1, playerId: "p1" }] as any[];
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={shotsData} />);
      await user.click(screen.getByRole("button", { name: /Edit Us shot at 10'/ }));
      await user.selectOptions(screen.getByTestId("editshotsPlayer"), "p2");
      await user.click(screen.getByText("Save Changes"));
      await waitFor(() => expect(mockUpdateShot).toHaveBeenCalled());
      const call = mockUpdateShot.mock.calls[0];
      expect(call[0]).toBe("s1");
      expect(call[1]).not.toHaveProperty("outcome");
      expect(call[1]).toEqual({ playerId: "p2" });
    });

    it("companion case: editing the shooter on a SAVED-outcome shot keeps outcome unchanged", async () => {
      const user = userEvent.setup();
      const shotsData = [{ id: "s1", takenByUs: true, outcome: "SAVED", gameSeconds: 600, half: 1, playerId: "p1" }] as any[];
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={shotsData} />);
      await user.click(screen.getByRole("button", { name: /Edit Us shot at 10'/ }));
      await user.selectOptions(screen.getByTestId("editshotsPlayer"), "p2");
      await user.click(screen.getByText("Save Changes"));
      await waitFor(() => expect(mockUpdateShot).toHaveBeenCalledWith("s1", { playerId: "p2" }));
    });

    it("changing the outcome dropdown on a BLOCKED shot to WIDE sends the new outcome", async () => {
      const user = userEvent.setup();
      const shotsData = [{ id: "s1", takenByUs: true, outcome: "BLOCKED", gameSeconds: 600, half: 1, playerId: "p1" }] as any[];
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={shotsData} />);
      await user.click(screen.getByRole("button", { name: /Edit Us shot at 10'/ }));
      await user.selectOptions(screen.getByLabelText("Outcome"), "WIDE");
      await user.click(screen.getByText("Save Changes"));
      await waitFor(() => expect(mockUpdateShot).toHaveBeenCalledWith("s1", expect.objectContaining({ outcome: "WIDE" })));
    });

    it("leaving the outcome dropdown unchanged on a BLOCKED shot omits outcome from the payload", async () => {
      const user = userEvent.setup();
      const shotsData = [{ id: "s1", takenByUs: true, outcome: "BLOCKED", gameSeconds: 600, half: 1, playerId: "p1" }] as any[];
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={shotsData} />);
      await user.click(screen.getByRole("button", { name: /Edit Us shot at 10'/ }));
      await user.click(screen.getByText("Save Changes"));
      await waitFor(() => expect(mockUpdateShot).toHaveBeenCalled());
      expect(mockUpdateShot.mock.calls[0][1]).not.toHaveProperty("outcome");
    });

    it("m7: allows clearing the shooter when editing an Us shot (shooter-less Us shot is a legitimate state)", async () => {
      const user = userEvent.setup();
      const shotsData = [{ id: "s1", takenByUs: true, outcome: "BLOCKED", gameSeconds: 600, half: 1, playerId: "p1" }] as any[];
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={shotsData} />);
      await user.click(screen.getByRole("button", { name: /Edit Us shot at 10'/ }));
      await user.selectOptions(screen.getByTestId("editshotsPlayer"), "");
      await user.click(screen.getByText("Save Changes"));
      await waitFor(() => expect(mockUpdateShot).toHaveBeenCalledWith("s1", { playerId: undefined }));
    });

    it("editing a 'Them' shot with outcome BLOCKED shows no shooter field, and title reflects the opponent", async () => {
      const user = userEvent.setup();
      const shotsData = [{ id: "s1", takenByUs: false, outcome: "BLOCKED", gameSeconds: 600, half: 1, playerId: null }] as any[];
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={shotsData} />);
      await user.click(screen.getByRole("button", { name: /Edit Eagles shot at 10'/ }));
      expect(screen.getByRole("heading", { name: /Edit Eagles Shot/ })).toBeInTheDocument();
      expect(screen.queryByTestId("editshotsPlayer")).not.toBeInTheDocument();
    });
  });

  describe("save's edit modal — unchanged (no outcome control)", () => {
    it("does not render an outcome control on the Save edit modal", async () => {
      const user = userEvent.setup();
      const savesData = [{ id: "sv1", byUs: true, gameSeconds: 300, half: 1, playerId: "p1" }] as any[];
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="saves" saves={savesData} />);
      await user.click(screen.getByRole("button", { name: /Edit Us save at 5'/ }));
      expect(screen.queryByLabelText("Outcome")).not.toBeInTheDocument();
    });

    it("calls updateSave with the edited player only", async () => {
      const user = userEvent.setup();
      const savesData = [{ id: "sv1", byUs: true, gameSeconds: 300, half: 1, playerId: "p1" }] as any[];
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="saves" saves={savesData} />);
      await user.click(screen.getByRole("button", { name: /Edit Us save at 5'/ }));
      await user.selectOptions(screen.getByTestId("editsavesPlayer"), "p2");
      await user.click(screen.getByText("Save Changes"));
      await waitFor(() => expect(mockUpdateSave).toHaveBeenCalledWith("sv1", { playerId: "p2" }));
    });
  });

  describe("delete", () => {
    const shotsData = [
      { id: "s1", takenByUs: true, outcome: "GOAL", gameSeconds: 600, half: 1, playerId: "p1" },
    ] as any[];

    it("uses shot-specific delete confirmation copy, including the sibling-drift note (i4)", async () => {
      const user = userEvent.setup();
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={shotsData} />);
      await user.click(screen.getByRole("button", { name: /Delete Us shot at 10'/ }));
      expect(screen.getByRole("heading", { name: "Delete shot?" })).toBeInTheDocument();
      expect(screen.getByText(/Any matching goal or save stays in its own list\./)).toBeInTheDocument();
    });

    it("calls deleteShot", async () => {
      const user = userEvent.setup();
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={shotsData} />);
      await user.click(screen.getByRole("button", { name: /Delete Us shot at 10'/ }));
      await user.click(screen.getByRole("button", { name: /^Delete$/ }));
      await waitFor(() => expect(mockDeleteShot).toHaveBeenCalledWith("s1"));
    });
  });

  describe("saves-specific delete", () => {
    const savesData = [
      { id: "sv1", byUs: true, gameSeconds: 300, half: 1, playerId: "p2" },
    ] as any[];

    it("uses save-specific delete confirmation copy, including the sibling-drift note (i4)", async () => {
      const user = userEvent.setup();
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="saves" saves={savesData} />);
      await user.click(screen.getByRole("button", { name: /Delete Us save at 5'/ }));
      expect(screen.getByText(/The matching shot stays in the Shots list\./)).toBeInTheDocument();
    });

    it("calls deleteSave for a save row", async () => {
      const user = userEvent.setup();
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="saves" saves={savesData} />);
      await user.click(screen.getByRole("button", { name: /Delete Us save at 5'/ }));
      await user.click(screen.getByRole("button", { name: /^Delete$/ }));
      await waitFor(() => expect(mockDeleteSave).toHaveBeenCalledWith("sv1"));
    });
  });

  describe("Save Auto-Goalkeeper Attribution (edit modal prefill)", () => {
    const gkPositions = [
      { id: "gk-pos", role: "GOALKEEPER" },
      { id: "other-pos", role: "DEFENDER" },
    ] as any[];
    const gkPositionsTwoSlots = [
      { id: "gk-pos-1", role: "GOALKEEPER" },
      { id: "gk-pos-2", role: "GOALKEEPER" },
    ] as any[];

    it("edit modal pre-fills the derived goalkeeper for a Save with no existing playerId", async () => {
      const user = userEvent.setup();
      const playTimeRecords = [
        { id: "ptr1", playerId: "p2", positionId: "gk-pos", startGameSeconds: 0, endGameSeconds: null },
      ] as any[];
      const savesData = [
        { id: "sv1", byUs: true, gameSeconds: 300, half: 1, playerId: null },
      ] as any[];
      renderWithProvider(
        <ShotSaveTracker
          {...defaultProps}
          statView="saves"
          saves={savesData}
          positions={gkPositions}
          playTimeRecords={playTimeRecords}
        />
      );
      await user.click(screen.getByRole("button", { name: /Edit Us save at 5'/ }));
      expect(screen.getByTestId("editsavesPlayer")).toHaveValue("p2");
    });

    it("does not pre-fill when no position has role: 'GOALKEEPER'", async () => {
      const user = userEvent.setup();
      const playTimeRecords = [
        { id: "ptr1", playerId: "p1", positionId: "other-pos", startGameSeconds: 0, endGameSeconds: null },
      ] as any[];
      const savesData = [{ id: "sv1", byUs: true, gameSeconds: 300, half: 1, playerId: null }] as any[];
      renderWithProvider(
        <ShotSaveTracker {...defaultProps} statView="saves" saves={savesData} positions={gkPositions} playTimeRecords={playTimeRecords} />
      );
      await user.click(screen.getByRole("button", { name: /Edit Us save at 5'/ }));
      expect(screen.getByTestId("editsavesPlayer")).toHaveValue("");
    });

    it("does not pre-fill when two different players simultaneously hold open records at two GOALKEEPER-role positions (ambiguous)", async () => {
      const user = userEvent.setup();
      const playTimeRecords = [
        { id: "ptr1", playerId: "p1", positionId: "gk-pos-1", startGameSeconds: 0, endGameSeconds: null },
        { id: "ptr2", playerId: "p2", positionId: "gk-pos-2", startGameSeconds: 0, endGameSeconds: null },
      ] as any[];
      const savesData = [{ id: "sv1", byUs: true, gameSeconds: 300, half: 1, playerId: null }] as any[];
      renderWithProvider(
        <ShotSaveTracker {...defaultProps} statView="saves" saves={savesData} positions={gkPositionsTwoSlots} playTimeRecords={playTimeRecords} />
      );
      await user.click(screen.getByRole("button", { name: /Edit Us save at 5'/ }));
      expect(screen.getByTestId("editsavesPlayer")).toHaveValue("");
    });

    it("edit modal never clobbers an existing playerId, even when a different player currently holds the open GK record", async () => {
      const user = userEvent.setup();
      const playTimeRecords = [
        { id: "ptr1", playerId: "p2", positionId: "gk-pos", startGameSeconds: 0, endGameSeconds: null },
      ] as any[];
      const savesData = [
        { id: "sv1", byUs: true, gameSeconds: 300, half: 1, playerId: "p1" },
      ] as any[];
      renderWithProvider(
        <ShotSaveTracker
          {...defaultProps}
          statView="saves"
          saves={savesData}
          positions={gkPositions}
          playTimeRecords={playTimeRecords}
        />
      );
      await user.click(screen.getByRole("button", { name: /Edit Us save at 5'/ }));
      expect(screen.getByTestId("editsavesPlayer")).toHaveValue("p1");
    });

    it("completed game: opening the edit modal for a Save with no existing playerId does not crash and produces no pre-fill", async () => {
      const user = userEvent.setup();
      const playTimeRecords = [
        { id: "ptr1", playerId: "p1", positionId: "gk-pos", startGameSeconds: 0, endGameSeconds: 1800 },
      ] as any[];
      const savesData = [
        { id: "sv1", byUs: true, gameSeconds: 300, half: 1, playerId: null },
      ] as any[];
      renderWithProvider(
        <ShotSaveTracker
          {...defaultProps}
          statView="saves"
          gameState={makeGameState({ status: "completed" }) as any}
          saves={savesData}
          positions={gkPositions}
          playTimeRecords={playTimeRecords}
        />
      );
      await user.click(screen.getByRole("button", { name: /Edit Us save at 5'/ }));
      expect(screen.getByTestId("editsavesPlayer")).toHaveValue("");
    });
  });

  describe("via helper badge (Milestone B2)", () => {
    it("shows a 'Logged via helper' badge on a shot with loggedVia: HELPER", () => {
      renderWithProvider(
        <ShotSaveTracker
          {...defaultProps}
          statView="shots"
          shots={[{ id: "s-helper", takenByUs: true, outcome: "GOAL", playerId: "p1", gameSeconds: 100, half: 1, loggedVia: "HELPER" } as any]}
        />
      );
      expect(screen.getByText("Logged via helper")).toBeInTheDocument();
    });

    it("shows a 'Logged via helper' badge on a save with loggedVia: HELPER", () => {
      renderWithProvider(
        <ShotSaveTracker
          {...defaultProps}
          statView="saves"
          saves={[{ id: "sv-helper", byUs: true, playerId: "p1", gameSeconds: 100, half: 1, loggedVia: "HELPER" } as any]}
        />
      );
      expect(screen.getByText("Logged via helper")).toBeInTheDocument();
    });

    it("does not show the badge for a coach-logged shot", () => {
      renderWithProvider(
        <ShotSaveTracker
          {...defaultProps}
          statView="shots"
          shots={[{ id: "s-coach", takenByUs: true, outcome: "GOAL", playerId: "p1", gameSeconds: 100, half: 1, loggedVia: "COACH" } as any]}
        />
      );
      expect(screen.queryByText("Logged via helper")).not.toBeInTheDocument();
    });
  });
});
