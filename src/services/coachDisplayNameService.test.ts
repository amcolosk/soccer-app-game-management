import { describe, it, expect } from 'vitest';
import {
  resolveAttributionLabel,
  getAttributionLabelClassName,
  formatAttributionLine,
  type TeamCoachProfileDTO,
} from './coachDisplayNameService';

describe('coachDisplayNameService', () => {
  const mockProfileMap = new Map<string, TeamCoachProfileDTO>([
    [
      'coach-alice',
      {
        coachId: 'coach-alice',
        displayName: 'Alice M.',
        isFallback: false,
        disambiguationGroupKey: 'alice m.',
      },
    ],
    [
      'coach-bob',
      {
        coachId: 'coach-bob',
        displayName: 'Bob J.',
        isFallback: false,
        disambiguationGroupKey: 'bob j.',
      },
    ],
    [
      'coach-charlie-no-name',
      {
        coachId: 'coach-charlie-no-name',
        displayName: null,
        isFallback: true,
        disambiguationGroupKey: null,
      },
    ],
  ]);

  describe('resolveAttributionLabel', () => {
    it('should return "Unknown Author" when authorId is null', () => {
      const label = resolveAttributionLabel(null, 'current-user', mockProfileMap);
      expect(label).toBe('Unknown Author');
    });

    it('should return "You" when authorId matches currentUserId', () => {
      const label = resolveAttributionLabel('current-user', 'current-user', mockProfileMap);
      expect(label).toBe('You');
    });

    it('should return "Former Coach" when author not in profile map', () => {
      const label = resolveAttributionLabel('removed-coach', 'current-user', mockProfileMap);
      expect(label).toBe('Former Coach');
    });

    it('should return "Coach" when author in profile map but no displayName', () => {
      const label = resolveAttributionLabel(
        'coach-charlie-no-name',
        'current-user',
        mockProfileMap
      );
      expect(label).toBe('Coach');
    });

    it('should return displayName when author has profile with name', () => {
      const label = resolveAttributionLabel('coach-alice', 'current-user', mockProfileMap);
      expect(label).toBe('Alice M.');
    });
  });

  describe('getAttributionLabelClassName', () => {
    it('should return "attribution-unknown" for null authorId', () => {
      const cls = getAttributionLabelClassName(null, 'current-user', mockProfileMap);
      expect(cls).toContain('attribution-unknown');
    });

    it('should return "attribution-you" for current user', () => {
      const cls = getAttributionLabelClassName('current-user', 'current-user', mockProfileMap);
      expect(cls).toContain('attribution-you');
    });

    it('should return "attribution-removed" for removed coach', () => {
      const cls = getAttributionLabelClassName('removed-coach', 'current-user', mockProfileMap);
      expect(cls).toContain('attribution-removed');
    });

    it('should return "attribution-fallback" for coach without displayName', () => {
      const cls = getAttributionLabelClassName(
        'coach-charlie-no-name',
        'current-user',
        mockProfileMap
      );
      expect(cls).toContain('attribution-fallback');
    });

    it('should return "attribution-named" for coach with displayName', () => {
      const cls = getAttributionLabelClassName('coach-alice', 'current-user', mockProfileMap);
      expect(cls).toContain('attribution-named');
    });
  });

  describe('formatAttributionLine', () => {
    it('should format label with "Created by:" prefix', () => {
      const line = formatAttributionLine('Alice M.');
      expect(line).toBe('Created by: Alice M.');
    });

    it('should work with "You" label', () => {
      const line = formatAttributionLine('You');
      expect(line).toBe('Created by: You');
    });

    it('should work with "Former Coach" label', () => {
      const line = formatAttributionLine('Former Coach');
      expect(line).toBe('Created by: Former Coach');
    });
  });
});
