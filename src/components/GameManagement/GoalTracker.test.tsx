/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GoalTracker } from "./GoalTracker";

vi.mock("aws-amplify/data", () => ({
  generateClient: () => ({
    models: {
      Goal: { create: vi.fn().mockResolvedValue({ data: {} }) },
      Game: { update: vi.fn().mockResolvedValue({ data: {} }) },
    },
  }),
}));

const mockConfirm = vi.fn().mockResolvedValue(false);
vi.mock("../ConfirmModal", () => ({
  useConfirm: () => mockConfirm,
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

const mockCreateGoal = vi.fn().mockResolvedValue(undefined);
const mockUpdateGame = vi.fn().mockResolvedValue(undefined);
const mockDeleteGoal = vi.fn().mockResolvedValue(undefined);
const mockUpdateGoal = vi.fn().mockResolvedValue(undefined);
const mockOnScoreUpdate = vi.fn();

const makeMutations = (overrides: Record<string, any> = {}) => ({
  updateGame: mockUpdateGame,
  createGoal: mockCreateGoal,
  deleteGoal: mockDeleteGoal,
  updateGoal: mockUpdateGoal,
  createPlayTimeRecord: vi.fn().mockResolvedValue(undefined),
  updatePlayTimeRecord: vi.fn().mockResolvedValue(undefined),
  createSubstitution: vi.fn().mockResolvedValue(undefined),
  createLineupAssignment: vi.fn().mockResolvedValue(undefined),
  deleteLineupAssignment: vi.fn().mockResolvedValue(undefined),
  updateLineupAssignment: vi.fn().mockResolvedValue(undefined),
  createGameNote: vi.fn().mockResolvedValue(undefined),
  updateGameNote: vi.fn().mockResolvedValue(undefined),
  deleteGameNote: vi.fn().mockResolvedValue(undefined),
  createPlayerAvailability: vi.fn().mockResolvedValue(undefined),
  updatePlayerAvailability: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const defaultProps = {
  gameState: makeGameState() as any,
  game: { id: "game-1" } as any,
  team: { coaches: ["coach-1"] } as any,
  players,
  goals: [] as any[],
  currentTime: 600,
  onScoreUpdate: mockOnScoreUpdate,
  mutations: makeMutations() as any,
  playTimeRecords: [] as any[],
  lineup: [] as any[],
};

describe("GoalTracker", () => {
  beforeEach(() => {
    mockConfirm.mockReset().mockResolvedValue(false);
    mockCreateGoal.mockReset().mockResolvedValue(undefined);
    mockUpdateGame.mockReset().mockResolvedValue(undefined);
    mockDeleteGoal.mockReset().mockResolvedValue(undefined);
    mockUpdateGoal.mockReset().mockResolvedValue(undefined);
    mockOnScoreUpdate.mockReset();
  });
  describe("goal buttons visibility", () => {
    it("shows goal buttons when in-progress", () => {
      render(<GoalTracker {...defaultProps} />);
      expect(screen.getByText(/Goal - Us/)).toBeInTheDocument();
      expect(screen.getByText(/Goal - Eagles/)).toBeInTheDocument();
    });

    it("shows goal buttons when at halftime", () => {
      render(
        <GoalTracker
          {...defaultProps}
          gameState={makeGameState({ status: "halftime" }) as any}
        />
      );
      expect(screen.getByText(/Goal - Us/)).toBeInTheDocument();
    });

    it("hides goal buttons when scheduled", () => {
      render(
        <GoalTracker
          {...defaultProps}
          gameState={makeGameState({ status: "scheduled" }) as any}
        />
      );
      expect(screen.queryByText(/Goal - Us/)).not.toBeInTheDocument();
    });

    it("hides goal buttons when completed", () => {
      render(
        <GoalTracker
          {...defaultProps}
          gameState={makeGameState({ status: "completed" }) as any}
        />
      );
      expect(screen.queryByText(/Goal - Us/)).not.toBeInTheDocument();
    });

    it("shows opponent name on opponent goal button", () => {
      render(
        <GoalTracker
          {...defaultProps}
          gameState={makeGameState({ opponent: "Sharks" }) as any}
        />
      );
      expect(screen.getByText(/Goal - Sharks/)).toBeInTheDocument();
    });
  });

  describe("goal modal", () => {
    it("opens modal with Our Goal when us-button clicked", async () => {
      const user = userEvent.setup();
      render(<GoalTracker {...defaultProps} />);
      await user.click(screen.getByText(/Goal - Us/));
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Record Goal");
      expect(screen.getByText(/Our Goal/)).toBeInTheDocument();
    });

    it("opens modal with opponent name when opponent-button clicked", async () => {
      const user = userEvent.setup();
      render(<GoalTracker {...defaultProps} />);
      await user.click(screen.getByText(/Goal - Eagles/));
      expect(screen.getByText(/Eagles Goal/)).toBeInTheDocument();
    });

    it("shows scorer select for our goal", async () => {
      const user = userEvent.setup();
      render(<GoalTracker {...defaultProps} />);
      await user.click(screen.getByText(/Goal - Us/));
      expect(screen.getByText("Who Scored? *")).toBeInTheDocument();
      expect(screen.getByTestId("goalScorer")).toBeInTheDocument();
    });

    it("shows assist select for our goal", async () => {
      const user = userEvent.setup();
      render(<GoalTracker {...defaultProps} />);
      await user.click(screen.getByText(/Goal - Us/));
      expect(screen.getByText(/Assisted By/)).toBeInTheDocument();
      expect(screen.getByTestId("goalAssist")).toBeInTheDocument();
    });

    it("hides scorer and assist for opponent goal", async () => {
      const user = userEvent.setup();
      render(<GoalTracker {...defaultProps} />);
      await user.click(screen.getByText(/Goal - Eagles/));
      expect(screen.queryByText("Who Scored? *")).not.toBeInTheDocument();
      expect(screen.queryByTestId("goalScorer")).not.toBeInTheDocument();
    });

    it("closes modal when Cancel clicked", async () => {
      const user = userEvent.setup();
      render(<GoalTracker {...defaultProps} />);
      await user.click(screen.getByText(/Goal - Us/));
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Record Goal");
      await user.click(screen.getByText("Cancel"));
      expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
    });
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
      render(<GoalTracker {...defaultProps} goals={goalsData} />);
      expect(screen.getByText("10'")).toBeInTheDocument();
      expect(screen.getByText("20'")).toBeInTheDocument();
      expect(screen.getAllByText("(1st Half)")).toHaveLength(2);
    });

    it("shows scorer name for our goals", () => {
      render(<GoalTracker {...defaultProps} goals={goalsData} />);
      expect(screen.getByText("#10 Alice Smith")).toBeInTheDocument();
    });

    it("shows assist when present", () => {
      render(<GoalTracker {...defaultProps} goals={goalsData} />);
      expect(screen.getByText(/Assist: #7 Bob/)).toBeInTheDocument();
    });

    it("shows opponent name for opponent goals", () => {
      render(<GoalTracker {...defaultProps} goals={goalsData} />);
      expect(screen.getByText("Eagles")).toBeInTheDocument();
    });

    it("shows notes when present", () => {
      render(<GoalTracker {...defaultProps} goals={goalsData} />);
      expect(screen.getByText("Great shot")).toBeInTheDocument();
    });

    it("does not render goals section when empty", () => {
      render(<GoalTracker {...defaultProps} goals={[]} />);
      expect(screen.queryByText("Goals")).not.toBeInTheDocument();
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
      render(<GoalTracker {...defaultProps} goals={goalsForEditDelete} />);
      expect(screen.getByRole("button", { name: /Edit Us goal at 10'/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Delete Us goal at 10'/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Edit Eagles goal at 20'/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Delete Eagles goal at 20'/ })).toBeInTheDocument();
    });

    it("shows edit and delete buttons for each goal card when completed", () => {
      render(
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
    it("calls deleteGoal and updateGame with decremented ourScore when scoredByUs=true", async () => {
      mockConfirm.mockResolvedValue(true);
      const user = userEvent.setup();
      render(<GoalTracker {...defaultProps} goals={goalsForEditDelete} />);
      await user.click(screen.getByRole("button", { name: /Delete Us goal at 10'/ }));
      await waitFor(() => expect(mockDeleteGoal).toHaveBeenCalledWith("g1"));
      expect(mockUpdateGame).toHaveBeenCalledWith("game-1", { ourScore: 0, opponentScore: 0 });
      expect(mockOnScoreUpdate).toHaveBeenCalledWith(0, 0);
    });

    it("decrements opponentScore when scoredByUs=false", async () => {
      mockConfirm.mockResolvedValue(true);
      const user = userEvent.setup();
      render(
        <GoalTracker
          {...defaultProps}
          gameState={makeGameState({ ourScore: 1, opponentScore: 2 }) as any}
          goals={goalsForEditDelete}
        />
      );
      await user.click(screen.getByRole("button", { name: /Delete Eagles goal at 20'/ }));
      await waitFor(() => expect(mockDeleteGoal).toHaveBeenCalledWith("g2"));
      expect(mockUpdateGame).toHaveBeenCalledWith("game-1", { ourScore: 1, opponentScore: 1 });
      expect(mockOnScoreUpdate).toHaveBeenCalledWith(1, 1);
    });

    it("uses Math.max(0, score-1) and does not go below 0", async () => {
      mockConfirm.mockResolvedValue(true);
      const user = userEvent.setup();
      render(
        <GoalTracker
          {...defaultProps}
          gameState={makeGameState({ ourScore: 0, opponentScore: 0 }) as any}
          goals={goalsForEditDelete}
        />
      );
      await user.click(screen.getByRole("button", { name: /Delete Us goal at 10'/ }));
      await waitFor(() => expect(mockDeleteGoal).toHaveBeenCalledWith("g1"));
      expect(mockUpdateGame).toHaveBeenCalledWith("game-1", { ourScore: 0, opponentScore: 0 });
    });

    it("does not call updateGame if deleteGoal throws", async () => {
      mockConfirm.mockResolvedValue(true);
      mockDeleteGoal.mockRejectedValue(new Error("Network error"));
      const user = userEvent.setup();
      render(<GoalTracker {...defaultProps} goals={goalsForEditDelete} />);
      await user.click(screen.getByRole("button", { name: /Delete Us goal at 10'/ }));
      await waitFor(() => expect(mockDeleteGoal).toHaveBeenCalledWith("g1"));
      expect(mockUpdateGame).not.toHaveBeenCalled();
    });

    it("does not delete when confirm is cancelled", async () => {
      mockConfirm.mockResolvedValue(false);
      const user = userEvent.setup();
      render(<GoalTracker {...defaultProps} goals={goalsForEditDelete} />);
      await user.click(screen.getByRole("button", { name: /Delete Us goal at 10'/ }));
      await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
      expect(mockDeleteGoal).not.toHaveBeenCalled();
    });
  });

  describe("goal edit", () => {
    it("opens modal pre-populated with goal's scorer, assist, notes", async () => {
      const user = userEvent.setup();
      render(<GoalTracker {...defaultProps} goals={goalsForEditDelete} />);
      await user.click(screen.getByRole("button", { name: /Edit Us goal at 10'/ }));
      expect(screen.getByRole("heading", { name: /Edit Our Goal/ })).toBeInTheDocument();
      expect(screen.getByTestId("editScorer")).toHaveValue("p1");
      expect(screen.getByTestId("editAssist")).toHaveValue("p2");
      expect(screen.getByPlaceholderText("Optional notes")).toHaveValue("Great shot");
    });

    it("calls updateGoal with editable fields and does not call updateGame", async () => {
      const user = userEvent.setup();
      render(<GoalTracker {...defaultProps} goals={goalsForEditDelete} />);
      await user.click(screen.getByRole("button", { name: /Edit Us goal at 10'/ }));
      await user.click(screen.getByText("Save Changes"));
      await waitFor(() => expect(mockUpdateGoal).toHaveBeenCalledWith("g1", {
        scorerId: "p1",
        assistId: "p2",
        notes: "Great shot",
      }));
      expect(mockUpdateGame).not.toHaveBeenCalled();
    });

    it("coerces empty scorer string to undefined when saving opponent goal", async () => {
      const user = userEvent.setup();
      // g2 is opponent goal with null scorerId -> editScorerId starts as ''
      render(<GoalTracker {...defaultProps} goals={goalsForEditDelete} />);
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
      render(<GoalTracker {...defaultProps} goals={goalsForEditDelete} />);
      await user.click(screen.getByRole("button", { name: /Edit Us goal at 10'/ }));
      // Clear the scorer select to empty
      await user.selectOptions(screen.getByTestId("editScorer"), "");
      await user.click(screen.getByText("Save Changes"));
      expect(screen.getByText("A scorer is required for our goals.")).toBeInTheDocument();
      expect(mockUpdateGoal).not.toHaveBeenCalled();
    });

    it("closes modal when Cancel clicked", async () => {
      const user = userEvent.setup();
      render(<GoalTracker {...defaultProps} goals={goalsForEditDelete} />);
      await user.click(screen.getByRole("button", { name: /Edit Us goal at 10'/ }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
