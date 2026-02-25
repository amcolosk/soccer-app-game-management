import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandBand } from "./CommandBand";

const makeGameState = (overrides = {}) => ({
  id: "game-1",
  status: "in-progress",
  currentHalf: 1,
  opponent: "Eagles",
  ourScore: 2,
  opponentScore: 1,
  isHome: true,
  ...overrides,
});

const baseProps = {
  gameState: makeGameState() as any,
  onBack: vi.fn(),
  currentTime: 1080, // 18 minutes
  isRunning: true,
  halfLengthSeconds: 1800,
  gamePlan: null,
  plannedRotations: [] as any[],
  onPauseTimer: vi.fn(),
  onResumeTimer: vi.fn(),
  onShowRotationModal: vi.fn(),
};

const makeRotation = (gameMinute: number) => ({
  id: "rot-1",
  half: 1,
  gameMinute,
  rotationNumber: 1,
  plannedSubstitutions: "[]",
});

describe("CommandBand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Back button ──────────────────────────────────────────────────────────
  it("calls onBack when the back button is clicked", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<CommandBand {...baseProps} onBack={onBack} />);
    await user.click(screen.getByRole("button", { name: /←/ }));
    expect(onBack).toHaveBeenCalled();
  });

  // ── Score display ────────────────────────────────────────────────────────
  it("renders 0 – 0 when ourScore and opponentScore are null", () => {
    const { container } = render(
      <CommandBand
        {...baseProps}
        gameState={makeGameState({ ourScore: null, opponentScore: null }) as any}
      />
    );
    const scoreEl = container.querySelector(".command-band__score");
    expect(scoreEl?.textContent).toMatch(/0/);
  });

  it("renders the correct score values", () => {
    const { container } = render(
      <CommandBand
        {...baseProps}
        gameState={makeGameState({ ourScore: 3, opponentScore: 1 }) as any}
      />
    );
    const scoreEl = container.querySelector(".command-band__score");
    expect(scoreEl?.textContent).toContain("3");
    expect(scoreEl?.textContent).toContain("1");
  });

  // ── Half label ───────────────────────────────────────────────────────────
  it("displays '1st Half' when currentHalf is 1", () => {
    render(<CommandBand {...baseProps} />);
    expect(screen.getByText("1st Half")).toBeInTheDocument();
  });

  it("displays '2nd Half' when currentHalf is 2", () => {
    render(
      <CommandBand
        {...baseProps}
        gameState={makeGameState({ currentHalf: 2 }) as any}
      />
    );
    expect(screen.getByText("2nd Half")).toBeInTheDocument();
  });

  // ── Pause / Resume ───────────────────────────────────────────────────────
  it("shows Pause button when in-progress and isRunning is true", () => {
    render(<CommandBand {...baseProps} isRunning={true} />);
    expect(screen.getByRole("button", { name: /⏸/ })).toBeInTheDocument();
  });

  it("shows Resume button when in-progress and isRunning is false", () => {
    render(<CommandBand {...baseProps} isRunning={false} />);
    expect(screen.getByRole("button", { name: /▶/ })).toBeInTheDocument();
  });

  it("calls onPauseTimer when Pause button is clicked", async () => {
    const user = userEvent.setup();
    const onPauseTimer = vi.fn();
    render(<CommandBand {...baseProps} isRunning={true} onPauseTimer={onPauseTimer} />);
    await user.click(screen.getByRole("button", { name: /⏸/ }));
    expect(onPauseTimer).toHaveBeenCalled();
  });

  it("calls onResumeTimer when Resume button is clicked", async () => {
    const user = userEvent.setup();
    const onResumeTimer = vi.fn();
    render(<CommandBand {...baseProps} isRunning={false} onResumeTimer={onResumeTimer} />);
    await user.click(screen.getByRole("button", { name: /▶/ }));
    expect(onResumeTimer).toHaveBeenCalled();
  });

  it("does not show Pause/Resume when status is halftime", () => {
    render(
      <CommandBand
        {...baseProps}
        gameState={makeGameState({ status: "halftime" }) as any}
      />
    );
    expect(screen.queryByRole("button", { name: /⏸/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /▶/ })).not.toBeInTheDocument();
  });

  it("does not show Pause/Resume when status is scheduled", () => {
    render(
      <CommandBand
        {...baseProps}
        gameState={makeGameState({ status: "scheduled" }) as any}
      />
    );
    expect(screen.queryByRole("button", { name: /⏸/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /▶/ })).not.toBeInTheDocument();
  });

  // ── Status badges ────────────────────────────────────────────────────────
  it("shows Live badge when in-progress with no game plan", () => {
    render(<CommandBand {...baseProps} gamePlan={null} />);
    expect(screen.getByText(/● Live/)).toBeInTheDocument();
  });

  it("shows Pre-Game badge when status is scheduled", () => {
    render(
      <CommandBand
        {...baseProps}
        gameState={makeGameState({ status: "scheduled" }) as any}
      />
    );
    expect(screen.getByText(/Pre-Game/)).toBeInTheDocument();
  });

  it("shows Halftime badge when status is halftime", () => {
    render(
      <CommandBand
        {...baseProps}
        gameState={makeGameState({ status: "halftime" }) as any}
      />
    );
    expect(screen.getByText(/Halftime/)).toBeInTheDocument();
  });

  it("shows Final badge when status is completed", () => {
    render(
      <CommandBand
        {...baseProps}
        gameState={makeGameState({ status: "completed" }) as any}
      />
    );
    expect(screen.getByText(/Final/)).toBeInTheDocument();
  });

  // ── Rotation badge ───────────────────────────────────────────────────────
  it("shows rotation badge instead of Live when in-progress with a game plan and pending rotation", () => {
    render(
      <CommandBand
        {...baseProps}
        gamePlan={{ id: "gp-1" } as any}
        plannedRotations={[makeRotation(25)] as any}
        currentTime={1200} // 20 minutes in, rotation at 25'
      />
    );
    expect(screen.queryByText(/● Live/)).not.toBeInTheDocument();
    expect(screen.getByText(/Rot @ 25'/)).toBeInTheDocument();
  });

  it("calls onShowRotationModal when the rotation badge is tapped", async () => {
    const user = userEvent.setup();
    const onShowRotationModal = vi.fn();
    render(
      <CommandBand
        {...baseProps}
        gamePlan={{ id: "gp-1" } as any}
        plannedRotations={[makeRotation(25)] as any}
        currentTime={1200}
        onShowRotationModal={onShowRotationModal}
      />
    );
    // The rotation badge is a button containing the rotation info
    await user.click(screen.getByText(/Rot @ 25'/));
    expect(onShowRotationModal).toHaveBeenCalled();
  });

  it("shows 'Sub now!' when currentTime has passed the rotation gameMinute", () => {
    render(
      <CommandBand
        {...baseProps}
        gamePlan={{ id: "gp-1" } as any}
        plannedRotations={[makeRotation(20)] as any}
        currentTime={1320} // 22 minutes — past the rotation at 20'
      />
    );
    expect(screen.getByText(/Sub now!/)).toBeInTheDocument();
  });

  it("shows minutes remaining when rotation is in the future", () => {
    render(
      <CommandBand
        {...baseProps}
        gamePlan={{ id: "gp-1" } as any}
        plannedRotations={[makeRotation(30)] as any}
        currentTime={1200} // 20 minutes in, rotation at 30' → 10 min remaining
      />
    );
    expect(screen.getByText(/10' to sub/)).toBeInTheDocument();
  });
});
