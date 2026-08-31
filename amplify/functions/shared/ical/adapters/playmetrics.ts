import { getProp, getPropParams, resolveDateTimeToUtcIso, zonedWallTimeToUtc, parseRawDateTime } from '../parser';
import type { Adapter, AdapterContext, GameImportRecord } from './types';

/**
 * PlayMetrics description-prose adapter. Detected via
 * `PRODID:-//PlayMetrics//EN`. See
 * docs/plans/CALENDAR-FEED-GAME-IMPORT-PLAN.md, "Parsing the real feed — the
 * traps" for the concrete data this logic is derived from, and
 * docs/specs/CALENDAR-IMPORT-SPEC.md for the grammar written up for future
 * adapter authors.
 */
export function detectPlaymetrics(prodId: string | undefined): boolean {
  return typeof prodId === 'string' && /playmetrics/i.test(prodId);
}

/** Strip a trailing " Games" from X-WR-CALNAME to recover "us" for the
 * home/away prose match, e.g. "Iowa United FC U13 Boys Navy Games" ->
 * "Iowa United FC U13 Boys Navy". */
export function deriveUsName(calName: string | undefined): string | null {
  if (!calName) return null;
  const trimmed = calName.trim();
  const match = /^(.*)\s+Games$/i.exec(trimmed);
  return (match ? match[1] : trimmed).trim() || null;
}

const ARRIVE_BY_RE = /Arrive by\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i;

function parseArriveByLine(line: string): { hour: number; minute: number } | null {
  const match = ARRIVE_BY_RE.exec(line);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3].toUpperCase();
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return { hour, minute };
}

function parseHomeAwayAndOpponent(
  descriptionLine0: string,
  us: string | null,
): { isHome: boolean; opponent: string; unverified: boolean; warning?: string } {
  if (us) {
    const awayPrefix = `${us} at `;
    const homeSuffix = ` at ${us}`;
    if (descriptionLine0.startsWith(awayPrefix)) {
      return { isHome: false, opponent: descriptionLine0.slice(awayPrefix.length).trim(), unverified: false };
    }
    if (descriptionLine0.endsWith(homeSuffix)) {
      return {
        isHome: true,
        opponent: descriptionLine0.slice(0, descriptionLine0.length - homeSuffix.length).trim(),
        unverified: false,
      };
    }
  }

  // Couldn't confidently place "us" in the prose (unknown alias, or the
  // description doesn't follow the "<away> at <home>" grammar). Fail safe
  // the same way the generic adapter does, rather than guessing.
  return {
    isHome: false,
    opponent: descriptionLine0.trim() || 'Opponent TBD',
    unverified: true,
    warning: 'Could not determine home/away from the event description — defaulted to away. Verify and correct manually.',
  };
}

export const playmetricsAdapter: Adapter = {
  name: 'playmetrics',
  detect: (calendar) => detectPlaymetrics(calendar.prodId),
  parseEvent: (event, ctx: AdapterContext): GameImportRecord | null => {
    const warnings: string[] = [];
    const uid = getProp(event, 'UID');
    if (!uid) {
      return null;
    }

    const dtstartValue = getProp(event, 'DTSTART');
    const dtstartParams = getPropParams(event, 'DTSTART');
    const gameDate = dtstartValue
      ? resolveDateTimeToUtcIso(dtstartValue, dtstartParams, ctx.calendar.timezone)
      : null;

    const description = getProp(event, 'DESCRIPTION') ?? '';
    const descLines = description.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

    const us = deriveUsName(ctx.calendar.calName);
    const line0 = descLines[0] ?? '';
    const { isHome, opponent, unverified, warning } = parseHomeAwayAndOpponent(line0, us);
    if (warning) warnings.push(warning);

    const locationProp = getProp(event, 'LOCATION');
    let locationName: string | null = null;
    let locationAddress: string | null = null;
    if (descLines.length >= 3 && descLines[2]) {
      locationName = descLines[2];
      locationAddress = locationProp ?? null;
    } else if (locationProp) {
      // Events 6/7 in the reference feed: only two description lines, venue
      // name lives in LOCATION with no street address at all.
      locationName = locationProp;
      locationAddress = null;
    }

    let arriveByTime: string | null = null;
    const arriveLine = descLines[1];
    if (arriveLine) {
      const parsedTime = parseArriveByLine(arriveLine);
      const dtstartWall = dtstartValue ? parseRawDateTime(dtstartValue) : null;
      const tzid = dtstartParams.TZID || ctx.calendar.timezone;
      if (parsedTime && dtstartWall && tzid) {
        const candidate = zonedWallTimeToUtc(
          { year: dtstartWall.year, month: dtstartWall.month, day: dtstartWall.day, hour: parsedTime.hour, minute: parsedTime.minute, second: 0 },
          tzid,
        );
        if (gameDate && new Date(candidate).getTime() >= new Date(gameDate).getTime()) {
          // An arrive-by time at or after kickoff indicates a misparsed
          // description line, not a real arrive-by time — drop it (plan
          // Risk 8).
          warnings.push('Parsed arrive-by time was not before kickoff and was dropped.');
        } else {
          arriveByTime = candidate;
        }
      }
    }

    const statusValue = getProp(event, 'STATUS');
    const cancelled = (statusValue ?? '').toUpperCase() === 'CANCELLED' ||
      (ctx.calendar.method ?? '').toUpperCase() === 'CANCEL';

    const sequenceValue = getProp(event, 'SEQUENCE');
    const externalSequence = sequenceValue !== undefined && sequenceValue.trim() !== '' && !Number.isNaN(Number(sequenceValue))
      ? Number(sequenceValue)
      : null;

    return {
      externalUid: uid,
      externalSource: 'playmetrics',
      externalSequence,
      opponent,
      isHome,
      gameDate,
      locationName,
      locationAddress,
      arriveByTime,
      cancelled,
      homeAwayUnverified: unverified,
      warnings,
    };
  },
};
