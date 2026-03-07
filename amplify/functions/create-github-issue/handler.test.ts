import { describe, it, expect, vi } from 'vitest';
import {
  sanitizeSeverity,
  buildIssueTitle,
  buildIssueBody,
  resolveLabels,
  validateInputLengths,
  parseSystemInfo,
  MAX_DESCRIPTION_LENGTH,
  MAX_STEPS_LENGTH,
} from './handler';

// ---------------------------------------------------------------------------
// Mock DynamoDB and fetch so handler can be imported in tests
// ---------------------------------------------------------------------------
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(function () { return {}; }),
}));
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: vi.fn() })) },
  UpdateCommand: vi.fn(),
}));

// ---------------------------------------------------------------------------
// sanitizeSeverity
// ---------------------------------------------------------------------------
describe('sanitizeSeverity', () => {
  it('passes through valid severities', () => {
    expect(sanitizeSeverity('low')).toBe('low');
    expect(sanitizeSeverity('medium')).toBe('medium');
    expect(sanitizeSeverity('high')).toBe('high');
    expect(sanitizeSeverity('feature-request')).toBe('feature-request');
  });

  it('falls back to medium for unknown values', () => {
    expect(sanitizeSeverity('critical')).toBe('medium');
    expect(sanitizeSeverity('')).toBe('medium');
    expect(sanitizeSeverity('INVALID')).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
// buildIssueTitle
// ---------------------------------------------------------------------------
describe('buildIssueTitle', () => {
  it('returns first 80 chars of description', () => {
    const long = 'A'.repeat(120);
    expect(buildIssueTitle(long)).toHaveLength(80);
  });

  it('replaces newlines with spaces', () => {
    const title = buildIssueTitle('Line one\nLine two\r\nLine three');
    expect(title).not.toContain('\n');
    expect(title).toContain('Line one Line two Line three');
  });

  it('returns short descriptions unchanged', () => {
    expect(buildIssueTitle('Short description')).toBe('Short description');
  });
});

// ---------------------------------------------------------------------------
// buildIssueBody
// ---------------------------------------------------------------------------
describe('buildIssueBody', () => {
  const sysInfo = {
    version: '1.2.0',
    userAgent: 'Mozilla/5.0',
    screenSize: '390x844',
    viewport: '390x800',
    url: 'https://coachteamtrack.com/game/123',
    timestamp: '2026-03-07T14:00:00.000Z',
  };

  it('includes description and footer sentinel', () => {
    const body = buildIssueBody('The timer is broken', undefined, sysInfo, 'coach@example.com');
    expect(body).toContain('## Description');
    expect(body).toContain('The timer is broken');
    expect(body).toContain('_Filed automatically by TeamTrack in-app bug reporter_');
  });

  it('shows "Not provided" when steps are absent', () => {
    const body = buildIssueBody('desc', undefined, sysInfo, 'a@b.com');
    expect(body).toContain('_Not provided_');
  });

  it('embeds provided steps', () => {
    const body = buildIssueBody('desc', '1. Go here\n2. Click', sysInfo, 'a@b.com');
    expect(body).toContain('1. Go here');
  });

  it('includes system info rows', () => {
    const body = buildIssueBody('desc', undefined, sysInfo, 'coach@example.com');
    expect(body).toContain('1.2.0');
    expect(body).toContain('390x844');
    expect(body).toContain('coach@example.com');
  });
});

// ---------------------------------------------------------------------------
// resolveLabels
// ---------------------------------------------------------------------------
describe('resolveLabels', () => {
  it('returns ["bug", "severity:high"] for a high-severity BUG', () => {
    expect(resolveLabels('BUG', 'high')).toEqual(['bug', 'severity:high']);
  });

  it('returns ["enhancement"] for a FEATURE_REQUEST (no severity label)', () => {
    expect(resolveLabels('FEATURE_REQUEST', 'feature-request')).toEqual(['enhancement']);
  });

  it('returns ["bug", "severity:medium"] for unknown severity', () => {
    expect(resolveLabels('BUG', 'UNKNOWN')).toEqual(['bug', 'severity:medium']);
  });

  it('returns ["bug", "severity:low"] for low severity', () => {
    expect(resolveLabels('BUG', 'low')).toEqual(['bug', 'severity:low']);
  });
});

// ---------------------------------------------------------------------------
// validateInputLengths
// ---------------------------------------------------------------------------
describe('validateInputLengths', () => {
  it('throws when description is empty', () => {
    expect(() => validateInputLengths('')).toThrow('Description is required');
    expect(() => validateInputLengths('   ')).toThrow('Description is required');
  });

  it(`throws when description exceeds ${MAX_DESCRIPTION_LENGTH} chars`, () => {
    expect(() => validateInputLengths('x'.repeat(MAX_DESCRIPTION_LENGTH + 1))).toThrow('Description must be under');
  });

  it(`throws when steps exceed ${MAX_STEPS_LENGTH} chars`, () => {
    expect(() => validateInputLengths('valid desc', 'x'.repeat(MAX_STEPS_LENGTH + 1))).toThrow('Steps must be under');
  });

  it('does not throw for valid input', () => {
    expect(() => validateInputLengths('A valid description', '1. Step one')).not.toThrow();
  });

  it('does not throw when steps are undefined', () => {
    expect(() => validateInputLengths('A valid description', undefined)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseSystemInfo
// ---------------------------------------------------------------------------
describe('parseSystemInfo', () => {
  it('parses a valid JSON string', () => {
    const parsed = parseSystemInfo('{"version":"1.0","viewport":"375x812"}');
    expect(parsed.version).toBe('1.0');
    expect(parsed.viewport).toBe('375x812');
  });

  it('returns empty object for undefined', () => {
    expect(parseSystemInfo(undefined)).toEqual({});
  });

  it('returns empty object for invalid JSON', () => {
    expect(parseSystemInfo('not-json')).toEqual({});
  });
});
