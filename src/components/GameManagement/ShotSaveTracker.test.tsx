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

const mockCreateShot = vi.fn().mockResolvedValue(undefined);
const mockDeleteShot = vi.fn().mockResolvedValue(undefined);
const mockUpdateShot = vi.fn().mockResolvedValue(undefined);
const mockCreateSave = vi.fn().mockResolvedValue(undefined);
const mockDeleteSave = vi.fn().mockResolvedValue(undefined);
const mockUpdateSave = vi.fn().mockResolvedValue(undefined);

const makeMutations = (overrides: Record<string, any> = {}) => ({
  createShot: mockCreateShot,
  deleteShot: mockDeleteShot,
  updateShot: mockUpdateShot,
  createSave: mockCreateSave,
  deleteSave: mockDeleteSave,
  updateSave: mockUpdateSave,
  ...overrides,
});

const defaultProps = {
  gameState: makeGameState() as any,
  game: { id: "game-1" } as any,
  team: { coaches: ["coach-1"] } as any,
  players,
  shots: [] as any[],
  saves: [] as any[],
  currentTime: 600,
  mutations: makeMutations() as any,
  playTimeRecords: [] as any[],
  lineup: [] as any[],
};

describe("ShotSaveTracker", () => {
  beforeEach(() => {
    mockCreateShot.mockReset().mockResolvedValue(undefined);
    mockDeleteShot.mockReset().mockResolvedValue(undefined);
    mockUpdateShot.mockReset().mockResolvedValue(undefined);
    mockCreateSave.mockReset().mockResolvedValue(undefined);
    mockDeleteSave.mockReset().mockResolvedValue(undefined);
    mockUpdateSave.mockReset().mockResolvedValue(undefined);
    vi.mocked(showSuccess).mockClear();
  });

  describe("entry buttons visibility (Shots)", () => {
    it("shows entry buttons when in-progress", () => {
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" />);
      expect(screen.getByText(/Shot - Us/)).toBeInTheDocument();
      expect(screen.getByText(/Shot - Eagles/)).toBeInTheDocument();
    });

    it("hides entry buttons when scheduled (mirrors GoalTracker's no-op guard)", () => {
      renderWithProvider(
        <ShotSaveTracker
          {...defaultProps}
          statView="shots"
          gameState={makeGameState({ status: "scheduled" }) as any}
        />
      );
      expect(screen.queryByText(/Shot - Us/)).not.toBeInTheDocument();
    });

    it("shows entry buttons when completed", () => {
      renderWithProvider(
        <ShotSaveTracker
          {...defaultProps}
          statView="shots"
          gameState={makeGameState({ status: "completed" }) as any}
        />
      );
      expect(screen.getByText(/Shot - Us/)).toBeInTheDocument();
    });
  });

  describe("entry buttons visibility (Saves)", () => {
    it("shows Save entry buttons", () => {
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="saves" />);
      expect(screen.getByText(/Save - Us/)).toBeInTheDocument();
      expect(screen.getByText(/Save - Eagles/)).toBeInTheDocument();
    });

    it("hides Save entry buttons when scheduled", () => {
      renderWithProvider(
        <ShotSaveTracker
          {...defaultProps}
          statView="saves"
          gameState={makeGameState({ status: "scheduled" }) as any}
        />
      );
      expect(screen.queryByText(/Save - Us/)).not.toBeInTheDocument();
    });
  });

  describe("Shot entry — Us/Opponent two-button flow", () => {
    it("opens modal for Us shot with a required player select and on-target toggle", async () => {
      const user = userEvent.setup();
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" />);
      await user.click(screen.getByText(/Shot - Us/));
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Record Shot");
      expect(screen.getByText("Who Took the Shot? *")).toBeInTheDocument();
      expect(screen.getByTestId("shotsPlayer")).toBeInTheDocument();
      expect(screen.getByLabelText("On Target?")).toBeInTheDocument();
    });

    it("opens modal for opponent shot without a player select, but keeps the on-target toggle", async () => {
      const user = userEvent.setup();
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" />);
      await user.click(screen.getByText(/Shot - Eagles/));
      expect(screen.queryByTestId("shotsPlayer")).not.toBeInTheDocument();
      expect(screen.getByLabelText("On Target?")).toBeInTheDocument();
    });

    it("requires a shooter for an Us shot", async () => {
      const user = userEvent.setup();
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" />);
      await user.click(screen.getByText(/Shot - Us/));
      await user.click(screen.getByRole("button", { name: /^Record Shot$/ }));
      expect(mockCreateShot).not.toHaveBeenCalled();
    });

    it("creates an Us shot with takenByUs, onTarget, and loggedVia: COACH", async () => {
      const user = userEvent.setup();
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" />);
      await user.click(screen.getByText(/Shot - Us/));
      await user.selectOptions(screen.getByTestId("shotsPlayer"), "p1");
      await user.click(screen.getByRole("button", { name: /^Record Shot$/ }));
      await waitFor(() => expect(mockCreateShot).toHaveBeenCalledWith(expect.objectContaining({
        gameId: "game-1",
        takenByUs: true,
        onTarget: true,
        playerId: "p1",
        loggedVia: "COACH",
        coaches: ["coach-1"],
      })));
    });

    it("creates an opponent shot with no playerId", async () => {
      const user = userEvent.setup();
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" />);
      await user.click(screen.getByText(/Shot - Eagles/));
      await user.click(screen.getByRole("button", { name: /^Record Shot$/ }));
      await waitFor(() => expect(mockCreateShot).toHaveBeenCalledWith(expect.objectContaining({
        takenByUs: false,
        playerId: undefined,
        loggedVia: "COACH",
      })));
    });
  });

  describe("Save entry — Us/Opponent two-button flow", () => {
    it("Us save's player select is optional (goalkeeper may be unknown)", async () => {
      const user = userEvent.setup();
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="saves" />);
      await user.click(screen.getByText(/Save - Us/));
      expect(screen.getByText("Goalkeeper (optional)")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /^Record Save$/ }));
      await waitFor(() => expect(mockCreateSave).toHaveBeenCalledWith(expect.objectContaining({
        byUs: true,
        playerId: undefined,
        loggedVia: "COACH",
      })));
    });

    it("opens modal for opponent save without a player select", async () => {
      const user = userEvent.setup();
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="saves" />);
      await user.click(screen.getByText(/Save - Eagles/));
      expect(screen.queryByTestId("savesPlayer")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /^Record Save$/ }));
      await waitFor(() => expect(mockCreateSave).toHaveBeenCalledWith(expect.objectContaining({
        byUs: false,
        playerId: undefined,
      })));
    });

    it("saves do not show an on-target toggle", async () => {
      const user = userEvent.setup();
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="saves" />);
      await user.click(screen.getByText(/Save - Us/));
      expect(screen.queryByLabelText("On Target?")).not.toBeInTheDocument();
    });
  });

  describe("stats list — Us vs opponent edit suppression", () => {
    const shotsData = [
      { id: "s1", takenByUs: true, onTarget: true, gameSeconds: 600, half: 1, playerId: "p1" },
      { id: "s2", takenByUs: false, onTarget: false, gameSeconds: 1200, half: 1, playerId: null },
    ] as any[];

    it("renders stat cards with minute and half", () => {
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={shotsData} />);
      expect(screen.getByText("10'")).toBeInTheDocument();
      expect(screen.getByText("20'")).toBeInTheDocument();
    });

    it("shows Edit and Delete for an Us-attributed row", () => {
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={shotsData} />);
      expect(screen.getByRole("button", { name: /Edit Us shot at 10'/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Delete Us shot at 10'/ })).toBeInTheDocument();
    });

    it("suppresses Edit but keeps Delete for an opponent-attributed row", () => {
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={shotsData} />);
      expect(screen.queryByRole("button", { name: /Edit Eagles shot at 20'/ })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Delete Eagles shot at 20'/ })).toBeInTheDocument();
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

  });

  describe("edit modal (Us rows only)", () => {
    const shotsData = [
      { id: "s1", takenByUs: true, onTarget: true, gameSeconds: 600, half: 1, playerId: "p1" },
    ] as any[];

    it("opens pre-populated with the shot's player and on-target value", async () => {
      const user = userEvent.setup();
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={shotsData} />);
      await user.click(screen.getByRole("button", { name: /Edit Us shot at 10'/ }));
      expect(screen.getByRole("heading", { name: /Edit Our Shot/ })).toBeInTheDocument();
      expect(screen.getByTestId("editshotsPlayer")).toHaveValue("p1");
    });

    it("calls updateShot with the edited fields", async () => {
      const user = userEvent.setup();
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={shotsData} />);
      await user.click(screen.getByRole("button", { name: /Edit Us shot at 10'/ }));
      await user.click(screen.getByText("Save Changes"));
      await waitFor(() => expect(mockUpdateShot).toHaveBeenCalledWith("s1", {
        playerId: "p1",
        onTarget: true,
      }));
    });

    it("requires a shooter when editing an Us shot", async () => {
      const user = userEvent.setup();
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={shotsData} />);
      await user.click(screen.getByRole("button", { name: /Edit Us shot at 10'/ }));
      await user.selectOptions(screen.getByTestId("editshotsPlayer"), "");
      await user.click(screen.getByText("Save Changes"));
      expect(screen.getByText("A shooter is required for our shots.")).toBeInTheDocument();
      expect(mockUpdateShot).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    const shotsData = [
      { id: "s1", takenByUs: true, onTarget: true, gameSeconds: 600, half: 1, playerId: "p1" },
    ] as any[];

    it("uses shot-specific delete confirmation copy", async () => {
      const user = userEvent.setup();
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="shots" shots={shotsData} />);
      await user.click(screen.getByRole("button", { name: /Delete Us shot at 10'/ }));
      expect(screen.getByRole("heading", { name: "Delete shot?" })).toBeInTheDocument();
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

    it("calls deleteSave for a save row", async () => {
      const user = userEvent.setup();
      renderWithProvider(<ShotSaveTracker {...defaultProps} statView="saves" saves={savesData} />);
      await user.click(screen.getByRole("button", { name: /Delete Us save at 5'/ }));
      await user.click(screen.getByRole("button", { name: /^Delete$/ }));
      await waitFor(() => expect(mockDeleteSave).toHaveBeenCalledWith("sv1"));
    });
  });
});
