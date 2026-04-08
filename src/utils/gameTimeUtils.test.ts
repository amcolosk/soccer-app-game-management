import { describe, it, expect } from 'vitest';
import { formatGameTimeDisplay, formatMinutesSeconds, isoToDatetimeLocal } from './gameTimeUtils';

describe('formatGameTimeDisplay', () => {
  it('should format time for 1st half', () => {
    expect(formatGameTimeDisplay(0, 1)).toBe("0' (1st Half)");
    expect(formatGameTimeDisplay(60, 1)).toBe("1' (1st Half)");
    expect(formatGameTimeDisplay(300, 1)).toBe("5' (1st Half)");
    expect(formatGameTimeDisplay(900, 1)).toBe("15' (1st Half)");
  });

  it('should format time for 2nd half', () => {
    expect(formatGameTimeDisplay(1800, 2)).toBe("30' (2nd Half)");
    expect(formatGameTimeDisplay(2100, 2)).toBe("35' (2nd Half)");
    expect(formatGameTimeDisplay(3600, 2)).toBe("60' (2nd Half)");
  });

  it('should handle fractional seconds by flooring', () => {
    expect(formatGameTimeDisplay(65, 1)).toBe("1' (1st Half)");
    expect(formatGameTimeDisplay(119, 1)).toBe("1' (1st Half)");
    expect(formatGameTimeDisplay(120, 2)).toBe("2' (2nd Half)");
  });

  it('should handle zero seconds', () => {
    expect(formatGameTimeDisplay(0, 1)).toBe("0' (1st Half)");
    expect(formatGameTimeDisplay(0, 2)).toBe("0' (2nd Half)");
  });

  it('should format large time values', () => {
    expect(formatGameTimeDisplay(5400, 2)).toBe("90' (2nd Half)");
    expect(formatGameTimeDisplay(6000, 2)).toBe("100' (2nd Half)");
  });
});

describe('formatMinutesSeconds', () => {
  it('should format time with zero padding', () => {
    expect(formatMinutesSeconds(0)).toBe('00:00');
    expect(formatMinutesSeconds(5)).toBe('00:05');
    expect(formatMinutesSeconds(59)).toBe('00:59');
    expect(formatMinutesSeconds(60)).toBe('01:00');
  });

  it('should format time with minutes and seconds', () => {
    expect(formatMinutesSeconds(65)).toBe('01:05');
    expect(formatMinutesSeconds(125)).toBe('02:05');
    expect(formatMinutesSeconds(600)).toBe('10:00');
    expect(formatMinutesSeconds(615)).toBe('10:15');
  });

  it('should handle large time values', () => {
    expect(formatMinutesSeconds(3599)).toBe('59:59');
    expect(formatMinutesSeconds(3600)).toBe('60:00');
    expect(formatMinutesSeconds(5400)).toBe('90:00');
  });

  it('should pad single digit minutes', () => {
    expect(formatMinutesSeconds(60)).toBe('01:00');
    expect(formatMinutesSeconds(120)).toBe('02:00');
    expect(formatMinutesSeconds(540)).toBe('09:00');
  });

  it('should pad single digit seconds', () => {
    expect(formatMinutesSeconds(601)).toBe('10:01');
    expect(formatMinutesSeconds(605)).toBe('10:05');
    expect(formatMinutesSeconds(609)).toBe('10:09');
  });

  it('should handle edge cases', () => {
    expect(formatMinutesSeconds(1)).toBe('00:01');
    expect(formatMinutesSeconds(61)).toBe('01:01');
    expect(formatMinutesSeconds(3661)).toBe('61:01');
  });
});

describe('isoToDatetimeLocal', () => {
  it('returns empty string for null', () => {
    expect(isoToDatetimeLocal(null)).toBe('');
  });
  it('returns empty string for undefined', () => {
    expect(isoToDatetimeLocal(undefined)).toBe('');
  });
  it('returns empty string for empty string', () => {
    expect(isoToDatetimeLocal('')).toBe('');
  });
  it('returns empty string for invalid date', () => {
    expect(isoToDatetimeLocal('not-a-date')).toBe('');
  });
  it('converts a UTC ISO string to local datetime-local format', () => {
    // Create a known local time and verify the conversion produces a valid datetime-local string
    const iso = new Date(2026, 3, 15, 14, 30, 0).toISOString(); // local time
    const result = isoToDatetimeLocal(iso);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    // Should round-trip: parsing the result back should give the same local time
    const roundTrip = new Date(result);
    expect(roundTrip.getFullYear()).toBe(2026);
    expect(roundTrip.getMonth()).toBe(3); // April
    expect(roundTrip.getDate()).toBe(15);
    expect(roundTrip.getHours()).toBe(14);
    expect(roundTrip.getMinutes()).toBe(30);
  });
});
