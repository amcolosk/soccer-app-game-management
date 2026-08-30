import type { ICalCalendar, ICalEvent } from '../parser';

/** One feed event translated into the shape the sync handler writes to
 * `Game`. `externalUid`/`externalSource` are the dedupe key (Reconciliation
 * rules, matching precedence step 1). */
export interface GameImportRecord {
  externalUid: string;
  externalSource: string;
  externalSequence: number | null;
  opponent: string;
  isHome: boolean;
  gameDate: string | null; // UTC ISO
  locationName: string | null;
  locationAddress: string | null;
  arriveByTime: string | null; // UTC ISO
  cancelled: boolean;
  homeAwayUnverified: boolean;
  warnings: string[];
}

export interface AdapterContext {
  calendar: ICalCalendar;
}

export interface Adapter {
  name: string;
  /** Whether this adapter should handle the given calendar (PRODID sniff). */
  detect: (calendar: ICalCalendar) => boolean;
  /** Translate one VEVENT into a GameImportRecord, or null to skip it
   * (e.g. missing UID). */
  parseEvent: (event: ICalEvent, ctx: AdapterContext) => GameImportRecord | null;
}
