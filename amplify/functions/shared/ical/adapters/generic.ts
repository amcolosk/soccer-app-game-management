import { getProp, getPropParams, resolveDateTimeToUtcIso } from '../parser';
import type { Adapter, AdapterContext, GameImportRecord } from './types';

/**
 * Fallback adapter for any feed that doesn't match a known provider's
 * PRODID. `isHome` is `.required()` on `Game` with no schema default, so
 * "leave it at the existing default" (architecture review Major 7a) was
 * never a real option — this adapter always sets `isHome: false` plus
 * `externalHomeAwayUnverified: true` plus a warning when it can't determine
 * home/away, which for a generic feed is always (there's no provider-
 * specific grammar to parse). Likewise `opponent` is `.required()`: falls
 * back to a literal "Opponent TBD" plus a warning when SUMMARY is empty.
 */
export const genericAdapter: Adapter = {
  name: 'generic',
  detect: () => true, // catch-all; adapters/index.ts tries this last
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

    const summary = (getProp(event, 'SUMMARY') ?? '').trim();
    let opponent = summary;
    if (!opponent) {
      opponent = 'Opponent TBD';
      warnings.push('Event had no SUMMARY to derive an opponent name from.');
    }

    warnings.push('Generic adapter cannot determine home/away for this provider — defaulted to away. Verify and correct manually.');

    const locationName = getProp(event, 'LOCATION') ?? null;

    const statusValue = getProp(event, 'STATUS');
    const cancelled = (statusValue ?? '').toUpperCase() === 'CANCELLED' ||
      (ctx.calendar.method ?? '').toUpperCase() === 'CANCEL';

    const sequenceValue = getProp(event, 'SEQUENCE');
    const externalSequence = sequenceValue !== undefined && sequenceValue.trim() !== '' && !Number.isNaN(Number(sequenceValue))
      ? Number(sequenceValue)
      : null;

    return {
      externalUid: uid,
      externalSource: 'ics',
      externalSequence,
      opponent,
      isHome: false,
      gameDate,
      locationName,
      locationAddress: null,
      arriveByTime: null,
      cancelled,
      homeAwayUnverified: true,
      warnings,
    };
  },
};
