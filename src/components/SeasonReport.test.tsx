import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { within } from '@testing-library/dom';
import { TeamReport } from './SeasonReport';

const {
  mockUseAmplifyQuery,
  mockSetHelpContext,
  mockSetDebugContext,
  mockTrackEvent,
  mockPlayTimeByGame,
  mockGoalList,
  mockGameNoteList,
} = vi.hoisted(() => ({
  mockUseAmplifyQuery: vi.fn(),
  mockSetHelpContext: vi.fn(),
  mockSetDebugContext: vi.fn(),
  mockTrackEvent: vi.fn(),
  mockPlayTimeByGame: vi.fn(),
  mockGoalList: vi.fn(),
  mockGameNoteList: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      PlayTimeRecord: {
        listPlayTimeRecordsByGameId: (...args: unknown[]) => mockPlayTimeByGame(...args),
      },
      Goal: { list: (...args: unknown[]) => mockGoalList(...args) },
      GameNote: { list: (...args: unknown[]) => mockGameNoteList(...args) },
    },
    queries: {},
  })),
}));

vi.mock('../hooks/useAmplifyQuery', () => ({
  useAmplifyQuery: (...args: unknown[]) => mockUseAmplifyQuery(...args),
}));

vi.mock('../contexts/HelpFabContext', () => ({
  useHelpFab: () => ({
    setHelpContext: mockSetHelpContext,
    setDebugContext: mockSetDebugContext,
  }),
}));

vi.mock('../utils/analytics', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  AnalyticsEvents: {
    SEASON_REPORT_VIEWED: { category: 'season-report', action: 'viewed' },
  },
}));

describe('TeamReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseAmplifyQuery.mockImplementation((modelName: string) => {
      if (modelName === 'TeamRoster') {
        return {
          data: [{ id: 'roster-1', teamId: 'team-1', playerId: 'player-1', playerNumber: 10 }],
          isSynced: true,
        };
      }

      if (modelName === 'Player') {
        return {
          data: [{ id: 'player-1', firstName: 'Sam', lastName: 'Lee' }],
          isSynced: true,
        };
      }

      if (modelName === 'Game') {
        return {
          data: [
            {
              id: 'game-1',
              teamId: 'team-1',
              status: 'completed',
              elapsedSeconds: 600,
              ourScore: 1,
              opponentScore: 0,
              gameDate: '2030-06-01',
              opponent: 'Rivals',
            },
          ],
          isSynced: true,
        };
      }

      if (modelName === 'FieldPosition') {
        return {
          data: [{ id: 'pos-1', positionName: 'Forward' }],
          isSynced: true,
        };
      }

      return { data: [], isSynced: true };
    });

    mockPlayTimeByGame.mockResolvedValue({ data: [], nextToken: null });
    mockGoalList.mockResolvedValue({
      data: [{ id: 'goal-1', gameId: 'game-1', scoredByUs: true, scorerId: 'player-1', gameSeconds: 120, half: 1 }],
      nextToken: null,
    });
    mockGameNoteList.mockResolvedValue({ data: [], nextToken: null });
  });

  it('renders computed season totals and player row after data sync', async () => {
    render(
      <TeamReport
        team={{ id: 'team-1', name: 'Tigers', coaches: [] } as never}
      />
    );

    expect(screen.getByText('Loading season statistics...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Season Report: Tigers')).toBeInTheDocument();
      expect(screen.getByText(/Sam Lee/)).toBeInTheDocument();
      expect(screen.getByText('1-0-0')).toBeInTheDocument();
      expect(screen.getByText('Total Goals')).toBeInTheDocument();
    });

    expect(mockTrackEvent).toHaveBeenCalledWith('season-report', 'viewed');
  });

  it('renders goals by position from field-position attribution', async () => {
    mockPlayTimeByGame.mockResolvedValue({
      data: [
        {
          id: 'ptr-1',
          gameId: 'game-1',
          playerId: 'player-1',
          positionId: 'pos-1',
          startGameSeconds: 0,
          endGameSeconds: 600,
        },
      ],
      nextToken: null,
    });

    render(
      <TeamReport
        team={{ id: 'team-1', name: 'Tigers', coaches: [] } as never}
      />
    );

    await waitFor(() => {
      const heading = screen.getByRole('heading', { name: 'Goals by Position' });
      expect(heading).toBeInTheDocument();
      const section = heading.closest('section');
      expect(section).not.toBeNull();
      expect(within(section as HTMLElement).getByRole('columnheader', { name: 'Assists' })).toBeInTheDocument();
      expect(within(section as HTMLElement).getByRole('rowheader', { name: 'Forward' })).toBeInTheDocument();
      const rows = within(section as HTMLElement).getAllByRole('row');
      expect(within(rows[1]).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['1', '0']);
    });
  });

  it('renders assists-inclusive goals-by-position rows sorted by goals then assists', async () => {
    mockUseAmplifyQuery.mockImplementation((modelName: string) => {
      if (modelName === 'TeamRoster') {
        return {
          data: [{ id: 'roster-1', teamId: 'team-1', playerId: 'player-1', playerNumber: 10 }],
          isSynced: true,
        };
      }

      if (modelName === 'Player') {
        return {
          data: [{ id: 'player-1', firstName: 'Sam', lastName: 'Lee' }],
          isSynced: true,
        };
      }

      if (modelName === 'Game') {
        return {
          data: [
            {
              id: 'game-1',
              teamId: 'team-1',
              status: 'completed',
              elapsedSeconds: 600,
              ourScore: 2,
              opponentScore: 0,
              gameDate: '2030-06-01',
              opponent: 'Rivals',
            },
          ],
          isSynced: true,
        };
      }

      if (modelName === 'FieldPosition') {
        return {
          data: [
            { id: 'pos-1', positionName: 'Forward' },
            { id: 'pos-2', positionName: 'Midfielder' },
          ],
          isSynced: true,
        };
      }

      return { data: [], isSynced: true };
    });

    mockPlayTimeByGame.mockResolvedValue({
      data: [
        {
          id: 'ptr-forward-scorer',
          gameId: 'game-1',
          playerId: 'player-1',
          positionId: 'pos-1',
          startGameSeconds: 0,
          endGameSeconds: 600,
        },
        {
          id: 'ptr-forward-assist',
          gameId: 'game-1',
          playerId: 'player-2',
          positionId: 'pos-1',
          startGameSeconds: 0,
          endGameSeconds: 600,
        },
        {
          id: 'ptr-mid-scorer',
          gameId: 'game-1',
          playerId: 'player-3',
          positionId: 'pos-2',
          startGameSeconds: 0,
          endGameSeconds: 600,
        },
      ],
      nextToken: null,
    });

    mockGoalList.mockResolvedValue({
      data: [
        { id: 'goal-1', gameId: 'game-1', scoredByUs: true, scorerId: 'player-1', assistId: 'player-2', gameSeconds: 120, half: 1 },
        { id: 'goal-2', gameId: 'game-1', scoredByUs: true, scorerId: 'player-3', gameSeconds: 240, half: 1 },
      ],
      nextToken: null,
    });

    render(
      <TeamReport
        team={{ id: 'team-1', name: 'Tigers', coaches: [] } as never}
      />
    );

    await waitFor(() => {
      const heading = screen.getByRole('heading', { name: 'Goals by Position' });
      const section = heading.closest('section') as HTMLElement;
      const rowHeaders = within(section).getAllByRole('rowheader');
      expect(rowHeaders.map(row => row.textContent)).toEqual(['Forward', 'Midfielder']);

      const rows = within(section).getAllByRole('row');
      expect(within(rows[1]).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['1', '1']);
      expect(within(rows[2]).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['1', '0']);
    });
  });

  it('omits goals by position section when goals cannot be attributed', async () => {
    mockGoalList.mockResolvedValue({
      data: [{ id: 'goal-2', gameId: 'game-1', scoredByUs: false, scorerId: 'player-1', gameSeconds: 120, half: 1 }],
      nextToken: null,
    });

    render(
      <TeamReport
        team={{ id: 'team-1', name: 'Tigers', coaches: [] } as never}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Season Report: Tigers')).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: 'Goals by Position' })).not.toBeInTheDocument();
  });
});
