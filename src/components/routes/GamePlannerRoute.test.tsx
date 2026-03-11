import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GamePlannerRoute } from './GamePlannerRoute';
import type { Game, Team } from '../../types/schema';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockGameGet, mockTeamGet, mockNavigate } = vi.hoisted(() => ({
  mockGameGet: vi.fn(),
  mockTeamGet: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      Game: { get: mockGameGet },
      Team: { get: mockTeamGet },
    },
  })),
}));

vi.mock('react-router-dom', () => ({
  useParams: vi.fn(),
  useLocation: vi.fn(),
  useNavigate: vi.fn(() => mockNavigate),
}));

vi.mock('../GamePlanner', () => ({
  GamePlanner: ({ game, team }: { game: Game; team: Team }) => (
    <div data-testid="game-planner">
      {game.id}-{team.id}
    </div>
  ),
}));

vi.mock('../../utils/errorHandler', () => ({
  logError: vi.fn(),
  handleApiError: vi.fn(),
}));

import { useParams, useLocation } from 'react-router-dom';

const mockUseParams = vi.mocked(useParams);
const mockUseLocation = vi.mocked(useLocation);

const fakeGame: Game = { id: 'game-1', teamId: 'team-1', status: 'scheduled' } as Game;
const fakeTeam: Team = { id: 'team-1', name: 'Eagles' } as Team;

function setupWithState(game: Game | null, team: Team | null) {
  mockUseParams.mockReturnValue({ gameId: 'game-1' });
  mockUseLocation.mockReturnValue({
    state: { game, team },
    pathname: '/game/game-1/plan',
    search: '',
    hash: '',
    key: 'default',
  } as ReturnType<typeof useLocation>);
}

function setupNoState() {
  mockUseParams.mockReturnValue({ gameId: 'game-1' });
  mockUseLocation.mockReturnValue({
    state: null,
    pathname: '/game/game-1/plan',
    search: '',
    hash: '',
    key: 'default',
  } as ReturnType<typeof useLocation>);
}

describe('GamePlannerRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders GamePlanner immediately when game + team are in location.state', () => {
    setupWithState(fakeGame, fakeTeam);

    render(<GamePlannerRoute />);

    expect(screen.getByTestId('game-planner')).toBeInTheDocument();
    expect(mockGameGet).not.toHaveBeenCalled();
  });

  it('shows loading state initially when no state is passed', () => {
    setupNoState();
    mockGameGet.mockReturnValue(new Promise(() => {}));

    render(<GamePlannerRoute />);

    expect(screen.getByText('Loading game plan...')).toBeInTheDocument();
  });

  it('fetches game and team by ID when location.state is absent', async () => {
    setupNoState();
    mockGameGet.mockResolvedValue({ data: fakeGame });
    mockTeamGet.mockResolvedValue({ data: fakeTeam });

    render(<GamePlannerRoute />);

    await waitFor(() =>
      expect(screen.getByTestId('game-planner')).toBeInTheDocument(),
    );
    expect(mockGameGet).toHaveBeenCalledWith({ id: 'game-1' });
    expect(mockTeamGet).toHaveBeenCalledWith({ id: 'team-1' });
  });

  it('renders error state when game not found', async () => {
    setupNoState();
    mockGameGet.mockResolvedValue({ data: null });

    render(<GamePlannerRoute />);

    await waitFor(() =>
      expect(screen.getByText('Game not found.')).toBeInTheDocument(),
    );
  });

  it('renders error state when team not found', async () => {
    setupNoState();
    mockGameGet.mockResolvedValue({ data: fakeGame });
    mockTeamGet.mockResolvedValue({ data: null });

    render(<GamePlannerRoute />);

    await waitFor(() =>
      expect(screen.getByText('Game not found.')).toBeInTheDocument(),
    );
  });

  it('"Back to Games" button navigates to /', async () => {
    setupNoState();
    mockGameGet.mockResolvedValue({ data: null });

    render(<GamePlannerRoute />);

    const backBtn = await screen.findByRole('button', { name: 'Back to Games' });
    await userEvent.click(backBtn);

    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('does NOT fetch when both game and team are already in state', () => {
    setupWithState(fakeGame, fakeTeam);

    render(<GamePlannerRoute />);

    expect(mockGameGet).not.toHaveBeenCalled();
    expect(mockTeamGet).not.toHaveBeenCalled();
  });
});
