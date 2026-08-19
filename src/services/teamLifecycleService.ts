import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

const client = generateClient<Schema>();

function assertLifecycleResult<T>(
  result: { data?: T | null; errors?: Array<{ message?: string }> },
  fallbackMessage: string,
): NonNullable<T> {
  if (result.errors && result.errors.length > 0) {
    throw new Error(result.errors[0]?.message || fallbackMessage);
  }
  if (!result.data) {
    throw new Error(fallbackMessage);
  }
  return result.data as NonNullable<T>;
}

/** Owner-only. Marks the team archived and expires its pending invitations. Reversible via restoreTeam. */
export async function archiveTeam(teamId: string): Promise<NonNullable<Schema['archiveTeam']['returnType']>> {
  const result = await client.mutations.archiveTeam({ teamId });
  return assertLifecycleResult(result, 'Failed to archive team');
}

/** Owner-only. Reactivates an archived team. Does not revive invitations expired during archiving. */
export async function restoreTeam(teamId: string): Promise<NonNullable<Schema['restoreTeam']['returnType']>> {
  const result = await client.mutations.restoreTeam({ teamId });
  return assertLifecycleResult(result, 'Failed to restore team');
}

/** Any coach on the team. First-come-first-served claim for a legacy or orphaned-owner team. */
export async function assignTeamOwner(teamId: string): Promise<NonNullable<Schema['assignTeamOwner']['returnType']>> {
  const result = await client.mutations.assignTeamOwner({ teamId });
  return assertLifecycleResult(result, 'Failed to assign team owner');
}
