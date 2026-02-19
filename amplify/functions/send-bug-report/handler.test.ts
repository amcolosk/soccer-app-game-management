import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  buildSubject,
  buildTextBody,
  buildHtmlBody,
  resolveUserEmail,
  parseSystemInfo,
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

  it('includes steps when provided', () => {
    const text = buildTextBody(makeInput({ steps: '1. Click save\n2. See error' }));
    expect(text).toContain('Steps: 1. Click save\n2. See error');
  });

  it('omits steps line when not provided', () => {
    const text = buildTextBody(makeInput({ steps: undefined }));
    expect(text).not.toContain('Steps:');
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
