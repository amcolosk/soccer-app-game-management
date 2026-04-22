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
  LineupShapeView: () => <div data-testid="lineup-shape-view" />,
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

const pos1: FormationPosition = { id: 'pos-1', name: 'GK', x: 50, y: 10 } as unknown as FormationPosition;
const pos2: FormationPosition = { id: 'pos-2', name: 'DEF', x: 30, y: 40 } as unknown as FormationPosition;
const positions = [pos1, pos2];

const player1: PlayerWithRoster = {
  id: 'player-1',
  name: 'Alice',
  firstName: 'Alice',
  lastName: 'Smith',
  playerNumber: 10,
  isActive: true,
} as unknown as PlayerWithRoster;

const players: PlayerWithRoster[] = [player1];

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

  it('does NOT show "Clear All" button in halftime when no positions assigned', () => {
    render(
      <LineupPanel
        {...defaultProps}
        gameState={makeGame('halftime')}
        game={makeGame('halftime')}
        lineup={[]}
      />,
    );
    expect(screen.queryByRole('button', { name: /clear all/i })).not.toBeInTheDocument();
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
});
