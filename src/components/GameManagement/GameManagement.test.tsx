/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, waitFor, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameManagement } from "./GameManagement";
import type { PlannedSubstitution } from "../../services/rotationPlannerService";
import { useWakeLock } from "../../hooks/useWakeLock";
import { useGameNotification } from "../../hooks/useGameNotification";

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
  mockSetHelpContext,
} = vi.hoisted(() => ({
  mockLineupDelete:      vi.fn().mockResolvedValue({}),
  mockLineupCreate:      vi.fn().mockResolvedValue({ data: { id: "la-new" } }),
  mockSubstitutionCreate: vi.fn().mockResolvedValue({ data: {} }),
  mockGameUpdate:        vi.fn().mockResolvedValue({ data: {} }),
  mockPlayTimeCreate:    vi.fn().mockResolvedValue({ data: {} }),
  mockSetHelpContext:    vi.fn(),
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
  onQueueSubstitution?: (playerId: string, positionId: string) => void;
  latestSubstitutionQueue?: { playerId: string; positionId: string }[];
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
vi.mock("./RotationWidget", () => ({
  RotationWidget: vi.fn((props: any) => {
    mockCaptures.onQueueSubstitution = props.onQueueSubstitution;
    mockCaptures.latestSubstitutionQueue = props.substitutionQueue;
    return <div />;
  }),
}));
vi.mock("./SubstitutionPanel",() => ({ SubstitutionPanel:() => <div /> }));
vi.mock("./LineupPanel", () => ({
  LineupPanel: vi.fn(() => {
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
vi.mock("./hooks/useGameTimer", () => ({ useGameTimer: vi.fn().mockReturnValue({ resetAnchor: vi.fn() }) }));
vi.mock("../../hooks/useOfflineMutations", () => ({
  useOfflineMutations: vi.fn().mockReturnValue({
    mutations: {
      updateGame:             (...args: unknown[]) => mockGameUpdate(...args),
      createPlayTimeRecord:   (...args: unknown[]) => mockPlayTimeCreate(...args),
      updatePlayTimeRecord:   vi.fn().mockResolvedValue(undefined),
      createSubstitution:     (...args: unknown[]) => mockSubstitutionCreate(...args),
      createLineupAssignment: (...args: unknown[]) => mockLineupCreate(...args),
      deleteLineupAssignment: (id: string) => mockLineupDelete({ id }),
      updateLineupAssignment: vi.fn().mockResolvedValue(undefined),
      createGoal:             vi.fn().mockResolvedValue(undefined),
      createGameNote:         vi.fn().mockResolvedValue(undefined),
    },
    isOnline:     true,
    pendingCount: 0,
    isSyncing:    false,
  }),
}));
vi.mock("../../hooks/useTeamData", () => ({
  useTeamData: vi.fn().mockReturnValue({ players: [], positions: [] }),
}));
vi.mock("../../hooks/useWakeLock", () => ({ useWakeLock: vi.fn() }));
vi.mock("../../hooks/useGameNotification", () => ({ useGameNotification: vi.fn() }));

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

vi.mock("../../contexts/HelpFabContext", () => ({
  useHelpFab: () => ({
    setHelpContext: mockSetHelpContext,
    helpContext: null,
    debugContext: null,
    setDebugContext: vi.fn(),
  }),
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
// Help context wiring
// ---------------------------------------------------------------------------
describe("GameManagement – help context wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCaptures.onApplyHalftimeSub = undefined;
    // Reset subscription mock to a working default after clearAllMocks
    mockUseGameSubscriptions.mockReturnValue(defaultSubscription);
  });

  it("calls setHelpContext with 'game-halftime' when game status is 'halftime'", () => {
    renderComponent();
    expect(mockSetHelpContext).toHaveBeenCalledWith('game-halftime');
  });

  it("calls setHelpContext with 'game-in-progress' when game status is 'in-progress'", () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'in-progress' },
    });
    render(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={mockTeam} onBack={vi.fn()} />);
    expect(mockSetHelpContext).toHaveBeenCalledWith('game-in-progress');
  });

  it("calls setHelpContext with 'game-scheduled' when game status is 'scheduled'", () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'scheduled' },
    });
    render(<GameManagement game={{ ...mockGame, status: 'scheduled' }} team={mockTeam} onBack={vi.fn()} />);
    expect(mockSetHelpContext).toHaveBeenCalledWith('game-scheduled');
  });

  it("calls setHelpContext with 'game-completed' when game status is 'completed'", () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'completed' },
    });
    render(<GameManagement game={{ ...mockGame, status: 'completed' }} team={mockTeam} onBack={vi.fn()} />);
    expect(mockSetHelpContext).toHaveBeenCalledWith('game-completed');
  });

  it("does not call setHelpContext for an unknown game status", () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'unknown-status' },
    });
    render(<GameManagement game={{ ...mockGame, status: 'unknown-status' as any }} team={mockTeam} onBack={vi.fn()} />);
    // setHelpContext should NOT be called with any game key for unknown status
    expect(mockSetHelpContext).not.toHaveBeenCalledWith(expect.stringMatching(/^game-/));
  });
});

// ---------------------------------------------------------------------------
// Wake Lock + Notification hook integration
// ---------------------------------------------------------------------------
describe("GameManagement – useWakeLock and useGameNotification", () => {
  const mockUseWakeLock = vi.mocked(useWakeLock);
  const mockUseGameNotification = vi.mocked(useGameNotification);

  beforeEach(() => {
    mockUseGameSubscriptions.mockReturnValue(defaultSubscription);
    mockUseWakeLock.mockClear();
    mockUseGameNotification.mockClear();
  });

  it("passes isActive=true to both hooks when status is 'in-progress'", () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'in-progress' },
    });
    render(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={mockTeam} onBack={vi.fn()} />);
    expect(mockUseWakeLock).toHaveBeenCalledWith(true);
    expect(mockUseGameNotification).toHaveBeenCalledWith(expect.objectContaining({ isActive: true }));
  });

  it("passes isActive=true to both hooks when status is 'halftime'", () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'halftime' },
    });
    render(<GameManagement game={{ ...mockGame, status: 'halftime' }} team={mockTeam} onBack={vi.fn()} />);
    expect(mockUseWakeLock).toHaveBeenCalledWith(true);
    expect(mockUseGameNotification).toHaveBeenCalledWith(expect.objectContaining({ isActive: true }));
  });

  it("passes isActive=false to both hooks when status is 'scheduled'", () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'scheduled' },
    });
    render(<GameManagement game={{ ...mockGame, status: 'scheduled' }} team={mockTeam} onBack={vi.fn()} />);
    expect(mockUseWakeLock).toHaveBeenCalledWith(false);
    expect(mockUseGameNotification).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
  });

  it("passes isActive=false to both hooks when status is 'completed'", () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'completed' },
    });
    render(<GameManagement game={{ ...mockGame, status: 'completed' }} team={mockTeam} onBack={vi.fn()} />);
    expect(mockUseWakeLock).toHaveBeenCalledWith(false);
    expect(mockUseGameNotification).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
  });

  it("passes requestPermissionNow=false when status is 'completed'", () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'completed' },
    });
    render(<GameManagement game={{ ...mockGame, status: 'completed' }} team={mockTeam} onBack={vi.fn()} />);
    expect(mockUseGameNotification).toHaveBeenCalledWith(
      expect.objectContaining({ requestPermissionNow: false })
    );
  });

  it("passes requestPermissionNow=true when status is 'in-progress'", () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'in-progress' },
    });
    render(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={mockTeam} onBack={vi.fn()} />);
    expect(mockUseGameNotification).toHaveBeenCalledWith(
      expect.objectContaining({ requestPermissionNow: true })
    );
  });

  it("passes team name and opponent to useGameNotification", () => {
    const teamWithName = { ...mockTeam, name: 'Eagles' };
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'in-progress', opponent: 'Lions', ourScore: 2, opponentScore: 1 },
    });
    render(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={teamWithName} onBack={vi.fn()} />);
    expect(mockUseGameNotification).toHaveBeenCalledWith(
      expect.objectContaining({ teamName: 'Eagles', opponent: 'Lions', ourScore: 2, opponentScore: 1 })
    );
  });
});

// ---------------------------------------------------------------------------
// Halftime injury modal CTA coverage
// ---------------------------------------------------------------------------
describe("GameManagement – halftime bench availability CTA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'halftime' },
    });
  });

  it("shows the Manage Bench Availability CTA in halftime", () => {
    renderComponent();

    expect(screen.getByRole("button", { name: "Manage Bench Availability" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Second Half" })).toBeInTheDocument();
  });

  it("opens and closes the bench availability modal from halftime CTA", async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.click(screen.getByRole("button", { name: "Manage Bench Availability" }));

    expect(screen.getByRole("heading", { name: "Bench Availability" })).toBeInTheDocument();
    expect(screen.getByText(/Mark bench players injured or available before the second half\./i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Bench Availability" })).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// handleQueueSubstitution – batching regression (Issue #20)
// ---------------------------------------------------------------------------
describe("GameManagement – handleQueueSubstitution batching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCaptures.onQueueSubstitution = undefined;
    mockCaptures.latestSubstitutionQueue = undefined;
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'in-progress' },
    });
  });

  it("wires onQueueSubstitution into RotationWidget props", () => {
    render(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={mockTeam} onBack={vi.fn()} />);
    expect(typeof mockCaptures.onQueueSubstitution).toBe("function");
  });

  it("queues all players when called multiple times synchronously (regression: Queue All batching)", async () => {
    // Regression test for Issue #20.
    // Before the fix, setSubstitutionQueue([...substitutionQueue, item]) captured the same
    // stale empty array for all batched calls, so only the last item ended up in the queue.
    // The fix uses a functional updater (prev => [...prev, item]) so each call sees the
    // latest state and all items accumulate correctly.
    render(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={mockTeam} onBack={vi.fn()} />);
    expect(typeof mockCaptures.onQueueSubstitution).toBe("function");

    // Simulate Queue All: three synchronous calls (as handleQueueAll does via forEach)
    act(() => {
      mockCaptures.onQueueSubstitution!("player-1", "pos-1");
      mockCaptures.onQueueSubstitution!("player-2", "pos-2");
      mockCaptures.onQueueSubstitution!("player-3", "pos-3");
    });

    await waitFor(() => {
      expect(mockCaptures.latestSubstitutionQueue).toHaveLength(3);
    });

    expect(mockCaptures.latestSubstitutionQueue).toContainEqual({ playerId: "player-1", positionId: "pos-1" });
    expect(mockCaptures.latestSubstitutionQueue).toContainEqual({ playerId: "player-2", positionId: "pos-2" });
    expect(mockCaptures.latestSubstitutionQueue).toContainEqual({ playerId: "player-3", positionId: "pos-3" });
  });

  it("does not add a duplicate entry when the same player+position is queued again", async () => {
    render(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={mockTeam} onBack={vi.fn()} />);

    act(() => {
      mockCaptures.onQueueSubstitution!("player-1", "pos-1");
    });
    await waitFor(() => expect(mockCaptures.latestSubstitutionQueue).toHaveLength(1));

    act(() => {
      mockCaptures.onQueueSubstitution!("player-1", "pos-1");
    });
    // Queue should still be length 1 — no duplicate added
    await waitFor(() => expect(mockCaptures.latestSubstitutionQueue).toHaveLength(1));
  });
});
