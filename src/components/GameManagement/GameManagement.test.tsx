/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, waitFor, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
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
  mockLineupList,
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
  mockPlannedRotationUpdate,
} = vi.hoisted(() => ({
  mockLineupDelete:      vi.fn().mockResolvedValue({}),
  mockLineupCreate:      vi.fn().mockResolvedValue({ data: { id: "la-new" } }),
  mockLineupList:        vi.fn().mockResolvedValue({ data: [] }),
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
  mockPlannedRotationUpdate: vi.fn().mockResolvedValue({ data: {} }),
}));

vi.mock("aws-amplify/data", () => ({
  generateClient: () => ({
    models: {
      LineupAssignment: {
        delete: mockLineupDelete,
        create: mockLineupCreate,
        list: mockLineupList,
      },
      Substitution:  { create: mockSubstitutionCreate },
      Game:          { update: mockGameUpdate },
      PlayTimeRecord: {
        create: mockPlayTimeCreate,
        list:   vi.fn().mockResolvedValue({ data: [], nextToken: null }),
      },
      PlannedRotation: {
        update: mockPlannedRotationUpdate,
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
  rotationWidgetProps?: any;
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
    mockCaptures.rotationWidgetProps = props;
    return <div />;
  }),
}));
vi.mock("./SubstitutionPanel",() => ({ SubstitutionPanel:() => <div /> }));
vi.mock("./LineupPanel", () => ({
  LineupPanel: vi.fn(() => {
    return <div />;
  }),
}));

vi.mock("./CompletedPlayTimeSummary", () => ({
  CompletedPlayTimeSummary: () => <div data-testid="completed-play-time-summary" />,
}));

// ---------------------------------------------------------------------------
// Router wrapper helper
// ---------------------------------------------------------------------------
const renderWithRouter = (ui: ReactElement) => render(ui, { wrapper: MemoryRouter });

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
      deleteGoal:             vi.fn().mockResolvedValue(undefined),
      updateGoal:             vi.fn().mockResolvedValue(undefined),
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
    ROTATION_RECALCULATED: { category: "GameDay", action: "Rotation Recalculated" },
    ROTATION_WIDGET_OPENED: { category: "GameDay", action: "Rotation Widget Opened" },
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
  renderWithRouter(<GameManagement game={mockGame} team={mockTeam} onBack={vi.fn()} />);

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

    renderWithRouter(<GameManagement game={{ ...mockGame, status: "in-progress" }} team={mockTeam} onBack={vi.fn()} />);

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

    renderWithRouter(<GameManagement game={{ ...mockGame, status: "halftime" }} team={mockTeam} onBack={vi.fn()} />);

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
    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={mockTeam} onBack={vi.fn()} />);
    expect(mockSetHelpContext).toHaveBeenCalledWith('game-in-progress');
  });

  it("calls setHelpContext with 'game-scheduled' when game status is 'scheduled'", () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'scheduled' },
    });
    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'scheduled' }} team={mockTeam} onBack={vi.fn()} />);
    expect(mockSetHelpContext).toHaveBeenCalledWith('game-scheduled');
  });

  it("calls setHelpContext with 'game-completed' when game status is 'completed'", () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'completed' },
    });
    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'completed' }} team={mockTeam} onBack={vi.fn()} />);
    expect(mockSetHelpContext).toHaveBeenCalledWith('game-completed');
  });

  it("does not call setHelpContext for an unknown game status", () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'unknown-status' },
    });
    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'unknown-status' as any }} team={mockTeam} onBack={vi.fn()} />);
    // setHelpContext should NOT be called with any game key for unknown status
    expect(mockSetHelpContext).not.toHaveBeenCalledWith(expect.stringMatching(/^game-/));
  });

  it("refetches coach profiles when entering the Notes tab", async () => {
    const user = userEvent.setup();
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'in-progress' },
    });

    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={mockTeam} onBack={vi.fn()} />);

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
    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={mockTeam} onBack={vi.fn()} />);
    expect(mockUseWakeLock).toHaveBeenCalledWith(true);
    expect(mockUseGameNotification).toHaveBeenCalledWith(expect.objectContaining({ isActive: true }));
  });

  it("passes isActive=true to both hooks when status is 'halftime'", () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'halftime' },
    });
    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'halftime' }} team={mockTeam} onBack={vi.fn()} />);
    expect(mockUseWakeLock).toHaveBeenCalledWith(true);
    expect(mockUseGameNotification).toHaveBeenCalledWith(expect.objectContaining({ isActive: true }));
  });

  it("passes isActive=false to both hooks when status is 'scheduled'", () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'scheduled' },
    });
    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'scheduled' }} team={mockTeam} onBack={vi.fn()} />);
    expect(mockUseWakeLock).toHaveBeenCalledWith(false);
    expect(mockUseGameNotification).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
  });

  it("passes isActive=false to both hooks when status is 'completed'", () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'completed' },
    });
    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'completed' }} team={mockTeam} onBack={vi.fn()} />);
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

    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'completed' }} team={mockTeam} onBack={vi.fn()} />);

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

    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'completed' }} team={mockTeam} onBack={vi.fn()} />);

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

    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'completed' }} team={mockTeam} onBack={vi.fn()} />);

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
    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'completed' }} team={mockTeam} onBack={vi.fn()} />);
    expect(mockUseGameNotification).toHaveBeenCalledWith(
      expect.objectContaining({ requestPermissionNow: false })
    );
  });

  it("passes requestPermissionNow=true when status is 'in-progress'", () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'in-progress' },
    });
    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={mockTeam} onBack={vi.fn()} />);
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
    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={teamWithName} onBack={vi.fn()} />);
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
    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={mockTeam} onBack={vi.fn()} />);
    expect(typeof mockCaptures.onQueueSubstitution).toBe("function");
  });

  it("queues all players when called multiple times synchronously (regression: Queue All batching)", async () => {
    // Regression test for Issue #20.
    // Before the fix, setSubstitutionQueue([...substitutionQueue, item]) captured the same
    // stale empty array for all batched calls, so only the last item ended up in the queue.
    // The fix uses a functional updater (prev => [...prev, item]) so each call sees the
    // latest state and all items accumulate correctly.
    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={mockTeam} onBack={vi.fn()} />);
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
    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={mockTeam} onBack={vi.fn()} />);

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

describe("GameManagement – starter fallback uses resolved starters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTeamData.mockReturnValue({ players: [], positions: [] });
  });

  it("handleStartGame sends friendly starter message when fallback is still insufficient", async () => {
    const { handleApiError } = await import("../../utils/errorHandler");
    const user = userEvent.setup();
    const gameState = { ...defaultSubscription.gameState, status: 'scheduled' };
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState,
      lineup: [
        { id: 'la-1', gameId: 'game-1', playerId: 'p1', positionId: 'pos1', isStarter: true },
        { id: 'la-2', gameId: 'game-1', playerId: null, positionId: 'pos2', isStarter: true },
      ],
    });
    mockLineupList.mockResolvedValueOnce({
      data: [
        { id: 'db-1', gameId: 'game-1', playerId: 'p1', positionId: 'pos1', isStarter: true },
        { id: 'db-2', gameId: 'game-1', playerId: null, positionId: 'pos2', isStarter: true },
      ],
    });

    renderWithRouter(
      <GameManagement
        game={{ ...mockGame, status: 'scheduled' }}
        team={{ ...mockTeam, maxPlayersOnField: 2 }}
        onBack={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /start game/i }));

    await waitFor(() => {
      expect(mockLineupList).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(handleApiError).toHaveBeenCalledWith(
        expect.any(Error),
        'Assign 2 starters before starting the game. Currently assigned: 1.'
      );
    });
    expect(mockGameUpdate).not.toHaveBeenCalled();
    expect(mockPlayTimeCreate).not.toHaveBeenCalled();
  });

  it("handleStartGame falls back to DB when resolved local starters are below expected", async () => {
    const user = userEvent.setup();
    const gameState = { ...defaultSubscription.gameState, status: 'scheduled' };
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState,
      lineup: [
        { id: 'la-1', gameId: 'game-1', playerId: 'p1', positionId: 'pos1', isStarter: true },
        { id: 'la-2', gameId: 'game-1', playerId: null, positionId: 'pos2', isStarter: true },
      ],
    });
    mockLineupList.mockResolvedValueOnce({
      data: [
        { id: 'db-1', gameId: 'game-1', playerId: 'p1', positionId: 'pos1', isStarter: true },
        { id: 'db-2', gameId: 'game-1', playerId: 'p2', positionId: 'pos2', isStarter: true },
      ],
    });

    renderWithRouter(
      <GameManagement
        game={{ ...mockGame, status: 'scheduled' }}
        team={{ ...mockTeam, maxPlayersOnField: 2 }}
        onBack={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /start game/i }));

    await waitFor(() => {
      expect(mockLineupList).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockPlayTimeCreate).toHaveBeenCalledTimes(2);
    });
  });

  it("handleStartSecondHalf falls back to DB when resolved local starters are below expected", async () => {
    const user = userEvent.setup();
    const gameState = { ...defaultSubscription.gameState, status: 'halftime' };
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState,
      lineup: [
        { id: 'la-1', gameId: 'game-1', playerId: 'p1', positionId: 'pos1', isStarter: true },
        { id: 'la-2', gameId: 'game-1', playerId: null, positionId: 'pos2', isStarter: true },
      ],
    });
    mockLineupList.mockResolvedValueOnce({
      data: [
        { id: 'db-1', gameId: 'game-1', playerId: 'p1', positionId: 'pos1', isStarter: true },
        { id: 'db-2', gameId: 'game-1', playerId: 'p2', positionId: 'pos2', isStarter: true },
      ],
    });

    renderWithRouter(
      <GameManagement
        game={{ ...mockGame, status: 'halftime' }}
        team={{ ...mockTeam, maxPlayersOnField: 2 }}
        onBack={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /start second half/i }));

    await waitFor(() => {
      expect(mockLineupList).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockPlayTimeCreate).toHaveBeenCalledTimes(2);
    });
  });

  it("handleStartSecondHalf sends friendly starter message when DB fallback is still insufficient", async () => {
    const { handleApiError } = await import("../../utils/errorHandler");
    const user = userEvent.setup();
    const gameState = { ...defaultSubscription.gameState, status: 'halftime' };
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState,
      lineup: [
        { id: 'la-1', gameId: 'game-1', playerId: 'p1', positionId: 'pos1', isStarter: true },
        { id: 'la-2', gameId: 'game-1', playerId: null, positionId: 'pos2', isStarter: true },
      ],
    });
    // DB fallback also only has 1 valid starter (playerId null is not counted)
    mockLineupList.mockResolvedValueOnce({
      data: [
        { id: 'db-1', gameId: 'game-1', playerId: 'p1', positionId: 'pos1', isStarter: true },
        { id: 'db-2', gameId: 'game-1', playerId: null, positionId: 'pos2', isStarter: true },
      ],
    });

    renderWithRouter(
      <GameManagement
        game={{ ...mockGame, status: 'halftime' }}
        team={{ ...mockTeam, maxPlayersOnField: 2 }}
        onBack={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /start second half/i }));

    await waitFor(() => {
      expect(mockLineupList).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(handleApiError).toHaveBeenCalledWith(
        expect.any(Error),
        'Assign 2 starters before starting the second half. Currently assigned: 1.'
      );
    });
    expect(mockGameUpdate).not.toHaveBeenCalled();
    expect(mockPlayTimeCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Completed state: play time summary and season report link
// ---------------------------------------------------------------------------
describe("completed state play time summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTeamData.mockReturnValue({ players: [], positions: [] });
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'completed' },
    });
  });

  it("renders CompletedPlayTimeSummary when gameState.status is 'completed'", () => {
    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'completed' }} team={mockTeam} onBack={vi.fn()} />);
    expect(screen.getByTestId("completed-play-time-summary")).toBeInTheDocument();
  });

  it("does NOT render CompletedPlayTimeSummary when game is in-progress", () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'in-progress' },
    });
    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={mockTeam} onBack={vi.fn()} />);
    expect(screen.queryByTestId("completed-play-time-summary")).not.toBeInTheDocument();
  });

  it("renders 'View Full Season Report' link when game is completed and points to correct URL", () => {
    const teamWithId = { ...mockTeam, id: 'team-abc' };
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'completed' },
    });
    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'completed' }} team={teamWithId} onBack={vi.fn()} />);
    const link = screen.getByRole("link", { name: /view full season report/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/reports/team-abc");
  });
});

// ---------------------------------------------------------------------------
// getPlanConflicts on-field detection
// ---------------------------------------------------------------------------
describe("GameManagement – getPlanConflicts on-field detection", () => {
  const futureRotation = {
    id: 'rot-future',
    rotationNumber: 1,
    gameMinute: 40, // future: 40 > currentMinutes(30)
    half: 2,
    plannedSubstitutions: JSON.stringify([
      { playerInId: 'player-C', playerOutId: 'player-D', positionId: 'pos1' },
    ]),
  };
  const pastRotation = {
    id: 'rot-past',
    rotationNumber: 1,
    gameMinute: 10, // past: 10 <= currentMinutes(30)
    half: 1,
    plannedSubstitutions: JSON.stringify([
      { playerInId: 'player-C', playerOutId: 'player-D', positionId: 'pos1' },
    ]),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTeamData.mockReturnValue({ players: [], positions: [] });
  });

  it("detects 'on-field' conflict when BOTH playerIn and playerOut are starters in a future rotation (true conflict)", () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'in-progress' },
      lineup: [
        // Both player-C (playerIn) and player-D (playerOut) are simultaneously on field — true conflict
        { id: 'la-C', gameId: 'game-1', playerId: 'player-C', positionId: 'pos2', isStarter: true },
        { id: 'la-D', gameId: 'game-1', playerId: 'player-D', positionId: 'pos1', isStarter: true },
      ],
      plannedRotations: [futureRotation],
      gamePlan: { id: 'gp-1', rotationIntervalMinutes: 10 } as any,
    });

    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={mockTeam} onBack={vi.fn()} />);

    const conflicts = mockCaptures.rotationWidgetProps?.getPlanConflicts?.();
    expect(conflicts).toBeDefined();
    const onFieldConflict = conflicts.find((c: any) => c.type === 'on-field' && c.playerId === 'player-C');
    expect(onFieldConflict).toBeDefined();
    expect(onFieldConflict.rotationNumbers).toContain(1);
  });

  // Scenario A — Bug 1: CC injured, EE subs in emergency; plan CC→EE is effectively executed
  it("Scenario A: no conflict when sub is effectively executed (playerIn on field, playerOut off field)", () => {
    // EE (playerIn) is now on field; CC (playerOut) is NOT in lineup — effectively executed
    const executedRotation = {
      id: 'rot-executed',
      rotationNumber: 2,
      gameMinute: 40,
      half: 1,
      plannedSubstitutions: JSON.stringify([
        { playerInId: 'player-EE', playerOutId: 'player-CC', positionId: 'pos1' },
      ]),
    };
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'in-progress' },
      lineup: [
        { id: 'la-EE', gameId: 'game-1', playerId: 'player-EE', positionId: 'pos1', isStarter: true },
        // player-CC is NOT in lineup (was injured and replaced)
      ],
      playerAvailabilities: [
        { id: 'av-CC', playerId: 'player-CC', status: 'injured', gameId: 'game-1', coaches: ['coach-1'] },
      ],
      plannedRotations: [executedRotation],
      gamePlan: { id: 'gp-1', rotationIntervalMinutes: 10 } as any,
    });

    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={mockTeam} onBack={vi.fn()} />);

    const conflicts = mockCaptures.rotationWidgetProps?.getPlanConflicts?.();
    expect(conflicts).toBeDefined();
    // No rotation or on-field conflict should be produced — EE is on field, CC is off field → effectively executed
    const rotationConflict = conflicts.find((c: any) => c.playerId === 'player-CC' || c.playerId === 'player-EE');
    expect(rotationConflict).toBeUndefined();
  });

  // Scenario B — true on-field conflict must still fire
  it("Scenario B: 'on-field' conflict fires when both playerIn (C) and playerOut (A) are simultaneously on field", () => {
    const trueConflictRotation = {
      id: 'rot-true-conflict',
      rotationNumber: 3,
      gameMinute: 40,
      half: 1,
      plannedSubstitutions: JSON.stringify([
        { playerInId: 'player-C', playerOutId: 'player-A', positionId: 'pos1' },
      ]),
    };
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'in-progress' },
      lineup: [
        { id: 'la-A', gameId: 'game-1', playerId: 'player-A', positionId: 'pos1', isStarter: true },
        { id: 'la-C', gameId: 'game-1', playerId: 'player-C', positionId: 'pos3', isStarter: true },
      ],
      plannedRotations: [trueConflictRotation],
      gamePlan: { id: 'gp-1', rotationIntervalMinutes: 10 } as any,
    });

    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={mockTeam} onBack={vi.fn()} />);

    const conflicts = mockCaptures.rotationWidgetProps?.getPlanConflicts?.();
    expect(conflicts).toBeDefined();
    const onFieldConflict = conflicts.find((c: any) => c.type === 'on-field' && c.playerId === 'player-C');
    expect(onFieldConflict).toBeDefined();
    expect(onFieldConflict.rotationNumbers).toContain(3);
  });

  // Scenario C — Bug 2: halftime subs applied; second half starts; no conflict
  it("Scenario C: no conflict when all halftime subs are effectively executed at start of second half", () => {
    // Halftime rotation: player-B replaced player-A, player-D replaced player-C
    const halftimeRotation = {
      id: 'rot-halftime',
      rotationNumber: 1,
      gameMinute: 30,
      half: 1,
      plannedSubstitutions: JSON.stringify([
        { playerInId: 'player-B', playerOutId: 'player-A', positionId: 'pos1' },
        { playerInId: 'player-D', playerOutId: 'player-C', positionId: 'pos2' },
      ]),
    };
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'in-progress', currentHalf: 2 },
      // All sub-ins are now starters; sub-outs are not in lineup
      lineup: [
        { id: 'la-B', gameId: 'game-1', playerId: 'player-B', positionId: 'pos1', isStarter: true },
        { id: 'la-D', gameId: 'game-1', playerId: 'player-D', positionId: 'pos2', isStarter: true },
      ],
      plannedRotations: [halftimeRotation],
      gamePlan: { id: 'gp-1', rotationIntervalMinutes: 10 } as any,
    });

    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={mockTeam} onBack={vi.fn()} />);

    const conflicts = mockCaptures.rotationWidgetProps?.getPlanConflicts?.();
    expect(conflicts).toBeDefined();
    // All subs are effectively executed — no rotation conflicts should fire
    const anyConflict = conflicts.find(
      (c: any) => ['player-A', 'player-B', 'player-C', 'player-D'].includes(c.playerId)
    );
    expect(anyConflict).toBeUndefined();
  });

  it("does NOT flag a past rotation as 'on-field' conflict", () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'in-progress' },
      lineup: [
        { id: 'la-C', gameId: 'game-1', playerId: 'player-C', positionId: 'pos2', isStarter: true },
      ],
      plannedRotations: [pastRotation],
      gamePlan: { id: 'gp-1', rotationIntervalMinutes: 10 } as any,
    });

    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={mockTeam} onBack={vi.fn()} />);

    const conflicts = mockCaptures.rotationWidgetProps?.getPlanConflicts?.();
    const onFieldConflict = conflicts?.find((c: any) => c.type === 'on-field' && c.playerId === 'player-C');
    expect(onFieldConflict).toBeUndefined();
  });

  it("does NOT produce 'on-field' conflicts for a scheduled game", () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'scheduled' },
      lineup: [
        { id: 'la-C', gameId: 'game-1', playerId: 'player-C', positionId: 'pos2', isStarter: true },
      ],
      plannedRotations: [futureRotation],
      gamePlan: { id: 'gp-1', rotationIntervalMinutes: 10 } as any,
    });

    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'scheduled' }} team={mockTeam} onBack={vi.fn()} />);

    const conflicts = mockCaptures.rotationWidgetProps?.getPlanConflicts?.();
    const onFieldConflict = conflicts?.find((c: any) => c.type === 'on-field');
    expect(onFieldConflict).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// handleRecalculateRotations uses live lineup
// ---------------------------------------------------------------------------
describe("GameManagement – handleRecalculateRotations uses live lineup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTeamData.mockReturnValue({
      players: [
        { id: 'p1', playerNumber: 1, firstName: 'Alice', lastName: 'A', isActive: true, preferredPositions: 'pos1' },
        { id: 'p2', playerNumber: 2, firstName: 'Bob', lastName: 'B', isActive: true, preferredPositions: 'pos2' },
      ],
      positions: [{ id: 'pos1', abbreviation: 'FW' }, { id: 'pos2', abbreviation: 'MF' }],
    });
  });

  it("calls calculateFairRotations with live starters (not gamePlan.startingLineup)", async () => {
    const { calculateFairRotations: mockedCalc } = await import("../../services/rotationPlannerService");
    const mockedFn = vi.mocked(mockedCalc);
    mockedFn.mockReturnValue({ rotations: [], warnings: [] });

    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'in-progress' },
      lineup: [
        { id: 'la-1', gameId: 'game-1', playerId: 'p1', positionId: 'pos1', isStarter: true },
        { id: 'la-2', gameId: 'game-1', playerId: 'p2', positionId: 'pos2', isStarter: true },
      ],
      playTimeRecords: [
        { id: 'ptr-1', playerId: 'p1', startGameSeconds: 0, endGameSeconds: 600, positionId: 'pos1', gameId: 'game-1', coaches: ['coach-1'] },
      ],
      gamePlan: {
        id: 'gp-1',
        rotationIntervalMinutes: 10,
        startingLineup: JSON.stringify([{ playerId: 'old-p1', positionId: 'pos1' }]),
      } as any,
      plannedRotations: [
        { id: 'rot-1', rotationNumber: 1, gameMinute: 40, half: 2, plannedSubstitutions: '[]' } as any,
      ],
    });

    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={mockTeam} onBack={vi.fn()} />);

    await act(async () => {
      await mockCaptures.rotationWidgetProps?.onRecalculateRotations?.();
    });

    await waitFor(() => {
      expect(mockedFn).toHaveBeenCalled();
    });

    const callArgs = mockedFn.mock.calls[0];
    // Second argument = lineupArray (from live starters, not from gamePlan.startingLineup)
    const lineupArg = callArgs[1];
    expect(lineupArg).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ playerId: 'p1', positionId: 'pos1' }),
        expect.objectContaining({ playerId: 'p2', positionId: 'pos2' }),
      ])
    );
    // Must NOT use the old gamePlan.startingLineup ('old-p1')
    expect(lineupArg.map((e: any) => e.playerId)).not.toContain('old-p1');
  });

  it("passes initialPlayTimeMinutes derived from playTimeRecords in the options", async () => {
    const { calculateFairRotations: mockedCalc } = await import("../../services/rotationPlannerService");
    const mockedFn = vi.mocked(mockedCalc);
    mockedFn.mockReturnValue({ rotations: [], warnings: [] });

    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'in-progress' },
      lineup: [
        { id: 'la-1', gameId: 'game-1', playerId: 'p1', positionId: 'pos1', isStarter: true },
      ],
      playTimeRecords: [
        { id: 'ptr-1', playerId: 'p1', startGameSeconds: 0, endGameSeconds: 600, positionId: 'pos1', gameId: 'game-1', coaches: ['coach-1'] },
      ],
      gamePlan: { id: 'gp-1', rotationIntervalMinutes: 10, startingLineup: '[]' } as any,
      plannedRotations: [
        { id: 'rot-1', rotationNumber: 1, gameMinute: 40, half: 2, plannedSubstitutions: '[]' } as any,
      ],
    });

    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={mockTeam} onBack={vi.fn()} />);

    await act(async () => {
      await mockCaptures.rotationWidgetProps?.onRecalculateRotations?.();
    });

    await waitFor(() => {
      expect(mockedFn).toHaveBeenCalled();
    });

    const callArgs = mockedFn.mock.calls[0];
    // 8th argument is options
    const options = callArgs[7];
    expect(options?.initialPlayTimeMinutes).toBeInstanceOf(Map);
    // p1 has 600 seconds (10 minutes) in playTimeRecords
    expect(options?.initialPlayTimeMinutes?.get('p1')).toBeCloseTo(10, 1);
  });

  it("reproduces issue #83: mid-game recalculation can write a halftime GK swap into a later regular rotation", async () => {
    const { calculateFairRotations: mockedCalc } = await import("../../services/rotationPlannerService");
    const mockedFn = vi.mocked(mockedCalc);
    const halftimeGoalieSwap = [
      { playerOutId: 'gk', playerInId: 'bench-gk', positionId: 'pos-gk' },
    ];

    mockedFn.mockReturnValue({
      warnings: [],
      rotations: [
        { substitutions: [{ playerOutId: 'p2', playerInId: 'p8', positionId: 'pos-f1' }] },
        { substitutions: [{ playerOutId: 'p3', playerInId: 'p9', positionId: 'pos-f2' }] },
        { substitutions: halftimeGoalieSwap },
        { substitutions: [{ playerOutId: 'p4', playerInId: 'p10', positionId: 'pos-f3' }] },
        { substitutions: [{ playerOutId: 'p5', playerInId: 'p11', positionId: 'pos-f4' }] },
      ],
    });

    mockUseTeamData.mockReturnValue({
      players: [
        { id: 'gk', playerNumber: 1, firstName: 'Goalie', lastName: 'One', isActive: true, preferredPositions: 'pos-gk' },
        { id: 'p2', playerNumber: 2, firstName: 'Two', lastName: 'A', isActive: true, preferredPositions: 'pos-f1' },
        { id: 'p3', playerNumber: 3, firstName: 'Three', lastName: 'B', isActive: true, preferredPositions: 'pos-f2' },
      ],
      positions: [
        { id: 'pos-gk', abbreviation: 'GK' },
        { id: 'pos-f1', abbreviation: 'CB' },
        { id: 'pos-f2', abbreviation: 'CM' },
      ],
    });

    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: {
        ...defaultSubscription.gameState,
        status: 'in-progress',
        elapsedSeconds: 11 * 60,
        halfLengthMinutes: 30,
      },
      lineup: [
        { id: 'la-gk', gameId: 'game-1', playerId: 'gk', positionId: 'pos-gk', isStarter: true },
        { id: 'la-2', gameId: 'game-1', playerId: 'p2', positionId: 'pos-f1', isStarter: true },
        { id: 'la-3', gameId: 'game-1', playerId: 'p3', positionId: 'pos-f2', isStarter: true },
      ],
      gamePlan: {
        id: 'gp-1',
        rotationIntervalMinutes: 10,
        startingLineup: '[]',
      } as any,
      plannedRotations: [
        { id: 'rot-10', rotationNumber: 1, gameMinute: 10, half: 1, plannedSubstitutions: '[]' } as any,
        { id: 'rot-20', rotationNumber: 2, gameMinute: 20, half: 1, plannedSubstitutions: '[]' } as any,
        { id: 'rot-30', rotationNumber: 3, gameMinute: 30, half: 2, plannedSubstitutions: '[]' } as any,
        { id: 'rot-40', rotationNumber: 4, gameMinute: 40, half: 2, plannedSubstitutions: '[]' } as any,
        { id: 'rot-50', rotationNumber: 5, gameMinute: 50, half: 2, plannedSubstitutions: '[]' } as any,
      ],
    });

    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'in-progress', elapsedSeconds: 11 * 60 }} team={mockTeam} onBack={vi.fn()} />);

    await act(async () => {
      await mockCaptures.rotationWidgetProps?.onRecalculateRotations?.();
    });

    await waitFor(() => {
      expect(mockPlannedRotationUpdate).toHaveBeenCalledTimes(4);
    });

    const updateCalls = mockPlannedRotationUpdate.mock.calls.map(([payload]) => payload);

    expect(updateCalls).toContainEqual({
      id: 'rot-30',
      plannedSubstitutions: JSON.stringify(halftimeGoalieSwap),
    });
    expect(updateCalls).not.toContainEqual({
      id: 'rot-40',
      plannedSubstitutions: JSON.stringify(halftimeGoalieSwap),
    });
  });

  it("post-halftime: only future second-half rotations are updated; index alignment is preserved", async () => {
    const { calculateFairRotations: mockedCalc } = await import("../../services/rotationPlannerService");
    const mockedFn = vi.mocked(mockedCalc);

    const secondHalfSub1 = [{ playerOutId: 'p3', playerInId: 'p8', positionId: 'pos-f3' }];
    const secondHalfSub2 = [{ playerOutId: 'p4', playerInId: 'p9', positionId: 'pos-f4' }];

    mockedFn.mockReturnValue({
      warnings: [],
      rotations: [
        { substitutions: [{ playerOutId: 'p1', playerInId: 'p6', positionId: 'pos-f1' }] }, // index 0 → rot-10 (past)
        { substitutions: [{ playerOutId: 'p2', playerInId: 'p7', positionId: 'pos-f2' }] }, // index 1 → rot-20 (past)
        { substitutions: [] },                                                                // index 2 → rot-30/halftime (past)
        { substitutions: secondHalfSub1 },                                                   // index 3 → rot-40
        { substitutions: secondHalfSub2 },                                                   // index 4 → rot-50
      ],
    });

    mockUseTeamData.mockReturnValue({
      players: [
        { id: 'gk', playerNumber: 1, firstName: 'Goalie', lastName: 'One', isActive: true, preferredPositions: 'pos-gk' },
        { id: 'p2', playerNumber: 2, firstName: 'Two', lastName: 'A', isActive: true, preferredPositions: 'pos-f1' },
        { id: 'p3', playerNumber: 3, firstName: 'Three', lastName: 'B', isActive: true, preferredPositions: 'pos-f2' },
      ],
      positions: [
        { id: 'pos-gk', abbreviation: 'GK' },
        { id: 'pos-f1', abbreviation: 'CB' },
        { id: 'pos-f2', abbreviation: 'CM' },
      ],
    });

    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: {
        ...defaultSubscription.gameState,
        status: 'in-progress',
        elapsedSeconds: 35 * 60,
        halfLengthMinutes: 30,
      },
      lineup: [
        { id: 'la-gk', gameId: 'game-1', playerId: 'gk', positionId: 'pos-gk', isStarter: true },
        { id: 'la-2',  gameId: 'game-1', playerId: 'p2', positionId: 'pos-f1', isStarter: true },
        { id: 'la-3',  gameId: 'game-1', playerId: 'p3', positionId: 'pos-f2', isStarter: true },
      ],
      gamePlan: {
        id: 'gp-1',
        rotationIntervalMinutes: 10,
        startingLineup: '[]',
      } as any,
      plannedRotations: [
        { id: 'rot-10', rotationNumber: 1, gameMinute: 10, half: 1, plannedSubstitutions: '[]' } as any,
        { id: 'rot-20', rotationNumber: 2, gameMinute: 20, half: 1, plannedSubstitutions: '[]' } as any,
        { id: 'rot-30', rotationNumber: 3, gameMinute: 30, half: 2, plannedSubstitutions: '[]' } as any,
        { id: 'rot-40', rotationNumber: 4, gameMinute: 40, half: 2, plannedSubstitutions: '[]' } as any,
        { id: 'rot-50', rotationNumber: 5, gameMinute: 50, half: 2, plannedSubstitutions: '[]' } as any,
      ],
    });

    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'in-progress', elapsedSeconds: 35 * 60 }} team={mockTeam} onBack={vi.fn()} />);

    await act(async () => {
      await mockCaptures.rotationWidgetProps?.onRecalculateRotations?.();
    });

    // Only rot-40 and rot-50 are in the future (gameMinute > 35); expect 2 updates
    await waitFor(() => {
      expect(mockPlannedRotationUpdate).toHaveBeenCalledTimes(2);
    });

    const updateCalls = mockPlannedRotationUpdate.mock.calls.map(([payload]) => payload);

    // Index-aligned substitutions must land on the correct future rotations
    expect(updateCalls).toContainEqual({
      id: 'rot-40',
      plannedSubstitutions: JSON.stringify(secondHalfSub1),
    });
    expect(updateCalls).toContainEqual({
      id: 'rot-50',
      plannedSubstitutions: JSON.stringify(secondHalfSub2),
    });

    // Past rotations (including the halftime slot at minute 30) must NOT be touched
    const updatedIds = updateCalls.map((c: any) => c.id);
    expect(updatedIds).not.toContain('rot-10');
    expect(updatedIds).not.toContain('rot-20');
    expect(updatedIds).not.toContain('rot-30');
  });
});

// ---------------------------------------------------------------------------
// RotationWidget receives recalculate props
// ---------------------------------------------------------------------------
describe("GameManagement – RotationWidget receives recalculate props", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTeamData.mockReturnValue({ players: [], positions: [] });
  });

  it("passes onRecalculateRotations, isRecalculating, and getPlanConflicts to RotationWidget for in-progress game", () => {
    mockUseGameSubscriptions.mockReturnValue({
      ...defaultSubscription,
      gameState: { ...defaultSubscription.gameState, status: 'in-progress' },
      gamePlan: { id: 'gp-1', rotationIntervalMinutes: 10 } as any,
      plannedRotations: [
        { id: 'rot-1', rotationNumber: 1, gameMinute: 40, half: 2, plannedSubstitutions: '[]' } as any,
      ],
    });

    renderWithRouter(<GameManagement game={{ ...mockGame, status: 'in-progress' }} team={mockTeam} onBack={vi.fn()} />);

    expect(typeof mockCaptures.rotationWidgetProps?.onRecalculateRotations).toBe('function');
    expect(mockCaptures.rotationWidgetProps?.isRecalculating).toBeDefined();
    expect(typeof mockCaptures.rotationWidgetProps?.getPlanConflicts).toBe('function');
  });
});
