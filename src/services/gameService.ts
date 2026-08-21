import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { assertMutationResult } from './amplifyMutationResult';

const client = generateClient<Schema>();

export interface CreateGameInput {
  teamId: string;
  opponent: string;
  isHome: boolean;
  gameDate?: string;
}

/**
 * Any coach on the team. Lambda-backed (TEAM-ARCHIVE-STEP11) so `coaches`
 * population happens server-side from the team's own coaches array, not from
 * a client-supplied value. No archived-team check until Part 2.
 */
export async function createGame(input: CreateGameInput): Promise<NonNullable<Schema['createGame']['returnType']>> {
  const result = await client.mutations.createGame(input);
  return assertMutationResult(result, 'Failed to create game');
}
