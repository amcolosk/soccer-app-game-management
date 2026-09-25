/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { showSuccess } from "../../utils/toast";
import { GoalTracker } from "./GoalTracker";
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

const mockUpdateGame = vi.fn().mockResolvedValue(undefined);
const mockDeleteGoal = vi.fn().mockResolvedValue(undefined);
const mockUpdateGoal = vi.fn().mockResolvedValue(undefined);

const makeMutations = (overrides: Record<string, any> = {}) => ({
  updateGame: mockUpdateGame,
  deleteGoal: mockDeleteGoal,
  updateGoal: mockUpdateGoal,
  ...overrides,
});

// GoalTracker now only needs gameState/players/goals/mutations -- creation
// moved to ShotOutcomeEntry.tsx. GameManagement.tsx still spreads the larger
// sharedGoalTrackerProps object onto it at runtime; the extra fields aren't
// required here.
const defaultProps = {
  gameState: makeGameState() as any,
  players,
  goals: [] as any[],
  mutations: makeMutations() as any,
};

describe("GoalTracker", () => {
  beforeEach(() => {
    mockUpdateGame.mockReset().mockResolvedValue(undefined);
    mockDeleteGoal.mockReset().mockResolvedValue(undefined);
    mockUpdateGoal.mockReset().mockResolvedValue(undefined);
    vi.mocked(showSuccess).mockClear();
  });

  describe("goals list", () => {
    const goalsData = [
      {
        id: "g1",
        scoredByUs: true,
        gameSeconds: 600,
        half: 1,
        scorerId: "p1",
        assistId: "p2",
        notes: "Great shot",
      },
      {
        id: "g2",
        scoredByUs: false,
        gameSeconds: 1200,
        half: 1,
        scorerId: null,
        assistId: null,
        notes: null,
      },
    ] as any[];

    it("renders goal cards with minute and half", () => {
      renderWithProvider(<GoalTracker {...defaultProps} goals={goalsData} />);
      expect(screen.getByText("10'")).toBeInTheDocument();
      expect(screen.getByText("20'")).toBeInTheDocument();
      expect(screen.getAllByText("(1st Half)")).toHaveLength(2);
    });

    it("shows scorer name for our goals", () => {
      renderWithProvider(<GoalTracker {...defaultProps} goals={goalsData} />);
      expect(screen.getByText("#10 Alice Smith")).toBeInTheDocument();
    });

    it("shows assist when present", () => {
      renderWithProvider(<GoalTracker {...defaultProps} goals={goalsData} />);
      expect(screen.getByText(/Assist: #7 Bob/)).toBeInTheDocument();
    });

    it("shows opponent name for opponent goals", () => {
      renderWithProvider(<GoalTracker {...defaultProps} goals={goalsData} />);
      expect(screen.getByText("Eagles")).toBeInTheDocument();
    });

    it("shows notes when present", () => {
      renderWithProvider(<GoalTracker {...defaultProps} goals={goalsData} />);
      expect(screen.getByText("Great shot")).toBeInTheDocument();
    });

    it("does not render goals section when empty", () => {
      renderWithProvider(<GoalTracker {...defaultProps} goals={[]} />);
      expect(screen.queryByText("Goals")).not.toBeInTheDocument();
    });

    it("shows the reworded empty state in completed when no goals, pointing at the two-button flow (m6/UI review)", () => {
      renderWithProvider(
        <GoalTracker
          {...defaultProps}
          gameState={makeGameState({ status: "completed" }) as any}
          goals={[]}
        />
      );
      expect(screen.getByText(/To correct the final score, tap Log Shot – Us or Log Shot – Them, then choose Goal\./)).toBeInTheDocument();
    });
  });

  const goalsForEditDelete = [
    {
      id: "g1",
      scoredByUs: true,
      gameSeconds: 600,
      half: 1,
      scorerId: "p1",
      assistId: "p2",
      notes: "Great shot",
    },
    {
      id: "g2",
      scoredByUs: false,
      gameSeconds: 1200,
      half: 1,
      scorerId: null,
      assistId: null,
      notes: null,
    },
  ] as any[];

  describe("edit and delete buttons", () => {
    it("shows edit and delete buttons for each goal card in-progress", () => {
      renderWithProvider(<GoalTracker {...defaultProps} goals={goalsForEditDelete} />);
      expect(screen.getByRole("button", { name: /Edit Us goal at 10'/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Delete Us goal at 10'/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Edit Eagles goal at 20'/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Delete Eagles goal at 20'/ })).toBeInTheDocument();
    });

    it("shows edit and delete buttons for each goal card when completed", () => {
      renderWithProvider(
        <GoalTracker
          {...defaultProps}
          gameState={makeGameState({ status: "completed" }) as any}
          goals={goalsForEditDelete}
        />
      );
      expect(screen.getByRole("button", { name: /Edit Us goal at 10'/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Delete Us goal at 10'/ })).toBeInTheDocument();
    });
  });

  describe("goal delete", () => {
    it("uses goal-specific delete confirmation copy, including the sibling-drift note (i4)", async () => {
      const user = userEvent.setup();
      renderWithProvider(<GoalTracker {...defaultProps} goals={goalsForEditDelete} />);

      await user.click(screen.getByRole("button", { name: /Delete Us goal at 10'/ }));

      expect(screen.getByRole("heading", { name: "Delete goal?" })).toBeInTheDocument();
      expect(screen.getByText("This permanently removes this goal event from the game timeline. The matching shot stays in the Shots list.")).toBeInTheDocument();
      expect(screen.queryByText("Only the original author can confirm this delete.")).not.toBeInTheDocument();
    });

    it("calls deleteGoal and does NOT call updateGame in active states", async () => {
      const user = userEvent.setup();
      renderWithProvider(<GoalTracker {...defaultProps} goals={goalsForEditDelete} />);
      await user.click(screen.getByRole("button", { name: /Delete Us goal at 10'/ }));
      await user.click(screen.getByRole("button", { name: /^Delete$/ }));
      await waitFor(() => expect(mockDeleteGoal).toHaveBeenCalledWith("g1"));
      // UpdateGame should NOT be called - score is derived from goals
      expect(mockUpdateGame).not.toHaveBeenCalled();
    });

    it("shows success toast with final score when completed", async () => {
      const user = userEvent.setup();
      renderWithProvider(
        <GoalTracker
          {...defaultProps}
          gameState={makeGameState({ status: "completed", ourScore: 1, opponentScore: 0 }) as any}
          goals={goalsForEditDelete}
        />
      );
      await user.click(screen.getByRole("button", { name: /Delete Us goal at 10'/ }));
      await user.click(screen.getByRole("button", { name: /^Delete$/ }));
      await waitFor(() => expect(mockDeleteGoal).toHaveBeenCalledWith("g1"));
      await waitFor(() => expect(showSuccess).toHaveBeenCalledWith(
        expect.stringContaining("Goal deleted")
      ));
      // updateGame NOT called - GameManagement will auto-reconcile
      expect(mockUpdateGame).not.toHaveBeenCalled();
    });

    it("does not delete when confirm is cancelled", async () => {
      const user = userEvent.setup();
      renderWithProvider(<GoalTracker {...defaultProps} goals={goalsForEditDelete} />);
      await user.click(screen.getByRole("button", { name: /Delete Us goal at 10'/ }));

      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(mockDeleteGoal).not.toHaveBeenCalled();
    });

    it("returns focus to delete action button when confirmation is cancelled", async () => {
      const user = userEvent.setup();
      renderWithProvider(<GoalTracker {...defaultProps} goals={goalsForEditDelete} />);

      const deleteButton = screen.getByRole("button", { name: /Delete Us goal at 10'/ });
      await user.click(deleteButton);
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() => {
        expect(document.activeElement).toBe(deleteButton);
      });
    });

    it("returns focus to delete action button when delete succeeds", async () => {
      const user = userEvent.setup();
      renderWithProvider(<GoalTracker {...defaultProps} goals={goalsForEditDelete} />);

      const deleteButton = screen.getByRole("button", { name: /Delete Us goal at 10'/ });
      await user.click(deleteButton);
      await user.click(screen.getByRole("button", { name: /^Delete$/ }));

      await waitFor(() => {
        expect(mockDeleteGoal).toHaveBeenCalledWith("g1");
      });
      await waitFor(() => {
        expect(document.activeElement).toBe(deleteButton);
      });
    });
  });

  describe("goal edit", () => {
    it("opens modal pre-populated with goal's scorer, assist, notes", async () => {
      const user = userEvent.setup();
      renderWithProvider(<GoalTracker {...defaultProps} goals={goalsForEditDelete} />);
      await user.click(screen.getByRole("button", { name: /Edit Us goal at 10'/ }));
      expect(screen.getByRole("heading", { name: /Edit Our Goal/ })).toBeInTheDocument();
      expect(screen.getByTestId("editScorer")).toHaveValue("p1");
      expect(screen.getByTestId("editAssist")).toHaveValue("p2");
      expect(screen.getByPlaceholderText("Optional notes")).toHaveValue("Great shot");
    });

    it("calls updateGoal with editable fields and does not call updateGame", async () => {
      const user = userEvent.setup();
      renderWithProvider(<GoalTracker {...defaultProps} goals={goalsForEditDelete} />);
      await user.click(screen.getByRole("button", { name: /Edit Us goal at 10'/ }));
      await user.click(screen.getByText("Save Changes"));
      await waitFor(() => expect(mockUpdateGoal).toHaveBeenCalledWith("g1", {
        scorerId: "p1",
        assistId: "p2",
        notes: "Great shot",
      }));
      expect(mockUpdateGame).not.toHaveBeenCalled();
    });

    it("shows success toast with final score when completed", async () => {
      const user = userEvent.setup();
      renderWithProvider(
        <GoalTracker
          {...defaultProps}
          gameState={makeGameState({ status: "completed", ourScore: 1, opponentScore: 0 }) as any}
          goals={goalsForEditDelete}
        />
      );
      await user.click(screen.getByRole("button", { name: /Edit Us goal at 10'/ }));
      await user.click(screen.getByText("Save Changes"));
      await waitFor(() => expect(showSuccess).toHaveBeenCalledWith(
        expect.stringContaining("Goal updated")
      ));
      expect(mockUpdateGame).not.toHaveBeenCalled();
    });

    it("coerces empty scorer string to undefined when saving opponent goal", async () => {
      const user = userEvent.setup();
      // g2 is opponent goal with null scorerId -> editScorerId starts as ''
      renderWithProvider(<GoalTracker {...defaultProps} goals={goalsForEditDelete} />);
      await user.click(screen.getByRole("button", { name: /Edit Eagles goal at 20'/ }));
      await user.click(screen.getByText("Save Changes"));
      await waitFor(() => expect(mockUpdateGoal).toHaveBeenCalledWith("g2", {
        scorerId: undefined,
        assistId: undefined,
        notes: undefined,
      }));
    });

    it("requires scorer for scoredByUs=true goal and shows error", async () => {
      const user = userEvent.setup();
      renderWithProvider(<GoalTracker {...defaultProps} goals={goalsForEditDelete} />);
      await user.click(screen.getByRole("button", { name: /Edit Us goal at 10'/ }));
      // Clear the scorer select to empty
      await user.selectOptions(screen.getByTestId("editScorer"), "");
      await user.click(screen.getByText("Save Changes"));
      expect(screen.getByText("A scorer is required for our goals.")).toBeInTheDocument();
      expect(mockUpdateGoal).not.toHaveBeenCalled();
    });

    it("closes modal when Cancel clicked", async () => {
      const user = userEvent.setup();
      renderWithProvider(<GoalTracker {...defaultProps} goals={goalsForEditDelete} />);
      await user.click(screen.getByRole("button", { name: /Edit Us goal at 10'/ }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  describe("via helper badge (Milestone B2)", () => {
    it("shows a 'Logged via helper' badge on a goal with loggedVia: HELPER", () => {
      renderWithProvider(
        <GoalTracker
          {...defaultProps}
          goals={[{ id: "g-helper", scoredByUs: true, scorerId: "p1", gameSeconds: 100, half: 1, loggedVia: "HELPER" } as any]}
        />
      );
      expect(screen.getByText("Logged via helper")).toBeInTheDocument();
    });

    it("does not show the badge for a coach-logged goal", () => {
      renderWithProvider(
        <GoalTracker
          {...defaultProps}
          goals={[{ id: "g-coach", scoredByUs: true, scorerId: "p1", gameSeconds: 100, half: 1, loggedVia: "COACH" } as any]}
        />
      );
      expect(screen.queryByText("Logged via helper")).not.toBeInTheDocument();
    });

    it("does not show the badge for a legacy goal with no loggedVia at all", () => {
      renderWithProvider(
        <GoalTracker
          {...defaultProps}
          goals={[{ id: "g-legacy", scoredByUs: true, scorerId: "p1", gameSeconds: 100, half: 1 } as any]}
        />
      );
      expect(screen.queryByText("Logged via helper")).not.toBeInTheDocument();
    });
  });
});
