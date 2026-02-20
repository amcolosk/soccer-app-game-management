import { describe, it, expect } from 'vitest';
import { validateStatus } from './handler';

describe('validateStatus', () => {
  it('accepts valid statuses', () => {
    expect(validateStatus('OPEN')).toBe(true);
    expect(validateStatus('IN_PROGRESS')).toBe(true);
    expect(validateStatus('FIXED')).toBe(true);
    expect(validateStatus('DEPLOYED')).toBe(true);
    expect(validateStatus('CLOSED')).toBe(true);
  });

  it('rejects invalid statuses', () => {
    expect(validateStatus('INVALID')).toBe(false);
    expect(validateStatus('open')).toBe(false);
    expect(validateStatus('')).toBe(false);
    expect(validateStatus('PENDING')).toBe(false);
  });
});
