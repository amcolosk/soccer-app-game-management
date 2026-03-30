/**
 * useTeamCoachProfiles Hook
 *
 * Fetches team coach profiles with:
 * - 60-second background polling for freshness
 * - Immediate refetch on: team change and window focus regain
 * - Exposed refetch() for callers such as GameManagement to refresh on notes tab entry
 * - Minimized DTO with displayName, isFallback, disambiguationGroupKey
 * - Silent refresh with no staleness badge or user-visible indicator
 */

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import type { TeamCoachProfileDTO } from '../services/coachDisplayNameService';

const client = generateClient<Schema>();

interface UseTeamCoachProfilesOptions {
  teamId?: string;
  enabled?: boolean;
  onFocusRefetch?: boolean;
}

export function useTeamCoachProfiles(
  options: UseTeamCoachProfilesOptions = {}
) {
  const { teamId, enabled = true, onFocusRefetch = true } = options;

  const [profiles, setProfiles] = useState<TeamCoachProfileDTO[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);
  const latestRequestIdRef = useRef(0);

  // Fetch profiles from API
  const fetchProfiles = useCallback(async () => {
    const requestId = ++latestRequestIdRef.current;

    if (!teamId || !enabled) {
      setProfiles([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const result = await client.queries.getTeamCoachProfiles({
        teamId,
      });

      if (result.errors && result.errors.length > 0) {
        throw new Error(result.errors[0].message ?? 'Failed to fetch profiles');
      }

      if (!isMountedRef.current || requestId !== latestRequestIdRef.current) return;

      let parsedData: unknown = result.data;
      if (typeof result.data === 'string') {
        parsedData = JSON.parse(result.data) as unknown;
      }

      const profileList = Array.isArray(parsedData)
        ? (parsedData as TeamCoachProfileDTO[])
        : [];
      setProfiles(profileList);
    } catch (err) {
      if (!isMountedRef.current || requestId !== latestRequestIdRef.current) return;

      console.error('Error fetching team coach profiles:', err);
      setProfiles([]);
      setError(err instanceof Error ? err : new Error('Failed to fetch profiles'));
    } finally {
      if (isMountedRef.current && requestId === latestRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [teamId, enabled]);

  // Initial and team-change fetch
  useEffect(() => {
    void fetchProfiles();
  }, [fetchProfiles]);

  // 60-second polling with jitter to reduce stampede
  useEffect(() => {
    if (!teamId || !enabled) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    // Add jitter (0-5s) to reduce stampede
    const jitterMs = Math.random() * 5000;
    const pollIntervalMs = 60 * 1000; // 60 seconds

    const timeoutId = setTimeout(() => {
      pollIntervalRef.current = setInterval(() => {
        void fetchProfiles();
      }, pollIntervalMs);
    }, jitterMs);

    return () => {
      clearTimeout(timeoutId);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [teamId, enabled, fetchProfiles]);

  // Immediate refetch on window focus regain
  useEffect(() => {
    if (!onFocusRefetch) {
      return;
    }

    const handleFocus = () => {
      void fetchProfiles();
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [onFocusRefetch, fetchProfiles]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Convert profiles to a Map for O(1) lookup by coachId
  const profileMap = useMemo(() => {
    const map = new Map<string, TeamCoachProfileDTO>();
    profiles.forEach((profile) => {
      map.set(profile.coachId, profile);
    });
    return map;
  }, [profiles]);

  return {
    profiles,
    profileMap,
    isLoading,
    error,
    refetch: fetchProfiles,
  };
}
