/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlayerNotesPanel } from "./PlayerNotesPanel";
import { ConfirmProvider } from "../ConfirmModal";
import { showWarning } from "../../utils/toast";

const performSendOff = vi.hoisted(() => vi.fn());
vi.mock("../../services/sendOffService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/sendOffService")>()),
  performSendOff,
}));

vi.mock("../../utils/toast", () => ({
  showWarning: vi.fn(), showError: vi.fn(), showSuccess: vi.fn(), showInfo: vi.fn(),
}));
vi.mock("../../utils/deviceDetect", () => ({ isLikelyIOS: vi.fn(() => false) }));
vi.mock("./hooks/useSpeechToText", () => ({
  useSpeechToText: vi.fn(() => ({
    isSupported: false, status: "idle", isListening: false, interimTranscript: "",
    errorCode: null, lowConfidenceDetected: false, start: vi.fn(), stop: vi.fn(),
  })),
}));
vi.mock("../PlayerSelect", () => ({
  PlayerSelect: ({ id, players, onChange, value }: any) => (
    <select data-testid={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">None</option>
      {players.map((p: any) => <option key={p.id} value={p.id}>{p.firstName}</option>)}
    </select>
  ),
}));

const players = [
  { id: "p1", playerNumber: 5, firstName: "Alice", lastName: "Smith" },
  { id: "p2", playerNumber: 9, firstName: "Bea", lastName: "Jones" },
] as any[];
const positions = [
  { id: "cb", positionName: "Center Back", role: "DEFENDER" },
  { id: "gk", positionName: "Goalkeeper", role: "GOALKEEPER" },
] as any[];
const lineup = [
  { id: "la-1", playerId: "p1", positionId: "cb", isStarter: true },
  { id: "la-2", playerId: "p2", positionId: "gk", isStarter: true },
] as any[];

const rescindSendOff = vi.fn().mockResolvedValue(undefined);
const createGameNote = vi.fn().mockResolvedValue(undefined);
const baseProps = {
  gameState: { id: "game-1", status: "in-progress", currentHalf: 1 } as any,
  game: { id: "game-1" } as any,
  team: { coaches: ["coach-1"] } as any,
  players,
  gameNotes: [] as any[],
  currentTime: 600,
  mutations: { createGameNote, rescindSendOff } as any,
  currentUserId: "coach-1",
  lineup,
  playTimeRecords: [] as any[],
  positions,
};

function renderPanel(props: Record<string, unknown> = {}) {
  return render(<ConfirmProvider><PlayerNotesPanel {...baseProps} {...props} /></ConfirmProvider>);
}

async function fillRedCard(user: ReturnType<typeof userEvent.setup>, playerId: string) {
  await user.click(screen.getByRole("button", { name: /Red Card/i }));
  await user.selectOptions(screen.getByTestId("notePlayer"), playerId);
  await user.type(screen.getByLabelText("Note"), "Serious foul play");
  await user.click(screen.getByRole("button", { name: "Save Note" }));
}

describe("PlayerNotesPanel red card send-off", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    performSendOff.mockResolvedValue({ vacateFailed: false });
  });

  it("asks for confirmation naming the position that will stay empty, then sends the player off", async () => {
    const user = userEvent.setup();
    renderPanel();
    await fillRedCard(user, "p1");

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("#5 Alice Smith will be sent off");
    expect(dialog).toHaveTextContent("Center Back stays empty for the rest of the game");
    expect(performSendOff).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Send off" }));
    await waitFor(() => expect(performSendOff).toHaveBeenCalledTimes(1));
    expect(performSendOff).toHaveBeenCalledWith(expect.objectContaining({
      playerId: "p1", gameSeconds: 600, half: 1, notes: "Serious foul play",
    }));
    expect(createGameNote).not.toHaveBeenCalled();
  });

  it("writes nothing when the coach cancels the confirmation", async () => {
    const user = userEvent.setup();
    renderPanel();
    await fillRedCard(user, "p1");

    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(performSendOff).not.toHaveBeenCalled();
    expect(createGameNote).not.toHaveBeenCalled();
  });

  it("explains that a sent-off goalkeeper's slot stays open for cover", async () => {
    const user = userEvent.setup();
    renderPanel();
    await fillRedCard(user, "p2");

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("leaves the goalkeeper position");
    expect(dialog).toHaveTextContent("plays a player down");
  });

  it("tells the coach when the card was recorded but the lineup could not be cleared", async () => {
    performSendOff.mockResolvedValue({ vacateFailed: true });
    const user = userEvent.setup();
    renderPanel();
    await fillRedCard(user, "p1");
    await user.click(await screen.findByRole("button", { name: "Send off" }));

    await waitFor(() => expect(showWarning).toHaveBeenCalledWith(expect.stringContaining("Red card recorded")));
  });

  it("keeps a red card without live-game data as a plain note", async () => {
    const user = userEvent.setup();
    renderPanel({ lineup: undefined, playTimeRecords: undefined });
    await fillRedCard(user, "p1");
    await waitFor(() => expect(createGameNote).toHaveBeenCalledWith(expect.objectContaining({ noteType: "red-card" })));
    expect(performSendOff).not.toHaveBeenCalled();
  });

  it("does not run the send-off flow for a red card with no player (e.g. an opponent)", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: /Red Card/i }));
    await user.type(screen.getByLabelText("Note"), "Their #7 sent off");
    await user.click(screen.getByRole("button", { name: "Save Note" }));
    await waitFor(() => expect(createGameNote).toHaveBeenCalledTimes(1));
    expect(performSendOff).not.toHaveBeenCalled();
  });
});

describe("PlayerNotesPanel rescind send-off", () => {
  const redCard = {
    id: "note-red", noteType: "red-card", playerId: "p1", positionId: "cb", gameSeconds: 360, half: 1,
    authorId: "coach-2", notes: "Serious foul", timestamp: new Date().toISOString(), rescindedAt: null,
  } as any;

  beforeEach(() => vi.clearAllMocks());

  it("lets any team coach rescind after confirming, without deleting the card", async () => {
    const user = userEvent.setup();
    renderPanel({ gameNotes: [redCard] });

    await user.click(screen.getByRole("button", { name: "Rescind send-off" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("stays in the game record, marked rescinded");
    await user.click(within(dialog).getByRole("button", { name: "Rescind send-off" }));

    await waitFor(() => expect(rescindSendOff).toHaveBeenCalledWith("note-red"));
  });

  it("does not offer rescind to someone who is not a team coach", () => {
    renderPanel({ gameNotes: [redCard], currentUserId: "outsider" });
    expect(screen.queryByRole("button", { name: "Rescind send-off" })).not.toBeInTheDocument();
  });

  it("shows a rescinded card as rescinded and removes the rescind action", () => {
    renderPanel({ gameNotes: [{ ...redCard, rescindedAt: "2026-10-26T00:00:00Z" }] });
    expect(screen.getByText("Rescinded")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rescind send-off" })).not.toBeInTheDocument();
  });

  it("does not offer rescind on a yellow card", () => {
    renderPanel({ gameNotes: [{ ...redCard, id: "y", noteType: "yellow-card" }] });
    expect(screen.queryByRole("button", { name: "Rescind send-off" })).not.toBeInTheDocument();
  });
});
