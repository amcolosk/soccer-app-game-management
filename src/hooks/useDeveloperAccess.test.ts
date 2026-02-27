import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { mockFetchUserAttributes } = vi.hoisted(() => ({
  mockFetchUserAttributes: vi.fn(),
}));

vi.mock('aws-amplify/auth', () => ({
  fetchUserAttributes: mockFetchUserAttributes,
}));

import { useDeveloperAccess } from './useDeveloperAccess';

async function flushPromises() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

describe('useDeveloperAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('no allowlist configured', () => {
    it('returns isDeveloper=false and checking=false immediately when VITE_DEVELOPER_EMAILS is empty', async () => {
      vi.stubEnv('VITE_DEVELOPER_EMAILS', '');
      const { result } = renderHook(() => useDeveloperAccess());
      await flushPromises();
      expect(result.current.isDeveloper).toBe(false);
      expect(result.current.checking).toBe(false);
    });

    it('does not call fetchUserAttributes when VITE_DEVELOPER_EMAILS is empty', async () => {
      vi.stubEnv('VITE_DEVELOPER_EMAILS', '');
      renderHook(() => useDeveloperAccess());
      await flushPromises();
      expect(mockFetchUserAttributes).not.toHaveBeenCalled();
    });

    it('does not call fetchUserAttributes when VITE_DEVELOPER_EMAILS contains only whitespace and commas', async () => {
      vi.stubEnv('VITE_DEVELOPER_EMAILS', '  ,  ,  ');
      renderHook(() => useDeveloperAccess());
      await flushPromises();
      expect(mockFetchUserAttributes).not.toHaveBeenCalled();
    });
  });

  describe('checking lifecycle', () => {
    it('starts with checking=true before fetchUserAttributes resolves', () => {
      vi.stubEnv('VITE_DEVELOPER_EMAILS', 'dev@example.com');
      mockFetchUserAttributes.mockReturnValue(new Promise(() => {})); // never resolves
      const { result } = renderHook(() => useDeveloperAccess());
      expect(result.current.checking).toBe(true);
    });

    it('sets checking=false after resolution when email is not in allowlist', async () => {
      vi.stubEnv('VITE_DEVELOPER_EMAILS', 'dev@example.com');
      mockFetchUserAttributes.mockResolvedValue({ email: 'other@example.com' });
      const { result } = renderHook(() => useDeveloperAccess());
      expect(result.current.checking).toBe(true);
      await flushPromises();
      expect(result.current.checking).toBe(false);
    });
  });

  describe('email in allowlist', () => {
    it('sets isDeveloper=true when the signed-in email matches the single allowlist entry', async () => {
      vi.stubEnv('VITE_DEVELOPER_EMAILS', 'dev@example.com');
      mockFetchUserAttributes.mockResolvedValue({ email: 'dev@example.com' });
      const { result } = renderHook(() => useDeveloperAccess());
      await flushPromises();
      expect(result.current.isDeveloper).toBe(true);
      expect(result.current.checking).toBe(false);
    });

    it('exposes the normalised email in userEmail when access is granted', async () => {
      vi.stubEnv('VITE_DEVELOPER_EMAILS', 'dev@example.com');
      mockFetchUserAttributes.mockResolvedValue({ email: 'dev@example.com' });
      const { result } = renderHook(() => useDeveloperAccess());
      await flushPromises();
      expect(result.current.userEmail).toBe('dev@example.com');
    });
  });

  describe('email not in allowlist', () => {
    it('sets isDeveloper=false when the signed-in email is not in the allowlist', async () => {
      vi.stubEnv('VITE_DEVELOPER_EMAILS', 'dev@example.com');
      mockFetchUserAttributes.mockResolvedValue({ email: 'coach@example.com' });
      const { result } = renderHook(() => useDeveloperAccess());
      await flushPromises();
      expect(result.current.isDeveloper).toBe(false);
    });
  });

  describe('case-insensitive matching', () => {
    it('grants access when env entry is uppercase but Cognito returns lowercase email', async () => {
      vi.stubEnv('VITE_DEVELOPER_EMAILS', 'DEV@EXAMPLE.COM');
      mockFetchUserAttributes.mockResolvedValue({ email: 'dev@example.com' });
      const { result } = renderHook(() => useDeveloperAccess());
      await flushPromises();
      expect(result.current.isDeveloper).toBe(true);
    });

    it('grants access when Cognito returns mixed-case email matching a lowercase env entry', async () => {
      vi.stubEnv('VITE_DEVELOPER_EMAILS', 'dev@example.com');
      mockFetchUserAttributes.mockResolvedValue({ email: 'Dev@Example.Com' });
      const { result } = renderHook(() => useDeveloperAccess());
      await flushPromises();
      expect(result.current.isDeveloper).toBe(true);
    });
  });

  describe('multiple emails in allowlist', () => {
    it('grants access when user email matches the second entry in a comma-separated list', async () => {
      vi.stubEnv('VITE_DEVELOPER_EMAILS', 'alice@example.com, bob@example.com, carol@example.com');
      mockFetchUserAttributes.mockResolvedValue({ email: 'bob@example.com' });
      const { result } = renderHook(() => useDeveloperAccess());
      await flushPromises();
      expect(result.current.isDeveloper).toBe(true);
    });

    it('grants access when user email matches the last entry in the list', async () => {
      vi.stubEnv('VITE_DEVELOPER_EMAILS', 'alice@example.com, bob@example.com, carol@example.com');
      mockFetchUserAttributes.mockResolvedValue({ email: 'carol@example.com' });
      const { result } = renderHook(() => useDeveloperAccess());
      await flushPromises();
      expect(result.current.isDeveloper).toBe(true);
    });

    it('denies access when no entry in the multi-email allowlist matches', async () => {
      vi.stubEnv('VITE_DEVELOPER_EMAILS', 'alice@example.com, bob@example.com');
      mockFetchUserAttributes.mockResolvedValue({ email: 'mallory@example.com' });
      const { result } = renderHook(() => useDeveloperAccess());
      await flushPromises();
      expect(result.current.isDeveloper).toBe(false);
    });
  });

  describe('fetchUserAttributes throws', () => {
    it('sets isDeveloper=false and checking=false without throwing when fetchUserAttributes rejects', async () => {
      vi.stubEnv('VITE_DEVELOPER_EMAILS', 'dev@example.com');
      mockFetchUserAttributes.mockRejectedValue(new Error('Not authenticated'));
      const { result } = renderHook(() => useDeveloperAccess());
      await flushPromises();
      expect(result.current.isDeveloper).toBe(false);
      expect(result.current.checking).toBe(false);
    });

    it('keeps userEmail null when fetchUserAttributes throws', async () => {
      vi.stubEnv('VITE_DEVELOPER_EMAILS', 'dev@example.com');
      mockFetchUserAttributes.mockRejectedValue(new Error('Session expired'));
      const { result } = renderHook(() => useDeveloperAccess());
      await flushPromises();
      expect(result.current.userEmail).toBeNull();
    });
  });

  describe('userEmail normalisation', () => {
    it('stores the lowercased email in userEmail regardless of Cognito casing', async () => {
      vi.stubEnv('VITE_DEVELOPER_EMAILS', 'dev@example.com');
      mockFetchUserAttributes.mockResolvedValue({ email: 'Dev@Example.COM' });
      const { result } = renderHook(() => useDeveloperAccess());
      await flushPromises();
      expect(result.current.userEmail).toBe('dev@example.com');
    });

    it('sets userEmail to null when the Cognito email attribute is an empty string', async () => {
      vi.stubEnv('VITE_DEVELOPER_EMAILS', 'dev@example.com');
      mockFetchUserAttributes.mockResolvedValue({ email: '' });
      const { result } = renderHook(() => useDeveloperAccess());
      await flushPromises();
      expect(result.current.userEmail).toBeNull();
    });

    it('sets userEmail to null when the email attribute is absent from the Cognito response', async () => {
      vi.stubEnv('VITE_DEVELOPER_EMAILS', 'dev@example.com');
      mockFetchUserAttributes.mockResolvedValue({});
      const { result } = renderHook(() => useDeveloperAccess());
      await flushPromises();
      expect(result.current.userEmail).toBeNull();
    });
  });
});
