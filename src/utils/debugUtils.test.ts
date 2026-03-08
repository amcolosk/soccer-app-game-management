import { describe, it, expect } from 'vitest';
import { buildFlatDebugSnapshot } from './debugUtils';

describe('buildFlatDebugSnapshot', () => {
  it('renders only header and footer when entries is empty', () => {
    const result = buildFlatDebugSnapshot('Test Snapshot', {});
    const lines = result.split('\n');
    expect(lines[0]).toBe('--- Test Snapshot ---');
    expect(lines[lines.length - 1]).toBe('-----------------------------------');
    expect(lines.length).toBe(2);
  });

  it('renders a string value', () => {
    const result = buildFlatDebugSnapshot('T', { name: 'hello' });
    expect(result).toContain('name: hello');
  });

  it('renders a number value', () => {
    const result = buildFlatDebugSnapshot('T', { count: 42 });
    expect(result).toContain('count: 42');
  });

  it('renders a boolean true value', () => {
    const result = buildFlatDebugSnapshot('T', { active: true });
    expect(result).toContain('active: true');
  });

  it('renders a boolean false value', () => {
    const result = buildFlatDebugSnapshot('T', { active: false });
    expect(result).toContain('active: false');
  });

  it('renders null as (null)', () => {
    const result = buildFlatDebugSnapshot('T', { editingId: null });
    expect(result).toContain('editingId: (null)');
  });

  it('renders undefined as (null)', () => {
    const result = buildFlatDebugSnapshot('T', { editingId: undefined });
    expect(result).toContain('editingId: (null)');
  });

  it('renders a Record<string, number> as key=value pairs', () => {
    const result = buildFlatDebugSnapshot('T', {
      availabilityByStatus: { available: 8, absent: 2, injured: 1 },
    });
    expect(result).toContain('availabilityByStatus: available=8, absent=2, injured=1');
  });

  it('renders an empty Record<string, number> as (none)', () => {
    const result = buildFlatDebugSnapshot('T', { availabilityByStatus: {} });
    expect(result).toContain('availabilityByStatus: (none)');
  });

  it('includes the title in the header line', () => {
    const result = buildFlatDebugSnapshot('My Debug Snapshot', {});
    expect(result.startsWith('--- My Debug Snapshot ---')).toBe(true);
  });

  it('ends with the separator footer', () => {
    const result = buildFlatDebugSnapshot('T', { a: 1, b: 'x' });
    expect(result.endsWith('-----------------------------------')).toBe(true);
  });

  it('renders multiple primitive entries in order', () => {
    const result = buildFlatDebugSnapshot('T', {
      teamCount: 3,
      loading: false,
      status: 'in-progress',
    });
    const lines = result.split('\n');
    expect(lines[1]).toBe('teamCount: 3');
    expect(lines[2]).toBe('loading: false');
    expect(lines[3]).toBe('status: in-progress');
  });
});
