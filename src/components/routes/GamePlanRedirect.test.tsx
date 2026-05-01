import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GamePlanRedirect } from './GamePlanRedirect';

const { mockUseParams } = vi.hoisted(() => ({
  mockUseParams: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => mockUseParams(),
  Navigate: ({ to }: { to: string }) => <div data-testid="redirect-target">{to}</div>,
}));

describe('GamePlanRedirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects /game/:gameId/plan to /game/:gameId', () => {
    mockUseParams.mockReturnValue({ gameId: 'game-123' });

    render(<GamePlanRedirect />);

    expect(screen.getByTestId('redirect-target')).toHaveTextContent('/game/game-123');
  });

  it('redirects to home when gameId is missing', () => {
    mockUseParams.mockReturnValue({});

    render(<GamePlanRedirect />);

    expect(screen.getByTestId('redirect-target')).toHaveTextContent('/');
  });
});
