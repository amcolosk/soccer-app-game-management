import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

      if (modelName === 'FormationPosition') {
        return {
          data: [{ id: 'pos-1', positionName: 'Forward' }],
          isSynced: true,
        };
      }

      return { data: [], isSynced: true };
    });

    mockPlayTimeByGame.mockResolvedValue({ data: [], nextToken: null });
    mockGoalList.mockResolvedValue({
      data: [{ id: 'goal-1', gameId: 'game-1', scorerId: 'player-1', gameSeconds: 120, half: 1 }],
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
});
