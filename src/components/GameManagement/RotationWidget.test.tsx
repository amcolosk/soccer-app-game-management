import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RotationWidget } from "./RotationWidget";

// Mock the availability context
vi.mock("../../contexts/AvailabilityContext", () => ({
  useAvailability: () => ({ getPlayerAvailability: vi.fn().mockReturnValue("available") }),
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
});
