import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
}));

function createObserveQueryResult<T>(items: T[]) {
  return {
    subscribe: ({ next }: { next: (result: { items: T[]; isSynced?: boolean }) => void }) => {
      next({ items, isSynced: true });
      return { unsubscribe: vi.fn() };
    },
  };
}

vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      GamePlan: {
        observeQuery: vi.fn(() => createObserveQueryResult([mockGamePlan])),
        list: vi.fn().mockResolvedValue({ data: [mockGamePlan] }),
        update: vi.fn().mockResolvedValue({ data: mockGamePlan }),
        create: vi.fn().mockResolvedValue({ data: mockGamePlan }),
        delete: vi.fn().mockResolvedValue({ data: {} }),
      },
      PlannedRotation: {
        observeQuery: vi.fn(() => createObserveQueryResult(mockRotations)),
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

import { GamePlanner } from './GamePlanner';

describe('GamePlanner Start pill interaction', () => {
  let originalScrollIntoView: typeof Element.prototype.scrollIntoView;

  beforeEach(() => {
    vi.clearAllMocks();
    originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('renders the Start pill, opens the Starting Lineup panel, and returns to the Lineup tab', async () => {
    const user = userEvent.setup();

    render(
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

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Rotations/i })).toHaveAttribute('aria-selected', 'true');
    });

    const startPill = await screen.findByRole('button', { name: 'Start' });
    expect(startPill).toBeInTheDocument();

    await user.click(startPill);

    expect(await screen.findByRole('heading', { name: 'Starting Lineup' })).toBeInTheDocument();

    const editButton = screen.getByRole('button', { name: 'Edit starting lineup in the Lineup tab' });
    await user.click(editButton);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Lineup/i })).toHaveAttribute('aria-selected', 'true');
    });

    expect(screen.getByRole('heading', { name: 'First Half Starting Lineup' })).toBeInTheDocument();
  });
});