/**
 * Tests for the LineupPanel component.
 *
 * Behaviours covered:
 *   - Header label changes by game status ('Starting Lineup' vs 'Second Half Lineup')
 *   - LineupBuilder renders only when status === 'scheduled'
 *   - Position grid renders for in-progress / halftime / completed
 *   - Halftime extras: 'Second Half Lineup' header, halftime hint, 'Clear All' button
 *   - In-progress position slot shows substitute button
 *   - Non-in-progress slot shows remove button instead
 *   - hideAvailablePlayers flag hides the available-players section
 *   - Empty position click in halftime calls onSubstitute
 *   - Substitute button calls onSubstitute with the matching position
 *   - Clear All flow: confirm → deletes all lineup assignments
 *   - Position picker: opens on available-player click, assigns on pick, cancels
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockDeleteLineupAssignment,
  mockCreateLineupAssignment,
  mockShowWarning,
  mockHandleApiError,
  mockConfirm,
  mockCalculatePlayerPlayTime,
  mockFormatPlayTime,
  mockIsPlayerCurrentlyPlaying,
  mockIsPlayerInLineup,
  mockQuickReplaceResultReporter,
} = vi.hoisted(() => ({
  mockDeleteLineupAssignment: vi.fn().mockResolvedValue({}),
  mockCreateLineupAssignment: vi.fn().mockResolvedValue({ data: { id: 'la-new' } }),
  mockShowWarning: vi.fn(),
  mockHandleApiError: vi.fn(),
  mockConfirm: vi.fn().mockResolvedValue(true),
  mockCalculatePlayerPlayTime: vi.fn().mockReturnValue(0),
  mockFormatPlayTime: vi.fn().mockReturnValue('0:00'),
  mockIsPlayerCurrentlyPlaying: vi.fn().mockReturnValue(false),
  mockIsPlayerInLineup: vi.fn().mockReturnValue(false),
  mockQuickReplaceResultReporter: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      LineupAssignment: {
        create: mockCreateLineupAssignment,
        delete: mockDeleteLineupAssignment,
        list: vi.fn().mockResolvedValue({ data: [] }),
      },
      PlayTimeRecord: {
        create: vi.fn().mockResolvedValue({ data: { id: 'ptr-new' } }),
      },
    },
  })),
}));

vi.mock('../../utils/toast', () => ({
  showWarning: (...args: unknown[]) => mockShowWarning(...args),
}));

vi.mock('../../utils/errorHandler', () => ({
  handleApiError: (...args: unknown[]) => mockHandleApiError(...args),
}));

vi.mock('../ConfirmModal', () => ({
  useConfirm: vi.fn(() => mockConfirm),
}));

vi.mock('../../utils/playTimeCalculations', () => ({
  calculatePlayerPlayTime: (...args: unknown[]) => mockCalculatePlayerPlayTime(...args),
  formatPlayTime: (...args: unknown[]) => mockFormatPlayTime(...args),
  isPlayerCurrentlyPlaying: (...args: unknown[]) => mockIsPlayerCurrentlyPlaying(...args),
}));

vi.mock('../../utils/lineupUtils', () => ({
  isPlayerInLineup: (...args: unknown[]) => mockIsPlayerInLineup(...args),
}));

vi.mock('../LineupBuilder', () => ({
  LineupBuilder: ({ positions }: { positions: unknown[] }) => (
    <div data-testid="lineup-builder" data-positions={positions.length} />
  ),
}));

vi.mock('./shape/LineupShapeView', () => ({
  LineupShapeView: ({ onQuickReplace, isReadOnly = false }: {
    onQuickReplace: (params: { assignmentId: string; playerId: string; positionId: string }) => Promise<"success" | "conflict" | "error">;
    isReadOnly?: boolean;
  }) => (
    <div data-testid="lineup-shape-view">
      <button type="button" aria-label="Export lineup shape" disabled={isReadOnly}>
        Export Shape
      </button>
      <button
        type="button"
        data-testid="trigger-quick-replace"
        disabled={isReadOnly}
        onClick={() => {
          void onQuickReplace({
            assignmentId: 'la-target',
            playerId: 'player-b',
            positionId: 'pos-1',
          }).then((result) => {
            mockQuickReplaceResultReporter(result);
          });
        }}
      >
        Trigger Quick Replace
      </button>
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import { LineupPanel } from './LineupPanel';
import type { Game, Team, PlayerWithRoster, FormationPosition, LineupAssignment, PlayTimeRecord } from './types';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeGame(status: string, overrides: object = {}): Game {
  return {
    id: 'game-1',
    status,
    currentHalf: 1,
    elapsedSeconds: 600,
    lastStartTime: null,
    halfLengthMinutes: 30,
    teamId: 'team-1',
    ...overrides,
  } as unknown as Game;
}

const team: Team = {
  id: 'team-1',
  name: 'Test Team',
  maxPlayersOnField: 7,
  coaches: ['user-1'],
} as unknown as Team;

const pos1: FormationPosition = { id: 'pos-1', name: 'GK', positionName: 'Goalkeeper', abbreviation: 'GK', x: 50, y: 10 } as unknown as FormationPosition;
const pos2: FormationPosition = { id: 'pos-2', name: 'DEF', positionName: 'Defender', abbreviation: 'DEF', x: 30, y: 40 } as unknown as FormationPosition;
const positions = [pos1, pos2];

const player1: PlayerWithRoster = {
  id: 'player-1',
  name: 'Alice',
  firstName: 'Alice',
  lastName: 'Smith',
  playerNumber: 10,
  isActive: true,
} as unknown as PlayerWithRoster;

const player2: PlayerWithRoster = {
  id: 'player-b',
  name: 'Bob',
  firstName: 'Bob',
  lastName: 'Jones',
  playerNumber: 11,
  isActive: true,
} as unknown as PlayerWithRoster;

const players: PlayerWithRoster[] = [player1, player2];

const lineupAssignment: LineupAssignment = {
  id: 'la-1',
  positionId: 'pos-1',
  playerId: 'player-1',
  gameId: 'game-1',
  isStarter: true,
} as unknown as LineupAssignment;

const defaultProps = {
  gameState: makeGame('in-progress'),
  game: makeGame('in-progress'),
  team,
  players,
  positions,
  lineup: [lineupAssignment],
  playTimeRecords: [] as PlayTimeRecord[],
  currentTime: 600,
  onSubstitute: vi.fn(),
  mutations: {
    deleteLineupAssignment: (id: string) => mockDeleteLineupAssignment({ id }),
    createLineupAssignment: mockCreateLineupAssignment,
    updateLineupAssignment: vi.fn().mockResolvedValue({}),
    updateGame:             vi.fn().mockResolvedValue({}),
    createPlayTimeRecord:   vi.fn().mockResolvedValue({}),
    updatePlayTimeRecord:   vi.fn().mockResolvedValue({}),
    createSubstitution:     vi.fn().mockResolvedValue({}),
    createGoal:             vi.fn().mockResolvedValue({}),
    createGameNote:         vi.fn().mockResolvedValue({}),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LineupPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
    mockIsPlayerCurrentlyPlaying.mockReturnValue(false);
    mockIsPlayerInLineup.mockReturnValue(false);
    mockCalculatePlayerPlayTime.mockReturnValue(0);
    mockFormatPlayTime.mockReturnValue('0:00');
    mockQuickReplaceResultReporter.mockReset();
  });

  // ── Header label ---------------------------------------------------------

  it('shows "Starting Lineup" header for scheduled status', () => {
    render(
      <LineupPanel
        {...defaultProps}
        gameState={makeGame('scheduled')}
        game={makeGame('scheduled')}
      />,
    );
    expect(screen.getByRole('heading', { name: /starting lineup/i })).toBeInTheDocument();
  });

  it('shows "Current Lineup" header for in-progress status', () => {
    render(<LineupPanel {...defaultProps} />);
    expect(screen.getByRole('heading', { name: /current lineup/i })).toBeInTheDocument();
  });

  it('shows "Second Half Lineup" header for halftime status', () => {
    render(
      <LineupPanel
        {...defaultProps}
        gameState={makeGame('halftime')}
        game={makeGame('halftime')}
      />,
    );
    expect(screen.getByRole('heading', { name: /second half lineup/i })).toBeInTheDocument();
  });

  // ── LineupBuilder (scheduled only) ----------------------------------------

  it('renders LineupBuilder when status is scheduled', () => {
    render(
      <LineupPanel
        {...defaultProps}
        gameState={makeGame('scheduled')}
        game={makeGame('scheduled')}
        lineup={[]}
      />,
    );
    expect(screen.getByTestId('lineup-builder')).toBeInTheDocument();
  });

  it('does NOT render LineupBuilder when status is in-progress', () => {
    render(<LineupPanel {...defaultProps} />);
    expect(screen.queryByTestId('lineup-builder')).not.toBeInTheDocument();
  });

  // ── Halftime extras -------------------------------------------------------

  it('shows halftime hint text only in halftime status', () => {
    render(
      <LineupPanel
        {...defaultProps}
        gameState={makeGame('halftime')}
        game={makeGame('halftime')}
      />,
    );
    expect(screen.getByText(/make substitutions now for the start of the second half/i)).toBeInTheDocument();
  });

  it('shows "Clear All" button in halftime when positions are assigned', () => {
    render(
      <LineupPanel
        {...defaultProps}
        gameState={makeGame('halftime')}
        game={makeGame('halftime')}
        lineup={[lineupAssignment]}
      />,
    );
    expect(screen.getByRole('button', { name: /clear all positions/i })).toBeInTheDocument();
  });

  it('shows disabled "Clear All" button in halftime when no positions are assigned', () => {
    render(
      <LineupPanel
        {...defaultProps}
        gameState={makeGame('halftime')}
        game={makeGame('halftime')}
        lineup={[]}
      />,
    );
    expect(screen.getByRole('button', { name: /clear all positions/i })).toBeDisabled();
  });

  // ── Slot buttons by status -----------------------------------------------

  it('shows substitute button (not remove) in in-progress status for assigned player', () => {
    render(<LineupPanel {...defaultProps} />);
    // Substitute button has title="Make substitution" with arrow character as content
    expect(screen.getByTitle('Make substitution')).toBeInTheDocument();
    expect(document.querySelector('.btn-remove-small')).not.toBeInTheDocument();
  });

  it('shows remove button (not substitute) in halftime status for assigned player', () => {
    render(
      <LineupPanel
        {...defaultProps}
        gameState={makeGame('halftime')}
        game={makeGame('halftime')}
      />,
    );
    expect(document.querySelector('.btn-remove-small')).toBeInTheDocument();
    expect(screen.queryByTitle('Make substitution')).not.toBeInTheDocument();
  });

  // ── Available players section ---------------------------------------------

  it('shows available players section in in-progress status', () => {
    render(<LineupPanel {...defaultProps} />);
    expect(screen.getByText(/available players/i)).toBeInTheDocument();
  });

  it('hides available players section when hideAvailablePlayers is true', () => {
    render(<LineupPanel {...defaultProps} hideAvailablePlayers />);
    expect(screen.queryByText(/available players/i)).not.toBeInTheDocument();
  });

  it('hides available players section in scheduled status', () => {
    render(
      <LineupPanel
        {...defaultProps}
        gameState={makeGame('scheduled')}
        game={makeGame('scheduled')}
      />,
    );
    expect(screen.queryByText(/available players/i)).not.toBeInTheDocument();
  });

  it('renders shape view when viewMode is shape', () => {
    render(
      <LineupPanel
        {...defaultProps}
        viewMode="shape"
      />,
    );
    expect(screen.getByTestId('lineup-shape-view')).toBeInTheDocument();
  });

  it('calls onViewModeChange when shape toggle is clicked', async () => {
    const user = userEvent.setup();
    const onViewModeChange = vi.fn();

    render(
      <LineupPanel
        {...defaultProps}
        onViewModeChange={onViewModeChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: /shape/i }));
    expect(onViewModeChange).toHaveBeenCalledWith('shape');
  });

  it('disables live plan controls in read-only mode so they cannot be focused or activated', async () => {
    const user = userEvent.setup();
    const onViewModeChange = vi.fn();
    const onSubstitute = vi.fn();

    render(
      <LineupPanel
        {...defaultProps}
        isReadOnly
        onViewModeChange={onViewModeChange}
        onSubstitute={onSubstitute}
      />,
    );

    const listButton = screen.getByRole('button', { name: /list/i });
    const shapeButton = screen.getByRole('button', { name: /shape/i });

    expect(listButton).toBeDisabled();
    expect(shapeButton).toBeDisabled();
    expect(screen.queryByTitle('Make substitution')).not.toBeInTheDocument();

    await user.tab();
    expect(listButton).not.toHaveFocus();
    expect(shapeButton).not.toHaveFocus();

    expect(onViewModeChange).not.toHaveBeenCalled();
    expect(onSubstitute).not.toHaveBeenCalled();
  });

  it('disables shape-view controls in read-only mode', async () => {
    const user = userEvent.setup();

    render(
      <LineupPanel
        {...defaultProps}
        isReadOnly
        viewMode="shape"
      />,
    );

    const exportButton = screen.getByRole('button', { name: /export lineup shape/i });
    const quickReplaceButton = screen.getByTestId('trigger-quick-replace');

    expect(exportButton).toBeDisabled();
    expect(quickReplaceButton).toBeDisabled();

    await user.tab();
    expect(exportButton).not.toHaveFocus();
    expect(quickReplaceButton).not.toHaveFocus();
    expect(mockQuickReplaceResultReporter).not.toHaveBeenCalled();
  });

  it('quick replace: update failure does not delete selected player starter assignment', async () => {
    const user = userEvent.setup();
    const updateLineupAssignment = vi.fn().mockRejectedValue(new Error('update failed hard'));
    const deleteLineupAssignment = vi.fn().mockResolvedValue({});

    render(
      <LineupPanel
        {...defaultProps}
        viewMode="shape"
        lineup={[
          {
            id: 'la-target',
            positionId: 'pos-1',
            playerId: 'player-1',
            gameId: 'game-1',
            isStarter: true,
          } as unknown as LineupAssignment,
          {
            id: 'la-player-b-existing',
            positionId: 'pos-2',
            playerId: 'player-b',
            gameId: 'game-1',
            isStarter: true,
          } as unknown as LineupAssignment,
        ]}
        mutations={{
          ...defaultProps.mutations,
          updateLineupAssignment,
          deleteLineupAssignment,
        }}
      />,
    );

    await user.click(screen.getByTestId('trigger-quick-replace'));

    await waitFor(() => {
      expect(updateLineupAssignment).toHaveBeenCalledWith('la-target', { playerId: 'player-b' });
      expect(deleteLineupAssignment).not.toHaveBeenCalled();
      expect(mockQuickReplaceResultReporter).toHaveBeenCalledWith('error');
      expect(mockHandleApiError).toHaveBeenCalled();
    });
  });

  it('quick replace: missing target update falls back to create without stale target delete', async () => {
    const user = userEvent.setup();
    const updateLineupAssignment = vi.fn().mockRejectedValue(new Error('record not found'));
    const createLineupAssignment = vi.fn().mockResolvedValue({ data: { id: 'la-created-target' } });
    const deleteLineupAssignment = vi.fn().mockResolvedValue({});

    render(
      <LineupPanel
        {...defaultProps}
        viewMode="shape"
        lineup={[
          {
            id: 'la-target',
            positionId: 'pos-1',
            playerId: 'player-1',
            gameId: 'game-1',
            isStarter: true,
          } as unknown as LineupAssignment,
        ]}
        mutations={{
          ...defaultProps.mutations,
          updateLineupAssignment,
          createLineupAssignment,
          deleteLineupAssignment,
        }}
      />,
    );

    await user.click(screen.getByTestId('trigger-quick-replace'));

    await waitFor(() => {
      expect(createLineupAssignment).toHaveBeenCalledWith({
        gameId: 'game-1',
        playerId: 'player-b',
        positionId: 'pos-1',
        isStarter: true,
        coaches: ['user-1'],
      });
      expect(deleteLineupAssignment).not.toHaveBeenCalled();
      expect(mockQuickReplaceResultReporter).toHaveBeenCalledWith('success');
    });
  });

  it('quick replace: cleanup delete failure attempts rollback and does not report success', async () => {
    const user = userEvent.setup();
    const updateLineupAssignment = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const deleteLineupAssignment = vi.fn().mockRejectedValue(new Error('not found'));

    render(
      <LineupPanel
        {...defaultProps}
        viewMode="shape"
        lineup={[
          {
            id: 'la-target',
            positionId: 'pos-1',
            playerId: 'player-1',
            gameId: 'game-1',
            isStarter: true,
          } as unknown as LineupAssignment,
          {
            id: 'la-player-b-existing',
            positionId: 'pos-2',
            playerId: 'player-b',
            gameId: 'game-1',
            isStarter: true,
          } as unknown as LineupAssignment,
        ]}
        mutations={{
          ...defaultProps.mutations,
          updateLineupAssignment,
          deleteLineupAssignment,
        }}
      />,
    );

    await user.click(screen.getByTestId('trigger-quick-replace'));

    await waitFor(() => {
      expect(deleteLineupAssignment).toHaveBeenCalledWith('la-player-b-existing');
      expect(updateLineupAssignment).toHaveBeenNthCalledWith(1, 'la-target', { playerId: 'player-b' });
      expect(updateLineupAssignment).toHaveBeenNthCalledWith(2, 'la-target', { playerId: 'player-1' });
      expect(mockQuickReplaceResultReporter).toHaveBeenCalledWith('conflict');
      expect(mockQuickReplaceResultReporter).not.toHaveBeenCalledWith('success');
    });
  });

  // ── Substitute button triggers onSubstitute --------------------------------

  it('substitute button calls onSubstitute with the matching position', async () => {
    const user = userEvent.setup();
    const onSubstitute = vi.fn();
    render(<LineupPanel {...defaultProps} onSubstitute={onSubstitute} />);

    await user.click(screen.getByTitle('Make substitution'));
    expect(onSubstitute).toHaveBeenCalledWith(pos1);
  });

  // ── Clear All flow ---------------------------------------------------------

  it('Clear All: confirm → deletes all lineup assignments', async () => {
    const user = userEvent.setup();
    render(
      <LineupPanel
        {...defaultProps}
        gameState={makeGame('halftime')}
        game={makeGame('halftime')}
        lineup={[lineupAssignment]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /clear all positions/i }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockDeleteLineupAssignment).toHaveBeenCalledWith({ id: 'la-1' }),
    );
  });

  it('Clear All: cancel → no deletes called', async () => {
    mockConfirm.mockResolvedValue(false);
    const user = userEvent.setup();
    render(
      <LineupPanel
        {...defaultProps}
        gameState={makeGame('halftime')}
        game={makeGame('halftime')}
        lineup={[lineupAssignment]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /clear all positions/i }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockDeleteLineupAssignment).not.toHaveBeenCalled();
  });

  it('halftime remove ignores stale missing-record delete errors', async () => {
    mockDeleteLineupAssignment.mockRejectedValueOnce(new Error('not found'));
    const user = userEvent.setup();
    render(
      <LineupPanel
        {...defaultProps}
        gameState={makeGame('halftime')}
        game={makeGame('halftime')}
        lineup={[lineupAssignment]}
      />,
    );

    const removeButton = document.querySelector('.btn-remove-small') as HTMLButtonElement;
    await user.click(removeButton);

    await waitFor(() => expect(mockDeleteLineupAssignment).toHaveBeenCalledWith({ id: 'la-1' }));
    expect(mockHandleApiError).not.toHaveBeenCalledWith(expect.anything(), 'Failed to remove player from lineup');
  });

  // ── Optimistic remove (#172: multiple clicks needed to remove a player) ----

  it('halftime remove: hides the slot immediately, before the delete resolves', async () => {
    let resolveDelete: (() => void) | undefined;
    mockDeleteLineupAssignment.mockReturnValueOnce(
      new Promise((resolve) => { resolveDelete = () => resolve({}); }),
    );
    const user = userEvent.setup();
    render(
      <LineupPanel
        {...defaultProps}
        gameState={makeGame('halftime')}
        game={makeGame('halftime')}
        lineup={[lineupAssignment]}
      />,
    );

    const removeButton = document.querySelector('.btn-remove-small') as HTMLButtonElement;
    await user.click(removeButton);

    // Before the mutation's promise ever settles, the slot should already read as
    // empty and the remove button gone — a second click has nothing to act on.
    expect(mockDeleteLineupAssignment).toHaveBeenCalledWith({ id: 'la-1' });
    expect(document.querySelector('.btn-remove-small')).not.toBeInTheDocument();
    expect(screen.getAllByText('Empty')).toHaveLength(2); // pos-1 now empty too, alongside pos-2

    resolveDelete?.();
    await waitFor(() => expect(mockHandleApiError).not.toHaveBeenCalled());
  });

  it('halftime remove: restores the slot if the delete fails unexpectedly', async () => {
    mockDeleteLineupAssignment.mockRejectedValueOnce(new Error('network error'));
    const user = userEvent.setup();
    render(
      <LineupPanel
        {...defaultProps}
        gameState={makeGame('halftime')}
        game={makeGame('halftime')}
        lineup={[lineupAssignment]}
      />,
    );

    const removeButton = document.querySelector('.btn-remove-small') as HTMLButtonElement;
    await user.click(removeButton);

    await waitFor(() =>
      expect(mockHandleApiError).toHaveBeenCalledWith(expect.anything(), 'Failed to remove player from lineup'),
    );
    // Slot reappears so the coach can see the player is still assigned and retry.
    expect(document.querySelector('.btn-remove-small')).toBeInTheDocument();
  });

  it('Clear All: hides all slots immediately, before the deletes resolve', async () => {
    let resolveFirst: (() => void) | undefined;
    mockDeleteLineupAssignment
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = () => resolve({}); }))
      .mockResolvedValueOnce({});
    const user = userEvent.setup();
    render(
      <LineupPanel
        {...defaultProps}
        gameState={makeGame('halftime')}
        game={makeGame('halftime')}
        lineup={[
          lineupAssignment,
          { ...lineupAssignment, id: 'la-2', positionId: 'pos-2', playerId: 'player-b' },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /clear all positions/i }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    await waitFor(() => expect(mockDeleteLineupAssignment).toHaveBeenCalledWith({ id: 'la-2' }));

    expect(document.querySelector('.btn-remove-small')).not.toBeInTheDocument();
    expect(screen.getAllByText('Empty')).toHaveLength(2);

    resolveFirst?.();
    await waitFor(() => expect(mockHandleApiError).not.toHaveBeenCalled());
  });

  it('Clear All: ignores stale missing-record deletes and continues', async () => {
    mockDeleteLineupAssignment
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce({});
    const user = userEvent.setup();
    render(
      <LineupPanel
        {...defaultProps}
        gameState={makeGame('halftime')}
        game={makeGame('halftime')}
        lineup={[
          lineupAssignment,
          { ...lineupAssignment, id: 'la-2', positionId: 'pos-2', playerId: 'player-b' },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /clear all positions/i }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    await waitFor(() => expect(mockDeleteLineupAssignment).toHaveBeenCalledWith({ id: 'la-1' }));
    await waitFor(() => expect(mockDeleteLineupAssignment).toHaveBeenCalledWith({ id: 'la-2' }));
    expect(mockHandleApiError).not.toHaveBeenCalledWith(expect.anything(), 'Failed to clear lineup');
  });

  // ── Empty position click (halftime) ---------------------------------------
  // The file header above has long claimed this is covered ("Empty position
  // click in halftime calls onSubstitute") but no such test actually existed.

  it('clicking an empty position in halftime calls onSubstitute with that position', async () => {
    const user = userEvent.setup();
    const onSubstitute = vi.fn();
    render(
      <LineupPanel
        {...defaultProps}
        gameState={makeGame('halftime')}
        game={makeGame('halftime')}
        lineup={[]}
        onSubstitute={onSubstitute}
      />,
    );

    const emptySlots = screen.getAllByText('Empty');
    await user.click(emptySlots[0]);

    expect(onSubstitute).toHaveBeenCalledWith(pos1);
  });

  // ── Position picker (available-player click) -------------------------------
  // Same as above: the header claimed "Position picker: opens on
  // available-player click, assigns on pick, cancels" with no backing test.

  it('position picker: opens from an available-player click and assigns on pick', async () => {
    const user = userEvent.setup();
    render(
      <LineupPanel
        {...defaultProps}
        gameState={makeGame('halftime')}
        game={makeGame('halftime')}
        lineup={[]}
      />,
    );

    await user.click(screen.getByText('Alice Smith'));
    expect(screen.getByText(/assign alice smith to position/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /goalkeeper/i }));

    await waitFor(() =>
      expect(mockCreateLineupAssignment).toHaveBeenCalledWith({
        gameId: 'game-1',
        playerId: 'player-1',
        positionId: 'pos-1',
        isStarter: true,
        coaches: team.coaches,
      }),
    );
    // Halftime assignments defer PlayTimeRecord creation to handleStartSecondHalf.
    expect(defaultProps.mutations.createPlayTimeRecord).not.toHaveBeenCalled();
    expect(screen.queryByText(/assign alice smith to position/i)).not.toBeInTheDocument();
  });

  it('position picker: Cancel closes the modal without assigning', async () => {
    const user = userEvent.setup();
    render(
      <LineupPanel
        {...defaultProps}
        gameState={makeGame('halftime')}
        game={makeGame('halftime')}
        lineup={[]}
      />,
    );

    await user.click(screen.getByText('Alice Smith'));
    expect(screen.getByText(/assign alice smith to position/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(screen.queryByText(/assign alice smith to position/i)).not.toBeInTheDocument();
    expect(mockCreateLineupAssignment).not.toHaveBeenCalled();
  });

  // ── Remove then assign a replacement (halftime) ----------------------------
  // Covers the coordinator brief's core scenario: removing a starter and
  // assigning a replacement for the vacated position, and documents that this
  // manual halftime flow does NOT record a Substitution the way
  // handleApplyHalftimeSub / executeSubstitution do — worth a product decision,
  // not asserted here as a bug, just as the current, tested behavior.

  it('halftime: removing a starter then assigning a replacement fills the vacated position without recording a Substitution', async () => {
    const user = userEvent.setup();
    render(
      <LineupPanel
        {...defaultProps}
        gameState={makeGame('halftime')}
        game={makeGame('halftime')}
        lineup={[lineupAssignment]} // player-1 (Alice) starting at pos-1
      />,
    );

    const removeButton = document.querySelector('.btn-remove-small') as HTMLButtonElement;
    await user.click(removeButton);
    await waitFor(() => expect(mockDeleteLineupAssignment).toHaveBeenCalledWith({ id: 'la-1' }));

    await user.click(screen.getByText('Bob Jones'));
    await waitFor(() => expect(screen.getByText(/assign bob jones to position/i)).toBeInTheDocument());

    // pos-1 is free again (its assignment was optimistically hidden), so it's
    // selectable as the replacement's position.
    await user.click(screen.getByRole('button', { name: /goalkeeper/i }));

    await waitFor(() =>
      expect(mockCreateLineupAssignment).toHaveBeenCalledWith({
        gameId: 'game-1',
        playerId: 'player-b',
        positionId: 'pos-1',
        isStarter: true,
        coaches: team.coaches,
      }),
    );
    expect(defaultProps.mutations.createSubstitution).not.toHaveBeenCalled();
  });
});
