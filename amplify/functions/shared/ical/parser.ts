// Generic RFC-5545 core: line unfolding, property/parameter parsing, VEVENT
// extraction, and timezone-aware wall-time -> UTC conversion. Provider-
// specific interpretation (opponent/home-away/venue prose) lives in
// amplify/functions/shared/ical/adapters/*, not here.
//
// See docs/plans/CALENDAR-FEED-GAME-IMPORT-PLAN.md, "Parsing the real feed —
// the traps" for the concrete cases this file exists to handle.

// ---------------------------------------------------------------------------
// Parser DoS caps (Security requirements, item 5). Bail with a clear error
// rather than looping unbounded on a hostile or corrupt payload.
// ---------------------------------------------------------------------------
export const MAX_VEVENTS = 2000;
export const MAX_UNFOLDED_LINES = 100000;
export const MAX_PROPERTY_VALUE_LENGTH = 10000;

export interface ICalProperty {
  value: string;
  params: Record<string, string>;
}

export interface ICalEvent {
  // Property name (already upper-cased) -> all occurrences in source order.
  // Adapters read the first occurrence via getProp/getPropParams; the array
  // is kept in case a future adapter needs a repeated property (e.g. RDATE).
  properties: Record<string, ICalProperty[]>;
}

export interface ICalCalendar {
  prodId?: string;
  calName?: string;
  timezone?: string; // X-WR-TIMEZONE
  method?: string;
}

export interface ParsedICalendar {
  calendar: ICalCalendar;
  events: ICalEvent[];
  warnings: string[];
}

export class ICalParseError extends Error {}

/**
 * Strip a UTF-8 BOM if present, then unfold physical line continuations
 * (CRLF, or bare LF as a tolerant fallback for non-conformant producers,
 * followed by exactly one space or tab) before anything else touches the
 * content. Consuming zero or two spaces corrupts folded values — see the
 * plan's event-3 DESCRIPTION example.
 */
function unfoldLines(raw: string): string[] {
  let text = raw;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  // Normalize all line-ending styles to \n first so the fold-detection regex
  // below only has to handle one case. This intentionally happens BEFORE
  // fold-joining: a fold is "\n " (or "\r\n "), and once CRLF is
  // normalized to LF, folds are just "\n" followed by a single space/tab.
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const rawLines = normalized.split('\n');
  if (rawLines.length > MAX_UNFOLDED_LINES) {
    throw new ICalParseError(`Calendar feed exceeds ${MAX_UNFOLDED_LINES} lines`);
  }

  const unfolded: string[] = [];
  for (const line of rawLines) {
    if (
      (line.startsWith(' ') || line.startsWith('\t')) &&
      unfolded.length > 0
    ) {
      // Continuation of the previous logical line: drop exactly the one
      // leading fold character, then append.
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }

  return unfolded.filter((l) => l.length > 0);
}

/** Unescape RFC-5545 TEXT value escaping: \n, \N, \, \; \\ — in that logical
 * order (backslash-escapes are resolved left to right over the raw string;
 * order here only matters in that \\n must not be re-interpreted after \\
 * has already been unescaped, hence the single-pass regex below). */
function unescapeValue(value: string): string {
  return value.replace(/\\(n|N|,|;|\\)/g, (_match, ch: string) => {
    if (ch === 'n' || ch === 'N') return '\n';
    return ch;
  });
}

/** Split a single unfolded content line into NAME, PARAMS, VALUE. Scans for
 * the first unquoted colon, since parameter values may themselves contain a
 * colon only inside double quotes (RFC 5545 §3.2). */
function splitContentLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  let inQuotes = false;
  let colonIndex = -1;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ':' && !inQuotes) {
      colonIndex = i;
      break;
    }
  }

  if (colonIndex === -1) {
    return null;
  }

  const head = line.slice(0, colonIndex);
  const rawValue = line.slice(colonIndex + 1);
  const value = rawValue.length > MAX_PROPERTY_VALUE_LENGTH
    ? rawValue.slice(0, MAX_PROPERTY_VALUE_LENGTH)
    : rawValue;

  const segments = head.split(';');
  const name = (segments.shift() ?? '').trim().toUpperCase();
  const params: Record<string, string> = {};
  for (const segment of segments) {
    const eqIndex = segment.indexOf('=');
    if (eqIndex === -1) continue;
    const paramName = segment.slice(0, eqIndex).trim().toUpperCase();
    let paramValue = segment.slice(eqIndex + 1).trim();
    if (paramValue.startsWith('"') && paramValue.endsWith('"') && paramValue.length >= 2) {
      paramValue = paramValue.slice(1, -1);
    }
    params[paramName] = paramValue;
  }

  return { name, params, value };
}

/** Parse a full `.ics` document into calendar metadata + a flat list of
 * VEVENT blocks. Unfold-then-unescape order matters (see module doc). */
export function parseICalendar(raw: string): ParsedICalendar {
  const warnings: string[] = [];
  const lines = unfoldLines(raw);

  if (!lines.some((l) => l.trim().toUpperCase() === 'BEGIN:VCALENDAR')) {
    throw new ICalParseError('Not a valid iCalendar file (missing BEGIN:VCALENDAR)');
  }

  const calendar: ICalCalendar = {};
  const events: ICalEvent[] = [];
  let currentEvent: ICalEvent | null = null;
  let inEvent = false;

  for (const rawLine of lines) {
    const parsed = splitContentLine(rawLine);
    if (!parsed) continue;
    const { name, params, value } = parsed;

    if (name === 'BEGIN' && value.toUpperCase() === 'VEVENT') {
      if (events.length >= MAX_VEVENTS) {
        throw new ICalParseError(`Calendar feed exceeds ${MAX_VEVENTS} events`);
      }
      inEvent = true;
      currentEvent = { properties: {} };
      continue;
    }

    if (name === 'END' && value.toUpperCase() === 'VEVENT') {
      if (currentEvent) {
        events.push(currentEvent);
      }
      currentEvent = null;
      inEvent = false;
      continue;
    }

    const unescaped = unescapeValue(value);

    if (inEvent && currentEvent) {
      if (name === 'RRULE') {
        warnings.push('RRULE on a VEVENT is not supported in v1 and was skipped for that event.');
      }
      if (!currentEvent.properties[name]) {
        currentEvent.properties[name] = [];
      }
      currentEvent.properties[name].push({ value: unescaped, params });
    } else {
      // Calendar-level properties.
      if (name === 'PRODID') calendar.prodId = unescaped;
      if (name === 'X-WR-CALNAME') calendar.calName = unescaped;
      if (name === 'X-WR-TIMEZONE') calendar.timezone = unescaped;
      if (name === 'METHOD') calendar.method = unescaped;
    }
  }

  if (events.length === 0) {
    warnings.push('No VEVENT blocks found in this calendar feed.');
  }

  return { calendar, events, warnings };
}

/** First occurrence of a property's unescaped value, or undefined. */
export function getProp(event: ICalEvent, name: string): string | undefined {
  return event.properties[name]?.[0]?.value;
}

/** First occurrence's parameters for a property, or an empty object. */
export function getPropParams(event: ICalEvent, name: string): Record<string, string> {
  return event.properties[name]?.[0]?.params ?? {};
}

// ---------------------------------------------------------------------------
// Timezone conversion (zonedWallTimeToUtc)
// ---------------------------------------------------------------------------

export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function getWallParts(utcMs: number, tzid: string): WallParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tzid,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const map: Record<string, string> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === '24' ? '0' : map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** `local time (ms since epoch, as if UTC) - actual UTC time (ms)` for the
 * given real instant, i.e. how far ahead of UTC the zone's wall clock reads
 * at that moment. Positive for zones east of UTC, negative west. */
function getTzOffsetMs(utcMs: number, tzid: string): number {
  const wall = getWallParts(utcMs, tzid);
  const asIfUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asIfUtc - utcMs;
}

function wallEquals(a: WallParts, b: WallTime): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day &&
    a.hour === b.hour && a.minute === b.minute && a.second === b.second;
}

/**
 * Resolve a local wall-clock time in `tzid` to a UTC ISO string, using
 * `Intl.DateTimeFormat` (Node 22 ships full ICU, so no date library is
 * needed — see the plan's "No date library in dependencies" finding).
 *
 * DST boundary rule (plan Risk 8, decided): a nonexistent spring-forward
 * wall time is shifted forward by the transition gap; an ambiguous
 * fall-back wall time uses the earlier (pre-transition) offset. Verified
 * against America/Chicago, the only zone this feature's fixtures exercise —
 * the tie-break (`Math.min`/`Math.max` over the two candidate instants)
 * generalizes correctly to any zone where the DST offset is algebraically
 * larger than standard time (true for every zone TeamTrack currently
 * supports), but is not proven for the opposite convention.
 */
export function zonedWallTimeToUtc(wall: WallTime, tzid: string): string {
  const guessUtcMs = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);

  const offsetA = getTzOffsetMs(guessUtcMs, tzid);
  const candidateA = guessUtcMs - offsetA;

  const offsetB = getTzOffsetMs(candidateA, tzid);
  const candidateB = guessUtcMs - offsetB;

  const aValid = wallEquals(getWallParts(candidateA, tzid), wall);
  const bValid = wallEquals(getWallParts(candidateB, tzid), wall);

  let resultMs: number;
  if (aValid && !bValid) {
    resultMs = candidateA;
  } else if (bValid && !aValid) {
    resultMs = candidateB;
  } else if (aValid && bValid) {
    // Ambiguous fall-back hour: both instants round-trip to the same wall
    // time. Use the earlier (pre-transition / DST) offset.
    resultMs = Math.min(candidateA, candidateB);
  } else {
    // Nonexistent spring-forward hour: neither instant round-trips. Shift
    // forward by the gap (use the later, post-transition offset).
    resultMs = Math.max(candidateA, candidateB);
  }

  return new Date(resultMs).toISOString();
}

/** Parse a raw RFC-5545 DATE-TIME value (`20260912T110000`,
 * `20260912T160000Z`) into its wall-clock components. Returns null if the
 * value doesn't match the expected shape. */
export function parseRawDateTime(value: string): (WallTime & { isUtc: boolean }) | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value.trim());
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
    isUtc: Boolean(match[7]),
  };
}

/**
 * Resolve a VEVENT's DTSTART (or any DATE-TIME property) to a UTC ISO
 * string, handling all three cases the plan calls out:
 * - `Z`-suffixed: used directly.
 * - `TZID=...` parameter: resolved via `zonedWallTimeToUtc`.
 * - Floating (no TZID, no `Z`): falls back to the calendar's
 *   `X-WR-TIMEZONE`, then to UTC.
 */
export function resolveDateTimeToUtcIso(
  value: string,
  params: Record<string, string>,
  calendarTimezone: string | undefined,
): string | null {
  const wall = parseRawDateTime(value);
  if (!wall) return null;

  if (wall.isUtc) {
    return new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)).toISOString();
  }

  const tzid = params.TZID || calendarTimezone;
  if (tzid) {
    return zonedWallTimeToUtc(wall, tzid);
  }

  // Floating time with no calendar-level timezone hint: fall back to UTC.
  return new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)).toISOString();
}
