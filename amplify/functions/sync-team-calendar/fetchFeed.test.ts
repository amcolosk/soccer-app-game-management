// @vitest-environment node
//
// vitest.config.ts sets `jsdom` globally; this repo has documented full-suite
// flakiness under default test concurrency (see the "Vitest Full-Suite
// Flakiness" memory note) that a network-dependent test would only add to.
// Mocked dns/fetch only — no real network or DNS dependency.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLookup = vi.hoisted(() => vi.fn());

vi.mock('dns/promises', () => ({
  lookup: mockLookup,
}));

import { fetchFeed, FeedFetchError } from './fetchFeed';

function textResponse(body: string, init: { status?: number; contentType?: string; contentLength?: string } = {}) {
  const headers = new Headers();
  headers.set('content-type', init.contentType ?? 'text/calendar');
  if (init.contentLength) headers.set('content-length', init.contentLength);
  return new Response(body, { status: init.status ?? 200, headers });
}

function redirectResponse(location: string) {
  const headers = new Headers();
  headers.set('location', location);
  return new Response(null, { status: 302, headers });
}

describe('fetchFeed — SSRF hardening', () => {
  beforeEach(() => {
    mockLookup.mockReset();
    mockLookup.mockResolvedValue([{ address: '203.0.113.10' }]); // TEST-NET-3 public-looking address
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('rejects http:// scheme', async () => {
    await expect(fetchFeed('http://calendar.playmetrics.com/x')).rejects.toThrow(FeedFetchError);
  });

  it('rejects file:// scheme', async () => {
    await expect(fetchFeed('file:///etc/passwd')).rejects.toThrow(FeedFetchError);
  });

  it('rejects a raw IP-literal host (not on the allowlist)', async () => {
    await expect(fetchFeed('https://169.254.169.254/latest/meta-data/')).rejects.toThrow(FeedFetchError);
  });

  it('rejects "localhost" as a host (not on the allowlist)', async () => {
    await expect(fetchFeed('https://localhost/feed.ics')).rejects.toThrow(FeedFetchError);
  });

  it('rejects a host outside the allowlist', async () => {
    await expect(fetchFeed('https://evil.example.com/feed.ics')).rejects.toThrow(/supported list/i);
  });

  it('never attempts a connection for a disallowed host (fetch is not called)', async () => {
    await expect(fetchFeed('https://evil.example.com/feed.ics')).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects when the allowlisted host resolves to a private/link-local address (169.254.169.254 metadata endpoint)', async () => {
    mockLookup.mockResolvedValue([{ address: '169.254.169.254' }]);
    await expect(fetchFeed('https://calendar.playmetrics.com/feed.ics')).rejects.toThrow(/disallowed address/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects when the allowlisted host resolves to an RFC1918 address', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.5' }]);
    await expect(fetchFeed('https://calendar.playmetrics.com/feed.ics')).rejects.toThrow(/disallowed address/i);
  });

  it('rejects when the allowlisted host resolves to loopback', async () => {
    mockLookup.mockResolvedValue([{ address: '127.0.0.1' }]);
    await expect(fetchFeed('https://calendar.playmetrics.com/feed.ics')).rejects.toThrow(/disallowed address/i);
  });

  it('rejects when the allowlisted host resolves to an IPv6 loopback/ULA', async () => {
    mockLookup.mockResolvedValue([{ address: '::1' }]);
    await expect(fetchFeed('https://calendar.playmetrics.com/feed.ics')).rejects.toThrow(/disallowed address/i);
  });

  it('re-validates the host/IP after every redirect (DNS-rebinding-shaped: second lookup for the same host returns a private IP)', async () => {
    mockLookup
      .mockResolvedValueOnce([{ address: '203.0.113.10' }]) // first hop: public
      .mockResolvedValueOnce([{ address: '169.254.169.254' }]); // second hop (post-redirect): private
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(redirectResponse('https://calendar.playmetrics.com/feed2.ics'));

    await expect(fetchFeed('https://calendar.playmetrics.com/feed.ics')).rejects.toThrow(/disallowed address/i);
  });

  it('never follows a cross-scheme (https -> http) redirect', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(redirectResponse('http://calendar.playmetrics.com/feed.ics'));
    await expect(fetchFeed('https://calendar.playmetrics.com/feed.ics')).rejects.toThrow(/disallowed scheme/i);
  });

  it('caps the number of redirects followed', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(redirectResponse('https://calendar.playmetrics.com/feed.ics'));
    await expect(fetchFeed('https://calendar.playmetrics.com/feed.ics')).rejects.toThrow(/too many redirects/i);
  });

  it('follows an allowed redirect (same allowlisted host) to a successful response', async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(redirectResponse('https://calendar.playmetrics.com/feed2.ics'))
      .mockResolvedValueOnce(textResponse('BEGIN:VCALENDAR\nEND:VCALENDAR\n'));

    const result = await fetchFeed('https://calendar.playmetrics.com/feed.ics');
    expect(result).toContain('BEGIN:VCALENDAR');
  });

  it('rejects a response whose Content-Length exceeds the cap', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      textResponse('x'.repeat(10), { contentLength: String(300 * 1024) }),
    );
    await expect(fetchFeed('https://calendar.playmetrics.com/feed.ics')).rejects.toThrow(/too large/i);
  });

  it('rejects a streamed response that exceeds the byte cap even without an honest Content-Length', async () => {
    const bigChunk = new Uint8Array(300 * 1024).fill(97);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bigChunk);
        controller.close();
      },
    });
    const headers = new Headers();
    headers.set('content-type', 'text/calendar');
    const response = new Response(stream, { status: 200, headers });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(response);

    await expect(fetchFeed('https://calendar.playmetrics.com/feed.ics')).rejects.toThrow(/too large/i);
  });

  it('rejects a disallowed content type', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      textResponse('<html>not a calendar</html>', { contentType: 'text/html' }),
    );
    await expect(fetchFeed('https://calendar.playmetrics.com/feed.ics')).rejects.toThrow(/content type/i);
  });

  it('rejects a non-2xx, non-redirect response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(textResponse('nope', { status: 404 }));
    await expect(fetchFeed('https://calendar.playmetrics.com/feed.ics')).rejects.toThrow(/status 404/i);
  });

  it('rejects on timeout', async () => {
    vi.useFakeTimers();
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((_url: string, opts: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }));

    const promise = fetchFeed('https://calendar.playmetrics.com/feed.ics');
    const assertion = expect(promise).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(10_001);
    await assertion;
  });

  it('accepts text/plain in addition to text/calendar', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      textResponse('BEGIN:VCALENDAR\nEND:VCALENDAR\n', { contentType: 'text/plain' }),
    );
    const result = await fetchFeed('https://calendar.playmetrics.com/feed.ics');
    expect(result).toContain('BEGIN:VCALENDAR');
  });

  it('never includes the URL itself in a thrown error message', async () => {
    try {
      await fetchFeed('https://evil.example.com/super-secret-token-path');
      throw new Error('expected fetchFeed to reject');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('evil.example.com');
      expect(message).not.toContain('super-secret-token-path');
    }
  });
});
