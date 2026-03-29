/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BenchTab } from "./BenchTab";

const mockConfirm = vi.hoisted(() => vi.fn());
const mockTrackEvent = vi.hoisted(() => vi.fn());
const mockShowSuccess = vi.hoisted(() => vi.fn());
const mockShowWarning = vi.hoisted(() => vi.fn());
const mockShowInfo = vi.hoisted(() => vi.fn());
const mockShowError = vi.hoisted(() => vi.fn());

vi.mock("../ConfirmModal", () => ({
  useConfirm: () => mockConfirm,
}));

vi.mock("../../utils/analytics", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  AnalyticsEvents: {
    PLAYER_MARKED_INJURED: { category: "GameDay", action: "Player Marked Injured" },
    PLAYER_RECOVERED_FROM_INJURY: { category: "GameDay", action: "Player Recovered From Injury" },
  },
}));

vi.mock("../../utils/toast", () => ({
  showSuccess: (...args: unknown[]) => mockShowSuccess(...args),
  showWarning: (...args: unknown[]) => mockShowWarning(...args),
  showInfo: (...args: unknown[]) => mockShowInfo(...args),
  showError: (...args: unknown[]) => mockShowError(...args),
}));

const HALF_LENGTH = 1800; // 30 minutes

const makePlayer = (id: string, playerNumber: number, firstName: string) => ({
  id,
  playerNumber,
  firstName,
  lastName: "Test",
  isActive: true,
  preferredPositions: "",
});

// Creates a play-time record that puts `seconds` of play time on a player
const makeRecord = (playerId: string, seconds: number) => ({
  id: `rec-${playerId}`,
  playerId,
  positionId: "pos-1",
  startGameSeconds: 0,
  endGameSeconds: seconds,
  gameId: "game-1",
});

// Creates an active (no endGameSeconds) record — player is currently on field
const makeActiveRecord = (playerId: string) => ({
  id: `rec-active-${playerId}`,
  playerId,
  positionId: "pos-1",
  startGameSeconds: 0,
  endGameSeconds: null,
  gameId: "game-1",
});

const makeLineupAssignment = (playerId: string) => ({
  id: `la-${playerId}`,
  gameId: "game-1",
  playerId,
  positionId: "pos-1",
  isStarter: true,
});

const defaultProps = {
  players: [] as any[],
  lineup: [] as any[],
  playTimeRecords: [] as any[],
  currentTime: 900, // 15 minutes elapsed
  halfLengthSeconds: HALF_LENGTH,
  gameId: "game-1",
  coaches: ["coach-1"],
  playerAvailabilities: [] as any[],
  mutations: {
    createPlayerAvailability: vi.fn().mockResolvedValue(undefined),
    updatePlayerAvailability: vi.fn().mockResolvedValue(undefined),
  } as any,
  onSelectPlayer: vi.fn(),
};

describe("BenchTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
  });

  // ── Empty state ──────────────────────────────────────────────────────────
  it("shows empty bench message when all players are in the lineup", () => {
    const players = [makePlayer("p1", 7, "Alice")];
    const lineup = [makeLineupAssignment("p1")];
    render(<BenchTab {...defaultProps} players={players as any} lineup={lineup as any} />);
    expect(screen.getByText(/No bench players available/i)).toBeInTheDocument();
  });

  it("does not show the bench section header when bench is empty", () => {
    const players = [makePlayer("p1", 7, "Alice")];
    const lineup = [makeLineupAssignment("p1")];
    render(<BenchTab {...defaultProps} players={players as any} lineup={lineup as any} />);
    expect(screen.queryByText(/Bench — tap to substitute/i)).not.toBeInTheDocument();
  });

  // ── Sorting ──────────────────────────────────────────────────────────────
  it("sorts bench players by play time ascending (least time first)", () => {
    const players = [
      makePlayer("p1", 10, "Alice"), // 600s
      makePlayer("p2", 7, "Bob"),    // 200s
      makePlayer("p3", 5, "Carol"),  // 900s
    ];
    const records = [
      makeRecord("p1", 600),
      makeRecord("p2", 200),
      makeRecord("p3", 900),
    ];
    render(
      <BenchTab
        {...defaultProps}
        players={players as any}
        playTimeRecords={records as any}
      />
    );
    const names = screen.getAllByText(/Alice|Bob|Carol/).map(el => el.textContent);
    const bobIndex = names.findIndex(n => n?.includes("Bob"));
    const aliceIndex = names.findIndex(n => n?.includes("Alice"));
    const carolIndex = names.findIndex(n => n?.includes("Carol"));
    expect(bobIndex).toBeLessThan(aliceIndex);
    expect(aliceIndex).toBeLessThan(carolIndex);
  });

  it("breaks ties in play time by jersey number ascending", () => {
    const players = [
      makePlayer("p1", 7, "Alice"),  // 300s
      makePlayer("p2", 5, "Bob"),    // 300s — lower jersey number → first
    ];
    const records = [
      makeRecord("p1", 300),
      makeRecord("p2", 300),
    ];
    render(
      <BenchTab
        {...defaultProps}
        players={players as any}
        playTimeRecords={records as any}
      />
    );
    const names = screen.getAllByText(/Alice|Bob/).map(el => el.textContent);
    const bobIndex = names.findIndex(n => n?.includes("Bob"));
    const aliceIndex = names.findIndex(n => n?.includes("Alice"));
    expect(bobIndex).toBeLessThan(aliceIndex);
  });

  // ── Urgency color classes ────────────────────────────────────────────────
  const getProgressFill = (container: HTMLElement) =>
    container.querySelector(".bench-tab__progress-fill");

  it("applies red class when play time is below 20% of halfLengthSeconds", () => {
    // 300s / 1800s = 16.7% — red
    const players = [makePlayer("p1", 7, "Alice")];
    const records = [makeRecord("p1", 300)];
    const { container } = render(
      <BenchTab {...defaultProps} players={players as any} playTimeRecords={records as any} />
    );
    expect(getProgressFill(container)).toHaveClass("bench-tab__progress-fill--red");
  });

  it("applies orange class when play time is between 20% and 60% of halfLengthSeconds", () => {
    // 720s / 1800s = 40% — orange
    const players = [makePlayer("p1", 7, "Alice")];
    const records = [makeRecord("p1", 720)];
    const { container } = render(
      <BenchTab {...defaultProps} players={players as any} playTimeRecords={records as any} />
    );
    expect(getProgressFill(container)).toHaveClass("bench-tab__progress-fill--orange");
  });

  it("applies green class when play time is at or above 60% of halfLengthSeconds", () => {
    // 1200s / 1800s = 66.7% — green
    const players = [makePlayer("p1", 7, "Alice")];
    const records = [makeRecord("p1", 1200)];
    const { container } = render(
      <BenchTab {...defaultProps} players={players as any} playTimeRecords={records as any} />
    );
    expect(getProgressFill(container)).toHaveClass("bench-tab__progress-fill--green");
  });

  it("applies orange class (not red) when play time equals exactly 20% of halfLengthSeconds", () => {
    // 360s / 1800s = exactly 20% — boundary: strict < 0.2 means this should be orange
    const players = [makePlayer("p1", 7, "Alice")];
    const records = [makeRecord("p1", 360)];
    const { container } = render(
      <BenchTab {...defaultProps} players={players as any} playTimeRecords={records as any} />
    );
    expect(getProgressFill(container)).toHaveClass("bench-tab__progress-fill--orange");
    expect(getProgressFill(container)).not.toHaveClass("bench-tab__progress-fill--red");
  });

  // ── Progress bar width cap ───────────────────────────────────────────────
  it("caps progress bar width at 100% when play time exceeds halfLengthSeconds", () => {
    // 2400s > 1800s halfLength — should not produce more than 100%
    const players = [makePlayer("p1", 7, "Alice")];
    const records = [makeRecord("p1", 2400)];
    const { container } = render(
      <BenchTab {...defaultProps} players={players as any} playTimeRecords={records as any} />
    );
    const fill = getProgressFill(container) as HTMLElement;
    expect(fill.style.width).toBe("100%");
  });

  // ── Zero halfLengthSeconds guard ─────────────────────────────────────────
  it("renders without crashing when halfLengthSeconds is 0", () => {
    const players = [makePlayer("p1", 7, "Alice")];
    const records = [makeRecord("p1", 300)];
    expect(() =>
      render(
        <BenchTab
          {...defaultProps}
          halfLengthSeconds={0}
          players={players as any}
          playTimeRecords={records as any}
        />
      )
    ).not.toThrow();
  });

  // ── Interactive vs non-interactive rows ──────────────────────────────────
  it("renders bench players as clickable button elements", () => {
    const players = [makePlayer("p1", 7, "Alice")];
    render(<BenchTab {...defaultProps} players={players as any} />);
    expect(screen.getByTitle(/Tap to substitute Alice in/)).toBeInTheDocument();
  });

  it("renders on-field players as non-interactive (not buttons)", () => {
    const players = [
      makePlayer("p1", 7, "Alice"),  // on bench (not in lineup)
      makePlayer("p2", 5, "Bob"),    // on field (in lineup + active record)
    ];
    // Bob is in the lineup, so he's excluded from benchPlayers
    const lineup = [makeLineupAssignment("p2")];
    const records = [makeActiveRecord("p2")];
    render(
      <BenchTab
        {...defaultProps}
        players={players as any}
        lineup={lineup as any}
        playTimeRecords={records as any}
        currentTime={300}
      />
    );
    // Alice is a bench button; Bob appears only in the on-field section (not a button)
    expect(screen.getByTitle(/Tap to substitute Alice in/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Bob/ })).not.toBeInTheDocument();
  });

  // ── onSelectPlayer callback ──────────────────────────────────────────────
  it("calls onSelectPlayer with the correct player id when a bench player is tapped", async () => {
    const user = userEvent.setup();
    const onSelectPlayer = vi.fn();
    const players = [makePlayer("p1", 7, "Alice")];
    render(
      <BenchTab
        {...defaultProps}
        players={players as any}
        onSelectPlayer={onSelectPlayer}
      />
    );
    await user.click(screen.getByTitle(/Tap to substitute Alice in/));
    expect(onSelectPlayer).toHaveBeenCalledWith("p1");
  });

  it("shows injured indicator text and recovery button for injured bench players", () => {
    const players = [makePlayer("p1", 7, "Alice")];
    render(
      <BenchTab
        {...defaultProps}
        players={players as any}
        playerAvailabilities={[{ id: "pa-1", playerId: "p1", status: "injured" }] as any}
      />,
    );

    expect(screen.getByText("Injured")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mark alice test available/i })).toBeInTheDocument();
  });

  it("marks player injured using create mutation when no existing availability record", async () => {
    const user = userEvent.setup();
    const players = [makePlayer("p1", 7, "Alice")];
    const createPlayerAvailability = vi.fn().mockResolvedValue(undefined);

    render(
      <BenchTab
        {...defaultProps}
        players={players as any}
        mutations={{ ...defaultProps.mutations, createPlayerAvailability } as any}
      />,
    );

    await user.click(screen.getByRole("button", { name: /mark alice test injured/i }));

    await waitFor(() => {
      expect(createPlayerAvailability).toHaveBeenCalledWith(
        expect.objectContaining({
          gameId: "game-1",
          playerId: "p1",
          status: "injured",
          availableUntilMinute: 15,
        }),
      );
    });
    expect(mockTrackEvent).toHaveBeenCalled();
    expect(mockShowSuccess).toHaveBeenCalledWith("Player status updated.");
  });

  it("marks player available using update mutation when currently injured", async () => {
    const user = userEvent.setup();
    const players = [makePlayer("p1", 7, "Alice")];
    const updatePlayerAvailability = vi.fn().mockResolvedValue(undefined);

    render(
      <BenchTab
        {...defaultProps}
        players={players as any}
        playerAvailabilities={[{ id: "pa-1", playerId: "p1", status: "injured" }] as any}
        mutations={{ ...defaultProps.mutations, updatePlayerAvailability } as any}
      />,
    );

    await user.click(screen.getByRole("button", { name: /mark alice test available/i }));

    await waitFor(() => {
      expect(updatePlayerAvailability).toHaveBeenCalledWith(
        "pa-1",
        expect.objectContaining({ status: "available", availableUntilMinute: null }),
      );
    });
    expect(mockShowSuccess).toHaveBeenCalledWith("Player status updated.");
  });

  it("does not trigger substitution selection when injury action is clicked", async () => {
    const user = userEvent.setup();
    const onSelectPlayer = vi.fn();
    const players = [makePlayer("p1", 7, "Alice")];
    render(
      <BenchTab
        {...defaultProps}
        players={players as any}
        onSelectPlayer={onSelectPlayer}
      />,
    );

    await user.click(screen.getByRole("button", { name: /mark alice test injured/i }));
    expect(onSelectPlayer).not.toHaveBeenCalled();
  });

  it("shows queued offline feedback when injury mutation is enqueued", async () => {
    const user = userEvent.setup();
    const players = [makePlayer("p1", 7, "Alice")];

    render(
      <BenchTab
        {...defaultProps}
        players={players as any}
        isOnline={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: /mark alice test injured/i }));

    await waitFor(() => {
      expect(screen.getByText(/Queued offline\. Will sync when online\./i)).toBeInTheDocument();
    });
    expect(mockShowWarning).toHaveBeenCalledWith("Saved offline. Will sync automatically.");
  });

  it("shows retryable failure feedback when injury mutation fails", async () => {
    const user = userEvent.setup();
    const players = [makePlayer("p1", 7, "Alice")];
    const createPlayerAvailability = vi.fn().mockRejectedValue(new Error("network failed"));

    render(
      <BenchTab
        {...defaultProps}
        players={players as any}
        mutations={{ ...defaultProps.mutations, createPlayerAvailability } as any}
      />,
    );

    await user.click(screen.getByRole("button", { name: /mark alice test injured/i }));

    await waitFor(() => {
      expect(screen.getByText(/Retry available\./i)).toBeInTheDocument();
    });
    expect(mockShowError).toHaveBeenCalledWith("Could not update player status.");
  });

  it("retries injury mutation after failure and succeeds for the same player", async () => {
    const user = userEvent.setup();
    const players = [makePlayer("p1", 7, "Alice")];
    let resolveSecondAttempt: (() => void) | undefined;
    const createPlayerAvailability = vi.fn()
      .mockRejectedValueOnce(new Error("network failed"))
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => {
          resolveSecondAttempt = resolve;
        })
      );

    render(
      <BenchTab
        {...defaultProps}
        players={players as any}
        mutations={{ ...defaultProps.mutations, createPlayerAvailability } as any}
      />,
    );

    const markInjuredButton = screen.getByRole("button", { name: /mark alice test injured/i });

    await user.click(markInjuredButton);
    await waitFor(() => {
      expect(screen.getByText(/Retry available\./i)).toBeInTheDocument();
    });

    // BenchTab debounces repeated taps for 350ms; wait before retrying.
    await new Promise((resolve) => setTimeout(resolve, 400));

    await user.click(markInjuredButton);

    await waitFor(() => {
      expect(screen.getByText(/Saving injury status\.\.\./i)).toBeInTheDocument();
    });
    expect(createPlayerAvailability).toHaveBeenCalledTimes(2);

    resolveSecondAttempt?.();
    await waitFor(() => {
      expect(screen.getByText(/^Synced$/i)).toBeInTheDocument();
    });
    expect(mockShowSuccess).toHaveBeenCalledWith("Player status updated.");
  });
});
