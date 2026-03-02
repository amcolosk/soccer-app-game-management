import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { GameManagement } from "./GameManagement";
import type { PlannedSubstitution } from "../../services/rotationPlannerService";

// ---------------------------------------------------------------------------
// Hoisted Amplify mock functions – must use vi.hoisted so they are available
// inside the vi.mock factory (which is hoisted above all imports).
// ---------------------------------------------------------------------------
const {
  mockLineupDelete,
  mockLineupCreate,
  mockSubstitutionCreate,
  mockGameUpdate,
  mockPlayTimeCreate,
} = vi.hoisted(() => ({
  mockLineupDelete:      vi.fn().mockResolvedValue({}),
  mockLineupCreate:      vi.fn().mockResolvedValue({ data: { id: "la-new" } }),
  mockSubstitutionCreate: vi.fn().mockResolvedValue({ data: {} }),
  mockGameUpdate:        vi.fn().mockResolvedValue({ data: {} }),
  mockPlayTimeCreate:    vi.fn().mockResolvedValue({ data: {} }),
}));

vi.mock("aws-amplify/data", () => ({
  generateClient: () => ({
    models: {
      LineupAssignment: {
        delete: mockLineupDelete,
        create: mockLineupCreate,
      },
      Substitution:  { create: mockSubstitutionCreate },
      Game:          { update: mockGameUpdate },
      PlayTimeRecord: {
        create: mockPlayTimeCreate,
        list:   vi.fn().mockResolvedValue({ data: [], nextToken: null }),
      },
    },
  }),
}));

// ---------------------------------------------------------------------------
// Capture callback props that GameManagement passes to child components
// ---------------------------------------------------------------------------
const mockCaptures: {
  onApplyHalftimeSub?: (sub: PlannedSubstitution) => Promise<void>;
  onMarkInjured?: (playerId: string) => Promise<void>;
} = {};

vi.mock("./GameTimer", () => ({
  GameTimer: vi.fn((props: any) => {
    mockCaptures.onApplyHalftimeSub = props.onApplyHalftimeSub;
    return <div data-testid="game-timer" />;
  }),
}));

// Mock all other child components so GameManagement renders without needing
// real implementations of its dependents.
vi.mock("./GameHeader",       () => ({ GameHeader:       () => <div /> }));
vi.mock("./GoalTracker",      () => ({ GoalTracker:      () => <div /> }));
vi.mock("./PlayerNotesPanel", () => ({ PlayerNotesPanel: () => <div /> }));
vi.mock("./RotationWidget",   () => ({ RotationWidget:   () => <div /> }));
vi.mock("./SubstitutionPanel",() => ({ SubstitutionPanel:() => <div /> }));
vi.mock("./LineupPanel", () => ({
  LineupPanel: vi.fn((props: any) => {
    mockCaptures.onMarkInjured = props.onMarkInjured;
    return <div />;
  }),
}));

// ---------------------------------------------------------------------------
// Hook mocks
// ---------------------------------------------------------------------------
const { mockUseGameSubscriptions } = vi.hoisted(() => ({
  mockUseGameSubscriptions: vi.fn(),
}));

vi.mock("./hooks/useGameSubscriptions", () => ({
  useGameSubscriptions: mockUseGameSubscriptions,
}));
vi.mock("./hooks/useGameTimer", () => ({ useGameTimer: vi.fn() }));
vi.mock("../../hooks/useTeamData", () => ({
  useTeamData: vi.fn().mockReturnValue({ players: [], positions: [] }),
}));

// ---------------------------------------------------------------------------
// Service / utility mocks
// ---------------------------------------------------------------------------
vi.mock("../../utils/analytics", () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: {
    GAME_STARTED:   { category: "game", action: "started" },
    GAME_COMPLETED: { category: "game", action: "completed" },
  },
}));
vi.mock("../../utils/toast", () => ({
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
  showInfo:    vi.fn(),
}));
vi.mock("../../utils/errorHandler",  () => ({ handleApiError: vi.fn() }));
vi.mock("../../utils/gameTimeUtils", () => ({
  formatGameTimeDisplay: vi.fn().mockReturnValue("30:00"),
}));
vi.mock("../ConfirmModal", () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));
vi.mock("../../services/substitutionService", () => ({
  closeActivePlayTimeRecords: vi.fn().mockResolvedValue(undefined),
  executeSubstitution:        vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/cascadeDeleteService", () => ({
  deleteGameCascade: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/rotationPlannerService", () => ({
  updatePlayerAvailability: vi.fn().mockResolvedValue(undefined),
  calculateFairRotations:   vi.fn().mockReturnValue({ rotations: [], warnings: [] }),
}));
vi.mock("../../contexts/AvailabilityContext", () => ({
  AvailabilityProvider: ({ children }: any) => children,
  useAvailability: () => ({ getPlayerAvailability: vi.fn().mockReturnValue("available") }),
}));

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------
const mockGame = {
  id: "game-1",
  status: "halftime",
  currentHalf: 1,
  ourScore: 0,
  opponentScore: 0,
  elapsedSeconds: 1800,
} as any;

const mockTeam = {
  id: "team-1",
  coaches: ["coach-1"],
  halfLengthMinutes: 30,
  maxPlayersOnField: 7,
  formationId: "form-1",
} as any;

const makeLineup = (playerId = "p1", positionId = "pos1") => [
  { id: "la-1", gameId: "game-1", playerId, positionId, isStarter: true },
];

const defaultSubscription = {
  gameState:            mockGame,
  setGameState:         vi.fn(),
  lineup:               makeLineup(),
  playTimeRecords:      [],
  goals:                [],
  gameNotes:            [],
  gamePlan:             null,
  plannedRotations:     [],
  playerAvailabilities: [],
  manuallyPausedRef:    { current: false },
};

const renderComponent = () =>
  render(<GameManagement game={mockGame} team={mockTeam} onBack={vi.fn()} />);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("GameManagement – handleApplyHalftimeSub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCaptures.onApplyHalftimeSub = undefined;
    mockCaptures.onMarkInjured = undefined;
    mockUseGameSubscriptions.mockReturnValue(defaultSubscription);
  });

  it("wires onApplyHalftimeSub into GameTimer props", () => {
    renderComponent();
    expect(typeof mockCaptures.onApplyHalftimeSub).toBe("function");
  });

  it("deletes the outgoing LineupAssignment", async () => {
    renderComponent();
    await mockCaptures.onApplyHalftimeSub!({
      playerOutId: "p1", playerInId: "p2", positionId: "pos1",
    });
    expect(mockLineupDelete).toHaveBeenCalledWith({ id: "la-1" });
  });

  it("creates a new LineupAssignment for the incoming player with isStarter: true", async () => {
    renderComponent();
    await mockCaptures.onApplyHalftimeSub!({
      playerOutId: "p1", playerInId: "p2", positionId: "pos1",
    });
    expect(mockLineupCreate).toHaveBeenCalledWith({
      gameId:     "game-1",
      playerId:   "p2",
      positionId: "pos1",
      isStarter:  true,
      coaches:    ["coach-1"],
    });
  });

  it("records a Substitution with half=1", async () => {
    renderComponent();
    await mockCaptures.onApplyHalftimeSub!({
      playerOutId: "p1", playerInId: "p2", positionId: "pos1",
    });
    expect(mockSubstitutionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        gameId:      "game-1",
        positionId:  "pos1",
        playerOutId: "p1",
        playerInId:  "p2",
        half:        1,
      })
    );
  });

  it("does NOT create any PlayTimeRecords (deferred to handleStartSecondHalf)", async () => {
    renderComponent();
    await mockCaptures.onApplyHalftimeSub!({
      playerOutId: "p1", playerInId: "p2", positionId: "pos1",
    });
    expect(mockPlayTimeCreate).not.toHaveBeenCalled();
  });

  it("does nothing when incoming player is already at that position (already applied)", async () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      lineup: makeLineup("p2", "pos1"), // p2 is already the starter at pos1
    });
    renderComponent();
    await mockCaptures.onApplyHalftimeSub!({
      playerOutId: "p1", playerInId: "p2", positionId: "pos1",
    });
    expect(mockLineupDelete).not.toHaveBeenCalled();
    expect(mockLineupCreate).not.toHaveBeenCalled();
    expect(mockSubstitutionCreate).not.toHaveBeenCalled();
  });

  it("does nothing when no assignment exists for the position", async () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      lineup: [], // nothing assigned
    });
    renderComponent();
    await mockCaptures.onApplyHalftimeSub!({
      playerOutId: "p1", playerInId: "p2", positionId: "pos1",
    });
    expect(mockLineupDelete).not.toHaveBeenCalled();
    expect(mockLineupCreate).not.toHaveBeenCalled();
  });

  it("calls handleApiError when an API call fails", async () => {
    const { handleApiError } = await import("../../utils/errorHandler");
    mockLineupDelete.mockRejectedValueOnce(new Error("Network error"));
    renderComponent();
    await mockCaptures.onApplyHalftimeSub!({
      playerOutId: "p1", playerInId: "p2", positionId: "pos1",
    });
    expect(handleApiError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.stringMatching(/halftime/i)
    );
  });
});

// ---------------------------------------------------------------------------
// handleMarkInjured
// ---------------------------------------------------------------------------
describe("GameManagement – handleMarkInjured", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCaptures.onApplyHalftimeSub = undefined;
    mockCaptures.onMarkInjured = undefined;
    mockUseGameSubscriptions.mockReturnValue(defaultSubscription);
  });

  it("wires onMarkInjured into LineupPanel props", () => {
    renderComponent();
    expect(typeof mockCaptures.onMarkInjured).toBe("function");
  });

  it("calls updatePlayerAvailability with null and the injury game minute", async () => {
    const { updatePlayerAvailability } = await import("../../services/rotationPlannerService");
    renderComponent();
    // game.elapsedSeconds = 1800 → currentTime = 1800 → Math.floor(1800/60) = 30
    await mockCaptures.onMarkInjured!("p1");
    expect(updatePlayerAvailability).toHaveBeenCalledWith(
      "game-1",
      "p1",
      "injured",
      expect.any(String),
      ["coach-1"],
      null,
      30
    );
  });

  it("closes active play time records for the injured player", async () => {
    const { closeActivePlayTimeRecords } = await import("../../services/substitutionService");
    renderComponent();
    await mockCaptures.onMarkInjured!("p1");
    expect(closeActivePlayTimeRecords).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Number),
      ["p1"]
    );
  });

  it("deletes the LineupAssignment for the injured player", async () => {
    renderComponent();
    await mockCaptures.onMarkInjured!("p1");
    expect(mockLineupDelete).toHaveBeenCalledWith({ id: "la-1" });
  });

  it("calls handleApiError when an API call fails", async () => {
    const { handleApiError } = await import("../../utils/errorHandler");
    const { updatePlayerAvailability } = await import("../../services/rotationPlannerService");
    vi.mocked(updatePlayerAvailability).mockRejectedValueOnce(new Error("DB error"));
    renderComponent();
    await mockCaptures.onMarkInjured!("p1");
    expect(handleApiError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.stringMatching(/injured/i)
    );
  });
});
