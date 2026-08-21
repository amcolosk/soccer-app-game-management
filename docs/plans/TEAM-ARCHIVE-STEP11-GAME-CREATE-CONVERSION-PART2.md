# Team Archive — Step 11, Part 2: Archived-Team Check on `createGame`

Status: Draft plan — **blocked on Part 1 landing and passing its Real-Time-Sync Validation Checklist on a real sandbox.** Do not begin implementation of this part until Part 1 is committed and verified.
Date: 2026-08-20
Parent plan: [TEAM-ARCHIVE-PLAN.md](TEAM-ARCHIVE-PLAN.md) — "Next Steps (ordered)" item 11 (Phase 8), sub-step 2. This is the final piece of the parent plan — closing this out moves game creation from the UI-only-enforced list to the server-side-enforced list, completing Acceptance Criterion 4.
Prior slice (hard prerequisite): [TEAM-ARCHIVE-STEP11-GAME-CREATE-CONVERSION-PART1.md](TEAM-ARCHIVE-STEP11-GAME-CREATE-CONVERSION-PART1.md) — lands the `createGame` Lambda, its IAM wiring, and the `Home.tsx`/`demoDataService.ts` call-site conversions with no archived-team check.
Prior precedent: [TEAM-ARCHIVE-STEP8-SERVER-ENFORCEMENT.md](TEAM-ARCHIVE-STEP8-SERVER-ENFORCEMENT.md) — `deleteGameSafe`'s archived-team guard is the direct structural template for this slice's check (same null-safe JS comparison reasoning, same fail-open-on-missing-team posture, same error-message-passthrough defect class at the UI call site).

## Goal

Add a server-side archived-team check to the `createGame` Lambda from Part 1, and reclassify game creation from "UI-only enforced" to "server-side enforced" in `docs/SHARING-PERMISSIONS.md`. This is the last open item in the parent plan.

**Definition of done:**
- `npm run gate:commit` passes.
- `amplify/functions/create-game/handler.test.ts` covers the archived/active/legacy-no-status/team-not-found cases.
- `docs/SHARING-PERMISSIONS.md` updated to move game creation into the server-side-enforced list.
- `docs/plans/TEAM-ARCHIVE-PLAN.md`'s Implementation Status updated to record Phase 8 fully complete — this closes out the parent plan's "Next Steps (ordered)" list entirely.
- Manual sandbox check: attempting to create a game against an archived team via `client.mutations.createGame(...)` directly (bypassing the UI's own dropdown filter) is rejected with a clear, actionable error.

## Scope

### In scope
- `amplify/functions/create-game/handler.ts` — add the archived-team check.
- `amplify/functions/create-game/handler.test.ts` — new cases for the guard.
- `src/components/Home.tsx` — minimal two-line error-message passthrough at `handleCreateGame`'s catch block (Step 8's Decision 4 pattern), now load-bearing because there's a new, specific, user-actionable server rejection reason to surface.
- `src/services/demoDataService.ts` — confirm (not necessarily change) that `createDemoTeam`'s freshly-created team is never archived at the moment its game is created, so this guard cannot regress demo seeding (see Decision 2 below — expected to require no code change, but must be verified, not assumed).
- `docs/SHARING-PERMISSIONS.md` — move "Game creation" from the UI-only-enforced list to the server-side-enforced list; update the one sentence in the existing "Game creation, until Phase 8's `Game.create` Lambda conversion lands" bullet (both the doc and this exact phrase also appear in `TEAM-ARCHIVE-STEP10-E2E-AND-DOCS.md`'s own diff outline — that file is historical and not edited retroactively; only the live `docs/SHARING-PERMISSIONS.md` changes).
- `docs/plans/TEAM-ARCHIVE-PLAN.md` — Implementation Status + Acceptance Criteria closeout.

### Explicitly out of scope
- Anything already covered by Part 1 (the Lambda's existence, its IAM wiring, the real-time-sync mechanism, `coaches` derivation).
- Removing or changing the existing UI-only enforcement (the Schedule Game dropdown's archived-team filter, `isTeamActive` early-return in `handleCreateGame`) — both stay exactly as they are. This slice adds a backstop; it does not replace the fast client-side check.
- Any change to `Home.tsx` beyond the error-message passthrough.

## Decisions

### Decision 1: null-safe JS comparison, not a DynamoDB `ConditionExpression` — matching `deleteGameSafe`'s exact precedent

`createGame`'s write is a `PutCommand` for a brand-new item, not a conditional update to an existing one — there is nothing to attach a `ConditionExpression` to that would meaningfully gate the write itself (a `PutCommand` has no natural "the *team* must be active" condition to express, since it isn't writing to the `Team` table). The check is a plain read-then-compare in application code, run after the existing coach-membership check and before the `PutCommand`, exactly like `deleteGameSafe`'s guard:

```ts
if (team.status === 'archived') {
  throw new Error('Cannot schedule a game for an archived team. Restore the team first.');
}
```

Per Correction 2 (parent plan) and confirmed correct precedent (Step 8's own audit of this exact question for `deleteGameSafe`/`deletePlayerSafe`): a bare JS `===` comparison already treats a missing/`undefined` `status` attribute as active correctly (`undefined === 'archived'` is `false`). The DynamoDB-specific null-safe `(attribute_not_exists(#status) OR #status <> :archived)` rewrite is only required for `ConditionExpression` strings, which this check is not.

### Decision 2: no fail-open-on-missing-team change needed, and no demo-seeding regression — but both must be verified, not assumed

`createGame`'s handler already fetches `Team` (Part 1, for `coaches` derivation and the coach-membership check) and already throws `'Team not found'` if the team doesn't exist — unlike `deleteGameSafe`'s guard (which fails open on a missing team, to avoid blocking cleanup of an orphaned game), `createGame` has no "orphaned game" case to protect, since there is no game yet. A missing team should simply continue to reject the whole create (as it already does in Part 1), not specifically because of the archived check — no behavior change needed here, just confirmation that adding the archived check doesn't need its own fail-open carve-out.

`createDemoTeam` (`demoDataService.ts`) creates its `Team` and its one `Game` back-to-back, synchronously, in the same function call, with no user-controllable step in between where the team could be archived (archiving requires navigating to Management, which cannot happen mid-await inside `createDemoTeam`'s own execution). **Verify this holds during implementation** (re-read `createDemoTeam`'s current body to confirm no `await` yields control back to a place a concurrent archive could land between `Team.create` and `createGame`) rather than assuming it from this description alone — if a genuine TOCTOU window exists, it is a pre-existing, vanishingly-unlikely race (a second browser tab archiving a team with the exact same id within milliseconds of its own creation, before its own creator has ever seen it) and not something this slice needs to newly guard against; call it out as a documented non-issue rather than silently ignoring it.

## File-by-File Changes

### 1. `amplify/functions/create-game/handler.ts`

Insert the check immediately after the existing coach-membership check, before the `now`/`id` computation:

```ts
  const teamResponse = await docClient.send(new GetCommand({
    TableName: teamTable,
    Key: { id: teamId },
    ProjectionExpression: 'id, coaches, #status',
    ExpressionAttributeNames: { '#status': 'status' },
  }));

  const team = teamResponse.Item as { id: string; coaches?: string[]; status?: string } | undefined;
  if (!team) {
    throw new Error('Team not found');
  }

  const coaches = team.coaches ?? [];
  if (!coaches.includes(callerSub)) {
    throw new Error('Access denied: caller is not a coach on this team');
  }

  // TEAM-ARCHIVE-STEP11 Part 2: archived teams are read-only historical data
  // (Acceptance Criterion 5) — scheduling a new game against one would create
  // fresh, ongoing state for a team the archive feature exists to freeze.
  // Plain JS comparison (not a DynamoDB ConditionExpression) already treats a
  // missing/undefined status as active — Correction 2's null-safe rewrite
  // only applies to ConditionExpression strings, matching the precedent
  // already audited and confirmed correct for deleteGameSafe/deletePlayerSafe
  // (TEAM-ARCHIVE-STEP8, Part A).
  if (team.status === 'archived') {
    throw new Error('Cannot schedule a game for an archived team. Restore the team first.');
  }
```

(`ProjectionExpression` widened from Part 1's `'id, coaches'` to also fetch `#status`; `status` is a DynamoDB reserved word, aliased the same way every other handler in this codebase already does.)

No IAM/env-var change — `createGame` already has `dynamodb:GetItem` on `teamTable` from Part 1; reading one more attribute on an already-granted `GetItem` needs no new permission.

### 2. `amplify/functions/create-game/handler.test.ts`

Extend Part 1's file with:
- Update the default `GetCommand` mock's team fixture to include `status: 'active'` by default (so Part 1's existing passing cases stay passing without modification — an explicit `active` status, not an absent one, keeps those tests' intent clear).
- New test: `'rejects creating a game for an archived team'` — team fixture `{ status: 'archived' }`; assert `rejects.toThrow(/archived team/i)` and that no `PutCommand` was ever sent (proves the guard runs before any write).
- New test: `'allows creating a game for a team with no status attribute (legacy team)'` — team fixture has no `status` key at all; assert the create still succeeds (proves the plain JS `===` comparison handles the undefined case correctly, matching `deleteGameSafe`'s equivalent test from Step 8).
- Existing `'creates a game with all default fields set correctly...'` test (from Part 1) updated to include `status: 'active'` in its team fixture, if not already covering it via the default-mock update above.

### 3. `src/components/Home.tsx`

`handleCreateGame`'s catch block currently (unchanged since before Part 1):
```ts
} catch (error) {
  handleApiError(error, 'Failed to create game');
}
```
Per Step 8's Decision 4 precedent (the same `handleApiError`-discards-the-real-message defect, now load-bearing because there's a specific, actionable server rejection to show): both files already import `showError` transitively via `handleApiError`'s own module — confirm `showError` is importable directly in `Home.tsx` (it already is, per Part 1/pre-existing imports: `import { showError, showWarning } from '../utils/toast';`). Replace with:
```ts
} catch (error) {
  console.error('Failed to create game', error);
  showError(error instanceof Error ? error.message : 'Failed to create game');
}
```
`handleApiError`'s import stays in `Home.tsx` (still used elsewhere in the file) — only this one catch block changes.

### 4. `docs/SHARING-PERMISSIONS.md`

Locate the existing bullet (confirmed present, per Part 1's Finding 13 and the grep that found it):
> Game creation, until Phase 8's `Game.create` Lambda conversion lands (still not done). Archived teams are filtered from the Schedule Game dropdown (`src/components/Home.tsx`) with a defensive client-side re-check in `handleCreateGame`, but a raw GraphQL call is not blocked.

Remove this from wherever the doc's "UI-only enforced" list currently is, and add game creation to the "server-side enforced" list with equivalent phrasing to the existing entries there (e.g., matching how team lifecycle fields / deletes / invitation acceptance are described) — something in the shape of:
> Game creation — enforced server-side via the Lambda-backed `createGame` mutation (`amplify/functions/create-game/`), which rejects creating a game against an archived team. The Schedule Game dropdown's client-side filter (`src/components/Home.tsx`) remains as a fast, non-authoritative UX convenience on top of the server-side check, not a substitute for it.

Exact final wording to match the surrounding doc's voice — confirm during implementation by reading the current full text of both lists, not just the one bullet already found by grep, since Step 10's own docs pass reorganized this content and the current structure should be read fresh rather than assumed from this excerpt.

### 5. `docs/plans/TEAM-ARCHIVE-PLAN.md`

- **Implementation Status:** add a "Step 11" entry (mirroring the existing Step 1/5/8/9/10 entries' format: commit references, one-paragraph summary, link to both Part 1 and Part 2 docs) recording Phase 8 as fully landed.
- **"Not yet done" paragraph:** remove "Phase 8 (`Game.create` Lambda conversion, still deferred, still gates nothing)" — this is the only remaining item in that list once Phase 8 lands, so confirm whether the paragraph should be removed entirely or reworded to state the parent plan is now fully implemented, pending only the previously-recorded residual risks (1)-(5), which are unaffected by this slice and remain open follow-ups in their own right (not part of Phase 8's closure).
- **Acceptance Criteria:** item 4 currently reads "Lifecycle fields, deletes, and invitation acceptance are rejected server-side for archived teams; game creation and the remaining deep in-game mutation surface are blocked in the UI as a documented, accepted residual risk until Phase 8 moves game creation server-side." Update to remove the "until Phase 8" qualifier for game creation specifically, since it is now server-side — the "remaining deep in-game mutation surface" clause (lineup/rotation/substitutions/etc.) stays exactly as worded, since that scope was never part of Phase 8 and remains UI-only by explicit, permanent design (parent plan Scope section).

## Test Plan

- `amplify/functions/create-game/handler.test.ts` — extended per File-by-File item 2.
- No new e2e coverage planned in this slice, matching Step 10's own precedent (Decision 5 there, for the structurally identical `deleteGameSafe`/`deletePlayerSafe` guards): the mechanism is well-covered at the handler-test level and is not materially riskier than those already-shipped, already-unit-tested guards. If a future slice wants e2e proof of the rejection (create-game-against-archived-team via direct mutation call, bypassing the UI filter), that is a reasonable low-priority follow-up, not required here.
- Manual sandbox check (see Goal) substitutes for e2e coverage here, matching Step 8's own precedent for its analogous guards.

## Risks and Edge Cases

- **This closes the parent plan's last named gap, but does not touch any of the five residual risks already recorded in "Implementation Status."** None of them (the `deletePlayerSafe` disclosure edge case, banner staleness, `revokeCoachAccess`'s missing child-record cascade, its missing owner guard, or the unwritten `archive-team`/`restore-team` handler unit tests) are affected by or resolved by this slice. Do not conflate "Phase 8 is done" with "the archive feature has no open follow-ups" when updating the parent plan doc.
- **The UI-only dropdown filter and the new server-side guard could theoretically disagree** if `isTeamActive`'s client-side helper and the Lambda's `team.status === 'archived'` check ever diverge in definition — they don't today (both treat missing/undefined as active), but this is exactly the kind of duplicated-logic drift risk worth a one-line note in the handler comment pointing at `src/utils/teamUtils.ts:isTeamActive` as the client-side sibling, so a future change to one is more likely to prompt checking the other.
- **No new regression class introduced** — this is a narrow, well-precedented addition (structurally identical to `deleteGameSafe`'s already-shipped, already-reviewed guard) landing on top of an already-validated Part 1 mechanism, which is precisely the point of having split this into two parts.
