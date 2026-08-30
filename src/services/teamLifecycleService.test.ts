import { describe, it, expect, vi, beforeEach } from 'vitest';
import { archiveTeam, restoreTeam, assignTeamOwner } from './teamLifecycleService';

const {
  mockArchiveTeam,
  mockRestoreTeam,
  mockAssignTeamOwner,
} = vi.hoisted(() => ({
  mockArchiveTeam: vi.fn(),
  mockRestoreTeam: vi.fn(),
  mockAssignTeamOwner: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    mutations: {
      archiveTeam: mockArchiveTeam,
      restoreTeam: mockRestoreTeam,
      assignTeamOwner: mockAssignTeamOwner,
    },
  })),
}));

const validTeam = {
  id: 'team-1',
  status: 'archived',
  ownerId: 'test-user-id',
  archivedAt: '2026-08-19T00:00:00.000Z',
  archivedBy: 'test-user-id',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockArchiveTeam.mockResolvedValue({ data: validTeam, errors: undefined });
  mockRestoreTeam.mockResolvedValue({ data: validTeam, errors: undefined });
  mockAssignTeamOwner.mockResolvedValue({ data: validTeam, errors: undefined });
});

describe('archiveTeam', () => {
  it('calls the archiveTeam mutation with the given teamId and returns result.data', async () => {
    const result = await archiveTeam('team-1');
    expect(mockArchiveTeam).toHaveBeenCalledWith({ teamId: 'team-1' });
    expect(result).toEqual(validTeam);
  });

  it('throws with the server error message when result.errors is present', async () => {
    mockArchiveTeam.mockResolvedValueOnce({
      data: null,
      errors: [{ message: 'Access denied: only the team owner can archive this team' }],
    });

    await expect(archiveTeam('team-1')).rejects.toThrow(
      /access denied: only the team owner can archive this team/i,
    );
  });

  it('throws the fallback message when result.data is falsy with no errors', async () => {
    mockArchiveTeam.mockResolvedValueOnce({ data: null, errors: undefined });

    await expect(archiveTeam('team-1')).rejects.toThrow(/failed to archive team/i);
  });
});

describe('restoreTeam', () => {
  it('calls the restoreTeam mutation with the given teamId and returns result.data', async () => {
    const result = await restoreTeam('team-1');
    expect(mockRestoreTeam).toHaveBeenCalledWith({ teamId: 'team-1' });
    expect(result).toEqual(validTeam);
  });

  it('throws with the server error message when result.errors is present', async () => {
    mockRestoreTeam.mockResolvedValueOnce({
      data: null,
      errors: [{ message: 'Access denied: only the team owner can restore this team' }],
    });

    await expect(restoreTeam('team-1')).rejects.toThrow(
      /access denied: only the team owner can restore this team/i,
    );
  });

  it('throws the fallback message when result.data is falsy with no errors', async () => {
    mockRestoreTeam.mockResolvedValueOnce({ data: null, errors: undefined });

    await expect(restoreTeam('team-1')).rejects.toThrow(/failed to restore team/i);
  });
});

describe('assignTeamOwner', () => {
  it('calls the assignTeamOwner mutation with the given teamId and returns result.data', async () => {
    const result = await assignTeamOwner('team-1');
    expect(mockAssignTeamOwner).toHaveBeenCalledWith({ teamId: 'team-1' });
    expect(result).toEqual(validTeam);
  });

  it('throws with the server error message when result.errors is present', async () => {
    mockAssignTeamOwner.mockResolvedValueOnce({
      data: null,
      errors: [{ message: 'Team already has an owner' }],
    });

    await expect(assignTeamOwner('team-1')).rejects.toThrow(/team already has an owner/i);
  });

  it('throws the fallback message when result.data is falsy with no errors', async () => {
    mockAssignTeamOwner.mockResolvedValueOnce({ data: null, errors: undefined });

    await expect(assignTeamOwner('team-1')).rejects.toThrow(/failed to assign team owner/i);
  });
});
