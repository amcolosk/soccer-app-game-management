import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeasonReportRoute } from './SeasonReportRoute';
import type { Team } from '../../types/schema';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockTeamList, mockTeamGet, mockNavigate } = vi.hoisted(() => ({
  mockTeamList: vi.fn(),
  mockTeamGet: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      Team: { list: mockTeamList, get: mockTeamGet },
    },
  })),
}));

vi.mock('react-router-dom', () => ({
  useParams: vi.fn(),
  useLocation: vi.fn(),
  useNavigate: vi.fn(() => mockNavigate),
}));

vi.mock('../SeasonReport', () => ({
  TeamReport: ({ team }: { team: Team }) => (
    <div data-testid="team-report">{team.name}</div>
  ),
}));

vi.mock('../../utils/errorHandler', () => ({
  logError: vi.fn(),
  handleApiError: vi.fn(),
}));

import { useParams, useLocation } from 'react-router-dom';

const mockUseParams = vi.mocked(useParams);
const mockUseLocation = vi.mocked(useLocation);

const teamA: Team = { id: 'team-a', name: 'Eagles' } as Team;
const teamB: Team = { id: 'team-b', name: 'Hawks' } as Team;

function setupRoute(params: Record<string, string> = {}, stateTeam: Team | null = null) {
  mockUseParams.mockReturnValue(params);
  mockUseLocation.mockReturnValue({
    state: stateTeam ? { team: stateTeam } : null,
    pathname: '/reports',
    search: '',
    hash: '',
    key: 'default',
  } as ReturnType<typeof useLocation>);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SeasonReportRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state while teams are loading', () => {
    setupRoute();
    mockTeamList.mockReturnValue(new Promise(() => {}));

    render(<SeasonReportRoute />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders team selector dropdown after teams load', async () => {
    setupRoute();
    mockTeamList.mockResolvedValue({ data: [teamA, teamB] });

    render(<SeasonReportRoute />);

    await waitFor(() =>
      expect(screen.getByLabelText('📊 Team Reports')).toBeInTheDocument(),
    );
    expect(screen.getByRole('option', { name: 'Eagles' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Hawks' })).toBeInTheDocument();
  });

  it('auto-selects and navigates when only one team exists', async () => {
    setupRoute();
    mockTeamList.mockResolvedValue({ data: [teamA] });

    render(<SeasonReportRoute />);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/reports/team-a', { replace: true }),
    );
  });

  it('renders TeamReport with pre-selected team from URL param found in list', async () => {
    setupRoute({ teamId: 'team-a' });
    mockTeamList.mockResolvedValue({ data: [teamA, teamB] });

    render(<SeasonReportRoute />);

    await waitFor(() =>
      expect(screen.getByTestId('team-report')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('team-report').textContent).toBe('Eagles');
  });

  it('handleTeamChange navigates to /reports/:teamId when team selected', async () => {
    setupRoute();
    mockTeamList.mockResolvedValue({ data: [teamA, teamB] });

    render(<SeasonReportRoute />);

    await waitFor(() =>
      expect(screen.getByLabelText('📊 Team Reports')).toBeInTheDocument(),
    );

    await userEvent.selectOptions(
      screen.getByLabelText('📊 Team Reports'),
      'team-b',
    );

    expect(mockNavigate).toHaveBeenCalledWith('/reports/team-b', { replace: true });
  });

  it('renders TeamReport with team passed via location.state without fetching', async () => {
    setupRoute({ teamId: 'team-a' }, teamA);
    mockTeamList.mockResolvedValue({ data: [teamA] });

    render(<SeasonReportRoute />);

    await waitFor(() =>
      expect(screen.getByTestId('team-report')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('team-report').textContent).toBe('Eagles');
  });

  it('fetches team by ID when teamId is in URL but not found in the list', async () => {
    setupRoute({ teamId: 'team-c' });
    mockTeamList.mockResolvedValue({ data: [teamA] }); // team-c not in list
    mockTeamGet.mockResolvedValue({ data: { id: 'team-c', name: 'Lions' } as Team });

    render(<SeasonReportRoute />);

    await waitFor(() =>
      expect(screen.getByTestId('team-report')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('team-report').textContent).toBe('Lions');
  });
});
