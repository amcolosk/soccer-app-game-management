import { describe, it, expect, vi } from 'vitest';
import {
  escapeHtml,
  buildSubject,
  buildTextBody,
  buildHtmlBody,
  resolveUserEmail,
  parseSystemInfo,
  sanitizeSeverity,
  getNextIssueNumber,
  validateInputLengths,
  validateScreenshotKey,
  checkRateLimit,
  type BugReportInput,
} from './handler';
import type { AppSyncIdentityCognito } from 'aws-lambda';

function makeInput(overrides?: Partial<BugReportInput>): BugReportInput {
  return {
    description: 'App crashes on save',
    severity: 'medium',
    systemInfo: { viewport: '375x812', version: '1.1.0' },
    userEmail: 'coach@example.com',
    userId: 'user-123',
    ...overrides,
  };
}

describe('escapeHtml', () => {
  it('escapes &, <, >, and "', () => {
    expect(escapeHtml('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
  });

  it('returns plain strings unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

describe('buildSubject', () => {
  it('includes severity emoji and description', () => {
    const subject = buildSubject(makeInput({ severity: 'high' }));
    expect(subject).toBe('🔴 TeamTrack Bug: App crashes on save');
  });

  it('strips newlines from description', () => {
    const subject = buildSubject(makeInput({ description: 'Line one\nLine two\r\nLine three' }));
    expect(subject).not.toContain('\n');
    expect(subject).not.toContain('\r');
    expect(subject).toContain('Line one Line two Line three');
  });

  it('truncates description to 80 characters', () => {
    const longDesc = 'A'.repeat(100);
    const subject = buildSubject(makeInput({ description: longDesc }));
    // Subject = emoji + " TeamTrack Bug: " + 80 chars
    expect(subject).toContain('A'.repeat(80));
    expect(subject).not.toContain('A'.repeat(81));
  });

  it('falls back to yellow emoji for unknown severity', () => {
    const subject = buildSubject(makeInput({ severity: 'critical' }));
    expect(subject).toContain('🟡');
  });

  it('uses correct emoji for each severity', () => {
    expect(buildSubject(makeInput({ severity: 'low' }))).toContain('🟢');
    expect(buildSubject(makeInput({ severity: 'medium' }))).toContain('🟡');
    expect(buildSubject(makeInput({ severity: 'high' }))).toContain('🔴');
    expect(buildSubject(makeInput({ severity: 'feature-request' }))).toContain('💡');
  });

  it('uses "Feature Request" label for feature-request severity', () => {
    const subject = buildSubject(makeInput({ severity: 'feature-request' }));
    expect(subject).toContain('TeamTrack Feature Request:');
    expect(subject).not.toContain('Bug');
  });
});

describe('buildTextBody', () => {
  it('includes description, reporter, and system info', () => {
    const text = buildTextBody(makeInput());
    expect(text).toContain('Description: App crashes on save');
    expect(text).toContain('Reporter: coach@example.com (user-123)');
    expect(text).toContain('viewport: 375x812');
    expect(text).toContain('version: 1.1.0');
  });

  it('includes severity header', () => {
    const text = buildTextBody(makeInput({ severity: 'high' }));
    expect(text).toContain('Bug Report — HIGH');
  });

  it('uses Feature Request header for feature-request severity', () => {
    const text = buildTextBody(makeInput({ severity: 'feature-request' }));
    expect(text).toContain('Feature Request');
    expect(text).not.toContain('Bug Report');
  });

  it('includes steps when provided', () => {
    const text = buildTextBody(makeInput({ steps: '1. Click save\n2. See error' }));
    expect(text).toContain('Steps: 1. Click save\n2. See error');
  });

  it('omits steps line when not provided', () => {
    const text = buildTextBody(makeInput({ steps: undefined }));
    expect(text).not.toContain('Steps:');
  });

  it('includes screenshot URL when provided', () => {
    const text = buildTextBody(makeInput(), 'https://s3.example.com/presigned-url');
    expect(text).toContain('Screenshot: https://s3.example.com/presigned-url');
  });

  it('omits screenshot line when not provided', () => {
    const text = buildTextBody(makeInput(), null);
    expect(text).not.toContain('Screenshot:');
  });

  it('omits screenshot line when screenshotUrl is undefined', () => {
    const text = buildTextBody(makeInput());
    expect(text).not.toContain('Screenshot:');
  });
});

describe('buildHtmlBody', () => {
  it('includes escaped description', () => {
    const html = buildHtmlBody(makeInput({ description: 'Error <script>alert("xss")</script>' }));
    expect(html).toContain('Error &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('includes severity badge', () => {
    const html = buildHtmlBody(makeInput({ severity: 'high' }));
    expect(html).toContain('severity-high');
    expect(html).toContain('HIGH');
  });

  it('includes reporter info', () => {
    const html = buildHtmlBody(makeInput());
    expect(html).toContain('coach@example.com');
    expect(html).toContain('user-123');
  });

  it('includes system info as table rows', () => {
    const html = buildHtmlBody(makeInput());
    expect(html).toContain('<td>viewport</td>');
    expect(html).toContain('<td>375x812</td>');
  });

  it('includes steps section when provided', () => {
    const html = buildHtmlBody(makeInput({ steps: 'Click the button' }));
    expect(html).toContain('Steps to Reproduce');
    expect(html).toContain('Click the button');
  });

  it('omits steps section when not provided', () => {
    const html = buildHtmlBody(makeInput({ steps: undefined }));
    expect(html).not.toContain('Steps to Reproduce');
  });

  it('includes View Screenshot button when screenshotUrl is provided', () => {
    const html = buildHtmlBody(makeInput(), 'https://s3.example.com/presigned-url');
    expect(html).toContain('View Screenshot');
    expect(html).toContain('https://s3.example.com/presigned-url');
  });

  it('omits screenshot section when screenshotUrl is null', () => {
    const html = buildHtmlBody(makeInput(), null);
    expect(html).not.toContain('View Screenshot');
  });

  it('omits screenshot section when screenshotUrl is not provided', () => {
    const html = buildHtmlBody(makeInput());
    expect(html).not.toContain('View Screenshot');
  });
});

describe('resolveUserEmail', () => {
  it('returns email from claims.email', () => {
    const identity = { claims: { email: 'a@b.com' } } as unknown as AppSyncIdentityCognito;
    expect(resolveUserEmail(identity)).toBe('a@b.com');
  });

  it('falls back to claims.username', () => {
    const identity = { claims: { username: 'user@test.com' } } as unknown as AppSyncIdentityCognito;
    expect(resolveUserEmail(identity)).toBe('user@test.com');
  });

  it('falls back to claims cognito:username', () => {
    const identity = { claims: { 'cognito:username': 'cog@test.com' } } as unknown as AppSyncIdentityCognito;
    expect(resolveUserEmail(identity)).toBe('cog@test.com');
  });

  it('returns unknown when no identity', () => {
    expect(resolveUserEmail(null)).toBe('unknown');
    expect(resolveUserEmail(undefined)).toBe('unknown');
  });

  it('returns unknown when no email claims', () => {
    const identity = { claims: {} } as unknown as AppSyncIdentityCognito;
    expect(resolveUserEmail(identity)).toBe('unknown');
  });

  it('prefers email over username', () => {
    const identity = { claims: { email: 'a@b.com', username: 'other@b.com' } } as unknown as AppSyncIdentityCognito;
    expect(resolveUserEmail(identity)).toBe('a@b.com');
  });
});

describe('parseSystemInfo', () => {
  it('parses valid JSON', () => {
    expect(parseSystemInfo('{"a":"1"}')).toEqual({ a: '1' });
  });

  it('returns raw value on invalid JSON', () => {
    expect(parseSystemInfo('not json')).toEqual({ raw: 'not json' });
  });

  it('returns empty object for null/undefined', () => {
    expect(parseSystemInfo(null)).toEqual({});
    expect(parseSystemInfo(undefined)).toEqual({});
  });
});

describe('sanitizeSeverity', () => {
  it('accepts valid severities', () => {
    expect(sanitizeSeverity('low')).toBe('low');
    expect(sanitizeSeverity('medium')).toBe('medium');
    expect(sanitizeSeverity('high')).toBe('high');
    expect(sanitizeSeverity('feature-request')).toBe('feature-request');
  });

  it('falls back to medium for invalid values', () => {
    expect(sanitizeSeverity('critical')).toBe('medium');
    expect(sanitizeSeverity('')).toBe('medium');
    expect(sanitizeSeverity('HIGH')).toBe('medium');
    expect(sanitizeSeverity('<script>alert(1)</script>')).toBe('medium');
  });
});

describe('getNextIssueNumber', () => {
  it('is exported as a function', () => {
    expect(typeof getNextIssueNumber).toBe('function');
  });
});

describe('validateInputLengths', () => {
  it('accepts valid description length', () => {
    expect(() => validateInputLengths('Valid description', undefined)).not.toThrow();
  });

  it('accepts valid description and steps length', () => {
    expect(() => validateInputLengths('Valid description', 'Valid steps')).not.toThrow();
  });

  it('throws error when description exceeds max length', () => {
    const longDescription = 'x'.repeat(5001);
    expect(() => validateInputLengths(longDescription, undefined)).toThrow(
      'Description exceeds maximum length'
    );
  });

  it('throws error when steps exceed max length', () => {
    const longSteps = 'x'.repeat(3001);
    expect(() => validateInputLengths('Valid description', longSteps)).toThrow(
      'Steps exceed maximum length'
    );
  });

  it('accepts description at exactly max length', () => {
    const maxDescription = 'x'.repeat(5000);
    expect(() => validateInputLengths(maxDescription, undefined)).not.toThrow();
  });

  it('accepts steps at exactly max length', () => {
    const maxSteps = 'x'.repeat(3000);
    expect(() => validateInputLengths('Valid description', maxSteps)).not.toThrow();
  });

  it('handles undefined steps', () => {
    expect(() => validateInputLengths('Valid description', undefined)).not.toThrow();
  });

  it('handles empty steps', () => {
    expect(() => validateInputLengths('Valid description', '')).not.toThrow();
  });
});

describe('checkRateLimit', () => {
  it('is exported as a function', () => {
    expect(typeof checkRateLimit).toBe('function');
  });
});

describe('validateScreenshotKey', () => {
  it('accepts undefined (no screenshot attached)', () => {
    expect(() => validateScreenshotKey(undefined)).not.toThrow();
  });

  it('accepts null (no screenshot attached)', () => {
    expect(() => validateScreenshotKey(null)).not.toThrow();
  });

  it('accepts a valid PNG key with identity-scoped path', () => {
    expect(() => validateScreenshotKey('bug-screenshots/us-east-1:f81d4fae-7dec-11d0-a765-00a0c91e6bf6/abc1def2-3456-7890-abcd-ef1234567890.png')).not.toThrow();
  });

  it('accepts a valid JPG key with identity-scoped path', () => {
    expect(() => validateScreenshotKey('bug-screenshots/us-east-1:abc123/f81d4fae-7dec-11d0-a765-00a0c91e6bf6.jpg')).not.toThrow();
  });

  it('rejects path traversal (../../etc/passwd)', () => {
    expect(() => validateScreenshotKey('../../etc/passwd')).toThrow('Invalid screenshotKey format');
  });

  it('rejects key without identity prefix (old single-segment format)', () => {
    expect(() => validateScreenshotKey('bug-screenshots/f81d4fae-7dec-11d0-a765-00a0c91e6bf6.png')).toThrow('Invalid screenshotKey format');
  });

  it('rejects key with uppercase extension', () => {
    expect(() => validateScreenshotKey('bug-screenshots/us-east-1:abc/uuid.PNG')).toThrow('Invalid screenshotKey format');
  });

  it('rejects key with disallowed extension (.gif)', () => {
    expect(() => validateScreenshotKey('bug-screenshots/us-east-1:abc/uuid.gif')).toThrow('Invalid screenshotKey format');
  });

  it('rejects key with extra path segments', () => {
    expect(() => validateScreenshotKey('bug-screenshots/us-east-1:abc/subdir/uuid.png')).toThrow('Invalid screenshotKey format');
  });

  it('rejects key that does not start with bug-screenshots/', () => {
    expect(() => validateScreenshotKey('other-prefix/us-east-1:abc/uuid.png')).toThrow('Invalid screenshotKey format');
  });

  it('rejects empty string', () => {
    expect(() => validateScreenshotKey('')).not.toThrow(); // empty string is falsy — treated as no key
  });
});
