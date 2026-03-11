import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sendTeamInvitation,
  acceptTeamInvitation,
  declineTeamInvitation,
  revokeCoachAccess,
  getUserPendingInvitations,
} from './invitationService';

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const {
  mockTeamGet,
  mockTeamUpdate,
  mockTeamInvitationCreate,
  mockTeamInvitationUpdate,
  mockAcceptInvitation,
  mockGetUserInvitations,
  mockGetCurrentUser,
} = vi.hoisted(() => ({
  mockTeamGet: vi.fn(),
  mockTeamUpdate: vi.fn(),
  mockTeamInvitationCreate: vi.fn(),
  mockTeamInvitationUpdate: vi.fn(),
  mockAcceptInvitation: vi.fn(),
  mockGetUserInvitations: vi.fn(),
  mockGetCurrentUser: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    models: {
      Team: {
        get: mockTeamGet,
        update: mockTeamUpdate,
      },
      TeamInvitation: {
        create: mockTeamInvitationCreate,
        update: mockTeamInvitationUpdate,
      },
    },
    mutations: {
      acceptInvitation: mockAcceptInvitation,
    },
    queries: {
      getUserInvitations: mockGetUserInvitations,
    },
  })),
}));

vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: mockGetCurrentUser,
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('invitationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ userId: 'user-123' });
  });

  describe('sendTeamInvitation', () => {
    it('creates invitation with correct coaches array and inviter info', async () => {
      const teamData = {
        id: 'team-1',
        name: 'Test Team',
        coaches: ['coach-1', 'coach-2'],
      };

      mockTeamGet.mockResolvedValue({ data: teamData });
      mockTeamInvitationCreate.mockResolvedValue({ data: { id: 'inv-1' } });

      await sendTeamInvitation('team-1', 'newcoach@test.com', 'COACH');

      expect(mockTeamInvitationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          teamId: 'team-1',
          teamName: 'Test Team',
          email: 'newcoach@test.com',
          role: 'COACH',
          status: 'PENDING',
          invitedBy: 'user-123',
          coaches: ['coach-1', 'coach-2'],
        })
      );
    });

    it('sets expiresAt to approximately +7 days from now', async () => {
      const teamData = {
        id: 'team-1',
        name: 'Test Team',
        coaches: ['coach-1'],
      };

      mockTeamGet.mockResolvedValue({ data: teamData });
      mockTeamInvitationCreate.mockResolvedValue({ data: { id: 'inv-1' } });

      const now = Date.now();
      await sendTeamInvitation('team-1', 'test@test.com', 'COACH');

      const call = mockTeamInvitationCreate.mock.calls[0][0];
      const expiresAt = new Date(call.expiresAt).getTime();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;

      // Allow 1 second of tolerance for test execution time
      expect(expiresAt).toBeGreaterThanOrEqual(now + sevenDays - 1000);
      expect(expiresAt).toBeLessThanOrEqual(now + sevenDays + 1000);
    });

    it('lowercases the email address', async () => {
      const teamData = {
        id: 'team-1',
        name: 'Test Team',
        coaches: ['coach-1'],
      };

      mockTeamGet.mockResolvedValue({ data: teamData });
      mockTeamInvitationCreate.mockResolvedValue({ data: { id: 'inv-1' } });

      await sendTeamInvitation('team-1', 'UPPERCASE@TEST.COM', 'COACH');

      expect(mockTeamInvitationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'uppercase@test.com',
        })
      );
    });

    it('throws if the team record is not found', async () => {
      mockTeamGet.mockResolvedValue({ data: null });

      await expect(
        sendTeamInvitation('team-1', 'test@test.com', 'COACH')
      ).rejects.toThrow('Team not found');
    });
  });

  describe('acceptTeamInvitation', () => {
    it('calls the acceptInvitation custom mutation with invitationId', async () => {
      mockAcceptInvitation.mockResolvedValue({ data: { success: true } });

      await acceptTeamInvitation('inv-123');

      expect(mockAcceptInvitation).toHaveBeenCalledWith({
        invitationId: 'inv-123',
      });
    });

    it('throws if mutation returns an errors array', async () => {
      mockAcceptInvitation.mockResolvedValue({
        errors: [{ message: 'Invalid invitation' }],
      });

      await expect(acceptTeamInvitation('inv-123')).rejects.toThrow(
        'Invalid invitation'
      );
    });
  });

  describe('declineTeamInvitation', () => {
    it('updates invitation status to DECLINED', async () => {
      mockTeamInvitationUpdate.mockResolvedValue({
        data: { id: 'inv-1', status: 'DECLINED' },
      });

      await declineTeamInvitation('inv-123');

      expect(mockTeamInvitationUpdate).toHaveBeenCalledWith({
        id: 'inv-123',
        status: 'DECLINED',
      });
    });
  });

  describe('revokeCoachAccess', () => {
    it('removes the target userId from the team coaches array', async () => {
      const teamData = {
        id: 'team-1',
        coaches: ['coach-1', 'coach-2', 'coach-3'],
      };

      mockTeamGet.mockResolvedValue({ data: teamData });
      mockTeamUpdate.mockResolvedValue({ data: {} });

      await revokeCoachAccess('team-1', 'coach-2');

      expect(mockTeamUpdate).toHaveBeenCalledWith({
        id: 'team-1',
        coaches: ['coach-1', 'coach-3'],
      });
    });

    it('throws if userId is not in the coaches array', async () => {
      const teamData = {
        id: 'team-1',
        coaches: ['coach-1'],
      };

      mockTeamGet.mockResolvedValue({ data: teamData });

      await expect(revokeCoachAccess('team-1', 'coach-999')).rejects.toThrow(
        'User is not a coach of this team'
      );
    });

    it('throws if the team is not found', async () => {
      mockTeamGet.mockResolvedValue({ data: null });

      await expect(revokeCoachAccess('team-1', 'coach-1')).rejects.toThrow(
        'Team not found'
      );
    });
  });

  describe('getUserPendingInvitations', () => {
    it('calls the custom getUserInvitations query', async () => {
      mockGetUserInvitations.mockResolvedValue({
        data: { teamInvitations: [] },
      });

      await getUserPendingInvitations();

      expect(mockGetUserInvitations).toHaveBeenCalled();
    });

    it('returns { teamInvitations: [] } when result.data is null', async () => {
      mockGetUserInvitations.mockResolvedValue({ data: null });

      const result = await getUserPendingInvitations();

      expect(result).toEqual({ teamInvitations: [] });
    });

    it('handles JSON parse errors gracefully (returns empty)', async () => {
      mockGetUserInvitations.mockResolvedValue({
        data: '{invalid json',
      });

      const result = await getUserPendingInvitations();

      expect(result).toEqual({ teamInvitations: [] });
    });

    it('parses JSON string data correctly', async () => {
      mockGetUserInvitations.mockResolvedValue({
        data: JSON.stringify({
          teamInvitations: [{ id: 'inv-1' }, { id: 'inv-2' }],
        }),
      });

      const result = await getUserPendingInvitations();

      expect(result).toEqual({
        teamInvitations: [{ id: 'inv-1' }, { id: 'inv-2' }],
      });
    });

    it('handles object data directly', async () => {
      mockGetUserInvitations.mockResolvedValue({
        data: {
          teamInvitations: [{ id: 'inv-1' }],
        },
      });

      const result = await getUserPendingInvitations();

      expect(result).toEqual({
        teamInvitations: [{ id: 'inv-1' }],
      });
    });
  });
});
