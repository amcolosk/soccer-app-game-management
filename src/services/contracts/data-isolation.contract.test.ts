import { beforeEach, describe, expect, it, vi } from 'vitest';

type TeamRecord = {
  id: string;
  name: string;
  coaches?: string[];
};

type BoundaryError = { message?: string };

type TeamListResult = {
  data?: TeamRecord[] | null;
  errors?: BoundaryError[];
};

type TeamGetResult = {
  data?: TeamRecord | null;
  errors?: BoundaryError[];
};

const { mockTeamList, mockTeamGet } = vi.hoisted(() => ({
  mockTeamList: vi.fn<() => Promise<TeamListResult>>(),
  mockTeamGet: vi.fn<(args: { id: string }) => Promise<TeamGetResult>>(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      Team: {
        list: mockTeamList,
        get: mockTeamGet,
      },
    },
  })),
}));

async function listVisibleTeamsContract() {
  const { generateClient } = await import('aws-amplify/data');
  const client = generateClient();
  const result = await client.models.Team.list();

  if (result.errors?.length) {
    throw new Error(result.errors[0]?.message ?? 'Unable to list visible teams');
  }

  return (result.data ?? []).map((team) => ({
    teamId: team.id,
    teamName: team.name,
    coachCount: team.coaches?.length ?? 0,
  }));
}

async function getVisibleTeamContract(teamId: string) {
  const { generateClient } = await import('aws-amplify/data');
  const client = generateClient();
  const result = await client.models.Team.get({ id: teamId });

  if (result.errors?.length) {
    throw new Error(result.errors[0]?.message ?? 'Unable to read team');
  }

  if (!result.data) {
    return null;
  }

  return {
    teamId: result.data.id,
    teamName: result.data.name,
    coaches: result.data.coaches ?? [],
  };
}

describe('data isolation contract (service/client boundary)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTeamList.mockResolvedValue({ data: [], errors: undefined });
    mockTeamGet.mockResolvedValue({ data: null, errors: undefined });
  });

  it('sends list request without cross-user filters and maps visible-team response', async () => {
    mockTeamList.mockResolvedValueOnce({
      data: [{ id: 'team-1', name: 'Eagles', coaches: ['coach-a', 'coach-b'] }],
      errors: undefined,
    });

    const teams = await listVisibleTeamsContract();

    expect(mockTeamList).toHaveBeenCalledWith();
    expect(teams).toEqual([{ teamId: 'team-1', teamName: 'Eagles', coachCount: 2 }]);
  });

  it('sends get request shape { id } and maps team payload for authorized reads', async () => {
    mockTeamGet.mockResolvedValueOnce({
      data: { id: 'team-2', name: 'Falcons', coaches: ['coach-z'] },
      errors: undefined,
    });

    const team = await getVisibleTeamContract('team-2');

    expect(mockTeamGet).toHaveBeenCalledWith({ id: 'team-2' });
    expect(team).toEqual({ teamId: 'team-2', teamName: 'Falcons', coaches: ['coach-z'] });
  });

  it('surfaces auth semantics for unauthorized list requests', async () => {
    mockTeamList.mockResolvedValueOnce({
      data: null,
      errors: [{ message: 'Unauthorized' }],
    });

    await expect(listVisibleTeamsContract()).rejects.toThrow(/unauthorized/i);
  });

  it('returns null for not-found get responses without auth errors', async () => {
    mockTeamGet.mockResolvedValueOnce({
      data: null,
      errors: undefined,
    });

    await expect(getVisibleTeamContract('missing-team')).resolves.toBeNull();
  });

  it('surfaces auth semantics for cross-owner team reads', async () => {
    mockTeamGet.mockResolvedValueOnce({
      data: null,
      errors: [{ message: 'Not Authorized to access Team on type Query' }],
    });

    await expect(getVisibleTeamContract('foreign-team-id')).rejects.toThrow(/not authorized|unauthorized/i);
  });
});