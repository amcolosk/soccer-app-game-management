/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RotationWidget } from "./RotationWidget";

// Mock the availability context — use vi.hoisted so the mock fn reference is
// accessible in both the factory and in tests.
const mockGetPlayerAvailability = vi.hoisted(() => vi.fn().mockReturnValue("available"));

vi.mock("../../contexts/AvailabilityContext", () => ({
  useAvailability: () => ({ getPlayerAvailability: mockGetPlayerAvailability }),
}));

// Mock service calls (handleLateArrival path)
vi.mock("../../services/rotationPlannerService", () => ({
  updatePlayerAvailability: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../utils/toast", () => ({
  showSuccess: vi.fn(),
}));
vi.mock("../../utils/errorHandler", () => ({
  handleApiError: vi.fn(),
}));

import { updatePlayerAvailability } from "../../services/rotationPlannerService";
const mockUpdatePlayerAvailability = vi.mocked(updatePlayerAvailability);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeGameState = (overrides = {}) => ({
  id: "game-1",
  status: "in-progress",
  currentHalf: 1,
  opponent: "Eagles",
  ourScore: 0,
  opponentScore: 0,
  ...overrides,
});

const makeRotation = (gameMinute: number, half = 1) => ({
  id: "rot-1",
  half,
  gameMinute,
  rotationNumber: 1,
  plannedSubstitutions: JSON.stringify([
    { playerOutId: "p1", playerInId: "p2", positionId: "pos-1" },
  ]),
});

const players = [
  { id: "p1", playerNumber: 10, firstName: "Alice", lastName: "Smith", isActive: true, preferredPositions: "" },
  { id: "p2", playerNumber: 7,  firstName: "Bob",   lastName: "Jones", isActive: true, preferredPositions: "" },
] as any[];

const positions = [
  { id: "pos-1", positionName: "Forward", abbreviation: "FW" },
] as any[];

const baseProps = {
  gameState: makeGameState() as any,
  game: { id: "game-1" } as any,
  team: { coaches: ["coach-1"] } as any,
  players,
  positions,
  gamePlan: { id: "gp-1" } as any,
  plannedRotations: [makeRotation(20)] as any[],
  currentTime: 600,   // 10 minutes in
  lineup: [] as any[],
  playTimeRecords: [] as any[],
  substitutionQueue: [] as any[],
  onQueueSubstitution: vi.fn(),
};

describe("RotationWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlayerAvailability.mockReturnValue("available");
  });

  // ── Null-render guards ───────────────────────────────────────────────────
  it("renders nothing when gameState.status is not in-progress", () => {
    const { container } = render(
      <RotationWidget
        {...baseProps}
        gameState={makeGameState({ status: "scheduled" }) as any}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when gamePlan is null even if game is in-progress", () => {
    const { container } = render(
      <RotationWidget {...baseProps} gamePlan={null} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  // ── Controlled modal — isRotationModalOpen ───────────────────────────────
  it("renders the rotation modal when isRotationModalOpen is true and a rotation exists", () => {
    render(
      <RotationWidget
        {...baseProps}
        isRotationModalOpen={true}
        onCloseRotationModal={vi.fn()}
      />
    );
    expect(screen.getByRole("heading", { name: /Planned Rotation/i })).toBeInTheDocument();
  });

  it("does not render the rotation modal when isRotationModalOpen is false", () => {
    render(
      <RotationWidget
        {...baseProps}
        isRotationModalOpen={false}
        onCloseRotationModal={vi.fn()}
      />
    );
    expect(screen.queryByRole("heading", { name: /Planned Rotation/i })).not.toBeInTheDocument();
  });

  it("calls onCloseRotationModal when the Close button is clicked in controlled mode", async () => {
    const user = userEvent.setup();
    const onCloseRotationModal = vi.fn();
    render(
      <RotationWidget
        {...baseProps}
        isRotationModalOpen={true}
        onCloseRotationModal={onCloseRotationModal}
      />
    );
    await user.click(screen.getByRole("button", { name: /Close/i }));
    expect(onCloseRotationModal).toHaveBeenCalled();
  });

  it("auto-selects the next rotation and shows the modal when isRotationModalOpen becomes true", async () => {
    const { rerender } = render(
      <RotationWidget
        {...baseProps}
        isRotationModalOpen={false}
        onCloseRotationModal={vi.fn()}
      />
    );
    expect(screen.queryByRole("heading", { name: /Planned Rotation/i })).not.toBeInTheDocument();

    rerender(
      <RotationWidget
        {...baseProps}
        isRotationModalOpen={true}
        onCloseRotationModal={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Planned Rotation/i })).toBeInTheDocument()
    );
  });

  // ── Rotation modal content ───────────────────────────────────────────────
  it("displays the rotation game minute in the modal heading", () => {
    render(
      <RotationWidget
        {...baseProps}
        isRotationModalOpen={true}
        onCloseRotationModal={vi.fn()}
      />
    );
    expect(screen.getByRole("heading", { name: /20'/ })).toBeInTheDocument();
  });

  it("shows player names for the planned substitution in the modal", () => {
    render(
      <RotationWidget
        {...baseProps}
        isRotationModalOpen={true}
        onCloseRotationModal={vi.fn()}
      />
    );
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
  });

  // ── handleLateArrival — clears stale availability window ────────────────
  it("calls updatePlayerAvailability with null, null as last two args when marking a late-arrival player as arrived", async () => {
    const user = userEvent.setup();

    // Make p2 (Bob) show as 'late-arrival' so the late-arrival button appears
    mockGetPlayerAvailability.mockImplementation((id: string) =>
      id === "p2" ? "late-arrival" : "available"
    );

    render(<RotationWidget {...baseProps} />);

    // Open the late arrival modal
    await user.click(screen.getByRole("button", { name: /Add Late Arrival/i }));

    // Click Bob's button in the modal
    const bobButton = screen.getByRole("button", { name: /Bob/i });
    await user.click(bobButton);

    expect(mockUpdatePlayerAvailability).toHaveBeenCalledWith(
      "game-1",
      "p2",
      "available",
      expect.stringContaining("Arrived late"),
      ["coach-1"],
      null,
      null
    );
  });

  // ── Queue All button ─────────────────────────────────────────────────────
  it("Queue All calls onQueueSubstitution for every available substitution in the rotation", async () => {
    // Rotation with TWO distinct substitutions — exercises the batching fix
    // (Issue #20: without functional updater only the first player was queued)
    const multiRotation = {
      ...makeRotation(20),
      plannedSubstitutions: JSON.stringify([
        { playerOutId: "p1", playerInId: "p2", positionId: "pos-1" },
        { playerOutId: "p3", playerInId: "p4", positionId: "pos-2" },
      ]),
    };
    const extraPlayers = [
      ...players,
      { id: "p3", playerNumber: 5, firstName: "Carol", lastName: "White", isActive: true, preferredPositions: "" },
      { id: "p4", playerNumber: 9, firstName: "Dave",  lastName: "Black", isActive: true, preferredPositions: "" },
    ] as any[];

    const user = userEvent.setup();
    const onQueueSubstitution = vi.fn();
    mockGetPlayerAvailability.mockReturnValue("available");

    render(
      <RotationWidget
        {...baseProps}
        players={extraPlayers}
        plannedRotations={[multiRotation] as any}
        isRotationModalOpen={true}
        onCloseRotationModal={vi.fn()}
        onQueueSubstitution={onQueueSubstitution}
      />
    );

    await user.click(screen.getByRole("button", { name: /Queue All/i }));

    expect(onQueueSubstitution).toHaveBeenCalledTimes(2);
    expect(onQueueSubstitution).toHaveBeenCalledWith("p2", "pos-1");
    expect(onQueueSubstitution).toHaveBeenCalledWith("p4", "pos-2");
  });

  it("Queue All skips players who are already in the substitution queue", async () => {
    const multiRotation = {
      ...makeRotation(20),
      plannedSubstitutions: JSON.stringify([
        { playerOutId: "p1", playerInId: "p2", positionId: "pos-1" },
        { playerOutId: "p3", playerInId: "p4", positionId: "pos-2" },
      ]),
    };
    const extraPlayers = [
      ...players,
      { id: "p3", playerNumber: 5, firstName: "Carol", lastName: "White", isActive: true, preferredPositions: "" },
      { id: "p4", playerNumber: 9, firstName: "Dave",  lastName: "Black", isActive: true, preferredPositions: "" },
    ] as any[];

    const user = userEvent.setup();
    const onQueueSubstitution = vi.fn();
    mockGetPlayerAvailability.mockReturnValue("available");

    // p2 is already queued — should be skipped by Queue All
    render(
      <RotationWidget
        {...baseProps}
        players={extraPlayers}
        plannedRotations={[multiRotation] as any}
        substitutionQueue={[{ playerId: "p2", positionId: "pos-1" }] as any}
        isRotationModalOpen={true}
        onCloseRotationModal={vi.fn()}
        onQueueSubstitution={onQueueSubstitution}
      />
    );

    await user.click(screen.getByRole("button", { name: /Queue All/i }));

    expect(onQueueSubstitution).toHaveBeenCalledTimes(1);
    expect(onQueueSubstitution).toHaveBeenCalledWith("p4", "pos-2");
    expect(onQueueSubstitution).not.toHaveBeenCalledWith("p2", "pos-1");
  });

  it("Queue All button is disabled when all substitutions are already queued", () => {
    const multiRotation = {
      ...makeRotation(20),
      plannedSubstitutions: JSON.stringify([
        { playerOutId: "p1", playerInId: "p2", positionId: "pos-1" },
      ]),
    };
    mockGetPlayerAvailability.mockReturnValue("available");

    render(
      <RotationWidget
        {...baseProps}
        plannedRotations={[multiRotation] as any}
        substitutionQueue={[{ playerId: "p2", positionId: "pos-1" }] as any}
        isRotationModalOpen={true}
        onCloseRotationModal={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /Queue All/i })).toBeDisabled();
  });

  it("Queue All closes the rotation modal overlay after queueing substitutions", async () => {
    const user = userEvent.setup();
    mockGetPlayerAvailability.mockReturnValue("available");

    // Use uncontrolled mode: no isRotationModalOpen prop so internal state governs visibility
    render(
      <RotationWidget
        {...baseProps}
        onQueueSubstitution={vi.fn()}
      />
    );

    // Open the modal via the "View Plan" button
    await user.click(screen.getByRole("button", { name: /View Plan/i }));
    expect(screen.getByRole("heading", { name: /Planned Rotation/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Queue All/i }));

    // Modal should no longer be visible after Queue All
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: /Planned Rotation/i })).not.toBeInTheDocument()
    );
  });

  // ── Malformed JSON graceful fallback ─────────────────────────────────────
  it("shows a fallback message when plannedSubstitutions contains malformed JSON", () => {
    const malformedRotation = { ...makeRotation(20), plannedSubstitutions: "not-valid-json" };
    render(
      <RotationWidget
        {...baseProps}
        plannedRotations={[malformedRotation] as any}
        isRotationModalOpen={true}
        onCloseRotationModal={vi.fn()}
      />
    );
    expect(screen.getByText(/Unable to load rotation data/i)).toBeInTheDocument();
  });

  it("shows all-injured warning when every planned incoming player is injured", () => {
    mockGetPlayerAvailability.mockImplementation((id: string) =>
      id === "p2" ? "injured" : "available",
    );

    render(
      <RotationWidget
        {...baseProps}
        isRotationModalOpen={true}
        onCloseRotationModal={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/No rotation changes available\. All planned players are either unavailable or already on the field\./i),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Stale rotation conflict detection (execution state awareness)
// ---------------------------------------------------------------------------
describe("RotationWidget – stale rotation conflict detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlayerAvailability.mockReturnValue("available");
  });

  // Test A: fully-executed rotation is hidden from countdown banner
  it("A: skips a fully-executed rotation in the countdown banner (playerIn on field, playerOut off field)", () => {
    // p2 is on field (playerIn executed), p1 is NOT in lineup (playerOut went off)
    const executedRotation = {
      id: "rot-executed",
      half: 1,
      gameMinute: 5, // within the 2-min grace window at currentTime=600 (10 min)
      rotationNumber: 1,
      plannedSubstitutions: JSON.stringify([
        { playerOutId: "p1", playerInId: "p2", positionId: "pos-1" },
      ]),
    };
    const lineupWithP2 = [
      { id: "la-p2", gameId: "game-1", playerId: "p2", positionId: "pos-1", isStarter: true },
      // p1 is NOT in lineup
    ] as any[];

    const { container } = render(
      <RotationWidget
        {...baseProps}
        plannedRotations={[executedRotation] as any}
        lineup={lineupWithP2}
        currentTime={600}
      />
    );

    // Countdown banner should not render (rotation is fully executed)
    expect(container.querySelector(".rotation-countdown-banner")).toBeNull();
  });

  // Test B: non-executed rotation is shown in countdown banner
  it("B: shows a non-executed rotation in the countdown banner (playerOut still on field)", () => {
    // Normal upcoming rotation: p1 is playerOut and still on field, p2 is not on field
    const upcomingRotation = makeRotation(15); // 15 min, within 2-min window at currentTime=780 (13 min)
    const lineupWithP1 = [
      { id: "la-p1", gameId: "game-1", playerId: "p1", positionId: "pos-1", isStarter: true },
    ] as any[];

    render(
      <RotationWidget
        {...baseProps}
        plannedRotations={[upcomingRotation] as any}
        lineup={lineupWithP1}
        currentTime={780}
      />
    );

    expect(screen.getByText(/Next Rotation:/i)).toBeInTheDocument();
  });

  // Test C: no conflict shown for effectively-executed sub (playerIn on field, playerOut off)
  it("C: rotationConflicts returns 0 for effectively-executed sub", () => {
    // p2 is on field (executed), p1 is NOT in lineup — should not be flagged orange
    const executedRotation = makeRotation(12); // within 2-min window at currentTime=600
    const lineupWithP2 = [
      { id: "la-p2", gameId: "game-1", playerId: "p2", positionId: "pos-1", isStarter: true },
    ] as any[];

    render(
      <RotationWidget
        {...baseProps}
        plannedRotations={[executedRotation] as any}
        lineup={lineupWithP2}
        currentTime={600}
      />
    );

    // Countdown banner should not render (rotation is fully executed)
    // If the banner DID render it would show has-conflicts class — absence of banner is the assertion
    const banner = document.querySelector(".rotation-countdown-banner");
    expect(banner).toBeNull();
  });

  // Test D: true on-field conflict (BOTH playerIn and playerOut on field) still fires
  it("D: shows conflict badge when both playerIn and playerOut are simultaneously on field", () => {
    const trueConflictRotation = makeRotation(12); // within 2-min window at currentTime=600
    const lineupWithBoth = [
      { id: "la-p1", gameId: "game-1", playerId: "p1", positionId: "pos-1", isStarter: true },
      { id: "la-p2", gameId: "game-1", playerId: "p2", positionId: "pos-2", isStarter: true },
    ] as any[];

    render(
      <RotationWidget
        {...baseProps}
        plannedRotations={[trueConflictRotation] as any}
        lineup={lineupWithBoth}
        currentTime={600}
      />
    );

    // Both p1 (playerOut) and p2 (playerIn) are on field — true conflict
    expect(screen.getByText(/Next Rotation:/i)).toBeInTheDocument();
    expect(screen.getByText(/conflict/i)).toBeInTheDocument();
  });
});
