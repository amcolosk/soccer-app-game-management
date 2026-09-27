import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { TeamReport } from './SeasonReport';

const {
  mockUseAmplifyQuery,
  mockSetHelpContext,
  mockSetDebugContext,
  mockTrackEvent,
  mockPlayTimeByGame,
  mockGoalList,
  mockGameNoteList,
  mockShotList,
  mockSaveList,
} = vi.hoisted(() => ({
  mockUseAmplifyQuery: vi.fn(),
  mockSetHelpContext: vi.fn(),
  mockSetDebugContext: vi.fn(),
  mockTrackEvent: vi.fn(),
  mockPlayTimeByGame: vi.fn(),
  mockGoalList: vi.fn(),
  mockGameNoteList: vi.fn(),
  mockShotList: vi.fn(),
  mockSaveList: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      PlayTimeRecord: {
        listPlayTimeRecordsByGameId: (...args: unknown[]) => mockPlayTimeByGame(...args),
      },
      Goal: { list: (...args: unknown[]) => mockGoalList(...args) },
      GameNote: { list: (...args: unknown[]) => mockGameNoteList(...args) },
      Shot: { listShotsByGameId: (...args: unknown[]) => mockShotList(...args) },
      Save: { listSavesByGameId: (...args: unknown[]) => mockSaveList(...args) },
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
          data: [{ id: 'pos-1', positionName: 'Forward', sortOrder: 1 }],
          isSynced: true,
        };
      }

      if (modelName === 'FormationPosition') {
        return {
          data: [],
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
    mockShotList.mockResolvedValue({ data: [], nextToken: null });
    mockSaveList.mockResolvedValue({ data: [], nextToken: null });
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
    expect(screen.queryByText(/Archived Team/)).not.toBeInTheDocument();
  });

  it('shows the archived-team read-only banner when the team is archived', async () => {
    render(
      <TeamReport
        team={{
          id: 'team-1',
          name: 'Tigers',
          coaches: [],
          status: 'archived',
          archivedAt: '2026-08-01T12:00:00.000Z',
        } as never}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Archived Team — Read-Only \(Archived Aug 1, 2026\)/)
      ).toBeInTheDocument();
    });
  });

  it('renders goals by position from field-position attribution', async () => {
    mockPlayTimeByGame.mockResolvedValue({
      data: [
        {
          id: 'ptr-1',
          playerId: 'player-1',
          gameId: 'game-1',
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
      const table = screen.getByRole('table', { name: 'Team goals and assists by field position' });
      expect(table).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /Goals & Assists by Position/i })).toBeInTheDocument();
      expect(within(table).getByRole('rowheader', { name: 'Forward' })).toBeInTheDocument();
      const rows = within(table).getAllByRole('row');
      expect(within(rows[1]).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['1', '0']);
    });
  });

  it('renders goals by position from formation-position attribution', async () => {
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
        return { data: [], isSynced: true };
      }

      if (modelName === 'FormationPosition') {
        return {
          data: [{ id: 'form-pos-1', positionName: 'Center Midfielder', sortOrder: 1 }],
          isSynced: true,
        };
      }

      return { data: [], isSynced: true };
    });

    mockPlayTimeByGame.mockResolvedValue({
      data: [
        {
          id: 'ptr-1',
          playerId: 'player-1',
          gameId: 'game-1',
          positionId: 'form-pos-1',
          startGameSeconds: 0,
          endGameSeconds: 600,
        },
      ],
      nextToken: null,
    });

    render(
      <TeamReport
        team={{ id: 'team-1', name: 'Tigers', formationId: 'formation-1', coaches: [] } as never}
      />
    );

    await waitFor(() => {
      const table = screen.getByRole('table', { name: 'Team goals and assists by field position' });
      expect(table).toBeInTheDocument();
      expect(within(table).getByRole('rowheader', { name: 'Center Midfielder' })).toBeInTheDocument();
      expect(screen.queryByRole('rowheader', { name: 'Unknown position' })).not.toBeInTheDocument();
    });
  });

  it('player detail rows are keyboard-accessible with onKeyDown handler', async () => {
    render(
      <TeamReport
        team={{ id: 'team-1', name: 'Tigers', coaches: [] } as never}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Sam Lee/)).toBeInTheDocument();
    });

    const playerRow = screen.getByText(/Sam Lee/).closest('tr')!;
    expect(playerRow).toHaveAttribute('tabindex', '0');
    expect(playerRow).toHaveAttribute('aria-selected', 'false');
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
      const table = screen.getByRole('table', { name: 'Team goals and assists by field position' });
      const rowHeaders = within(table).getAllByRole('rowheader');
      expect(rowHeaders.map(row => row.textContent)).toEqual(['Forward', 'Midfielder']);

      const rows = within(table).getAllByRole('row');
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

    expect(screen.queryByRole('table', { name: 'Team goals and assists by field position' })).not.toBeInTheDocument();
  });

  describe('Issue #203: Saves by Goalie', () => {
    // Data arrays are hoisted to stable per-invocation references (rather than
    // literals created fresh inside the mockImplementation callback) so that
    // re-renders triggered by user interaction (e.g. a tab/row click) see the
    // SAME array identity across calls. The real useAmplifyQuery hook backs
    // its data with useState, so it is naturally reference-stable between
    // renders unless a subscription actually delivers new data; this mock
    // must replicate that or unrelated state changes (like a tab click) will
    // spuriously look like "new data" to effects depending on these arrays,
    // via referential inequality) and loop forever.
    function mockKeeperScenario() {
      const teamRosterData = [
        { id: 'roster-1', teamId: 'team-1', playerId: 'player-1', playerNumber: 1 },
        { id: 'roster-2', teamId: 'team-1', playerId: 'player-2', playerNumber: 10 },
      ];
      const playerData = [
        { id: 'player-1', firstName: 'Casey', lastName: 'Keeper' },
        { id: 'player-2', firstName: 'Sam', lastName: 'Lee' },
      ];
      const gameData = [
        {
          id: 'game-1',
          teamId: 'team-1',
          status: 'completed',
          elapsedSeconds: 2700,
          ourScore: 1,
          opponentScore: 1,
          gameDate: '2030-06-01',
          opponent: 'Rivals',
        },
      ];
      const fieldPositionData: unknown[] = [];
      const formationPositionData = [{ id: 'form-gk', positionName: 'Goalkeeper', sortOrder: 0, role: 'GOALKEEPER' }];
      const emptyData: unknown[] = [];

      mockUseAmplifyQuery.mockImplementation((modelName: string) => {
        if (modelName === 'TeamRoster') return { data: teamRosterData, isSynced: true };
        if (modelName === 'Player') return { data: playerData, isSynced: true };
        if (modelName === 'Game') return { data: gameData, isSynced: true };
        if (modelName === 'FieldPosition') return { data: fieldPositionData, isSynced: true };
        if (modelName === 'FormationPosition') return { data: formationPositionData, isSynced: true };
        return { data: emptyData, isSynced: true };
      });

      mockPlayTimeByGame.mockResolvedValue({
        data: [
          {
            id: 'ptr-keeper',
            playerId: 'player-1',
            gameId: 'game-1',
            positionId: 'form-gk',
            startGameSeconds: 0,
            endGameSeconds: 2700,
          },
        ],
        nextToken: null,
      });
      mockGoalList.mockResolvedValue({
        data: [
          { id: 'goal-1', gameId: 'game-1', scoredByUs: false, gameSeconds: 500, half: 1 },
        ],
        nextToken: null,
      });
      mockGameNoteList.mockResolvedValue({ data: [], nextToken: null });
      mockShotList.mockResolvedValue({
        data: [
          { id: 'shot-1', gameId: 'game-1', playerId: 'player-2', takenByUs: true, outcome: 'GOAL', gameSeconds: 100, half: 1 },
          { id: 'shot-2', gameId: 'game-1', playerId: 'player-2', takenByUs: true, outcome: null, gameSeconds: 200, half: 1 },
        ],
        nextToken: null,
      });
      mockSaveList.mockResolvedValue({
        data: [
          { id: 'save-1', gameId: 'game-1', playerId: 'player-1', byUs: true, gameSeconds: 300, half: 1 },
          { id: 'save-2', gameId: 'game-1', playerId: 'player-1', byUs: true, gameSeconds: 600, half: 1 },
          { id: 'save-3', gameId: 'game-1', playerId: null, byUs: true, gameSeconds: 900, half: 1 },
        ],
        nextToken: null,
      });
    }

    const team = { id: 'team-1', name: 'Tigers', formationId: 'formation-1', coaches: [] } as never;

    it('Field tab renders 12 columns including the 4 new Shot columns with dash-for-zero', async () => {
      mockKeeperScenario();
      render(<TeamReport team={team} />);

      await waitFor(() => {
        expect(screen.getByRole('table', { name: 'Player season statistics' })).toBeInTheDocument();
      });

      const table = screen.getByRole('table', { name: 'Player season statistics' });
      const headerCells = within(table).getAllByRole('columnheader');
      expect(headerCells).toHaveLength(12);

      // Sam Lee (player-2) has 2 shots, 1 on target, 0 wide, 0 blocked -- expect dash for 0.
      const samRow = screen.getByText(/Sam Lee/).closest('tr')!;
      const cells = within(samRow).getAllByRole('cell');
      // last 4 cells are Shots/On Target/Wide/Blocked
      expect(cells.slice(-4).map(c => c.textContent)).toEqual(['2', '1', '-', '-']);
    });

    it('switching to the Goalkeeper tab changes aria-label and shows only keeper-experienced players', async () => {
      mockKeeperScenario();
      const user = userEvent.setup();
      render(<TeamReport team={team} />);

      await waitFor(() => {
        expect(screen.getByRole('table', { name: 'Player season statistics' })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('tab', { name: 'Goalkeeper' }));

      await waitFor(() => {
        expect(screen.getByRole('table', { name: 'Goalkeeper season statistics' })).toBeInTheDocument();
      });

      const table = screen.getByRole('table', { name: 'Goalkeeper season statistics' });
      expect(within(table).getByText(/Casey Keeper/)).toBeInTheDocument();
      expect(within(table).queryByText(/Sam Lee/)).not.toBeInTheDocument();
    });

    it('shows Saves=3, GA=1, Save%=75% for a keeper-experienced player, real zeros not dashes for a shutout', async () => {
      mockKeeperScenario();
      const user = userEvent.setup();
      render(<TeamReport team={team} />);

      await waitFor(() => {
        expect(screen.getByRole('table', { name: 'Player season statistics' })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('tab', { name: 'Goalkeeper' }));

      await waitFor(() => {
        const table = screen.getByRole('table', { name: 'Goalkeeper season statistics' });
        const keeperRow = within(table).getByText(/Casey Keeper/).closest('tr')!;
        const cells = within(keeperRow).getAllByRole('cell');
        // Last 3 cells are Saves, Goals Against, Save %
        expect(cells.slice(-3).map(c => c.textContent)).toEqual(['3', '1', '75%']);
      });
    });

    it('a non-keeper player is entirely absent from the Goalkeeper tab rows', async () => {
      mockKeeperScenario();
      const user = userEvent.setup();
      render(<TeamReport team={team} />);

      await waitFor(() => {
        expect(screen.getByRole('table', { name: 'Player season statistics' })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('tab', { name: 'Goalkeeper' }));

      await waitFor(() => {
        const table = screen.getByRole('table', { name: 'Goalkeeper season statistics' });
        expect(within(table).queryByText(/Sam Lee/)).not.toBeInTheDocument();
      });
    });

    it('shows — for Save % when a keeper-experienced player has saves + goalsAgainst === 0', async () => {
      mockKeeperScenario();
      mockGoalList.mockResolvedValue({ data: [], nextToken: null });
      mockSaveList.mockResolvedValue({ data: [], nextToken: null });

      const user = userEvent.setup();
      render(<TeamReport team={team} />);

      await waitFor(() => {
        expect(screen.getByRole('table', { name: 'Player season statistics' })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('tab', { name: 'Goalkeeper' }));

      await waitFor(() => {
        const table = screen.getByRole('table', { name: 'Goalkeeper season statistics' });
        const keeperRow = within(table).getByText(/Casey Keeper/).closest('tr')!;
        const cells = within(keeperRow).getAllByRole('cell');
        expect(cells.slice(-3).map(c => c.textContent)).toEqual(['0', '0', '—']);
      });
    });

    it('shows the Goalkeeper-tab empty state when no roster player has ever played keeper', async () => {
      // No FormationPosition GOALKEEPER role at all. Data arrays hoisted to
      // stable references (see mockKeeperScenario's comment above).
      const rosterData = [{ id: 'roster-1', teamId: 'team-1', playerId: 'player-1', playerNumber: 10 }];
      const playerData = [{ id: 'player-1', firstName: 'Sam', lastName: 'Lee' }];
      const gameData = [{ id: 'game-1', teamId: 'team-1', status: 'completed', elapsedSeconds: 600, ourScore: 1, opponentScore: 0, gameDate: '2030-06-01', opponent: 'Rivals' }];
      const emptyData: unknown[] = [];

      mockUseAmplifyQuery.mockImplementation((modelName: string) => {
        if (modelName === 'TeamRoster') return { data: rosterData, isSynced: true };
        if (modelName === 'Player') return { data: playerData, isSynced: true };
        if (modelName === 'Game') return { data: gameData, isSynced: true };
        return { data: emptyData, isSynced: true };
      });

      const user = userEvent.setup();
      render(<TeamReport team={{ id: 'team-1', name: 'Tigers', coaches: [] } as never} />);

      await waitFor(() => {
        expect(screen.getByRole('table', { name: 'Player season statistics' })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('tab', { name: 'Goalkeeper' }));

      await waitFor(() => {
        expect(screen.getByText('No players have logged goalkeeper time yet.')).toBeInTheDocument();
      });
    });

    it('Total Saves summary card sums across keepers and shows/hides the unattributed line correctly', async () => {
      mockKeeperScenario();
      render(<TeamReport team={team} />);

      await waitFor(() => {
        expect(screen.getByText('🧤 Total Saves')).toBeInTheDocument();
      });

      // 2 explicit + 1 fallback-resolved save, all attributed to player-1.
      const savesCard = screen.getByText('🧤 Total Saves').closest('.summary-card')!;
      expect(within(savesCard).getByText('3')).toBeInTheDocument();
      expect(within(savesCard).queryByText(/with no keeper on record/)).not.toBeInTheDocument();
    });

    it('shows a correctly-pluralized "+N with no keeper on record" line when unattributedCount > 0', async () => {
      mockKeeperScenario();
      mockSaveList.mockResolvedValue({
        data: [
          { id: 'save-1', gameId: 'game-1', playerId: null, byUs: true, gameSeconds: 9999, half: 1 },
          { id: 'save-2', gameId: 'game-1', playerId: null, byUs: true, gameSeconds: 9998, half: 1 },
        ],
        nextToken: null,
      });

      render(<TeamReport team={team} />);

      await waitFor(() => {
        expect(screen.getByText('🧤 Total Saves')).toBeInTheDocument();
      });

      const savesCard = screen.getByText('🧤 Total Saves').closest('.summary-card')!;
      expect(within(savesCard).getByText('+2 saves with no keeper on record')).toBeInTheDocument();
    });

    it('drill-down for a keeper-experienced player shows the keeper breakout card above Play Time by Position', async () => {
      mockKeeperScenario();
      render(<TeamReport team={team} />);

      await waitFor(() => {
        expect(screen.getByText(/Casey Keeper/)).toBeInTheDocument();
      });

      await userEvent.setup().click(screen.getByText(/Casey Keeper/).closest('tr')!);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Goalkeeper Stats/i })).toBeInTheDocument();
      });

      const cards = document.querySelectorAll('.details-card');
      expect(cards[0]).toHaveClass('keeper-breakout-card');
    });

    it('drill-down for a non-keeper player shows NO keeper breakout card', async () => {
      mockKeeperScenario();
      render(<TeamReport team={team} />);

      await waitFor(() => {
        expect(screen.getByText(/Sam Lee/)).toBeInTheDocument();
      });

      await userEvent.setup().click(screen.getByText(/Sam Lee/).closest('tr')!);

      await waitFor(() => {
        expect(document.querySelector('.player-details-section')).toBeInTheDocument();
      });

      expect(screen.queryByRole('heading', { name: /Goalkeeper Stats/i })).not.toBeInTheDocument();
    });

    it('drill-down section ordering: keeper breakout -> Play Time -> Goals & Assists -> Saves -> Shots -> Goals -> Assists -> Stars -> Yellow -> Red', async () => {
      mockKeeperScenario();
      // Give the keeper an explicit goal and a gold star too, so every card renders.
      mockGoalList.mockResolvedValue({
        data: [
          { id: 'goal-1', gameId: 'game-1', scoredByUs: false, gameSeconds: 500, half: 1 },
          { id: 'goal-2', gameId: 'game-1', scoredByUs: true, scorerId: 'player-1', gameSeconds: 800, half: 1 },
        ],
        nextToken: null,
      });
      mockGameNoteList.mockResolvedValue({
        data: [{ id: 'note-1', gameId: 'game-1', playerId: 'player-1', noteType: 'gold-star', gameSeconds: 850, half: 1 }],
        nextToken: null,
      });
      // Give the keeper a shot too (e.g. an outfield sub appearance) so the
      // Shots card renders for this player alongside Saves.
      mockShotList.mockResolvedValue({
        data: [{ id: 'shot-1', gameId: 'game-1', playerId: 'player-1', takenByUs: true, outcome: 'WIDE', gameSeconds: 850, half: 1 }],
        nextToken: null,
      });

      render(<TeamReport team={team} />);

      await waitFor(() => {
        expect(screen.getByText(/Casey Keeper/)).toBeInTheDocument();
      });

      await userEvent.setup().click(screen.getByText(/Casey Keeper/).closest('tr')!);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Goalkeeper Stats/i })).toBeInTheDocument();
      });

      const headings = Array.from(document.querySelectorAll('.details-card h3')).map(h => h.textContent);
      const savesIdx = headings.findIndex(h => h?.includes('Saves'));
      const shotsIdx = headings.findIndex(h => h?.includes('Shots'));
      const goalsIdx = headings.findIndex(h => h?.startsWith('⚽ Goals ('));
      const goldStarIdx = headings.findIndex(h => h?.includes('Gold Stars'));

      expect(headings[0]).toContain('Goalkeeper Stats');
      expect(headings[1]).toContain('Play Time by Position');
      expect(headings[2]).toContain('Goals & Assists by Position');
      expect(savesIdx).toBeLessThan(shotsIdx);
      expect(shotsIdx).toBeLessThan(goalsIdx);
      expect(goalsIdx).toBeLessThan(goldStarIdx);
    });

    it('Saves list in one player drill-down never includes a save attributed to a different player', async () => {
      // Two keepers, each with their own attributed save. Data arrays hoisted
      // to stable references (see mockKeeperScenario's comment above).
      const rosterData = [
        { id: 'roster-1', teamId: 'team-1', playerId: 'player-1', playerNumber: 1 },
        { id: 'roster-2', teamId: 'team-1', playerId: 'player-3', playerNumber: 2 },
      ];
      const playerData = [
        { id: 'player-1', firstName: 'Casey', lastName: 'Keeper' },
        { id: 'player-3', firstName: 'Jordan', lastName: 'Backup' },
      ];
      const gameData = [{ id: 'game-1', teamId: 'team-1', status: 'completed', elapsedSeconds: 2700, ourScore: 0, opponentScore: 0, gameDate: '2030-06-01', opponent: 'Rivals' }];
      const fieldPositionData: unknown[] = [];
      const formationPositionData = [{ id: 'form-gk', positionName: 'Goalkeeper', sortOrder: 0, role: 'GOALKEEPER' }];
      const emptyData: unknown[] = [];

      mockUseAmplifyQuery.mockImplementation((modelName: string) => {
        if (modelName === 'TeamRoster') return { data: rosterData, isSynced: true };
        if (modelName === 'Player') return { data: playerData, isSynced: true };
        if (modelName === 'Game') return { data: gameData, isSynced: true };
        if (modelName === 'FieldPosition') return { data: fieldPositionData, isSynced: true };
        if (modelName === 'FormationPosition') return { data: formationPositionData, isSynced: true };
        return { data: emptyData, isSynced: true };
      });

      mockPlayTimeByGame.mockResolvedValue({
        data: [
          { id: 'ptr-1', playerId: 'player-1', gameId: 'game-1', positionId: 'form-gk', startGameSeconds: 0, endGameSeconds: 1000 },
          { id: 'ptr-2', playerId: 'player-3', gameId: 'game-1', positionId: 'form-gk', startGameSeconds: 1000, endGameSeconds: 2700 },
        ],
        nextToken: null,
      });
      mockGoalList.mockResolvedValue({ data: [], nextToken: null });
      mockGameNoteList.mockResolvedValue({ data: [], nextToken: null });
      mockShotList.mockResolvedValue({ data: [], nextToken: null });
      mockSaveList.mockResolvedValue({
        data: [
          { id: 'save-a', gameId: 'game-1', playerId: null, byUs: true, gameSeconds: 500, half: 1 },
          { id: 'save-b', gameId: 'game-1', playerId: null, byUs: true, gameSeconds: 1500, half: 1 },
        ],
        nextToken: null,
      });

      render(<TeamReport team={{ id: 'team-1', name: 'Tigers', formationId: 'formation-1', coaches: [] } as never} />);

      await waitFor(() => {
        expect(screen.getByText(/Casey Keeper/)).toBeInTheDocument();
      });

      await userEvent.setup().click(screen.getByText(/Casey Keeper/).closest('tr')!);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Saves \(1\)/i })).toBeInTheDocument();
      });
    });

    it('Shots list shows the correct outcome label per shot, including the null-outcome case', async () => {
      mockKeeperScenario();
      render(<TeamReport team={team} />);

      await waitFor(() => {
        expect(screen.getByText(/Sam Lee/)).toBeInTheDocument();
      });

      await userEvent.setup().click(screen.getByText(/Sam Lee/).closest('tr')!);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Shots \(2\)/i })).toBeInTheDocument();
      });

      expect(screen.getByText(/Goal$/)).toBeInTheDocument();
      expect(screen.getByText(/Outcome not recorded$/)).toBeInTheDocument();
    });

    it('a Shot/Save fetch failure does not blank the rest of the report', async () => {
      mockKeeperScenario();
      mockShotList.mockRejectedValue(new Error('network error'));
      mockSaveList.mockRejectedValue(new Error('network error'));

      render(<TeamReport team={team} />);

      await waitFor(() => {
        expect(screen.getByText('Season Report: Tigers')).toBeInTheDocument();
        expect(screen.getByText(/Casey Keeper/)).toBeInTheDocument();
        expect(screen.getByText(/Sam Lee/)).toBeInTheDocument();
      });
    });
  });
});
