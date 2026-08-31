import { lookup } from 'dns/promises';
import { isIP } from 'net';

// Security requirements (docs/plans/CALENDAR-FEED-GAME-IMPORT-PLAN.md,
// "Security requirements (must be in place before the URL path ships)").
// A Lambda fetching a user-supplied URL is an SSRF primitive. This module is
// deliberately the *only* place that issues the outbound request, so it can
// be unit-tested in isolation from the handler (mocked dns/fetch only — see
// fetchFeed.test.ts's `// @vitest-environment node` docblock).

// Item 7 (locked with product owner): host allowlist. This is
// **load-bearing**, not redundant with items 1-3 -- a pre-flight IP check
// alone is defeated by DNS rebinding (fetch() re-resolves at connect time,
// after our check). If this allowlist is ever generalized away, a
// connect-time `lookup` hook (e.g. an undici Agent) has to replace it.
const ALLOWED_HOSTS = new Set(['calendar.playmetrics.com']);

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const ALLOWED_CONTENT_TYPES = new Set(['text/calendar', 'text/plain']);

export class FeedFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedFetchError';
  }
}

function isPrivateOrSpecialIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true; // malformed -- fail closed
  }
  const [a, b] = parts;
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 0) return true; // "this network"
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254 metadata endpoint
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (RFC6598)
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isPrivateOrSpecialIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true; // loopback
  if (normalized.startsWith('fe80:') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true; // link-local fe80::/10
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // ULA fc00::/7
  if (normalized.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 -- validate the embedded v4 address.
    const embedded = normalized.slice('::ffff:'.length);
    if (isIP(embedded) === 4) return isPrivateOrSpecialIPv4(embedded);
    return true; // fail closed if not a recognizable embedded v4
  }
  return false;
}

function isPrivateOrSpecialIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateOrSpecialIPv4(ip);
  if (version === 6) return isPrivateOrSpecialIPv6(ip);
  return true; // unrecognized -- fail closed
}

/** Resolves `hostname` and rejects if any resolved address is private or
 * special-range. Re-run on every hop (including after each redirect) --
 * a pre-flight check alone is defeated by a redirect landing on a different
 * host. */
async function assertHostResolvesToPublicIp(hostname: string): Promise<void> {
  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new FeedFetchError('Could not resolve the calendar host');
  }
  if (addresses.length === 0) {
    throw new FeedFetchError('Could not resolve the calendar host');
  }
  for (const { address } of addresses) {
    if (isPrivateOrSpecialIp(address)) {
      throw new FeedFetchError('Calendar host resolves to a disallowed address');
    }
  }
}

function assertAllowedUrl(url: URL): void {
  // Item 1: scheme allowlist.
  if (url.protocol !== 'https:') {
    throw new FeedFetchError('Only https calendar URLs are supported');
  }
  // Item 7: host allowlist, checked before any connection is attempted.
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new FeedFetchError('Calendar host is not on the supported list');
  }
}

/**
 * Fetch a calendar feed URL with the full SSRF hardening stack: scheme +
 * host allowlist, private/special-IP host validation re-checked after every
 * redirect, a redirect cap, and response size/timeout/content-type caps.
 * Returns the response body as text. Never includes the URL itself in a
 * thrown error message (item 6 -- the message may end up persisted in
 * `Team.calendarFeedLastError` and rendered back to the coach).
 */
export async function fetchFeed(rawUrl: string): Promise<string> {
  let currentUrl: URL;
  try {
    currentUrl = new URL(rawUrl);
  } catch {
    throw new FeedFetchError('Invalid calendar URL');
  }

  for (let redirectCount = 0; ; redirectCount += 1) {
    assertAllowedUrl(currentUrl);
    await assertHostResolvesToPublicIp(currentUrl.hostname);

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(currentUrl.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'TeamTrack-CalendarSync/1.0' },
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new FeedFetchError('Timed out fetching the calendar feed');
      }
      throw new FeedFetchError('Could not fetch the calendar feed');
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (response.status >= 300 && response.status < 400) {
      if (redirectCount >= MAX_REDIRECTS) {
        throw new FeedFetchError('Too many redirects fetching the calendar feed');
      }
      const location = response.headers.get('location');
      if (!location) {
        throw new FeedFetchError('Calendar feed redirected with no destination');
      }
      let nextUrl: URL;
      try {
        nextUrl = new URL(location, currentUrl);
      } catch {
        throw new FeedFetchError('Calendar feed redirected to an invalid URL');
      }
      // Never follow a cross-scheme redirect (item 3).
      if (nextUrl.protocol !== 'https:') {
        throw new FeedFetchError('Calendar feed redirected to a disallowed scheme');
      }
      currentUrl = nextUrl;
      continue; // loop re-validates scheme/host/IP for the new URL
    }

    if (!response.ok) {
      throw new FeedFetchError(`Calendar feed request failed with status ${response.status}`);
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new FeedFetchError('Calendar feed returned an unexpected content type');
    }

    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader && Number(contentLengthHeader) > MAX_RESPONSE_BYTES) {
      throw new FeedFetchError('Calendar feed response is too large');
    }

    if (!response.body) {
      return await response.text();
    }

    // Stream with a hard byte cap even when Content-Length is absent or
    // understates the true size.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new FeedFetchError('Calendar feed response is too large');
        }
        chunks.push(value);
      }
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
  }
}
