import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { assertMutationResult } from './amplifyMutationResult';

const client = generateClient<Schema>();

export interface SyncTeamCalendarInput {
  teamId: string;
  feedUrl?: string;
  icsContent?: string;
  saveFeedUrl?: boolean;
  dryRun?: boolean;
}

/**
 * Thin wrapper over the `syncTeamCalendar` custom mutation — the only entry
 * point for both the pasted-URL and uploaded-file import paths (Derived
 * Decision B, parsing happens server-side for both). There is no
 * `client.models.CalendarFeed.*` call anywhere in this file or the rest of
 * the frontend: that model has no client grants at all (round-2 architecture
 * review Major A) — the feed URL is written and read only by
 * `syncTeamCalendar`/`unlinkTeamCalendar`'s Lambda handlers via the DynamoDB
 * SDK.
 */
export async function syncTeamCalendar(input: SyncTeamCalendarInput): Promise<NonNullable<Schema['syncTeamCalendar']['returnType']>> {
  const result = await client.mutations.syncTeamCalendar(input);
  return assertMutationResult(result, 'Failed to sync calendar');
}
