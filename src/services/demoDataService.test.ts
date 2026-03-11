import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDemoTeam, removeDemoData } from './demoDataService';

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const {
  mockTeamCreate,
  mockTeamGet,
  mockPlayerCreate,
  mockTeamRosterCreate,
  mockTeamRosterList,
  mockGameCreate,
  mockDeleteTeamCascade,
  mockDeletePlayerCascade,
  mockTrackEvent,
} = vi.hoisted(() => ({
  mockTeamCreate: vi.fn(),
  mockTeamGet: vi.fn(),
  mockPlayerCreate: vi.fn(),
  mockTeamRosterCreate: vi.fn(),
  mockTeamRosterList: vi.fn(),
  mockGameCreate: vi.fn(),
  mockDeleteTeamCascade: vi.fn(),
  mockDeletePlayerCascade: vi.fn(),
  mockTrackEvent: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      Team: {
        create: mockTeamCreate,
        get: mockTeamGet,
      },
      Player: {
        create: mockPlayerCreate,
      },
      TeamRoster: {
        create: mockTeamRosterCreate,
        list: mockTeamRosterList,
      },
      Game: {
        create: mockGameCreate,
      },
    },
  })),
}));

vi.mock('./cascadeDeleteService', () => ({
  deleteTeamCascade: mockDeleteTeamCascade,
  deletePlayerCascade: mockDeletePlayerCascade,
}));

vi.mock('../utils/analytics', () => ({
  trackEvent: mockTrackEvent,
  AnalyticsEvents: {
    DEMO_TEAM_CREATED: { category: 'Onboarding', action: 'Demo Team Created' },
    DEMO_TEAM_REMOVED: { category: 'Onboarding', action: 'Demo Team Removed' },
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('demoDataService', () => {
  let localStorageMock: { [key: string]: string } = {};
  let navigatorOnlineSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock = {};

    // Mock localStorage
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => localStorageMock[key] ?? null,
      setItem: (key: string, value: string) => {
        localStorageMock[key] = value;
      },
      removeItem: (key: string) => {
        delete localStorageMock[key];
      },
    });

    // Default to online
    navigatorOnlineSpy = vi.spyOn(navigator, 'onLine', 'get');
    navigatorOnlineSpy.mockReturnValue(true);

    // Default success responses
    mockTeamCreate.mockResolvedValue({ data: { id: 'team-demo' } });
    mockPlayerCreate.mockResolvedValue({ data: { id: 'player-1' } });
    mockTeamRosterCreate.mockResolvedValue({ data: { id: 'roster-1' } });
    mockGameCreate.mockResolvedValue({ data: { id: 'game-1' } });
    mockTeamGet.mockResolvedValue({
      data: { id: 'team-demo', name: 'Eagles Demo' },
    });
    mockTeamRosterList.mockResolvedValue({ data: [], nextToken: null });
    mockDeleteTeamCascade.mockResolvedValue(undefined);
    mockDeletePlayerCascade.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('createDemoTeam', () => {
    it('throws when navigator.onLine is false', async () => {
      navigatorOnlineSpy.mockReturnValue(false);

      await expect(createDemoTeam('user-1')).rejects.toThrow(
        'Demo data requires an internet connection'
      );
    });

    it('returns early (no API calls) when demoTeamId already in localStorage', async () => {
      localStorageMock['onboarding:demoTeamId'] = 'existing-team';

      await createDemoTeam('user-1');

      expect(mockTeamCreate).not.toHaveBeenCalled();
    });

    it('calls Team.create without a formationId field', async () => {
      await createDemoTeam('user-1');

      const call = mockTeamCreate.mock.calls[0][0];
      expect(call).not.toHaveProperty('formationId');
      expect(call).toMatchObject({
        name: 'Eagles Demo',
        coaches: ['user-1'],
        maxPlayersOnField: 7,
        halfLengthMinutes: 30,
        sport: 'Soccer',
        gameFormat: 'Halves',
      });
    });

    it('creates 12 players with firstName only (empty lastName)', async () => {
      let playerCallCount = 0;
      mockPlayerCreate.mockImplementation(() => {
        playerCallCount++;
        return Promise.resolve({ data: { id: `player-${playerCallCount}` } });
      });

      await createDemoTeam('user-1');

      expect(mockPlayerCreate).toHaveBeenCalledTimes(12);

      // Check all calls have firstName and empty lastName
      for (const call of mockPlayerCreate.mock.calls) {
        expect(call[0]).toMatchObject({
          lastName: '',
          coaches: ['user-1'],
        });
        expect(call[0].firstName).toBeTruthy();
      }
    });

    it('creates 12 TeamRoster entries with jersey numbers 1-12', async () => {
      let playerCallCount = 0;
      mockPlayerCreate.mockImplementation(() => {
        playerCallCount++;
        return Promise.resolve({ data: { id: `player-${playerCallCount}` } });
      });

      await createDemoTeam('user-1');

      expect(mockTeamRosterCreate).toHaveBeenCalledTimes(12);

      // Verify jersey numbers 1-12
      const jerseyNumbers = mockTeamRosterCreate.mock.calls.map(
        (call) => call[0].playerNumber
      );
      expect(jerseyNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    });

    it('creates 1 scheduled game dated ~3 days in the future', async () => {
      const now = Date.now();

      await createDemoTeam('user-1');

      expect(mockGameCreate).toHaveBeenCalledTimes(1);

      const call = mockGameCreate.mock.calls[0][0];
      expect(call).toMatchObject({
        teamId: 'team-demo',
        opponent: 'Lions',
        isHome: true,
        status: 'scheduled',
        coaches: ['user-1'],
      });

      const gameDate = new Date(call.gameDate).getTime();
      const threeDays = 3 * 24 * 60 * 60 * 1000;

      // Allow 10 seconds tolerance for test execution
      expect(gameDate).toBeGreaterThanOrEqual(now + threeDays - 10000);
      expect(gameDate).toBeLessThanOrEqual(now + threeDays + 10000);
    });

    it('stores the team ID in localStorage under demoTeamId', async () => {
      await createDemoTeam('user-1');

      expect(localStorageMock['onboarding:demoTeamId']).toBe('team-demo');
    });

    it('tracks analytics event', async () => {
      await createDemoTeam('user-1');

      expect(mockTrackEvent).toHaveBeenCalledWith('Onboarding', 'Demo Team Created');
    });

    it('cleans up partial data (calls delete) on API error', async () => {
      // First two player creates succeed, then third fails
      let playerCallCount = 0;
      mockPlayerCreate.mockImplementation(() => {
        playerCallCount++;
        if (playerCallCount <= 2) {
          return Promise.resolve({ data: { id: `player-${playerCallCount}` } });
        }
        return Promise.reject(new Error('Player create failed'));
      });

      await expect(createDemoTeam('user-1')).rejects.toThrow('Player create failed');

      // Verify cleanup was attempted
      expect(mockDeleteTeamCascade).toHaveBeenCalledWith('team-demo');
      expect(mockDeletePlayerCascade).toHaveBeenCalledTimes(2);
      expect(localStorageMock['onboarding:demoTeamId']).toBeUndefined();
    });
  });

  describe('removeDemoData', () => {
    beforeEach(() => {
      mockTeamRosterList.mockResolvedValue({
        data: [
          { playerId: 'player-1' },
          { playerId: 'player-2' },
          { playerId: 'player-3' },
        ],
        nextToken: null,
      });
    });

    it('calls deleteTeamCascade with the demo team ID', async () => {
      await removeDemoData('team-demo');

      expect(mockDeleteTeamCascade).toHaveBeenCalledWith('team-demo');
    });

    it('removes demoTeamId from localStorage', async () => {
      localStorageMock['onboarding:demoTeamId'] = 'team-demo';

      await removeDemoData('team-demo');

      expect(localStorageMock['onboarding:demoTeamId']).toBeUndefined();
    });

    it('tracks analytics event', async () => {
      await removeDemoData('team-demo');

      expect(mockTrackEvent).toHaveBeenCalledWith('Onboarding', 'Demo Team Removed');
    });

    it('throws and clears localStorage when target team name is not Eagles Demo', async () => {
      mockTeamGet.mockResolvedValue({
        data: { id: 'team-demo', name: 'Different Team' },
      });

      localStorageMock['onboarding:demoTeamId'] = 'team-demo';

      await expect(removeDemoData('team-demo')).rejects.toThrow(
        'Target team is not recognized as a demo team'
      );

      // Verify localStorage was cleaned up
      expect(localStorageMock['onboarding:demoTeamId']).toBeUndefined();
    });

    it('removes demoTeamId from localStorage even if deletion fails', async () => {
      localStorageMock['onboarding:demoTeamId'] = 'team-demo';
      mockDeleteTeamCascade.mockRejectedValue(new Error('Delete failed'));

      await expect(removeDemoData('team-demo')).rejects.toThrow('Delete failed');

      // localStorage still cleaned up
      expect(localStorageMock['onboarding:demoTeamId']).toBeUndefined();
    });

    it('calls deletePlayerCascade for each player in the roster', async () => {
      await removeDemoData('team-demo');

      expect(mockDeletePlayerCascade).toHaveBeenCalledTimes(3);
      expect(mockDeletePlayerCascade).toHaveBeenCalledWith('player-1');
      expect(mockDeletePlayerCascade).toHaveBeenCalledWith('player-2');
      expect(mockDeletePlayerCascade).toHaveBeenCalledWith('player-3');
    });
  });
});
