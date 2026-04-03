/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, waitFor, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
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
  mockCreateGameNote,
  mockUpdateGameNote,
  mockDeleteGameNote,
  mockCreatePlayerAvailability,
  mockUpdatePlayerAvailability,
  mockSetHelpContext,
  mockRefetchCoachProfiles,
} = vi.hoisted(() => ({
  mockLineupDelete:      vi.fn().mockResolvedValue({}),
  mockLineupCreate:      vi.fn().mockResolvedValue({ data: { id: "la-new" } }),
  mockSubstitutionCreate: vi.fn().mockResolvedValue({ data: {} }),
  mockGameUpdate:        vi.fn().mockResolvedValue({ data: {} }),
  mockPlayTimeCreate:    vi.fn().mockResolvedValue({ data: {} }),
  mockCreateGameNote:    vi.fn().mockResolvedValue(undefined),
  mockUpdateGameNote:    vi.fn().mockResolvedValue(undefined),
  mockDeleteGameNote:    vi.fn().mockResolvedValue(undefined),
  mockCreatePlayerAvailability: vi.fn().mockResolvedValue(undefined),
  mockUpdatePlayerAvailability: vi.fn().mockResolvedValue(undefined),
  mockSetHelpContext:    vi.fn(),
  mockRefetchCoachProfiles: vi.fn().mockResolvedValue(undefined),
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
  preGameNotesPanelProps?: any;
  playerNotesPanelProps?: any;
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
vi.mock("./PlayerNotesPanel", () => ({
  PlayerNotesPanel: vi.fn((props: any) => {
    mockCaptures.playerNotesPanelProps = props;
    return <div data-testid="player-notes-panel" />;
  }),
}));
vi.mock("./PreGameNotesPanel", () => ({
  PreGameNotesPanel: vi.fn((props: any) => {
    mockCaptures.preGameNotesPanelProps = props;
    return <div data-testid="pre-game-notes-panel" />;
  }),
}));
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

const { mockUseTeamData } = vi.hoisted(() => ({
  mockUseTeamData: vi.fn(),
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
      createGameNote:         (...args: unknown[]) => mockCreateGameNote(...args),
      updateGameNote:         (...args: unknown[]) => mockUpdateGameNote(...args),
      deleteGameNote:         (...args: unknown[]) => mockDeleteGameNote(...args),
      createPlayerAvailability: (...args: unknown[]) => mockCreatePlayerAvailability(...args),
      updatePlayerAvailability: (...args: unknown[]) => mockUpdatePlayerAvailability(...args),
    },
    isOnline:     true,
    pendingCount: 0,
    isSyncing:    false,
  }),
}));
vi.mock("../../hooks/useTeamData", () => ({
  useTeamData: mockUseTeamData,
}));
vi.mock("../../hooks/useTeamCoachProfiles", () => ({
  useTeamCoachProfiles: vi.fn(() => ({
    profileMap: new Map(),
    refetch: mockRefetchCoachProfiles,
  })),
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
    PLAYER_MARKED_INJURED: { category: "GameDay", action: "Player Marked Injured" },
    PLAYER_RECOVERED_FROM_INJURY: { category: "GameDay", action: "Player Recovered From Injury" },
  },
}));
vi.mock("../../utils/toast", () => ({
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
  showInfo:    vi.fn(),
  showError:   vi.fn(),
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

const makeBenchPlayer = (id = "bench-1") => ({
  id,
  playerNumber: 9,
  firstName: "Alex",
  lastName: "Bench",
  isActive: true,
  preferredPositions: "",
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("GameManagement – handleApplyHalftimeSub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCaptures.onApplyHalftimeSub = undefined;
    mockCaptures.playerNotesPanelProps = undefined;
    mockUseTeamData.mockReturnValue({ players: [], positions: [] });
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

describe("GameManagement – direct live note entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCaptures.playerNotesPanelProps = undefined;
    mockUseTeamData.mockReturnValue({ players: [], positions: [] });
  });

  it("opens the shared note modal from CommandBand while staying on the field tab", async () => {
    const user = userEvent.setup();
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: "in-progress" },
    });

    render(<GameManagement game={{ ...mockGame, status: "in-progress" }} team={mockTeam} onBack={vi.fn()} />);

    expect(mockCaptures.playerNotesPanelProps?.isNoteModalOpen).toBe(false);
    await user.click(screen.getByRole("button", { name: /add note/i }));

    expect(screen.getByRole("tab", { name: /field/i })).toHaveAttribute("aria-selected", "true");
    expect(mockCaptures.playerNotesPanelProps?.isNoteModalOpen).toBe(true);
    expect(mockCaptures.playerNotesPanelProps?.noteModalIntent).toMatchObject({
      source: "command-band",
      defaultType: "other",
    });
  });

  it("opens the shared note modal from halftime Add note action", async () => {
    const user = userEvent.setup();
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: "halftime" },
    });

    render(<GameManagement game={{ ...mockGame, status: "halftime" }} team={mockTeam} onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Add note" }));

    expect(mockCaptures.playerNotesPanelProps?.isNoteModalOpen).toBe(true);
    expect(mockCaptures.playerNotesPanelProps?.noteModalIntent).toMatchObject({
      source: "halftime-action",
      defaultType: "other",
    });
  });
});

// ---------------------------------------------------------------------------
// Help context wiring
// ---------------------------------------------------------------------------
describe("GameManagement – help context wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCaptures.onApplyHalftimeSub = undefined;
    mockUseTeamData.mockReturnValue({ players: [], positions: [] });
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

  it("refetches coach profiles when entering the Notes tab", async () => {
    const user = userEvent.setup();
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'in-progress' },
    });

    render(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={mockTeam} onBack={vi.fn()} />);

    const baselineCalls = mockRefetchCoachProfiles.mock.calls.length;
    await user.click(screen.getByRole('tab', { name: /notes/i }));

    await waitFor(() => {
      expect(mockRefetchCoachProfiles.mock.calls.length).toBeGreaterThan(baselineCalls);
    });
  });
});

// ---------------------------------------------------------------------------
// Wake Lock + Notification hook integration
// ---------------------------------------------------------------------------
describe("GameManagement – useWakeLock and useGameNotification", () => {
  const mockUseWakeLock = vi.mocked(useWakeLock);
  const mockUseGameNotification = vi.mocked(useGameNotification);

  beforeEach(() => {
    mockUseTeamData.mockReturnValue({ players: [], positions: [] });
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

  it("passes pre-game notes to PreGameNotesPanel in completed state", () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'completed' },
      gameNotes: [
        {
          id: 'n-pre',
          noteType: 'coaching-point',
          playerId: null,
          gameSeconds: null,
          half: null,
          notes: 'Win the midfield',
          timestamp: new Date().toISOString(),
          authorId: 'coach-a',
          gameId: 'game-1',
          coaches: ['coach-1'],
        },
        {
          id: 'n-in',
          noteType: 'gold-star',
          playerId: 'p1',
          gameSeconds: 120,
          half: 1,
          notes: 'Great tackle',
          timestamp: new Date().toISOString(),
          authorId: 'coach-a',
          gameId: 'game-1',
          coaches: ['coach-1'],
        },
      ],
    });

    render(<GameManagement game={{ ...mockGame, status: 'completed' }} team={mockTeam} onBack={vi.fn()} />);

    expect(mockCaptures.preGameNotesPanelProps.notes).toHaveLength(1);
    expect(mockCaptures.preGameNotesPanelProps.notes[0].id).toBe('n-pre');
    expect(mockCaptures.preGameNotesPanelProps.gameStatus).toBe('completed');
    expect(mockCaptures.preGameNotesPanelProps.isReadOnly).toBe(false);
  });

  it("creates a completed-state pre-game note through the real add callback flow", async () => {
    const user = userEvent.setup();
    mockUseTeamData.mockReturnValue({ players: [], positions: [] });
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'completed' },
      gameNotes: [],
    });

    render(<GameManagement game={{ ...mockGame, status: 'completed' }} team={mockTeam} onBack={vi.fn()} />);

    act(() => {
      mockCaptures.preGameNotesPanelProps.onAdd();
    });

    await user.type(screen.getByLabelText('Coaching note text'), 'Post-game cleanup reminder');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(mockCreateGameNote).toHaveBeenCalledWith(
        expect.objectContaining({
          gameId: 'game-1',
          noteType: 'coaching-point',
          notes: 'Post-game cleanup reminder',
          gameSeconds: null,
          half: null,
          coaches: ['coach-1'],
        })
      );
    });
  });

  it("updates and deletes completed-state pre-game notes through panel callbacks", async () => {
    const user = userEvent.setup();
    const noteToEdit = {
      id: 'n-pre',
      noteType: 'coaching-point',
      playerId: null,
      gameSeconds: null,
      half: null,
      notes: 'Initial coaching point',
      timestamp: new Date().toISOString(),
      authorId: 'coach-a',
      gameId: 'game-1',
      coaches: ['coach-1'],
    };

    mockUseTeamData.mockReturnValue({ players: [], positions: [] });
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'completed' },
      gameNotes: [noteToEdit],
    });

    render(<GameManagement game={{ ...mockGame, status: 'completed' }} team={mockTeam} onBack={vi.fn()} />);

    act(() => {
      mockCaptures.preGameNotesPanelProps.onEdit(noteToEdit);
    });

    const noteInput = screen.getByLabelText('Coaching note text');
    await user.clear(noteInput);
    await user.type(noteInput, 'Edited coaching point');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateGameNote).toHaveBeenCalledWith('n-pre', {
        notes: 'Edited coaching point',
        playerId: null,
      });
    });

    await act(async () => {
      await mockCaptures.preGameNotesPanelProps.onDelete(noteToEdit);
    });

    expect(mockDeleteGameNote).toHaveBeenCalledWith('n-pre');
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
    mockUseTeamData.mockReturnValue({ players: [], positions: [] });
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'halftime' },
    });
  });

  it("shows the Manage Injuries CTA in halftime", () => {
    renderComponent();

    expect(screen.getByRole("button", { name: "Manage Injuries" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Second Half" })).toBeInTheDocument();
  });

  it("opens and closes the bench availability modal from halftime CTA", async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.click(screen.getByRole("button", { name: "Manage Injuries" }));

    expect(screen.getByRole("dialog", { name: "Manage Injuries" })).toBeInTheDocument();
    expect(screen.getByText(/Mark injured players unavailable for substitutions and rotations until recovered\./i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Manage Injuries" })).not.toBeInTheDocument();
    });
  });

  it("returns focus to the invoking CTA when closing the injury modal", async () => {
    const user = userEvent.setup();
    renderComponent();

    const trigger = screen.getByRole("button", { name: "Manage Injuries" });
    trigger.focus();

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });

  it("closes the injury modal on Escape when no injury mutation is pending", async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.click(screen.getByRole("button", { name: "Manage Injuries" }));
    expect(screen.getByRole("dialog", { name: "Manage Injuries" })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Manage Injuries" })).not.toBeInTheDocument();
    });
  });

  it("keeps focus trapped in the injury modal on Tab and Shift+Tab", async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.click(screen.getByRole("button", { name: "Manage Injuries" }));

    const doneButton = screen.getByRole("button", { name: "Done" });
    doneButton.focus();
    expect(doneButton).toHaveFocus();

    await user.tab();
    expect(doneButton).toHaveFocus();

    await user.tab({ shift: true });
    expect(doneButton).toHaveFocus();
  });

  it("traverses multiple injury modal controls in order and wraps on Tab/Shift+Tab", async () => {
    const user = userEvent.setup();
    mockUseTeamData.mockReturnValue({
      players: [
        {
          id: "bench-1",
          playerNumber: 7,
          firstName: "Pat",
          lastName: "One",
          isActive: true,
          preferredPositions: "",
        },
        {
          id: "bench-2",
          playerNumber: 9,
          firstName: "Sam",
          lastName: "Two",
          isActive: true,
          preferredPositions: "",
        },
      ],
      positions: [],
    });
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'halftime' },
      lineup: [],
    });

    renderComponent();

    await user.click(screen.getByRole("button", { name: "Manage Injuries" }));

    const firstAction = screen.getByRole("button", { name: /mark pat one injured/i });
    const secondAction = screen.getByRole("button", { name: /mark sam two injured/i });
    const doneButton = screen.getByRole("button", { name: "Done" });

    firstAction.focus();
    expect(firstAction).toHaveFocus();

    await user.tab();
    expect(secondAction).toHaveFocus();

    await user.tab();
    expect(doneButton).toHaveFocus();

    await user.tab();
    expect(firstAction).toHaveFocus();

    await user.tab({ shift: true });
    expect(doneButton).toHaveFocus();

    await user.tab({ shift: true });
    expect(secondAction).toHaveFocus();

    await user.tab({ shift: true });
    expect(firstAction).toHaveFocus();
  });

  it("ignores Escape and backdrop click while injury mutation is pending", async () => {
    const user = userEvent.setup();
    let resolveCreate: (() => void) | undefined;
    mockUseTeamData.mockReturnValue({ players: [makeBenchPlayer()], positions: [] });
    mockCreatePlayerAvailability.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        resolveCreate = resolve;
      })
    );

    renderComponent();
    await user.click(screen.getByRole("button", { name: "Manage Injuries" }));

    await user.click(screen.getByRole("button", { name: /mark alex bench injured/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
    });

    await user.keyboard('{Escape}');
    expect(screen.getByRole("dialog", { name: "Manage Injuries" })).toBeInTheDocument();

    const dialog = screen.getByRole("dialog", { name: "Manage Injuries" });
    const overlay = dialog.parentElement;
    expect(overlay).not.toBeNull();
    if (overlay) {
      await user.click(overlay);
    }
    expect(screen.getByRole("dialog", { name: "Manage Injuries" })).toBeInTheDocument();

    resolveCreate?.();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
    });
  });
});

// ---------------------------------------------------------------------------
// handleQueueSubstitution – batching regression (Issue #20)
// ---------------------------------------------------------------------------
describe("GameManagement – handleQueueSubstitution batching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTeamData.mockReturnValue({ players: [], positions: [] });
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
