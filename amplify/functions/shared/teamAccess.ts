import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

export type TeamRecord = Record<string, unknown> & { id: string; coaches?: string[]; status?: string };

export interface TeamAccessResult {
  team: TeamRecord;
  coaches: string[];
}

export interface AssertTeamAccessOptions {
  /** Defaults to true: reject when the team is archived. Pass false for a
   * read-only caller that's fine operating against archived teams (none of
   * this plan's Lambdas do that today, but the option exists so a future
   * caller doesn't have to fork the helper). */
  requireActive?: boolean;
  /** Message used when the archived-team guard trips. Callers should phrase
   * this for their own action ("Cannot sync a team calendar for an archived
   * team...", "Cannot unlink..."). */
  archivedMessage?: string;
}

/**
 * Shared team-fetch + membership + archived-team guard, extracted
 * (architecture review Major 6) from the triple duplicated across
 * create-game-safe/handler.ts, delete-game-safe/handler.ts and friends.
 * **Used by the new calendar-import Lambdas only** — the five existing
 * handlers are not retrofitted onto this in this change (see the plan's
 * Risks section, "Retrofitting ... is explicitly out of scope").
 */
export async function assertTeamAccess(
  docClient: DynamoDBDocumentClient,
  teamTable: string,
  teamId: string,
  callerSub: string,
  options: AssertTeamAccessOptions = {},
): Promise<TeamAccessResult> {
  const teamResponse = await docClient.send(new GetCommand({
    TableName: teamTable,
    Key: { id: teamId },
    // Strongly consistent (carried forward verbatim from create-game-safe's
    // TEAM-ARCHIVE-STEP11 rationale, architecture review finding): GetCommand
    // defaults to eventually-consistent reads. Without ConsistentRead, a
    // coach who just accepted a team invitation and immediately tries to
    // sync/unlink a calendar could hit a stale replica and get a hard
    // "Access denied" error on a team visible in their own UI — a worse
    // failure mode than the silent/permissive behavior it replaces. Cost:
    // one extra RCU, no meaningful latency impact on a write path.
    ConsistentRead: true,
  }));

  const team = teamResponse.Item as TeamRecord | undefined;
  if (!team) {
    throw new Error('Team not found');
  }

  // coaches derived server-side from the team's own coaches array — not
  // accepted as a client argument. This both closes the population rule
  // (CLAUDE.md) and is the authorization check: a caller not in
  // `team.coaches` cannot act on it.
  const coaches = team.coaches ?? [];
  if (!coaches.includes(callerSub)) {
    throw new Error('Access denied: caller is not a coach on this team');
  }

  // Archived teams are read-only historical data (Acceptance Criterion 5 of
  // the archive feature) -- carried forward from create-game-safe's Part 2
  // rationale. Plain JS comparison (not a DynamoDB ConditionExpression)
  // already treats a missing/undefined status as active -- matches the
  // precedent already audited and confirmed correct for
  // deleteGameSafe/deletePlayerSafe. Client-side sibling: src/utils/teamUtils.ts
  // isTeamActive -- if one definition of "archived" changes, check the other.
  const requireActive = options.requireActive !== false;
  if (requireActive && team.status === 'archived') {
    throw new Error(options.archivedMessage ?? 'Cannot perform this action for an archived team. Restore the team first.');
  }

  return { team, coaches };
}
