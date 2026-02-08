import { describe, it, expect } from 'vitest';
import { getStatusColor, getStatusLabel, STATUS_CYCLE } from './PlayerAvailabilityGrid';

describe('PlayerAvailabilityGrid', () => {
  describe('getStatusColor', () => {
    it('returns green for available', () => {
      expect(getStatusColor('available')).toBe('#4caf50');
    });

    it('returns red for absent', () => {
      expect(getStatusColor('absent')).toBe('#f44336');
    });

    it('returns orange for injured', () => {
      expect(getStatusColor('injured')).toBe('#ff9800');
    });

    it('returns yellow for late-arrival', () => {
      expect(getStatusColor('late-arrival')).toBe('#fdd835');
    });

    it('returns grey for unknown status', () => {
      expect(getStatusColor('unknown')).toBe('#9e9e9e');
      expect(getStatusColor('')).toBe('#9e9e9e');
    });
  });

  describe('getStatusLabel', () => {
    it('returns ✓ for available', () => {
      expect(getStatusLabel('available')).toBe('✓');
    });

    it('returns ✗ for absent', () => {
      expect(getStatusLabel('absent')).toBe('✗');
    });

    it('returns 🩹 for injured', () => {
      expect(getStatusLabel('injured')).toBe('🩹');
    });

    it('returns ⏰ for late-arrival', () => {
      expect(getStatusLabel('late-arrival')).toBe('⏰');
    });

    it('returns ? for unknown status', () => {
      expect(getStatusLabel('unknown')).toBe('?');
      expect(getStatusLabel('')).toBe('?');
    });
  });

  describe('STATUS_CYCLE', () => {
    it('contains all four statuses in order', () => {
      expect(STATUS_CYCLE).toEqual(['available', 'absent', 'late-arrival', 'injured']);
    });

    it('cycles correctly from each status', () => {
      // Simulates the click-to-cycle logic
      const nextStatus = (current: string) => {
        const idx = STATUS_CYCLE.indexOf(current as typeof STATUS_CYCLE[number]);
        return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
      };

      expect(nextStatus('available')).toBe('absent');
      expect(nextStatus('absent')).toBe('late-arrival');
      expect(nextStatus('late-arrival')).toBe('injured');
      expect(nextStatus('injured')).toBe('available'); // wraps around
    });

    it('defaults to first status for unknown value', () => {
      // When indexOf returns -1, (-1 + 1) % 4 = 0, so it starts at "available"
      const idx = STATUS_CYCLE.indexOf('unknown' as typeof STATUS_CYCLE[number]);
      const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
      expect(next).toBe('available');
    });
  });
});
