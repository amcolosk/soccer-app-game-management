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
      onSubstitute={vi.fn()}
      onRemoveFromLineup={vi.fn().mockResolvedValue(undefined)}
    />, 
  );
};

const renderViewWithPlayers = (
  status: string,
  playersOverride: PlayerWithRoster[],
  lineupAssignments: LineupAssignment[] = lineup,
) => {
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
      onSubstitute={vi.fn()}
      onRemoveFromLineup={vi.fn().mockResolvedValue(undefined)}
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
});
