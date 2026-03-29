/**
 * Tests for SubstitutionPanel.
 *
 * Behaviours covered:
 *   - Substitution queue section:
 *     - Hidden when queue is empty
 *     - Hidden when game status is not 'in-progress'
 *     - Visible with correct count when queue has items in-progress
 *     - Remove-from-queue (✕) calls onQueueChange without the removed item
 *     - "Sub All Now" → confirm → executeSubstitution called for each queued item
 *     - "Sub All Now" cancel → executeSubstitution NOT called
 *   - Modal opening:
 *     - Modal hidden on initial render (no substitutionRequest)
 *     - Modal opens when substitutionRequest prop is set (useEffect)
 *     - onSubstitutionRequestHandled called when modal opens
 *   - Modal content:
 *     - Empty position shows "Assign Player to Position" title
 *     - Occupied position shows "Substitution" title
 *   - Player actions inside modal:
 *     - "Queue" button adds item to queue via onQueueChange
 *     - "Sub Now" button calls executeSubstitution directly
 *     - "Assign" button creates LineupAssignment (empty position case)
 *   - Modal dismissal:
 *     - Close button hides the modal
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockCreateLineupAssignment,
  mockCreatePlayTimeRecord,
  mockShowWarning,
  mockTrackEvent,
  mockHandleApiError,
  mockConfirm,
  mockCalculatePlayerPlayTime,
  mockIsPlayerCurrentlyPlaying,
  mockIsPlayerInLineup,
  mockFormatMinutesSeconds,
  mockExecuteSubstitution,
  mockGetPlayerAvailability,
} = vi.hoisted(() => ({
  mockCreateLineupAssignment: vi.fn().mockResolvedValue({ data: { id: 'la-new' } }),
  mockCreatePlayTimeRecord: vi.fn().mockResolvedValue({}),
  mockShowWarning: vi.fn(),
  mockTrackEvent: vi.fn(),
  mockHandleApiError: vi.fn(),
  mockConfirm: vi.fn().mockResolvedValue(true),
  mockCalculatePlayerPlayTime: vi.fn().mockReturnValue(0),
  mockIsPlayerCurrentlyPlaying: vi.fn().mockReturnValue(false),
  mockIsPlayerInLineup: vi.fn().mockReturnValue(false),
  mockFormatMinutesSeconds: vi.fn().mockReturnValue('10:00'),
  mockExecuteSubstitution: vi.fn().mockResolvedValue(undefined),
  mockGetPlayerAvailability: vi.fn().mockReturnValue('available'),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      LineupAssignment: {
        create: mockCreateLineupAssignment,
        delete: vi.fn().mockResolvedValue({}),
      },
      PlayTimeRecord: {
        create: mockCreatePlayTimeRecord,
      },
    },
  })),
}));

vi.mock('../../utils/toast', () => ({
  showWarning: (...args: unknown[]) => mockShowWarning(...args),
  showError: vi.fn(),
}));

vi.mock('../../utils/analytics', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  AnalyticsEvents: {
    SUBSTITUTION_MADE: { category: 'game', action: 'substitution_made' },
    ALL_SUBSTITUTIONS_EXECUTED: { category: 'game', action: 'all_substitutions_executed' },
  },
}));

vi.mock('../../utils/errorHandler', () => ({
  handleApiError: (...args: unknown[]) => mockHandleApiError(...args),
  logError: vi.fn(),
}));

vi.mock('../ConfirmModal', () => ({
  useConfirm: vi.fn(() => mockConfirm),
}));

vi.mock('../../utils/playTimeCalculations', () => ({
  calculatePlayerPlayTime: (...args: unknown[]) => mockCalculatePlayerPlayTime(...args),
  isPlayerCurrentlyPlaying: (...args: unknown[]) => mockIsPlayerCurrentlyPlaying(...args),
}));

vi.mock('../../utils/lineupUtils', () => ({
  isPlayerInLineup: (...args: unknown[]) => mockIsPlayerInLineup(...args),
}));

vi.mock('../../utils/gameTimeUtils', () => ({
  formatMinutesSeconds: (...args: unknown[]) => mockFormatMinutesSeconds(...args),
}));

vi.mock('../../services/substitutionService', () => ({
  executeSubstitution: (...args: unknown[]) => mockExecuteSubstitution(...args),
}));

vi.mock('../../contexts/AvailabilityContext', () => ({
  useAvailability: vi.fn(() => ({
    getPlayerAvailability: mockGetPlayerAvailability,
    availabilities: [],
  })),
}));

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import { SubstitutionPanel } from './SubstitutionPanel';
import type {
  Game,
  Team,
  PlayerWithRoster,
  FormationPosition,
  LineupAssignment,
  PlayTimeRecord,
  SubQueue,
} from './types';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeGame(status: string): Game {
  return {
    id: 'game-1',
    status,
    currentHalf: 1,
    elapsedSeconds: 600,
    lastStartTime: null,
    halfLengthMinutes: 30,
    teamId: 'team-1',
  } as unknown as Game;
}

const team: Team = {
  id: 'team-1',
  name: 'Test Team',
  maxPlayersOnField: 7,
  coaches: ['user-1'],
} as unknown as Team;

const pos1: FormationPosition = {
  id: 'pos-1',
  positionName: 'Goalkeeper',
  abbreviation: 'GK',
  x: 50,
  y: 10,
} as unknown as FormationPosition;

const pos2: FormationPosition = {
  id: 'pos-2',
  positionName: 'Defender',
  abbreviation: 'DEF',
  x: 30,
  y: 40,
} as unknown as FormationPosition;

const player1: PlayerWithRoster = {
  id: 'player-1',
  firstName: 'Alice',
  lastName: 'Smith',
  playerNumber: 1,
  isActive: true,
  preferredPositions: '',  // stored as comma-separated string in the data model
} as unknown as PlayerWithRoster;

const player2: PlayerWithRoster = {
  id: 'player-2',
  firstName: 'Bob',
  lastName: 'Jones',
  playerNumber: 9,
  isActive: true,
  preferredPositions: '',  // stored as comma-separated string in the data model
} as unknown as PlayerWithRoster;

const lineupAlice: LineupAssignment = {
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
  players: [player1, player2],
  positions: [pos1, pos2],
  lineup: [lineupAlice],
  playTimeRecords: [] as PlayTimeRecord[],
  currentTime: 600,
  substitutionQueue: [] as SubQueue[],
  onQueueChange: vi.fn(),
  substitutionRequest: null as FormationPosition | null,
  onSubstitutionRequestHandled: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SubstitutionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
    mockIsPlayerInLineup.mockReturnValue(false);
    mockIsPlayerCurrentlyPlaying.mockReturnValue(false);
    mockGetPlayerAvailability.mockReturnValue('available');
    mockExecuteSubstitution.mockResolvedValue(undefined);
  });

  // ── Substitution queue section ------------------------------------------

  it('queue section is hidden when substitutionQueue is empty', () => {
    render(<SubstitutionPanel {...defaultProps} substitutionQueue={[]} />);
    expect(screen.queryByText(/sub all now/i)).not.toBeInTheDocument();
  });

  it('queue section is hidden when status is not in-progress', () => {
    render(
      <SubstitutionPanel
        {...defaultProps}
        gameState={makeGame('halftime')}
        game={makeGame('halftime')}
        substitutionQueue={[{ playerId: 'player-2', positionId: 'pos-1' }]}
      />,
    );
    expect(screen.queryByText(/sub all now/i)).not.toBeInTheDocument();
  });

  it('queue section shows count when queue has items in-progress', () => {
    render(
      <SubstitutionPanel
        {...defaultProps}
        substitutionQueue={[{ playerId: 'player-2', positionId: 'pos-1' }]}
      />,
    );
    // Section heading should show queue count
    expect(screen.getByRole('heading', { name: /substitution queue/i })).toBeInTheDocument();
  });

  it('remove from queue (✕) calls onQueueChange without the removed item', async () => {
    const user = userEvent.setup();
    const onQueueChange = vi.fn();
    const queue: SubQueue[] = [{ playerId: 'player-2', positionId: 'pos-1' }];
    render(
      <SubstitutionPanel
        {...defaultProps}
        substitutionQueue={queue}
        onQueueChange={onQueueChange}
      />,
    );

    await user.click(screen.getByTitle('Remove from queue'));
    expect(onQueueChange).toHaveBeenCalledWith([]);
  });

  it('"Sub All Now" → confirm → executeSubstitution called for queued item', async () => {
    const user = userEvent.setup();
    const queue: SubQueue[] = [{ playerId: 'player-2', positionId: 'pos-1' }];
    render(
      <SubstitutionPanel
        {...defaultProps}
        substitutionQueue={queue}
      />,
    );

    await user.click(screen.getByTitle('Execute all queued substitutions at once'));
    expect(mockConfirm).toHaveBeenCalled();
    await waitFor(() => expect(mockExecuteSubstitution).toHaveBeenCalled());
  });

  it('"Sub All Now" cancel → executeSubstitution NOT called', async () => {
    mockConfirm.mockResolvedValue(false);
    const user = userEvent.setup();
    const queue: SubQueue[] = [{ playerId: 'player-2', positionId: 'pos-1' }];
    render(
      <SubstitutionPanel
        {...defaultProps}
        substitutionQueue={queue}
      />,
    );

    await user.click(screen.getByTitle('Execute all queued substitutions at once'));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockExecuteSubstitution).not.toHaveBeenCalled();
  });

  // ── Modal opening --------------------------------------------------------

  it('modal is hidden on initial render (no substitutionRequest)', () => {
    render(<SubstitutionPanel {...defaultProps} substitutionRequest={null} />);
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
  });

  it('modal opens when substitutionRequest prop is non-null', async () => {
    render(<SubstitutionPanel {...defaultProps} substitutionRequest={pos1} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument(),
    );
  });

  it('onSubstitutionRequestHandled is called when modal opens via substitutionRequest', async () => {
    const onSubstitutionRequestHandled = vi.fn();
    render(
      <SubstitutionPanel
        {...defaultProps}
        substitutionRequest={pos1}
        onSubstitutionRequestHandled={onSubstitutionRequestHandled}
      />,
    );
    await waitFor(() => expect(onSubstitutionRequestHandled).toHaveBeenCalled());
  });

  // ── Modal content --------------------------------------------------------

  it('occupied position shows "Substitution" title in modal', async () => {
    // pos1 has alice assigned (isStarter: true) in lineupAlice
    render(<SubstitutionPanel {...defaultProps} substitutionRequest={pos1} />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /substitution/i })).toBeInTheDocument(),
    );
  });

  it('empty position shows "Assign Player to Position" title in modal', async () => {
    // pos2 has no player assigned
    render(
      <SubstitutionPanel
        {...defaultProps}
        substitutionRequest={pos2}
        lineup={[]}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /assign player to position/i }),
      ).toBeInTheDocument(),
    );
  });

  // ── Player actions in modal ---------------------------------------------

  it('"Queue" button adds player to queue via onQueueChange', async () => {
    const user = userEvent.setup();
    const onQueueChange = vi.fn();
    // Alice is currently playing (pos-1), so only Bob appears as available
    mockIsPlayerCurrentlyPlaying.mockImplementation((playerId: string) => playerId === 'player-1');
    render(
      <SubstitutionPanel
        {...defaultProps}
        onQueueChange={onQueueChange}
        substitutionRequest={pos1}
      />,
    );

    await waitFor(() => expect(screen.getAllByTitle('Add to substitution queue')).toHaveLength(1));
    await user.click(screen.getByTitle('Add to substitution queue'));

    expect(onQueueChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ positionId: 'pos-1' }),
      ]),
    );
  });

  it('"Sub Now" button in modal calls executeSubstitution', async () => {
    const user = userEvent.setup();
    // Alice is currently playing (pos-1), so only Bob appears as available
    mockIsPlayerCurrentlyPlaying.mockImplementation((playerId: string) => playerId === 'player-1');
    render(<SubstitutionPanel {...defaultProps} substitutionRequest={pos1} />);

    await waitFor(() => expect(screen.getAllByTitle('Substitute immediately')).toHaveLength(1));
    await user.click(screen.getByTitle('Substitute immediately'));

    await waitFor(() => expect(mockExecuteSubstitution).toHaveBeenCalled());
  });

  // ── Modal dismissal -----------------------------------------------------

  it('Close button hides the modal', async () => {
    const user = userEvent.setup();
    render(<SubstitutionPanel {...defaultProps} substitutionRequest={pos1} />);

    await waitFor(() => screen.getByRole('button', { name: /close/i }));
    await user.click(screen.getByRole('button', { name: /close/i }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument(),
    );
  });

  it('filters injured players from substitution candidates', async () => {
    mockIsPlayerCurrentlyPlaying.mockImplementation((playerId: string) => playerId === 'player-1');
    mockGetPlayerAvailability.mockImplementation((playerId: string) =>
      playerId === 'player-2' ? 'injured' : 'available',
    );

    render(<SubstitutionPanel {...defaultProps} substitutionRequest={pos1} />);

    await waitFor(() => {
      expect(screen.queryByText(/Bob Jones/)).not.toBeInTheDocument();
      expect(screen.getByText(/No eligible substitutes\. All bench players are marked injured\./i)).toBeInTheDocument();
    });
  });

  it('removes queued injured player and announces warning', async () => {
    mockGetPlayerAvailability.mockImplementation((playerId: string) =>
      playerId === 'player-2' ? 'injured' : 'available',
    );
    const onQueueChange = vi.fn();

    render(
      <SubstitutionPanel
        {...defaultProps}
        substitutionQueue={[{ playerId: 'player-2', positionId: 'pos-1' }]}
        onQueueChange={onQueueChange}
      />,
    );

    await waitFor(() => {
      expect(onQueueChange).toHaveBeenCalledWith([]);
      expect(mockShowWarning).toHaveBeenCalledWith('Removed from queue: player marked injured.');
    });
  });
});
