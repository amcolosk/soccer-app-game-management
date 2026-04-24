import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LineupShapeView } from "./LineupShapeView";
import type {
  FormationPosition,
  Game,
  LineupAssignment,
  PlayTimeRecord,
  PlayerWithRoster,
} from "../types";

const mockExportLineupShapeLocally = vi.fn(() => ({ filename: "game-1.lineup-shape.json" }));
const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();

vi.mock("./lineupShapeDeterminism", () => ({
  LINEUP_SHAPE_LAYOUT_VERSION: "soccer-shape-v1",
  buildLineupShapeNodes: vi.fn(() => [
    {
      positionId: "pos-gk",
      positionName: "Goalkeeper",
      abbreviation: "GK",
      lane: "gk",
      laneIndex: 0,
      slotIndex: 0,
      xPct: 50,
      yPct: 85,
    },
  ]),
}));

vi.mock("./exportLineupShape", () => ({
  exportLineupShapeLocally: (...args: unknown[]) => mockExportLineupShapeLocally(...args),
}));

vi.mock("../../../utils/toast", () => ({
  showSuccess: (...args: unknown[]) => mockShowSuccess(...args),
  showError: (...args: unknown[]) => mockShowError(...args),
}));

const baseGame = {
  id: "game-1",
  teamId: "team-1",
  currentHalf: 1,
  elapsedSeconds: 0,
  halfLengthMinutes: 30,
} as unknown as Game;

const positions = [
  {
    id: "pos-gk",
    positionName: "Goalkeeper",
    abbreviation: "GK",
  } as FormationPosition,
];

const players = [
  {
    id: "player-1",
    firstName: "Ava",
    lastName: "Keeper",
    playerNumber: 1,
  } as PlayerWithRoster,
];

const lineup = [
  {
    id: "la-1",
    positionId: "pos-gk",
    playerId: "player-1",
    isStarter: true,
  } as LineupAssignment,
];

const renderView = (status: string, lineupAssignments: LineupAssignment[] = lineup) => {
  const onSubstitute = vi.fn();
  const onQuickReplace = vi.fn().mockResolvedValue("success");
  const onClearSlot = vi.fn().mockResolvedValue("success");

  return render(
    <LineupShapeView
      gameState={{ ...baseGame, status } as Game}
      game={{ ...baseGame, status } as Game}
      positions={positions}
      lineup={lineupAssignments}
      players={players}
      playTimeRecords={[] as PlayTimeRecord[]}
      currentTime={0}
      teamMaxPlayersOnField={7}
      onSubstitute={onSubstitute}
      onQuickReplace={onQuickReplace}
      onClearSlot={onClearSlot}
    />,
  );
};

const renderViewWithPlayers = (
  status: string,
  playersOverride: PlayerWithRoster[],
  lineupAssignments: LineupAssignment[] = lineup,
) => {
  const onSubstitute = vi.fn();
  const onQuickReplace = vi.fn().mockResolvedValue("success");
  const onClearSlot = vi.fn().mockResolvedValue("success");

  return render(
    <LineupShapeView
      gameState={{ ...baseGame, status } as Game}
      game={{ ...baseGame, status } as Game}
      positions={positions}
      lineup={lineupAssignments}
      players={playersOverride}
      playTimeRecords={[] as PlayTimeRecord[]}
      currentTime={0}
      teamMaxPlayersOnField={7}
      onSubstitute={onSubstitute}
      onQuickReplace={onQuickReplace}
      onClearSlot={onClearSlot}
    />,
  );
};

describe("LineupShapeView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports with accessible control and without identity in export params", async () => {
    const user = userEvent.setup();
    renderView("scheduled");

    const exportButton = screen.getByRole("button", {
      name: /export lineup shape and bench strip to local file/i,
    });
    await user.click(exportButton);

    expect(mockExportLineupShapeLocally).toHaveBeenCalledTimes(1);
    const exportParams = mockExportLineupShapeLocally.mock.calls[0][0] as Record<string, unknown>;
    expect(exportParams).not.toHaveProperty("coachUserId");
    expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining("Exported lineup shape"));
  });

  it("exposes halftime helper text in a live region", () => {
    renderView("halftime");

    const halftimeHint = screen.getByText(/halftime preview/i);
    expect(halftimeHint).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("region", { name: /locked bench strip/i })).toBeInTheDocument();
  });

  it("renders shared pitch surface semantics and decorative markings", () => {
    renderView("scheduled");

    const pitch = screen.getByRole("img", { name: /soccer lineup shape/i });
    expect(pitch).toHaveClass("soccer-pitch-surface");
    expect(pitch).toHaveClass("lineup-shape-view__pitch");

    const markings = document.querySelector(".soccer-pitch-surface__markings");
    expect(markings).toHaveAttribute("aria-hidden", "true");
    expect(document.querySelectorAll(".soccer-pitch-surface__penalty-box").length).toBe(2);
  });

  it("keeps pitch actions keyboard-reachable with readable tap-target metadata", async () => {
    const user = userEvent.setup();
    renderView("scheduled");

    const exportButton = screen.getByRole("button", { name: /export lineup shape and bench strip to local file/i });
    expect(exportButton).toBeInTheDocument();

    await user.tab();
    expect(exportButton).toHaveFocus();

    const nodeButton = screen.getByRole("button", { name: /goalkeeper: ava keeper/i });
    expect(nodeButton).toHaveAttribute("title", "Tap to quick replace");
  });

  it("routes assigned scheduled node taps into quick replace dialog", async () => {
    const user = userEvent.setup();
    const onSubstitute = vi.fn();
    const onQuickReplace = vi.fn().mockResolvedValue("success");

    render(
      <LineupShapeView
        gameState={{ ...baseGame, status: "scheduled" } as Game}
        game={{ ...baseGame, status: "scheduled" } as Game}
        positions={positions}
        lineup={lineup}
        players={players}
        playTimeRecords={[] as PlayTimeRecord[]}
        currentTime={0}
        teamMaxPlayersOnField={7}
        onSubstitute={onSubstitute}
        onQuickReplace={onQuickReplace}
        onClearSlot={vi.fn().mockResolvedValue("success")}
      />,
    );

    await user.click(screen.getByRole("button", { name: /goalkeeper: ava keeper/i }));
    expect(screen.getByRole("dialog", { name: /quick replace: goalkeeper/i })).toBeInTheDocument();
    expect(onSubstitute).not.toHaveBeenCalled();
  });

  it("keeps in-progress assigned node taps routed to substitution", async () => {
    const user = userEvent.setup();
    const onSubstitute = vi.fn();

    render(
      <LineupShapeView
        gameState={{ ...baseGame, status: "in-progress" } as Game}
        game={{ ...baseGame, status: "in-progress" } as Game}
        positions={positions}
        lineup={lineup}
        players={players}
        playTimeRecords={[] as PlayTimeRecord[]}
        currentTime={0}
        teamMaxPlayersOnField={7}
        onSubstitute={onSubstitute}
        onQuickReplace={vi.fn().mockResolvedValue("success")}
        onClearSlot={vi.fn().mockResolvedValue("success")}
      />,
    );

    await user.click(screen.getByRole("button", { name: /goalkeeper: ava keeper/i }));
    expect(onSubstitute).toHaveBeenCalledWith(expect.objectContaining({ id: "pos-gk" }));
    expect(screen.queryByRole("dialog", { name: /quick replace/i })).not.toBeInTheDocument();
  });

  it("disables unsupported node interactions with an accessible unavailable title", () => {
    renderView("completed", []);

    const nodeButton = screen.getByRole("button", { name: /goalkeeper: empty/i });
    expect(nodeButton).toBeDisabled();
    expect(nodeButton).toHaveAttribute("title", "Unavailable");
  });

  it("does not show out-of-position when preferred positions are not configured", () => {
    renderViewWithPlayers("scheduled", [
      {
        id: "player-1",
        firstName: "Ava",
        lastName: "Keeper",
        playerNumber: 1,
        preferredPositions: "",
      } as PlayerWithRoster,
    ]);

    expect(screen.queryByText("Out of position")).not.toBeInTheDocument();
  });

  it("shows out-of-position when assigned position is not in configured preferred positions", () => {
    renderViewWithPlayers("scheduled", [
      {
        id: "player-1",
        firstName: "Ava",
        lastName: "Keeper",
        playerNumber: 1,
        preferredPositions: "pos-rb,pos-cm",
      } as PlayerWithRoster,
    ]);

    expect(screen.getByText("Out of position")).toBeInTheDocument();
  });

  it("removes persistent X control from assigned shape nodes", () => {
    renderView("scheduled");

    expect(screen.queryByRole("button", { name: /remove ava keeper from goalkeeper/i })).not.toBeInTheDocument();
    expect(document.querySelector(".lineup-shape-node__remove")).not.toBeInTheDocument();
  });

  it("exposes player label title for predictable truncation fallback", () => {
    renderView("scheduled");

    const playerLabel = screen.getByTitle("#1 Ava");
    expect(playerLabel).toHaveClass("lineup-shape-node__player");
    expect(playerLabel).toHaveTextContent("#1 Ava");
  });

  it("runs clear-slot action from quick replace dialog", async () => {
    const user = userEvent.setup();
    const onClearSlot = vi.fn().mockResolvedValue("success");

    render(
      <LineupShapeView
        gameState={{ ...baseGame, status: "scheduled" } as Game}
        game={{ ...baseGame, status: "scheduled" } as Game}
        positions={positions}
        lineup={lineup}
        players={players}
        playTimeRecords={[] as PlayTimeRecord[]}
        currentTime={0}
        teamMaxPlayersOnField={7}
        onSubstitute={vi.fn()}
        onQuickReplace={vi.fn().mockResolvedValue("success")}
        onClearSlot={onClearSlot}
      />,
    );

    await user.click(screen.getByRole("button", { name: /goalkeeper: ava keeper/i }));
    await user.click(screen.getByRole("button", { name: /clear slot/i }));

    expect(onClearSlot).toHaveBeenCalledWith({
      assignmentId: "la-1",
      positionName: "Goalkeeper",
      playerName: "Ava Keeper",
    });
  });

  it("shows conflict microcopy when quick replace mutation reports conflict", async () => {
    const user = userEvent.setup();
    const onQuickReplace = vi.fn().mockRejectedValue(new Error("ConditionalCheckFailedException"));
    const playersWithBench = [
      ...players,
      {
        id: "player-2",
        firstName: "Mia",
        lastName: "Bench",
        playerNumber: 12,
      } as PlayerWithRoster,
    ];

    render(
      <LineupShapeView
        gameState={{ ...baseGame, status: "scheduled" } as Game}
        game={{ ...baseGame, status: "scheduled" } as Game}
        positions={positions}
        lineup={lineup}
        players={playersWithBench}
        playTimeRecords={[] as PlayTimeRecord[]}
        currentTime={0}
        teamMaxPlayersOnField={7}
        onSubstitute={vi.fn()}
        onQuickReplace={onQuickReplace}
        onClearSlot={vi.fn().mockResolvedValue("success")}
      />,
    );

    await user.click(screen.getByRole("button", { name: /goalkeeper: ava keeper/i }));
    await user.click(screen.getByRole("button", { name: /#12 mia bench/i }));

    const conflictMessages = screen.getAllByText(/lineup changed from another update/i);
    expect(conflictMessages.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps quick replace dialog open and shows conflict when clear-slot reports conflict", async () => {
    const user = userEvent.setup();
    const onClearSlot = vi.fn().mockResolvedValue("conflict");

    render(
      <LineupShapeView
        gameState={{ ...baseGame, status: "scheduled" } as Game}
        game={{ ...baseGame, status: "scheduled" } as Game}
        positions={positions}
        lineup={lineup}
        players={players}
        playTimeRecords={[] as PlayTimeRecord[]}
        currentTime={0}
        teamMaxPlayersOnField={7}
        onSubstitute={vi.fn()}
        onQuickReplace={vi.fn().mockResolvedValue("success")}
        onClearSlot={onClearSlot}
      />,
    );

    await user.click(screen.getByRole("button", { name: /goalkeeper: ava keeper/i }));
    await user.click(screen.getByRole("button", { name: /clear slot/i }));

    expect(screen.getByRole("dialog", { name: /quick replace: goalkeeper/i })).toBeInTheDocument();
    const conflictMessages = screen.getAllByText(/lineup changed from another update/i);
    expect(conflictMessages.length).toBeGreaterThanOrEqual(1);
    expect(mockShowSuccess).not.toHaveBeenCalledWith("Lineup slot cleared.");
    expect(onClearSlot).toHaveBeenCalledTimes(1);
  });
});
