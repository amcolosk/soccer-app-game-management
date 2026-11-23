/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { showSuccess } from "../../utils/toast";
import { trackEvent } from "../../utils/analytics";
import { ShotOutcomeEntry } from "./ShotOutcomeEntry";

vi.mock("../../utils/toast", () => ({
  showWarning: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("../../utils/analytics", () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: { GOAL_RECORDED: { category: "GameDay", action: "Goal Recorded" } },
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
      <option value="gk1">gk1</option>
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
  { id: "gk1", playerNumber: 1, firstName: "Gary", lastName: "Keeper" },
] as any[];

const mockCreateShot = vi.fn().mockResolvedValue(undefined);
const mockCreateGoal = vi.fn().mockResolvedValue(undefined);
const mockCreateSave = vi.fn().mockResolvedValue(undefined);

const makeMutations = (overrides: Record<string, any> = {}) => ({
  createShot: mockCreateShot,
  createGoal: mockCreateGoal,
  createSave: mockCreateSave,
  ...overrides,
});

const defaultProps = {
  gameState: makeGameState() as any,
  game: { id: "game-1" } as any,
  team: { coaches: ["coach-1"] } as any,
  players,
  positions: [] as any[],
  playTimeRecords: [] as any[],
  lineup: [] as any[],
  currentTime: 600,
  mutations: makeMutations() as any,
};

describe("ShotOutcomeEntry", () => {
  beforeEach(() => {
    mockCreateShot.mockReset().mockResolvedValue(undefined);
    mockCreateGoal.mockReset().mockResolvedValue(undefined);
    mockCreateSave.mockReset().mockResolvedValue(undefined);
    vi.mocked(showSuccess).mockClear();
    vi.mocked(trackEvent).mockClear();
  });

  describe("entry button visibility (m6 carry-over)", () => {
    it("shows both entry buttons when in-progress", () => {
      render(<ShotOutcomeEntry {...defaultProps} />);
      expect(screen.getByText(/Log Shot – Us/)).toBeInTheDocument();
      expect(screen.getByText(/Log Shot – Eagles/)).toBeInTheDocument();
    });

    it("hides entry buttons when scheduled", () => {
      render(<ShotOutcomeEntry {...defaultProps} gameState={makeGameState({ status: "scheduled" }) as any} />);
      expect(screen.queryByText(/Log Shot – Us/)).not.toBeInTheDocument();
    });

    it("shows entry buttons when completed", () => {
      render(<ShotOutcomeEntry {...defaultProps} gameState={makeGameState({ status: "completed" }) as any} />);
      expect(screen.getByText(/Log Shot – Us/)).toBeInTheDocument();
    });
  });

  describe("Us flow — shooter (skippable) -> outcome", () => {
    it("BLOCKED and WIDE submit immediately on tap, no confirm step", async () => {
      const user = userEvent.setup();
      render(<ShotOutcomeEntry {...defaultProps} />);
      await user.click(screen.getByText(/Log Shot – Us/));
      await user.click(screen.getByRole("button", { name: "Continue" })); // skip shooter
      await user.click(screen.getByRole("button", { name: "Blocked" }));
      await waitFor(() => expect(mockCreateShot).toHaveBeenCalledWith(expect.objectContaining({
        takenByUs: true, outcome: "BLOCKED", playerId: null,
      })));
      expect(mockCreateGoal).not.toHaveBeenCalled();
      expect(mockCreateSave).not.toHaveBeenCalled();
      // Modal closes immediately (no confirm step rendered at all).
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("shooter is skippable regardless of outcome (Us + Goal, no shooter selected)", async () => {
      const user = userEvent.setup();
      render(<ShotOutcomeEntry {...defaultProps} />);
      await user.click(screen.getByText(/Log Shot – Us/));
      await user.click(screen.getByRole("button", { name: "Continue" })); // skip shooter
      await user.click(screen.getByRole("button", { name: "Goal" }));
      await user.click(screen.getByRole("button", { name: /Log Goal/ })); // skip assist, submit directly
      await waitFor(() => expect(mockCreateGoal).toHaveBeenCalledWith(expect.objectContaining({
        scoredByUs: true, scorerId: null, assistId: null,
      })));
    });

    it("GOAL submits directly from the assist step once shooter+assist are picked, with no confirm screen", async () => {
      const user = userEvent.setup();
      render(<ShotOutcomeEntry {...defaultProps} />);
      await user.click(screen.getByText(/Log Shot – Us/));
      await user.selectOptions(screen.getByTestId("shotShooter"), "p1");
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.click(screen.getByRole("button", { name: "Goal" }));
      await user.selectOptions(screen.getByTestId("shotAssist"), "p2");

      // Nothing submitted until the assist step's own "Log Goal" tap.
      expect(mockCreateShot).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: /Log Goal/ }));
      await waitFor(() => expect(mockCreateShot).toHaveBeenCalledWith(expect.objectContaining({ outcome: "GOAL", playerId: "p1" })));
      await waitFor(() => expect(mockCreateGoal).toHaveBeenCalledWith(expect.objectContaining({ scorerId: "p1", assistId: "p2" })));
    });

    it("Us + Saved submits immediately on tap, no confirm step (no keeper attribution possible)", async () => {
      const user = userEvent.setup();
      render(<ShotOutcomeEntry {...defaultProps} />);
      await user.click(screen.getByText(/Log Shot – Us/));
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.click(screen.getByRole("button", { name: "Saved" }));
      await waitFor(() => expect(mockCreateShot).toHaveBeenCalledWith(expect.objectContaining({ outcome: "SAVED", takenByUs: true })));
      await waitFor(() => expect(mockCreateSave).toHaveBeenCalledWith(expect.objectContaining({ byUs: false, playerId: null })));
      expect(screen.queryByRole("button", { name: /Log Save/ })).not.toBeInTheDocument();
    });
  });

  describe("Them flow — no shooter step", () => {
    it("opens directly to the outcome step", async () => {
      const user = userEvent.setup();
      render(<ShotOutcomeEntry {...defaultProps} />);
      await user.click(screen.getByText(/Log Shot – Eagles/));
      expect(screen.getByRole("button", { name: "Goal" })).toBeInTheDocument();
      expect(screen.queryByTestId("shotShooter")).not.toBeInTheDocument();
    });

    it("BLOCKED/WIDE submit immediately with takenByUs:false", async () => {
      const user = userEvent.setup();
      render(<ShotOutcomeEntry {...defaultProps} />);
      await user.click(screen.getByText(/Log Shot – Eagles/));
      await user.click(screen.getByRole("button", { name: "Wide" }));
      await waitFor(() => expect(mockCreateShot).toHaveBeenCalledWith(expect.objectContaining({ takenByUs: false, outcome: "WIDE" })));
    });

    it("GOAL submits immediately with no confirm step, carries no scorer/assist", async () => {
      const user = userEvent.setup();
      render(<ShotOutcomeEntry {...defaultProps} />);
      await user.click(screen.getByText(/Log Shot – Eagles/));
      await user.click(screen.getByRole("button", { name: "Goal" }));
      await waitFor(() => expect(mockCreateGoal).toHaveBeenCalledWith(expect.objectContaining({ scoredByUs: false, scorerId: null, assistId: null })));
      expect(screen.queryByRole("button", { name: /Log Goal/ })).not.toBeInTheDocument();
    });

    it("SAVED with no resolvable current goalkeeper goes to a keeper picker that submits directly, no confirm step", async () => {
      const user = userEvent.setup();
      render(<ShotOutcomeEntry {...defaultProps} />);
      await user.click(screen.getByText(/Log Shot – Eagles/));
      await user.click(screen.getByRole("button", { name: "Saved" }));
      expect(screen.getByTestId("shotKeeper")).toBeInTheDocument();
      await user.selectOptions(screen.getByTestId("shotKeeper"), "gk1");
      await user.click(screen.getByRole("button", { name: /Log Save/ }));
      await waitFor(() => expect(mockCreateSave).toHaveBeenCalledWith(expect.objectContaining({ byUs: true, playerId: "gk1" })));
    });

    it("SAVED with an auto-resolvable current goalkeeper submits immediately with no confirm step", async () => {
      const user = userEvent.setup();
      const playTimeRecords = [{ id: "ptr1", playerId: "gk1", positionId: "gk-pos", startGameSeconds: 0, endGameSeconds: null }] as any[];
      const positions = [{ id: "gk-pos", role: "GOALKEEPER" }] as any[];
      render(<ShotOutcomeEntry {...defaultProps} positions={positions} playTimeRecords={playTimeRecords} />);
      await user.click(screen.getByText(/Log Shot – Eagles/));
      await user.click(screen.getByRole("button", { name: "Saved" }));
      await waitFor(() => expect(mockCreateSave).toHaveBeenCalledWith(expect.objectContaining({ byUs: true, playerId: "gk1" })));
      expect(screen.queryByRole("button", { name: /Log Save/ })).not.toBeInTheDocument();
      expect(showSuccess).toHaveBeenCalledWith("Save recorded for Gary Keeper.");
    });
  });

  describe("completed-state score toast + GOAL_RECORDED analytics (m6 carry-over)", () => {
    it("shows the final-score toast on a completed-state Goal write", async () => {
      const user = userEvent.setup();
      render(<ShotOutcomeEntry {...defaultProps} gameState={makeGameState({ status: "completed", ourScore: 1, opponentScore: 0 }) as any} />);
      await user.click(screen.getByText(/Log Shot – Us/));
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.click(screen.getByRole("button", { name: "Goal" }));
      await user.click(screen.getByRole("button", { name: /Log Goal/ }));
      await waitFor(() => expect(showSuccess).toHaveBeenCalledWith(expect.stringContaining("Final score updated to 2–0")));
    });

    it("fires GOAL_RECORDED with 'own' for an Us goal and 'opponent' for a Them goal", async () => {
      const user = userEvent.setup();
      const { unmount } = render(<ShotOutcomeEntry {...defaultProps} />);
      await user.click(screen.getByText(/Log Shot – Us/));
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.click(screen.getByRole("button", { name: "Goal" }));
      await user.click(screen.getByRole("button", { name: /Log Goal/ }));
      await waitFor(() => expect(trackEvent).toHaveBeenCalledWith("GameDay", "Goal Recorded", "own"));
      unmount();

      render(<ShotOutcomeEntry {...defaultProps} />);
      await user.click(screen.getByText(/Log Shot – Eagles/));
      await user.click(screen.getByRole("button", { name: "Goal" }));
      await waitFor(() => expect(trackEvent).toHaveBeenCalledWith("GameDay", "Goal Recorded", "opponent"));
    });
  });

  describe("m5: retry saving goal/save after a partial failure", () => {
    it("a first-write (Shot) failure never triggers a second write", async () => {
      const user = userEvent.setup();
      mockCreateShot.mockRejectedValueOnce(new Error("network error"));
      render(<ShotOutcomeEntry {...defaultProps} />);
      await user.click(screen.getByText(/Log Shot – Us/));
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.click(screen.getByRole("button", { name: "Goal" }));
      await user.click(screen.getByRole("button", { name: /Log Goal/ }));
      await waitFor(() => expect(mockCreateShot).toHaveBeenCalledTimes(1));
      expect(mockCreateGoal).not.toHaveBeenCalled();
    });

    it("keeps the modal open with a 'Retry saving goal' action when the Shot succeeds but the Goal write throws, and never re-sends the Shot", async () => {
      const user = userEvent.setup();
      mockCreateGoal.mockRejectedValueOnce(new Error("network error"));
      render(<ShotOutcomeEntry {...defaultProps} />);
      await user.click(screen.getByText(/Log Shot – Us/));
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.click(screen.getByRole("button", { name: "Goal" }));
      await user.click(screen.getByRole("button", { name: /Log Goal/ }));

      await waitFor(() => expect(screen.getByRole("button", { name: /Retry saving goal/ })).toBeInTheDocument());
      expect(mockCreateShot).toHaveBeenCalledTimes(1);

      mockCreateGoal.mockResolvedValueOnce(undefined);
      await user.click(screen.getByRole("button", { name: /Retry saving goal/ }));
      await waitFor(() => expect(mockCreateGoal).toHaveBeenCalledTimes(2));
      // The Shot must never be re-sent on retry.
      expect(mockCreateShot).toHaveBeenCalledTimes(1);
    });

    it("auto-keeper Saved: a failed Save write offers a working retry that re-sends only the Save with the same keeper", async () => {
      const user = userEvent.setup();
      mockCreateSave.mockRejectedValueOnce(new Error("network error"));
      const playTimeRecords = [{ id: "ptr1", playerId: "gk1", positionId: "gk-pos", startGameSeconds: 0, endGameSeconds: null }] as any[];
      const positions = [{ id: "gk-pos", role: "GOALKEEPER" }] as any[];
      render(<ShotOutcomeEntry {...defaultProps} positions={positions} playTimeRecords={playTimeRecords} />);
      await user.click(screen.getByText(/Log Shot – Eagles/));
      await user.click(screen.getByRole("button", { name: "Saved" }));

      await waitFor(() => expect(screen.getByRole("button", { name: /Retry saving save/ })).toBeInTheDocument());
      mockCreateSave.mockResolvedValueOnce(undefined);
      await user.click(screen.getByRole("button", { name: /Retry saving save/ }));
      await waitFor(() => expect(mockCreateSave).toHaveBeenCalledTimes(2));
      expect(mockCreateSave).toHaveBeenLastCalledWith(expect.objectContaining({ byUs: true, playerId: "gk1" }));
      expect(mockCreateShot).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(showSuccess).toHaveBeenCalledWith("Save recorded for Gary Keeper."));
    });

    it("backdrop tap is a no-op while a retry is pending", async () => {
      const user = userEvent.setup();
      mockCreateGoal.mockRejectedValueOnce(new Error("network error"));
      render(<ShotOutcomeEntry {...defaultProps} />);
      await user.click(screen.getByText(/Log Shot – Us/));
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.click(screen.getByRole("button", { name: "Goal" }));
      await user.click(screen.getByRole("button", { name: /Log Goal/ }));

      await waitFor(() => expect(screen.getByRole("button", { name: /Retry saving goal/ })).toBeInTheDocument());

      const dialog = screen.getByRole("dialog");
      await user.click(dialog); // backdrop tap
      // Modal is still open, retry action still present.
      expect(screen.getByRole("button", { name: /Retry saving goal/ })).toBeInTheDocument();
    });

    it("the error copy names the fallback recovery path (delete-and-relog via the Shots list)", async () => {
      const user = userEvent.setup();
      mockCreateGoal.mockRejectedValueOnce(new Error("network error"));
      render(<ShotOutcomeEntry {...defaultProps} />);
      await user.click(screen.getByText(/Log Shot – Us/));
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.click(screen.getByRole("button", { name: "Goal" }));
      await user.click(screen.getByRole("button", { name: /Log Goal/ }));

      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/delete it from the Shots list/));
    });
  });
});
