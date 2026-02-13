import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlayerNotesPanel } from "./PlayerNotesPanel";

vi.mock("aws-amplify/data", () => ({
  generateClient: () => ({
    models: {
      GameNote: { create: vi.fn().mockResolvedValue({ data: {} }) },
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
  ...overrides,
});

const players = [
  { id: "p1", playerNumber: 10, firstName: "Alice", lastName: "Smith" },
] as any[];

const defaultProps = {
  gameState: makeGameState() as any,
  game: { id: "game-1" } as any,
  team: { coaches: ["coach-1"] } as any,
  players,
  gameNotes: [] as any[],
  currentTime: 600,
};

describe("PlayerNotesPanel", () => {
  describe("note buttons visibility", () => {
    it("hides all buttons when scheduled", () => {
      render(
        <PlayerNotesPanel
          {...defaultProps}
          gameState={makeGameState({ status: "scheduled" }) as any}
        />
      );
      expect(screen.queryByText(/Gold Star/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Yellow Card/)).not.toBeInTheDocument();
    });

    it("shows 4 buttons when in-progress", () => {
      render(<PlayerNotesPanel {...defaultProps} />);
      expect(screen.getByText(/Gold Star/)).toBeInTheDocument();
      expect(screen.getByText(/Yellow Card/)).toBeInTheDocument();
      expect(screen.getByText(/Red Card/)).toBeInTheDocument();
      expect(screen.getByText("📝 Note")).toBeInTheDocument();
    });

    it("shows only 2 buttons when completed", () => {
      render(
        <PlayerNotesPanel
          {...defaultProps}
          gameState={makeGameState({ status: "completed" }) as any}
        />
      );
      expect(screen.getByText(/Gold Star/)).toBeInTheDocument();
      expect(screen.getByText("📝 Note")).toBeInTheDocument();
      expect(screen.queryByText(/Yellow Card/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Red Card/)).not.toBeInTheDocument();
    });
  });

  describe("note modal", () => {
    it("opens modal with Gold Star icon when clicked", async () => {
      const user = userEvent.setup();
      render(<PlayerNotesPanel {...defaultProps} />);
      await user.click(screen.getByText(/Gold Star/));
      // Modal title should contain the icon and label
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Gold Star");
    });

    it("opens modal with Yellow Card icon when clicked", async () => {
      const user = userEvent.setup();
      render(<PlayerNotesPanel {...defaultProps} />);
      await user.click(screen.getByText(/Yellow Card/));
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Yellow Card");
    });

    it("shows Post-Game Note subtitle when completed", async () => {
      const user = userEvent.setup();
      render(
        <PlayerNotesPanel
          {...defaultProps}
          gameState={makeGameState({ status: "completed" }) as any}
        />
      );
      await user.click(screen.getByText(/Gold Star/));
      expect(screen.getByText("Post-Game Note")).toBeInTheDocument();
    });

    it("shows game time subtitle when in-progress", async () => {
      const user = userEvent.setup();
      render(<PlayerNotesPanel {...defaultProps} />);
      await user.click(screen.getByText(/Gold Star/));
      // Should not show "Post-Game Note"
      expect(screen.queryByText("Post-Game Note")).not.toBeInTheDocument();
    });

    it("shows player select in modal", async () => {
      const user = userEvent.setup();
      render(<PlayerNotesPanel {...defaultProps} />);
      await user.click(screen.getByText(/Gold Star/));
      expect(screen.getByTestId("notePlayer")).toBeInTheDocument();
    });

    it("closes modal when Cancel clicked", async () => {
      const user = userEvent.setup();
      render(<PlayerNotesPanel {...defaultProps} />);
      await user.click(screen.getByText(/Gold Star/));
      expect(screen.getByText("Save Note")).toBeInTheDocument();
      await user.click(screen.getByText("Cancel"));
      expect(screen.queryByText("Save Note")).not.toBeInTheDocument();
    });
  });

  describe("notes list", () => {
    const notesData = [
      {
        id: "n1",
        noteType: "gold-star",
        gameSeconds: 300,
        half: 1,
        playerId: "p1",
        notes: "Great defending",
      },
      {
        id: "n2",
        noteType: "yellow-card",
        gameSeconds: 900,
        half: 1,
        playerId: null,
        notes: null,
      },
    ] as any[];

    it("renders note cards with correct icon", () => {
      render(<PlayerNotesPanel {...defaultProps} gameNotes={notesData} />);
      expect(screen.getByText("Game Notes")).toBeInTheDocument();
    });

    it("shows correct note type labels", () => {
      render(<PlayerNotesPanel {...defaultProps} gameNotes={notesData} />);
      expect(screen.getByText("Gold Star")).toBeInTheDocument();
      expect(screen.getByText("Yellow Card")).toBeInTheDocument();
    });

    it("shows player name when note has playerId", () => {
      render(<PlayerNotesPanel {...defaultProps} gameNotes={notesData} />);
      expect(screen.getByText("#10 Alice Smith")).toBeInTheDocument();
    });

    it("shows note text when present", () => {
      render(<PlayerNotesPanel {...defaultProps} gameNotes={notesData} />);
      expect(screen.getByText("Great defending")).toBeInTheDocument();
    });

    it("shows minute and half info", () => {
      render(<PlayerNotesPanel {...defaultProps} gameNotes={notesData} />);
      const timeSpans = document.querySelectorAll(".note-time");
      expect(timeSpans).toHaveLength(2);
      expect(timeSpans[0]).toHaveTextContent("5'");
      expect(timeSpans[1]).toHaveTextContent("15'");
    });

    it("does not render notes section when empty", () => {
      render(<PlayerNotesPanel {...defaultProps} gameNotes={[]} />);
      expect(screen.queryByText("Game Notes")).not.toBeInTheDocument();
    });
  });
});
