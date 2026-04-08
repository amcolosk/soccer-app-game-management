import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  mockSetDebugContext,
  mockSetHelpContext,
  mockConfirm,
  mockPlayers,
  mockPositions,
  mockGamePlan,
  mockRotations,
  mockAmplifyQueryResult,
  setMockGamePlans,
  setMockRotations,
} = vi.hoisted(() => ({
  mockSetDebugContext: vi.fn(),
  mockSetHelpContext: vi.fn(),
  mockConfirm: vi.fn().mockResolvedValue(true),
  mockPlayers: [
    {
      id: 'player-1',
      firstName: 'Alex',
      lastName: 'Stone',
      playerNumber: 9,
      preferredPositions: '',
    },
    {
      id: 'player-2',
      firstName: 'Blair',
      lastName: 'Reed',
      playerNumber: 10,
      preferredPositions: '',
    },
    {
      id: 'player-3',
      firstName: 'Casey',
      lastName: 'Shaw',
      playerNumber: 11,
      preferredPositions: '',
    },
  ],
  mockPositions: [
    { id: 'pos-1', abbreviation: 'GK', positionName: 'Goalkeeper' },
    { id: 'pos-2', abbreviation: 'CB', positionName: 'Center Back' },
  ],
  mockGamePlan: {
    id: 'plan-1',
    gameId: 'game-1',
    rotationIntervalMinutes: 10,
    startingLineup: JSON.stringify([
      { positionId: 'pos-1', playerId: 'player-1' },
      { positionId: 'pos-2', playerId: 'player-2' },
    ]),
    halftimeLineup: null,
  },
  mockRotations: [
    {
      id: 'rotation-1',
      gamePlanId: 'plan-1',
      rotationNumber: 1,
      gameMinute: 10,
      half: 1,
      plannedSubstitutions: JSON.stringify([
        { playerOutId: 'player-2', playerInId: 'player-3', positionId: 'pos-2' },
      ]),
    },
  ],
  mockAmplifyQueryResult: {
    data: [],
    isSynced: true,
  },
  setMockGamePlans: (() => {
    const subscribers = new Set<(result: { items: unknown[]; isSynced?: boolean }) => void>();
    let items = [] as unknown[];

    const cloneItems = (nextItems: unknown[]) => nextItems.map((item) => ({ ...(item as Record<string, unknown>) }));
    const emit = () => {
      const snapshot = cloneItems(items);
      subscribers.forEach((next) => next({ items: snapshot, isSynced: true }));
    };

    const setter = (nextItems: unknown[]) => {
      items = cloneItems(nextItems);
    };

    Object.assign(setter, {
      emit,
      subscribe: (next: (result: { items: unknown[]; isSynced?: boolean }) => void) => {
        subscribers.add(next);
        next({ items: cloneItems(items), isSynced: true });
        return () => subscribers.delete(next);
      },
      reset: () => {
        subscribers.clear();
        items = [];
      },
    });

    return setter;
  })(),
  setMockRotations: (() => {
    const subscribers = new Set<(result: { items: unknown[]; isSynced?: boolean }) => void>();
    let items = [] as unknown[];

    const cloneItems = (nextItems: unknown[]) => nextItems.map((item) => ({ ...(item as Record<string, unknown>) }));
    const emit = () => {
      const snapshot = cloneItems(items);
      subscribers.forEach((next) => next({ items: snapshot, isSynced: true }));
    };

    const setter = (nextItems: unknown[]) => {
      items = cloneItems(nextItems);
    };

    Object.assign(setter, {
      emit,
      subscribe: (next: (result: { items: unknown[]; isSynced?: boolean }) => void) => {
        subscribers.add(next);
        next({ items: cloneItems(items), isSynced: true });
        return () => subscribers.delete(next);
      },
      reset: () => {
        subscribers.clear();
        items = [];
      },
    });

    return setter;
  })(),
}));

const emitGamePlans = (setMockGamePlans as typeof setMockGamePlans & { emit: () => void }).emit;
const emitRotations = (setMockRotations as typeof setMockRotations & { emit: () => void }).emit;
const subscribeToGamePlans = (setMockGamePlans as typeof setMockGamePlans & {
  subscribe: (next: (result: { items: unknown[]; isSynced?: boolean }) => void) => () => void;
}).subscribe;
const subscribeToRotations = (setMockRotations as typeof setMockRotations & {
  subscribe: (next: (result: { items: unknown[]; isSynced?: boolean }) => void) => () => void;
}).subscribe;
const resetSubscriptions = () => {
  (setMockGamePlans as typeof setMockGamePlans & { reset: () => void }).reset();
  (setMockRotations as typeof setMockRotations & { reset: () => void }).reset();
};

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      GamePlan: {
        observeQuery: vi.fn(() => ({
          subscribe: ({ next }: { next: (result: { items: unknown[]; isSynced?: boolean }) => void }) => ({
            unsubscribe: subscribeToGamePlans(next),
          }),
        })),
        list: vi.fn().mockResolvedValue({ data: [mockGamePlan] }),
        update: vi.fn().mockResolvedValue({ data: mockGamePlan }),
        create: vi.fn().mockResolvedValue({ data: mockGamePlan }),
        delete: vi.fn().mockResolvedValue({ data: {} }),
      },
      PlannedRotation: {
        observeQuery: vi.fn(() => ({
          subscribe: ({ next }: { next: (result: { items: unknown[]; isSynced?: boolean }) => void }) => ({
            unsubscribe: subscribeToRotations(next),
          }),
        })),
        update: vi.fn().mockResolvedValue({ data: mockRotations[0] }),
        create: vi.fn().mockResolvedValue({ data: mockRotations[0] }),
        delete: vi.fn().mockResolvedValue({ data: {} }),
      },
      Game: {
        list: vi.fn().mockResolvedValue({ data: [] }),
        update: vi.fn().mockResolvedValue({ data: {} }),
      },
    },
  }),
}));

vi.mock('../hooks/useTeamData', () => ({
  useTeamData: vi.fn(() => ({
    players: mockPlayers,
    positions: mockPositions,
  })),
}));

vi.mock('../hooks/useAmplifyQuery', () => ({
  useAmplifyQuery: vi.fn(() => mockAmplifyQueryResult),
}));

vi.mock('../hooks/useTeamCoachProfiles', () => ({
  useTeamCoachProfiles: vi.fn(() => ({
    profileMap: new Map(),
  })),
}));

vi.mock('../hooks/useOfflineMutations', () => ({
  useOfflineMutations: vi.fn(() => ({
    mutations: {
      createGameNote: vi.fn(),
      updateGameNote: vi.fn(),
      deleteGameNote: vi.fn(),
    },
  })),
}));

vi.mock('../contexts/HelpFabContext', () => ({
  useHelpFab: vi.fn(() => ({
    setDebugContext: mockSetDebugContext,
    setHelpContext: mockSetHelpContext,
  })),
}));

vi.mock('../contexts/AvailabilityContext', () => ({
  AvailabilityProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('./ConfirmModal', () => ({
  useConfirm: () => mockConfirm,
}));

vi.mock('./LineupBuilder', () => ({
  LineupBuilder: () => <div data-testid="lineup-builder" />,
}));

vi.mock('./PlayerAvailabilityGrid', () => ({
  PlayerAvailabilityGrid: () => <div data-testid="player-availability-grid" />,
}));

vi.mock('../utils/gamePlannerDebugUtils', () => ({
  buildDebugSnapshot: vi.fn(() => 'debug-snapshot'),
}));

vi.mock('../utils/toast', () => ({
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
}));

vi.mock('../utils/errorHandler', () => ({
  handleApiError: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../utils/analytics', () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: {
    PLAN_SAVED: { category: 'plan', action: 'saved' },
    AUTO_GENERATE_ROTATIONS: { category: 'plan', action: 'auto-generate' },
    COPY_PLAN_FROM_GAME: { category: 'plan', action: 'copy' },
  },
}));

vi.mock('../services/rotationPlannerService', () => ({
  calculatePlayTime: vi.fn(() => new Map()),
  calculateFairRotations: vi.fn(() => ({ rotations: [], warnings: [] })),
  copyGamePlan: vi.fn().mockResolvedValue(undefined),
}));

import { GamePlanner, type RotationTimelineItem } from './GamePlanner';
import { reconcileSelectionKey } from '../utils/gamePlannerTimeline';

function renderGamePlanner() {
  return render(
    <GamePlanner
      game={{ id: 'game-1', opponent: 'Rivals FC', halfLengthMinutes: 30 } as never}
      team={{
        id: 'team-1',
        formationId: 'formation-1',
        coaches: ['coach-1'],
        halfLengthMinutes: 30,
        maxPlayersOnField: 2,
      } as never}
      onBack={vi.fn()}
    />,
  );
}

describe('GamePlanner timeline interaction', () => {
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSubscriptions();
    setMockGamePlans([mockGamePlan]);
    setMockRotations(mockRotations);
    originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('defaults to Start selected and renders lineup editor inline without a Lineup tab', async () => {
    const user = userEvent.setup();

    renderGamePlanner();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Rotations/i })).toHaveAttribute('aria-selected', 'true');
    });

    const startPill = await screen.findByRole('tab', { name: 'Start' });
    expect(startPill).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: /Lineup/i })).not.toBeInTheDocument();

    expect(await screen.findByRole('heading', { name: 'Starting Lineup' })).toBeInTheDocument();
    expect(screen.getByTestId('lineup-builder')).toBeInTheDocument();

    await user.click(startPill);
    expect(startPill).toHaveAttribute('aria-selected', 'true');
  });

  it('moves selection with keyboard arrows and keeps focus on selected pill', async () => {
    const user = userEvent.setup();

    renderGamePlanner();

    const startPill = await screen.findByRole('tab', { name: 'Start' });
    startPill.focus();
    await user.keyboard('{ArrowRight}');

    const halftimePill = screen.getByRole('tab', { name: 'HT' });
    expect(halftimePill).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(halftimePill);
    expect(screen.getByRole('heading', { name: 'Halftime Lineup' })).toBeInTheDocument();

    await user.keyboard('{ArrowRight}');
    const rotationOnePill = screen.getByRole('tab', { name: /^R1/ });
    expect(rotationOnePill).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(rotationOnePill);
    expect(screen.getByRole('heading', { name: /Rotation 1/ })).toBeInTheDocument();

    await user.keyboard('{Home}');
    expect(startPill).toHaveAttribute('aria-selected', 'true');
  });

  it('mounts details for all selectable pre-plan pills, including numbered rotations', async () => {
    const user = userEvent.setup();
    setMockGamePlans([]);
    setMockRotations([]);

    renderGamePlanner();

    const startPill = await screen.findByRole('tab', { name: 'Start' });
    const rotationOnePill = await screen.findByRole('tab', { name: 'R1' });
    const halftimePill = await screen.findByRole('tab', { name: 'HT' });

    expect(startPill).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: 'Starting Lineup' })).toBeInTheDocument();

    await user.click(rotationOnePill);
    expect(rotationOnePill).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: /Rotation 1/ })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();

    await user.click(halftimePill);

    expect(halftimePill).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Halftime Lineup' })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
  });

  it('preserves halftime selection when the timeline transitions from pre-plan to persisted items', async () => {
    const user = userEvent.setup();
    setMockGamePlans([]);
    setMockRotations([]);

    renderGamePlanner();

    const halftimePill = await screen.findByRole('tab', { name: 'HT' });
    await user.click(halftimePill);
    expect(screen.getByRole('heading', { name: 'Halftime Lineup' })).toBeInTheDocument();

    await act(async () => {
      setMockGamePlans([mockGamePlan]);
      setMockRotations(mockRotations);
      emitGamePlans();
      emitRotations();
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'HT' })).toHaveAttribute('aria-selected', 'true');
    });
    expect(screen.getByRole('heading', { name: 'Halftime Lineup' })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
  });

  it('reconciles selection by rotation-number semantic identity when persisted keys change', () => {
    const persistedTimeline: RotationTimelineItem[] = [
      {
        key: 'starting',
        label: 'Start',
        selection: 'starting',
        substitutionsCount: 0,
        variant: 'starting',
      },
      {
        key: 'rotation-1-rotation-1-reloaded',
        label: 'R1',
        selection: 1,
        substitutionsCount: 1,
        variant: 'rotation',
      },
      {
        key: 'halftime-rotation-3',
        label: 'HT',
        selection: 'halftime',
        substitutionsCount: 0,
        variant: 'halftime',
      },
    ];

    expect(reconcileSelectionKey(persistedTimeline, 'rotation-1-10-synthetic')).toBe('rotation-1-rotation-1-reloaded');
    expect(reconcileSelectionKey(persistedTimeline, 'rotation-1')).toBe('rotation-1-rotation-1-reloaded');

    const syntheticTimeline: RotationTimelineItem[] = [
      {
        key: 'starting',
        label: 'Start',
        selection: 'starting',
        substitutionsCount: 0,
        variant: 'starting',
      },
      {
        key: 'rotation-1-10-synthetic',
        label: 'R1',
        selection: 1,
        substitutionsCount: 0,
        variant: 'rotation',
      },
      {
        key: 'halftime-2-20',
        label: 'HT',
        selection: 'halftime',
        substitutionsCount: 0,
        variant: 'halftime',
      },
    ];

    expect(reconcileSelectionKey(syntheticTimeline, 'rotation-1-rotation-1-reloaded')).toBe('rotation-1-10-synthetic');
  });

  describe('planner controls and plan display', () => {
    it('interval input renders with accessible label', async () => {
      setMockGamePlans([]);
      setMockRotations([]);

      renderGamePlanner();

      expect(
        await screen.findByRole('spinbutton', { name: /Rotation interval in minutes/i }),
      ).toBeInTheDocument();
    });

    it('shows "Create Game Plan" button before any plan exists', async () => {
      setMockGamePlans([]);
      setMockRotations([]);

      renderGamePlanner();

      expect(
        await screen.findByRole('button', { name: /Create Game Plan/i }),
      ).toBeInTheDocument();
    });

    it('shows "Update Plan" button when a game plan already exists', async () => {
      // beforeEach already seeds mockGamePlan + mockRotations
      renderGamePlanner();

      expect(
        await screen.findByRole('button', { name: /Update Plan/i }),
      ).toBeInTheDocument();
    });

    it('Copy from Previous button is visible in rotation detail panel when rotations exist', async () => {
      const user = userEvent.setup();
      // beforeEach already seeds mockGamePlan + mockRotations
      renderGamePlanner();

      const rotationOnePill = await screen.findByRole('tab', { name: /^R1/ });
      await user.click(rotationOnePill);

      expect(
        screen.getByRole('button', { name: /Reset to Previous Lineup/i }),
      ).toBeInTheDocument();
    });

    it('Projected Play Time section renders when plan data exists', async () => {
      // beforeEach already seeds mockGamePlan + mockRotations
      renderGamePlanner();

      expect(await screen.findByText(/Projected Play Time/i)).toBeInTheDocument();
    });

    it('rotation detail panel shows substitution display when rotation has planned subs', async () => {
      const user = userEvent.setup();
      // beforeEach already seeds mockGamePlan + mockRotations; mockRotations[0] has one planned sub
      renderGamePlanner();

      const rotationOnePill = await screen.findByRole('tab', { name: /^R1/ });
      await user.click(rotationOnePill);

      await screen.findByRole('heading', { name: /Rotation 1/i });
      expect(screen.getByText(/Planned Substitutions/i)).toBeInTheDocument();
    });
  });
});