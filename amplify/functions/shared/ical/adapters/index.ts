import type { ICalCalendar } from '../parser';
import { playmetricsAdapter } from './playmetrics';
import { genericAdapter } from './generic';
import type { Adapter } from './types';

export type { Adapter, AdapterContext, GameImportRecord } from './types';
export { playmetricsAdapter } from './playmetrics';
export { genericAdapter } from './generic';

/** Adapter selection by PRODID / X-WR-* (Decision 4: generic core + pluggable
 * provider adapters). PlayMetrics is tried first; anything else falls back
 * to the generic adapter. */
export function selectAdapter(calendar: ICalCalendar): Adapter {
  if (playmetricsAdapter.detect(calendar)) {
    return playmetricsAdapter;
  }
  return genericAdapter;
}
