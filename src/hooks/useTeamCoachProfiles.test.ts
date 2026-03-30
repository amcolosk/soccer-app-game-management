import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { resolveAttributionLabel } from '../services/coachDisplayNameService';

const { mockGetTeamCoachProfiles } = vi.hoisted(() => ({
  mockGetTeamCoachProfiles: vi.fn(),
}));

vi.mock('aws-amplify/data', () => ({
  generateClient: vi.fn(() => ({
    queries: {
      getTeamCoachProfiles: mockGetTeamCoachProfiles,
    },
  })),
}));

import { useTeamCoachProfiles } from './useTeamCoachProfiles';

describe('useTeamCoachProfiles', () => {
  beforeEach(() => {
    mockGetTeamCoachProfiles.mockReset();
  });

  it('loads profiles and exposes lookup map', async () => {
    mockGetTeamCoachProfiles.mockResolvedValue({
      data: [
        {
          coachId: 'coach-1',
          displayName: 'Coach One',
          isFallback: false,
          disambiguationGroupKey: null,
        },
      ],
      errors: undefined,
    });

    const { result } = renderHook(() =>
      useTeamCoachProfiles({ teamId: 'team-1', onFocusRefetch: false })
    );

    await waitFor(() => {
      expect(result.current.profiles).toHaveLength(1);
    });

    expect(result.current.profileMap.get('coach-1')?.displayName).toBe('Coach One');
    expect(result.current.error).toBeNull();
  });

  it('clears stale profiles on refetch failure so attribution falls back safely', async () => {
    mockGetTeamCoachProfiles
      .mockResolvedValueOnce({
        data: [
          {
            coachId: 'coach-1',
            displayName: 'Coach One',
            isFallback: false,
            disambiguationGroupKey: null,
          },
        ],
        errors: undefined,
      })
      .mockResolvedValueOnce({
        data: null,
        errors: [{ message: 'Unauthorized' }],
      });

    const { result } = renderHook(() =>
      useTeamCoachProfiles({ teamId: 'team-1', onFocusRefetch: false })
    );

    await waitFor(() => {
      expect(result.current.profiles).toHaveLength(1);
    });

    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.profiles).toEqual([]);
    });
    expect(result.current.profileMap.size).toBe(0);
    expect(result.current.error?.message).toContain('Unauthorized');
    expect(resolveAttributionLabel('coach-1', 'current-user-id', result.current.profileMap)).toBe('Former Coach');
  });

  it('keeps profiles cleared when a newer unauthorized failure finishes before an older delayed success', async () => {
    let resolveOldRequest: ((value: unknown) => void) | undefined;
    mockGetTeamCoachProfiles
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          resolveOldRequest = resolve;
        })
      )
      .mockResolvedValueOnce({
        data: null,
        errors: [{ message: 'Unauthorized' }],
      });

    const { result } = renderHook(() =>
      useTeamCoachProfiles({ teamId: 'team-1', onFocusRefetch: false })
    );

    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.profiles).toEqual([]);
    });
    expect(result.current.error?.message).toContain('Unauthorized');

    resolveOldRequest?.({
      data: [
        {
          coachId: 'coach-1',
          displayName: 'Stale Coach',
          isFallback: false,
          disambiguationGroupKey: null,
        },
      ],
      errors: undefined,
    });

    await new Promise((r) => setTimeout(r, 20));

    expect(result.current.profiles).toEqual([]);
    expect(result.current.profileMap.size).toBe(0);
    expect(result.current.error?.message).toContain('Unauthorized');
  });
});
