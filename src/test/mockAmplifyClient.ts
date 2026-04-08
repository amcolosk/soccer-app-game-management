import { vi } from 'vitest';
import type { ManagementQueryFixtures } from './fixtures/managementFixtures';

const state = vi.hoisted(() => {
  const modelMocks = {
    Team: {
      create: vi.fn().mockResolvedValue({ data: { id: 'team-created' } }),
      update: vi.fn().mockResolvedValue({ data: { id: 'team-updated' } }),
      list: vi.fn().mockResolvedValue({ data: [] }),
    },
    Player: {
      create: vi.fn().mockResolvedValue({ data: { id: 'player-created' } }),
      update: vi.fn().mockResolvedValue({ data: { id: 'player-updated' } }),
      list: vi.fn().mockResolvedValue({ data: [] }),
    },
    TeamRoster: {
      create: vi.fn().mockResolvedValue({ data: { id: 'roster-created' } }),
      update: vi.fn().mockResolvedValue({ data: { id: 'roster-updated' } }),
      delete: vi.fn().mockResolvedValue({}),
      list: vi.fn().mockResolvedValue({ data: [] }),
    },
    Formation: {
      create: vi.fn().mockResolvedValue({ data: { id: 'formation-created' } }),
      update: vi.fn().mockResolvedValue({ data: { id: 'formation-updated' } }),
      list: vi.fn().mockResolvedValue({ data: [] }),
    },
    FormationPosition: {
      create: vi.fn().mockResolvedValue({ data: { id: 'position-created' } }),
      update: vi.fn().mockResolvedValue({ data: { id: 'position-updated' } }),
      delete: vi.fn().mockResolvedValue({}),
      list: vi.fn().mockResolvedValue({ data: [] }),
    },
  };

  const queryData: ManagementQueryFixtures = {
    Team: [],
    Player: [],
    TeamRoster: [],
    Formation: [],
    FormationPosition: [],
  };

  return {
    modelMocks,
    queryData,
    helpFab: {
      setHelpContext: vi.fn(),
      setDebugContext: vi.fn(),
    },
    confirm: vi.fn().mockResolvedValue(true),
    swipe: {
      swipedItemId: null as string | null,
      close: vi.fn(),
      getSwipeProps: vi.fn().mockReturnValue({}),
      getSwipeStyle: vi.fn().mockReturnValue({}),
    },
    cascade: {
      deleteTeamCascade: vi.fn().mockResolvedValue(undefined),
      deletePlayerCascade: vi.fn().mockResolvedValue(undefined),
      deleteFormationCascade: vi.fn().mockResolvedValue(undefined),
      getPlayerImpact: vi.fn().mockResolvedValue({ playTimeCount: 0, goalCount: 0, noteCount: 0 }),
    },
    toast: {
      showError: vi.fn(),
      showWarning: vi.fn(),
      showSuccess: vi.fn(),
    },
    error: {
      handleApiError: vi.fn(),
      logError: vi.fn(),
    },
  };
});

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: state.modelMocks,
  })),
}));

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ userId: 'test-user-id' }),
}));

vi.mock('../hooks/useAmplifyQuery', () => ({
  useAmplifyQuery: vi.fn((modelName: keyof ManagementQueryFixtures) => ({
    data: state.queryData[modelName] ?? [],
  })),
}));

vi.mock('../contexts/HelpFabContext', () => ({
  useHelpFab: () => ({
    setHelpContext: state.helpFab.setHelpContext,
    setDebugContext: state.helpFab.setDebugContext,
    helpContext: null,
    debugContext: null,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock('../components/ConfirmModal', () => ({
  useConfirm: vi.fn(() => state.confirm),
}));

vi.mock('../hooks/useSwipeDelete', () => ({
  useSwipeDelete: vi.fn(() => ({
    getSwipeProps: state.swipe.getSwipeProps,
    getSwipeStyle: state.swipe.getSwipeStyle,
    close: state.swipe.close,
    swipedItemId: state.swipe.swipedItemId,
  })),
}));

vi.mock('../components/InvitationManagement', () => ({
  InvitationManagement: () => null,
}));

vi.mock('../services/cascadeDeleteService', () => ({
  deleteTeamCascade: state.cascade.deleteTeamCascade,
  deletePlayerCascade: state.cascade.deletePlayerCascade,
  deleteFormationCascade: state.cascade.deleteFormationCascade,
  getPlayerImpact: state.cascade.getPlayerImpact,
}));

vi.mock('../services/demoDataService', () => ({
  removeDemoData: vi.fn(),
}));

vi.mock('../utils/debugUtils', () => ({
  buildFlatDebugSnapshot: vi.fn().mockReturnValue({}),
}));

vi.mock('../utils/analytics', () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: {
    TEAM_CREATED: { category: 'test', action: 'test' },
    TEAM_DELETED: { category: 'test', action: 'test' },
    PLAYER_ADDED: { category: 'test', action: 'test' },
    PLAYER_ADDED_TO_ROSTER: { category: 'test', action: 'test' },
    PLAYER_DELETED: { category: 'test', action: 'test' },
    FORMATION_CREATED: { category: 'test', action: 'test' },
    FORMATION_DELETED: { category: 'test', action: 'test' },
  },
}));

vi.mock('../utils/errorHandler', () => ({
  handleApiError: state.error.handleApiError,
  logError: state.error.logError,
}));

vi.mock('../utils/toast', () => ({
  showError: state.toast.showError,
  showWarning: state.toast.showWarning,
  showSuccess: state.toast.showSuccess,
}));

export const managementModelMocks = state.modelMocks;
export const managementUiMocks = {
  helpFab: state.helpFab,
  confirm: state.confirm,
  swipe: state.swipe,
  cascade: state.cascade,
  toast: state.toast,
  error: state.error,
};

export function setAmplifyQueryData(data: Partial<ManagementQueryFixtures>) {
  state.queryData.Team = data.Team ?? [];
  state.queryData.Player = data.Player ?? [];
  state.queryData.TeamRoster = data.TeamRoster ?? [];
  state.queryData.Formation = data.Formation ?? [];
  state.queryData.FormationPosition = data.FormationPosition ?? [];
}

export function setConfirmResult(value: boolean) {
  state.confirm.mockResolvedValue(value);
}

export function setSwipedItemId(value: string | null) {
  state.swipe.swipedItemId = value;
}

export function resetManagementHarness() {
  vi.clearAllMocks();
  setAmplifyQueryData({
    Team: [],
    Player: [],
    TeamRoster: [],
    Formation: [],
    FormationPosition: [],
  });
  state.confirm.mockResolvedValue(true);
  state.swipe.swipedItemId = null;
  state.modelMocks.Team.create.mockResolvedValue({ data: { id: 'team-created' } });
  state.modelMocks.Formation.create.mockResolvedValue({ data: { id: 'formation-created' } });
  state.modelMocks.FormationPosition.create.mockResolvedValue({ data: { id: 'position-created' } });
}
