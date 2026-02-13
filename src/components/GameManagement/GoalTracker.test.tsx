import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
  ourScore: 1,
  opponentScore: 0,
  ...overrides,
});

const players = [
  { id: "p1", playerNumber: 10, firstName: "Alice", lastName: "Smith" },
  { id: "p2", playerNumber: 7, firstName: "Bob", lastName: "Jones" },
] as any[];

const defaultProps = {
  gameState: makeGameState() as any,
  game: { id: "game-1" } as any,
  team: { coaches: ["coach-1"] } as any,
  players,
  goals: [] as any[],
  currentTime: 600,
  onScoreUpdate: vi.fn(),
};

describe("GoalTracker", () => {
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
});
