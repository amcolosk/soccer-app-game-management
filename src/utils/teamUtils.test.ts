import { describe, it, expect } from 'vitest';
import {
  isTeamArchived,
  isTeamActive,
  isTeamOwnershipAssigned,
  isTeamOwner,
  formatArchivedOn,
} from './teamUtils';

describe('isTeamArchived / isTeamActive', () => {
  it('treats status: undefined as active (legacy teams, never backfilled)', () => {
    expect(isTeamArchived({ status: undefined })).toBe(false);
    expect(isTeamActive({ status: undefined })).toBe(true);
  });

  it('treats status: null as active', () => {
    expect(isTeamArchived({ status: null })).toBe(false);
    expect(isTeamActive({ status: null })).toBe(true);
  });

  it('treats status: "active" as active', () => {
    expect(isTeamArchived({ status: 'active' })).toBe(false);
    expect(isTeamActive({ status: 'active' })).toBe(true);
  });

  it('treats status: "archived" as archived, not active', () => {
    expect(isTeamArchived({ status: 'archived' })).toBe(true);
    expect(isTeamActive({ status: 'archived' })).toBe(false);
  });
});

describe('isTeamOwnershipAssigned', () => {
  it('returns false when ownerId is not set', () => {
    expect(isTeamOwnershipAssigned({ ownerId: null, coaches: ['coach-a'] })).toBe(false);
    expect(isTeamOwnershipAssigned({ ownerId: undefined, coaches: ['coach-a'] })).toBe(false);
  });

  it('returns true when ownerId is set and present in coaches', () => {
    expect(isTeamOwnershipAssigned({ ownerId: 'coach-a', coaches: ['coach-a', 'coach-b'] })).toBe(true);
  });

  it('returns false when ownerId is set but not present in coaches (orphaned owner)', () => {
    expect(isTeamOwnershipAssigned({ ownerId: 'coach-a', coaches: ['coach-b'] })).toBe(false);
  });

  it('returns false when coaches is undefined', () => {
    expect(isTeamOwnershipAssigned({ ownerId: 'coach-a', coaches: undefined })).toBe(false);
  });
});

describe('isTeamOwner', () => {
  it('returns true when userId matches a validly-assigned ownerId', () => {
    expect(isTeamOwner({ ownerId: 'coach-a', coaches: ['coach-a', 'coach-b'] }, 'coach-a')).toBe(true);
  });

  it('returns false for a non-owner coach', () => {
    expect(isTeamOwner({ ownerId: 'coach-a', coaches: ['coach-a', 'coach-b'] }, 'coach-b')).toBe(false);
  });

  it('returns false when ownerId matches userId but the owner is orphaned (not in coaches)', () => {
    expect(isTeamOwner({ ownerId: 'coach-a', coaches: ['coach-b'] }, 'coach-a')).toBe(false);
  });

  it('returns false when userId is null or undefined', () => {
    expect(isTeamOwner({ ownerId: 'coach-a', coaches: ['coach-a'] }, null)).toBe(false);
    expect(isTeamOwner({ ownerId: 'coach-a', coaches: ['coach-a'] }, undefined)).toBe(false);
  });
});

describe('formatArchivedOn', () => {
  it('formats a valid ISO string', () => {
    // Noon UTC avoids day-boundary flips for local timezones running the test suite.
    expect(formatArchivedOn('2026-08-19T12:00:00.000Z')).toBe('Aug 19, 2026');
  });

  it('returns null for null', () => {
    expect(formatArchivedOn(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(formatArchivedOn(undefined)).toBeNull();
  });

  it('returns null for a garbage string', () => {
    expect(formatArchivedOn('not-a-date')).toBeNull();
  });
});
