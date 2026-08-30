# Team Archive — Step 8: Server-Side Enforcement (`*Safe` Delete Guards + Transactional `accept-invitation`)

Status: Draft plan — revised after architecture review round 1, ready for round 2 (or implementation if round 2 is waived)
Date: 2026-08-19 (revised 2026-08-19)
Parent plan: [TEAM-ARCHIVE-PLAN.md](TEAM-ARCHIVE-PLAN.md) — "Next Steps (ordered)" item 8 (remaining Phase 4 server-side checks).
Prior slices: [TEAM-ARCHIVE-STEP1-BACKEND-WIRING.md](TEAM-ARCHIVE-STEP1-BACKEND-WIRING.md) (handler/IAM conventions), [TEAM-ARCHIVE-STEP5-FRONTEND-UX.md](TEAM-ARCHIVE-STEP5-FRONTEND-UX.md) (confirms `Delete Permanently` is Archived-view-only in the **Management UI**, and flags — Known Gap, round 2 Minor 8 — that any future `deleteTeamSafe` archived-team guard "must not block deletes for archived teams").

**Revision history:**
- Round 1 (architecture review, 2026-08-19): fixed two Major findings — (1) Decision 4's claimed UI error-message passthrough was factually wrong (`handleApiError` discards the real server error); resolved by adding a minimal two-line `showError(error.message)` passthrough at both `deleteGameCascade` call sites, widening scope by exactly those two `src/` files. (2) Decision 3 (`deletePlayerSafe`) is no longer "no guard" — it now gets the same archived-team guard as `deleteGameSafe`, for the same historical-preservation reasoning. Folded in five Minor findings: corrected Decision 6's rationale (policy-bypass-by-a-trusted-party, not "fait accompli"), corrected Decision 8's framing (ordinary duplicate-invitation-link path, not a rare legacy-repair case; test renamed), added handler-local helper extraction to the Part B code sketch, fixed two inaccuracies in the Part B test plan (line-176 assertion needs a real update; the expired-invitation test needs none), and added one clarifying sentence to Decision 4 about `deleteTeamSafe` never calling `deleteGameSafe`.

## Goal

Backend-only. Two independent pieces of server-side enforcement:

- **Part A** — decide, per `*Safe` delete Lambda, whether an archived-team check belongs there at all, and add it only where it does.
- **Part B** — make `accept-invitation`'s invitation-accept + coaches-append atomic via `TransactWriteCommand`, with a null-safe archived-team condition and correct handling of `TransactionCanceledException`/`CancellationReasons`.

**Definition of done:** `npx tsc -p amplify/tsconfig.json --noEmit` and `npm run gate:commit` both pass; the handler test files listed below are updated and green; a sandbox smoke test (described at the end, not executed as part of this plan) proves the transactional path and the new game-delete and player-delete guards.

## Scope

This slice is backend-focused, with one deliberate, small exception (see below).

### In scope
- `amplify/functions/delete-game-safe/handler.ts` + `resource.ts`/`amplify/backend.ts` wiring — new archived-team guard.
- `amplify/functions/delete-player-safe/handler.ts` + `resource.ts`/`amplify/backend.ts` wiring — new archived-team guard (added in round 1 revision; see Decision 3).
- `amplify/functions/accept-invitation/handler.ts` — `TransactWriteCommand` conversion + `amplify/backend.ts` IAM addition.
- Comment-only, no-behavior-change documentation added to `delete-team-safe/handler.ts`, `delete-formation-safe/handler.ts` recording why no guard was added, so a future change doesn't "helpfully" reintroduce one incorrectly.
- **`src/components/Home.tsx` and `src/components/GameManagement/GameManagement.tsx` — a minimal two-line error-message passthrough at each `deleteGameCascade` catch block** (added in round 1 revision; see Decision 4). Without it, a coach who trips the new `deleteGameSafe` archived-team guard sees a content-free "Failed to delete game" toast instead of the server's actual reason. Scope stays backend-focused in spirit — no new UI state, no new component, just surfacing the real error string that already comes back from the API.
- **`src/components/Management.tsx` — the same passthrough fix, applied once to the shared local `confirmAndDelete` helper** (added in round 1 revision, discovered while verifying Decision 3's `deletePlayerSafe` call site; see Risks). Without it, a coach who trips the new `deletePlayerSafe` archived-team guard sees the same content-free generic toast.
- Test updates: `amplify/functions/delete-game-safe/handler.test.ts`, `amplify/functions/delete-player-safe/handler.test.ts`, `amplify/functions/accept-invitation/handler.test.ts`.

### Out of scope
- Any other frontend change beyond the passthrough fixes above.
- `archiveTeam`/`restoreTeam`/`assignTeamOwner` themselves (unchanged, already deployed).
- Phase 6, Phase 7 completeness beyond what proves this slice, Phase 8 (`Game.create`).
- Actually running a sandbox deploy (described as a required follow-up, not executed here).

## Part A — Archived-team guard on the `*Safe` delete Lambdas

### Investigation findings (read directly from the handlers and their callers)

| Lambda | Authorization today | Team relationship | Callers (`src/`) |
|---|---|---|---|
| `deleteTeamSafe` | `team.coaches.includes(callerSub)` (any coach) | *is* the team | `Management.tsx` (`handleDeleteTeam`, Archived-view-only per Step 5) **and** `demoDataService.ts` (`createDemoTeam`'s failure-rollback cleanup, `removeDemoData`) |
| `deleteFormationSafe` | `formation.coaches.includes(callerSub)` | none — Formation is shared across teams, not owned by exactly one; already blocks delete if referenced by **any** team (`scanTeamsUsingFormation`, all teams regardless of status) | `Management.tsx` (`handleDeleteFormation`, Formations tab) |
| `deleteGameSafe` | `game.coaches.includes(callerSub)` | `game.teamId` — one team, required field | `Home.tsx` (`handleDeleteGameFromHome`, swipe-delete on any game card in the history list) **and** `GameManagement.tsx` (`deleteGameButton`, in-game "Delete Game" action) |
| `deletePlayerSafe` | `player.coaches.includes(callerSub)` | none — a Player can be on multiple teams' rosters via `TeamRoster`, some active, some archived, simultaneously; but the full `TeamRoster` list is already materialized during the delete (line ~112) so the archived-team set is structurally checkable, same as Formation's reference scan | `Management.tsx` (`handleDeletePlayer`, Players tab / roster removal) |

### Decision 1: `deleteTeamSafe` — no guard change; must keep allowing deletes of active teams too

**Confirmed by reading `src/services/demoDataService.ts`:**
```ts
// createDemoTeam's catch block (line ~104) — rollback of a freshly-created,
// never-archived team after a mid-seed failure:
void deleteTeamCascade(createdTeamId).catch(() => undefined);

// removeDemoData (line ~145) — the user-facing "Remove Demo Data" action,
// called directly from Home.tsx and Management.tsx, unconditionally:
await deleteTeamCascade(teamId);
```
Both are real, currently-shipped call sites that invoke `deleteTeamCascade` → `deleteTeamSafe` against a team that is **never archived** — the demo team is either brand new (seed-failure rollback) or an ordinary active demo team (user-initiated removal). Step 5's "Delete Permanently is reachable only from the Archived Teams view" statement is true of `Management.tsx`'s **team-card actions**, not of every caller of `deleteTeamCascade` in the codebase.

**Decision: do not add a "team must be archived" guard to `deleteTeamSafe`.** Adding one would be an active regression, immediately breaking demo-data seed-rollback and demo-data removal — both real, in-scope features, not edge cases. `deleteTeamSafe` already has no status check at all, so it already satisfies the Part A requirement ("must ALLOW deleting an archived team") with zero code change. No hardening is added for active-team deletion either, because there is no way to add one without also blocking the two legitimate demo-team call sites — and inventing a "skip the guard for demo teams" carve-out would be worse (fragile, name-based special-casing) than not adding the guard at all.

**Action:** add a one-line comment above the coach-membership check recording this decision, so a future "add the archived guard here too, for consistency" edit doesn't silently reintroduce the regression:
```ts
// No archived-team guard here, intentionally (TEAM-ARCHIVE-STEP8, Part A,
// Decision 1): this Lambda is also the rollback/cleanup path for
// src/services/demoDataService.ts (seed-failure rollback and the
// user-facing "Remove Demo Data" action), both of which delete an
// always-active team. A "must be archived" check would break both. The
// Management UI's own "Delete Permanently" action is Archived-view-only —
// that is a UI-level restriction, not a backend one, and stays that way.
```

### Decision 2: `deleteFormationSafe` — no guard; the existing check already subsumes it

A `Formation` is not scoped to a single team — `scanTeamsUsingFormation` already blocks the delete if **any** team references it, active or archived. Adding "reject if the referencing team is archived" is both redundant (deletion is already blocked whenever a reference exists, regardless of status) and structurally awkward (a Formation can be referenced by zero teams, one active team, one archived team, or several of each — there is no single "the team" to check). **Decision: no code change.** Add a short comment noting this was considered and is inapplicable, for the same future-proofing reason as Decision 1.

### Decision 3: `deletePlayerSafe` — add the same archived-team guard as `deleteGameSafe`, for the same reason (revised in round 1)

**Original framing rejected by architecture review.** The plan originally treated `deletePlayerSafe` as pure "roster/player membership" — Phase 4's UI-only-enforced bucket — with no guard needed. That doesn't survive scrutiny: `deletePlayerSafe` (`amplify/functions/delete-player-safe/handler.ts`, ~lines 111-149) doesn't just remove a roster row; it permanently deletes the Player's `PlayTimeRecord`, `Goal` (as scorer), `GameNote`, `PlayerAvailability`, and `TeamRoster` records **across every team the player is on**, with no team scoping at all. A coach who archives last season's team specifically to preserve its history, then later deletes a departed player from the (unrelated, active) Players tab, permanently destroys that archived team's play-time/goal/note history for that player — exactly the harm Acceptance Criterion 5 ("archived teams remain available for reports and read-only historical access") exists to prevent, and exactly the same class of harm Decision 4 identifies for `deleteGameSafe`. A `Player` is not scoped to a single team, but that's not actually disqualifying: `deleteFormationSafe` isn't scoped to a single team either, and it already blocks the delete if referenced by **any** team, active or archived (`scanTeamsUsingFormation`) — Formation is a valid analogy after all. `deletePlayerSafe` already materializes the player's full `TeamRoster` list (line ~112) before deleting anything, so the archived-team set is structurally available the same way, at essentially the same cost.

**Decision: add an archived-team guard.** Reject the delete if any of the player's `TeamRoster.teamId` resolves to a team with `status === 'archived'`. This reuses the `TEAM_TABLE` env var + `grantReadData` shape from Decision 4's `deleteGameSafe` guard.

**Named tradeoff:** a player who is on both an active team and an archived team becomes undeletable (globally, not just from the archived team's roster) until the archived team is either restored (owner-only action, per the existing archive/restore model) or the player is removed from the archived team's roster by some other means. **This is judged acceptable**, for the same reason it's acceptable for `deleteFormationSafe`'s existing "blocked while referenced by any team" behavior: it's the conservative, data-preserving default, it matches an existing precedent in this same codebase rather than inventing a new one, and the failure mode is a clear, actionable error (not silent data loss) that a coach can resolve by restoring the team. This keeps the reasoning self-consistent with Decision 4: both guards say "an archived team's historical child records must not be destroyed by an unrelated delete action, even if that means the delete is temporarily blocked."

### Decision 4: `deleteGameSafe` — add the guard; this is the one case where it's both meaningful and currently missing

`Game.teamId` is a single required field — a clean, unambiguous relationship, unlike Formation/Player. And unlike "in-game event changes" (goals/notes/substitutions edited *within* a game, which Phase 4 explicitly places in the UI-only bucket), `deleteGameSafe` destroys the **entire historical Game record** for a team, including a scheduled or completed game. Confirmed by reading both call sites:
- `Home.tsx`'s `handleDeleteGameFromHome` — swipe-to-delete on any game card in the in-progress/scheduled/completed history lists. `Home.tsx`'s `getTeam` deliberately searches the **full**, unfiltered `teams` array (Step 5's explicit design decision, to keep archived-team game history visible) — so a coach browsing an archived team's game history today can still swipe-delete one of its games, with no guard anywhere.
- `GameManagement.tsx`'s `deleteGameButton` — an in-game "Delete Game" action.

Neither path checks team status today. This directly undermines Acceptance Criterion 5 ("Archived teams remain available for reports and read-only historical game access") — a coach can silently destroy an archived team's game history, which is precisely the data the archive feature exists to preserve. **Decision: add an archived-team check.** This is a genuine, previously-undocumented gap (not called out in the parent plan's Known Gaps), not a UI-only-enforcement tradeoff being formalized.

**Confirmed non-interaction with permanent team deletion:** `deleteTeamSafe` (the "Delete Permanently" path, Archived-view-only per Step 5) deletes a team's games directly via its own DynamoDB writes against the Game table — it never calls `deleteGameSafe`. So the new `deleteGameSafe` archived-team guard cannot accidentally break permanent deletion of an archived team's own games as a side effect of deleting the whole team; the two code paths are fully independent.

Implementation is a plain JS read-then-check (not a conditional write — `deleteGameSafe` never writes to the Team table), so Correction 2's null-safe *DynamoDB ConditionExpression* shape doesn't apply here; a bare JS `===` comparison already treats `undefined`/missing `status` as active correctly (`undefined === 'archived'` is `false`), matching the precedent already audited and confirmed correct for `archive-team`/`restore-team`'s own JS-side status checks (Step 1, Decision 3).

## Part A — File-by-File Changes

### 1. `amplify/functions/delete-game-safe/handler.ts`

Add `TEAM_TABLE` to the upfront env-var block, and a team-archived check right after the existing coach-membership check (authorization before business-rule state, matching the codebase's existing ordering convention):

```ts
  const gameId = event.arguments.gameId;
  const gameTable = process.env.GAME_TABLE;
  const teamTable = process.env.TEAM_TABLE;
  const playTimeRecordTable = process.env.PLAY_TIME_RECORD_TABLE;
  // ...existing table env vars, unchanged...

  if (!gameTable || !teamTable || !playTimeRecordTable || !goalTable || !gameNoteTable || !substitutionTable || !lineupAssignmentTable || !playerAvailabilityTable || !gamePlanTable || !plannedRotationTable || !queuedSubstitutionTable) {
    throw new Error('Required environment variables are not set');
  }

  const gameResponse = await docClient.send(new GetCommand({
    TableName: gameTable,
    Key: { id: gameId },
  }));

  const game = gameResponse.Item as DbItem | undefined;
  if (!game) {
    throw new Error('Game not found');
  }

  const coaches = game.coaches as string[] | undefined;
  if (!coaches?.includes(callerSub)) {
    throw new Error('Access denied: caller is not a coach on this game');
  }

  // TEAM-ARCHIVE-STEP8, Part A, Decision 4: archived teams are meant to stay
  // read-only historical data (Acceptance Criterion 5) — deleting a game
  // permanently removes it from that history, unlike editing content within
  // a still-viewable game (goals/notes/substitutions), which Phase 4 already
  // treats as UI-only. `game.teamId` is a single required field, unlike
  // Formation/Player, so this check is unambiguous. Plain JS comparison
  // (not a DynamoDB ConditionExpression) already treats a missing/undefined
  // `status` as active — Correction 2's null-safe rewrite only applies to
  // ConditionExpression strings. Fails open (allows the delete) if the
  // team record itself can't be found, rather than blocking cleanup of an
  // orphaned game.
  const teamId = game.teamId as string | undefined;
  if (teamId) {
    const teamResponse = await docClient.send(new GetCommand({
      TableName: teamTable,
      Key: { id: teamId },
      ProjectionExpression: '#status',
      ExpressionAttributeNames: { '#status': 'status' },
    }));
    const team = teamResponse.Item as { status?: string } | undefined;
    if (team?.status === 'archived') {
      throw new Error('Cannot delete a game belonging to an archived team. Restore the team first.');
    }
  }

  const rollbackStack: SnapshotRecord[] = [];
  // ...unchanged from here...
```

### 2. `amplify/functions/delete-game-safe/resource.ts`

No change expected (no new args, no timeout pressure — one extra `GetCommand` is negligible against this handler's existing `timeoutSeconds`). Confirm during implementation.

### 3. `amplify/backend.ts`

Add a read-only grant + env var for `deleteGameSafe`, and the same for `deletePlayerSafe` (round 1 addition, Decision 3), matching Step 1's least-privilege `PolicyStatement`/scoped-grant convention (both handlers already otherwise use the older `grantReadWriteData` shape for their own tables — leave those as-is, only the *new* Team access follows the newer convention):

```ts
// Grant table access for deleteGameSafe Lambda (authoritative game delete with rollback)
gameTable.grantReadWriteData(backend.deleteGameSafe.resources.lambda);
// TEAM-ARCHIVE-STEP8: read-only, for the archived-team delete guard.
teamTable.grantReadData(backend.deleteGameSafe.resources.lambda);
playTimeRecordTable.grantReadWriteData(backend.deleteGameSafe.resources.lambda);
// ...unchanged...
backend.deleteGameSafe.addEnvironment('GAME_TABLE', gameTable.tableName);
backend.deleteGameSafe.addEnvironment('TEAM_TABLE', teamTable.tableName); // new
backend.deleteGameSafe.addEnvironment('PLAY_TIME_RECORD_TABLE', playTimeRecordTable.tableName);
// ...unchanged...

// Grant table access for deletePlayerSafe Lambda (round 1 addition, Decision 3)
playerTable.grantReadWriteData(backend.deletePlayerSafe.resources.lambda);
// TEAM-ARCHIVE-STEP8: read-only, for the archived-team delete guard.
teamTable.grantReadData(backend.deletePlayerSafe.resources.lambda);
// ...unchanged...
backend.deletePlayerSafe.addEnvironment('PLAYER_TABLE', playerTable.tableName);
backend.deletePlayerSafe.addEnvironment('TEAM_TABLE', teamTable.tableName); // new
// ...unchanged...
```
`teamTable` is already declared at module scope (line ~94) and already in scope at both of these points in the file — no new `Table` reference needed.

### 4. `amplify/functions/delete-player-safe/handler.ts` (round 1 addition — real behavior change, not comment-only)

Add `TEAM_TABLE` to the env-var block, and an archived-team guard that runs after the coach-membership check but before any deletes start. The guard reuses the `TeamRoster` scan that already runs today (previously inside the `Promise.all`) by pulling it out and running it first:

```ts
  const playerTable = process.env.PLAYER_TABLE;
  const teamTable = process.env.TEAM_TABLE;
  const teamRosterTable = process.env.TEAM_ROSTER_TABLE;
  // ...existing table env vars, unchanged...

  if (!playerTable || !teamTable || !teamRosterTable || !playTimeRecordTable || !goalTable || !gameNoteTable || !playerAvailabilityTable) {
    throw new Error('Required environment variables are not set');
  }

  // ...existing player fetch + coach-membership check, unchanged...

  // TEAM-ARCHIVE-STEP8, Part A, Decision 3: deleting a Player permanently
  // destroys their PlayTimeRecord/Goal/GameNote/PlayerAvailability/TeamRoster
  // history across every team they're on, with no team scoping — the same
  // class of harm to Acceptance Criterion 5 that Decision 4 identifies for
  // deleteGameSafe. Block if any referenced team is archived, matching
  // deleteFormationSafe's existing "blocked while referenced by any team"
  // precedent. Fetched before any deletes start, and before the parallel
  // scan below, so the guard is checked with zero partial destructive state.
  const teamRosters = await scanAll(teamRosterTable, 'playerId = :playerId', { ':playerId': playerId });
  const referencedTeamIds = [...new Set(teamRosters.map((roster) => roster.teamId as string))];
  const archivedTeams = (await Promise.all(referencedTeamIds.map(async (teamId) => {
    const teamResponse = await docClient.send(new GetCommand({
      TableName: teamTable,
      Key: { id: teamId },
      ProjectionExpression: 'id, #name, #status',
      ExpressionAttributeNames: { '#name': 'name', '#status': 'status' },
    }));
    return teamResponse.Item as { id: string; name?: string; status?: string } | undefined;
  }))).filter((team): team is { id: string; name?: string; status?: string } => team?.status === 'archived');

  if (archivedTeams.length > 0) {
    const teamNames = archivedTeams.slice(0, 3).map((team) => team.name ?? team.id).join(', ');
    throw new Error(
      `Cannot delete player: player has history on archived team(s): ${teamNames}. Restore the team(s) first.`,
    );
  }

  const rollbackStack: SnapshotRecord[] = [];

  try {
    const [playTimeRecords, goalsAsScorer, goalsAsAssist, gameNotes, playerAvailabilities] = await Promise.all([
      // teamRosters already fetched above — removed from this Promise.all
      scanAll(playTimeRecordTable, 'playerId = :playerId', { ':playerId': playerId }),
      scanAll(goalTable, 'scorerId = :playerId', { ':playerId': playerId }),
      scanAll(goalTable, 'assistId = :playerId', { ':playerId': playerId }),
      scanAll(gameNoteTable, 'playerId = :playerId', { ':playerId': playerId }),
      scanAll(playerAvailabilityTable, 'playerId = :playerId', { ':playerId': playerId }),
    ]);
    // ...unchanged from here, using the already-fetched `teamRosters` in place
    // of the old in-Promise.all scan result...
```
Fails open on a missing team record (same as Decision 4's `deleteGameSafe` guard), and treats a missing/undefined `status` as active via plain JS `===` comparison — no ConditionExpression involved, so Correction 2's null-safe rewrite doesn't apply here either.

### 5. `amplify/functions/delete-player-safe/resource.ts`

No change expected (no new args; the added `GetCommand`s are per-referenced-team, typically 1-3, negligible against this handler's existing `timeoutSeconds`). Confirm during implementation.

### 6. `amplify/functions/delete-team-safe/handler.ts`, `delete-formation-safe/handler.ts`

Comment-only additions (Decisions 1–2 above), placed immediately above each handler's existing coach-membership check. No IAM/env/behavior change. (`delete-player-safe/handler.ts` moved out of this comment-only group in the round 1 revision — see item 4 above.)

### 7. `src/components/Home.tsx` and `src/components/GameManagement/GameManagement.tsx` (round 1 addition — Decision 4 UI fix)

Both files already `import { showError } from '.../utils/toast'` — no new import needed. Replace the generic `handleApiError` call at each `deleteGameCascade` catch block with a passthrough that surfaces the server's real message:

`src/components/Home.tsx` (~line 484, inside `handleDeleteGameFromHome`):
```ts
    } catch (error) {
      console.error('Failed to delete game', error);
      showError(error instanceof Error ? error.message : 'Failed to delete game');
    }
```

`src/components/GameManagement/GameManagement.tsx` (~line 2122, inside `deleteGameButton`'s click handler):
```ts
          } catch (error) {
            console.error('Failed to delete game', error);
            showError(error instanceof Error ? error.message : 'Failed to delete game');
          }
```
`handleApiError`'s import stays in both files (still used by every other call site) — only these two specific catch blocks change. This is the primary `src/` change in this slice, added specifically to fix Decision 4's UI mitigation claim (see Risks).

### 8. `src/components/Management.tsx` (round 1 addition — discovered while verifying Decision 3's call site)

`handleDeletePlayer` (and `handleDeleteTeam`, `handleRemovePlayerFromRoster`) route through a shared local `confirmAndDelete` helper (~line 46-62) whose catch block has the identical `handleApiError` bug. Fix once, in the shared helper, rather than patching `handleDeletePlayer` alone:

```ts
async function confirmAndDelete(
  confirmFn: ReturnType<typeof useConfirm>,
  opts: { title: string; message: string; confirmText?: string; deleteFn: () => Promise<unknown>; entityName: string; variant?: 'danger' | 'warning' | 'default' },
) {
  const confirmed = await confirmFn({
    title: opts.title,
    message: opts.message,
    confirmText: opts.confirmText || 'Delete',
    variant: opts.variant ?? 'danger',
  });
  if (!confirmed) return;
  try {
    await opts.deleteFn();
  } catch (error) {
    console.error(`Failed to delete ${opts.entityName}`, error);
    showError(error instanceof Error ? error.message : `Failed to delete ${opts.entityName}`);
  }
}
```
`Management.tsx` already imports `showError` (confirm the exact import path during implementation — it uses `handleApiError` elsewhere in the file, e.g. for `getPlayerImpact`'s own catch, which is untouched). This single-function fix improves the error message for `handleDeleteTeam` and `handleRemovePlayerFromRoster` too, as a side effect — not requested by this slice's guards directly, but a strict improvement with no behavior downside, and avoids leaving two near-identical unfixed copies of the same bug sitting next to the one this slice does fix.

## Part A — Test Plan

### `amplify/functions/delete-game-safe/handler.test.ts`
- Add `TEAM_TABLE = 'TeamTable'` to the `beforeEach` env-var block.
- Update the default `GetCommand` mock (currently a single unconditional `{ Item: { id: 'game-1', coaches: ['coach-1'] } }` for *every* `GetCommand` call) to branch on `command.input.TableName`, returning the game fixture for `GameTable` and a team fixture (`{ id: 'team-1', status: 'active' }` by default, `game.teamId: 'team-1'`) for `TeamTable`.
- New test: `'rejects deleting a game whose team is archived'` — team fixture returns `{ status: 'archived' }`; assert `rejects.toThrow(/archived team/i)` and that no `DeleteCommand` was ever sent (proves the guard runs before any destructive work starts).
- New test: `'allows deleting a game whose team has no status attribute (legacy team)'` — team fixture has no `status` key at all; assert the delete still succeeds (proves the plain JS `===` comparison already handles the undefined case, Correction 2's underlying concern, without needing the DynamoDB-specific null-safe rewrite).
- New test: `'allows deleting a game whose team record cannot be found'` — `TeamTable` `GetCommand` returns `{ Item: undefined }`; assert the delete still succeeds (fail-open for orphaned games).

### `amplify/functions/delete-player-safe/handler.test.ts` (round 1 addition)
- Add `TEAM_TABLE = 'TeamTable'` to the `beforeEach` env-var block.
- Update the default `GetCommand`/`ScanCommand` mocks to branch on `TableName`, returning a `TeamRoster` fixture (`[{ teamId: 'team-1', playerId: 'player-1', ... }]`) for `TeamRosterTable` scans and a team fixture (`{ id: 'team-1', name: 'Team A', status: 'active' }` by default) for `TeamTable` gets.
- New test: `'rejects deleting a player who has roster history on an archived team'` — team fixture returns `{ status: 'archived' }`; assert `rejects.toThrow(/archived team/i)` and that no `DeleteCommand` was ever sent (proves the guard runs before any destructive work starts).
- New test: `'allows deleting a player whose only teams are active'` — all referenced teams `{ status: 'active' }`; delete succeeds unaffected.
- New test: `'allows deleting a player on multiple teams when all are active'` — two `TeamRoster` rows, two distinct active teams; delete succeeds, both team lookups performed (dedup by `teamId` proven via mock call count).
- New test: `'allows deleting a player whose team record cannot be found'` — `TeamTable` `GetCommand` returns `{ Item: undefined }`; assert the delete still succeeds (fail-open for orphaned rosters).

### `delete-team-safe/handler.test.ts`, `delete-formation-safe/handler.test.ts`
No test changes — no behavior changed, comment-only diffs. (`delete-player-safe/handler.test.ts` moved to its own real-test-changes section above.)

### `src/components/Home.tsx`, `src/components/GameManagement/GameManagement.tsx`, `src/components/Management.tsx` (round 1 addition)
No existing test rewrites expected — none of the three files' existing tests assert on the literal string passed to `handleApiError`/`showError` for the delete-game or `confirmAndDelete` catch blocks specifically (confirm during implementation). No new tests are required by this slice for the passthroughs themselves; they're covered end-to-end by the sandbox smoke test (steps 3-4 below).

## Part B — `accept-invitation`: `TransactWriteCommand` conversion

### What the handler currently does (confirmed by reading it in full)

1. Resolve caller email (multi-fallback, unchanged — out of scope).
2. `GetCommand` the invitation; verify email match.
3. If `status === 'PENDING'`:
   - If expired: single-item `UpdateCommand` (PENDING → EXPIRED), then throw. **Unaffected by this slice** — never touches `Team`.
   - Else: single-item `UpdateCommand` (PENDING → ACCEPTED) with `ConditionExpression: '#status = :pendingStatus'`, caught via `isConditionalCheckFailed` → re-read → classify.
   - Else branch (`status !== 'PENDING'`): idempotent check — if already `ACCEPTED` by this same `userId`, continue; otherwise throw via `toInvitationStateError`.
4. **Unconditionally after step 3** (both the just-transitioned and the already-ACCEPTED-idempotent paths reach here): single-item `UpdateCommand` appending `userId` to `Team.coaches`, `ConditionExpression: 'attribute_not_exists(coaches) OR NOT contains(coaches, :coachId)'`, caught and swallowed as an idempotent no-op on conditional failure.
5. Re-read `Team`, verify `coaches` actually contains `userId` (throws `'Team coach update failed'` otherwise).
6. Backfill `coaches` onto `TeamRoster`, `Player`, `Formation`, `FormationPosition`, `Game` records for this team (via `updateRecordCoachesIfNeeded`, each with its own internal optimistic-retry loop).
7. Re-read and return `Team`.

**The atomicity gap this slice closes** is specifically between step 3's invitation-transition write and step 4's coaches-append write, when step 3 is a *genuine, first-time* PENDING → ACCEPTED transition (not the idempotent-retry path) — that is exactly the "mid-acceptance race between archive and accept-invitation" the parent plan's Risks section names.

### Decision 5: transaction scope — exactly two items, nothing else folded in

Confirmed via `amplify/backend.ts`'s existing `acceptInvitation` grants: this handler also touches `TeamRoster`, `Player`, `Formation`, `FormationPosition`, and `Game` (step 6, the permission-repair backfill). **None of these join the transaction.** Reasons:
- DynamoDB transactions cap at 100 items; the backfill loop is unbounded (all of a team's rosters/players/formation positions/games) and cannot be sized statically.
- Each backfill write is a *propagation* of an already-granted authorization (the coaches append in step 3/4 is the actual grant), not the grant itself. They already tolerate eventual consistency and races via their own per-record optimistic-retry loop (`updateRecordCoachesIfNeeded`) — this is pre-existing, unchanged behavior, not a new risk this slice introduces.
- If a team is archived *after* the atomic Team.coaches append commits but *before* the backfill loop finishes, that's fine: the coach is already validly a coach on that (now-archived) team, and backfilling their access onto its already-existing child records is not "mutating an archived team's structure" — archiving never changes `coaches` membership semantics, only the lifecycle flag.

**Transaction scope: exactly the `TeamInvitation` status-transition item and the `Team` coaches-append item — nothing else.**

### Decision 6: the "already-ACCEPTED, idempotent" branch stays non-transactional and stays archived-unaware — deliberately

When the top-level `else if (status !== 'PENDING')` branch is entered (this call never attempts an invitation-status transition at all — some prior call already fully committed it), step 4's coaches-append repair keeps running as a plain, non-transactional single-item `UpdateCommand`, exactly as today, and is **not** gated on archived status.

**Rationale (corrected in round 1 — the original framing was factually imprecise).** The original text justified this as safe because "this path only fires when the invitation is already a fait accompli." That's not quite right: `TeamInvitation` uses `allow.ownersDefinedIn('coaches')` with unrestricted CRUD (`amplify/data/resource.ts`, ~lines 381-383), so any coach already on the team could directly write `status: 'ACCEPTED', acceptedBy: <invitee sub>` via a plain client call — no accept-invitation Lambda call required — and that invitee could then hit this branch and get appended to `coaches` on an archived team, bypassing the transactional path's archived gate entirely. So this branch is not un-exploitable; it's just not a *privilege escalation* when exploited, because the only party who can set up that condition (write `ACCEPTED`/`acceptedBy` directly onto a `TeamInvitation`) already holds coach-level write access to that same team. **Decision unchanged: keep this branch exactly as designed, non-transactional and archived-unaware.** Gating a repair-of-an-existing-grant on current archived status would still be wrong for the reason originally stated — it could strand a coach's own already-legitimate membership backfill (and therefore their roster/game visibility) merely because the team was archived sometime after they'd already validly joined it — but the accurate reason this is *safe*, not just convenient, is that the party who could exploit this path already holds coach-level access to the team: it's a policy bypass by an already-trusted party, not a privilege escalation for an untrusted one. Update the corresponding code comment in the handler to match this accurate framing rather than the "fait accompli" phrasing.

### Decision 7: null-safe archived condition, matching Correction 2 exactly

```
(attribute_not_exists(#status) OR #status <> :archived) AND (attribute_not_exists(coaches) OR NOT contains(coaches, :coachId))
```
`#status` is aliased (`status` is a DynamoDB reserved word, matching the existing invitation-status condition's own `#status` alias in this same handler).

### Decision 8: `TransactionCanceledException`/`CancellationReasons` handling — what's actually determinable, and why it's *more* precise than today, not less

`TransactWriteCommand` fails the whole transaction if **any** item's condition fails, and reports one `CancellationReasons` entry per `TransactItems` index (confirmed against `@aws-sdk/client-dynamodb`'s modeled types: `TransactionCanceledException.CancellationReasons: CancellationReason[]`, each with an optional `Code`, `Message`, and — when `ReturnValuesOnConditionCheckFailure: 'ALL_OLD'` is set on that item — `Item: Record<string, AttributeValue>`, in raw low-level shape, same as Step 1's `ConditionalCheckFailedException.Item` pattern). Both `TransactItems[].Update` entries get `ReturnValuesOnConditionCheckFailure: 'ALL_OLD'` set, so on a condition failure DynamoDB returns the pre-write item for *whichever* item(s) failed, atomically with the check — no re-read race, matching Step 1's Decision 2 precedent exactly.

`TransactItems` order is fixed and named for clarity:
```ts
const INVITATION_TRANSACT_INDEX = 0;
const TEAM_TRANSACT_INDEX = 1;
```

Three distinguishable outcomes, each independently determinable from `CancellationReasons`:
1. **Only the Team item failed** (`reasons[TEAM_TRANSACT_INDEX]?.Code === 'ConditionalCheckFailed'`, invitation item did not) — the invitation genuinely was/·is PENDING for this caller; the team-side condition is what's blocking. Unmarshall `reasons[TEAM_TRANSACT_INDEX].Item` and check `status === 'archived'` to report "team archived" specifically; if not archived, the only other way this condition fails is `coaches` already containing the caller — see below for why this is an ordinary, expected case (a duplicate invitation link), not a rare artifact.
2. **The Invitation item failed** (regardless of the Team item) — re-read the invitation and classify exactly as the current single-item catch does today (expired/declined/claimed-by-someone-else/idempotent-retry-by-same-user). This is unchanged behavior, just triggered from a different exception shape.
3. **Neither item's `Code` is `ConditionalCheckFailed`** — the transaction was cancelled for an unrelated reason (e.g. throughput); re-throw as-is rather than guessing.

This is genuinely **more** precise than the pre-transaction code, not less: today, a single `ConditionalCheckFailedException` on the team-merge `UpdateCommand` collapses "team archived" and "already a coach" into the same swallowed no-op with no distinction at all. The transactional path can tell them apart from the same atomic response.

**Correcting the "already a coach" sub-branch's framing (round 1).** The original plan described the "team-side `NOT contains` failed but not archived" sub-case as a rare legacy-repair scenario ("speculative-but-justified... not exercised by any known live bug report"). That undersold it: `src/services/invitationService.ts`'s `sendTeamInvitation` (~lines 12-46) has no guard against sending a second invitation to the same email for the same team, so two PENDING invitations to the same person is normal, unremarkable behavior. Accepting a second invite link after the first was already accepted is exactly this sub-case: invite #2's `TeamInvitation` item is still genuinely PENDING (its own condition passes), but `Team.coaches` already contains the invitee from accepting invite #1, so the team-side `NOT contains` condition fails. Today (pre-this-slice) that path already succeeds silently via the swallowed conditional-failure catch. **Decision: keep this sub-branch exactly as designed — do not simplify it to a generic throw.** Simplifying it would regress a real, currently-working case: clicking a legitimate second invite link would start failing with "Failed to join team" instead of quietly succeeding. The renamed rationale is: this is the ordinary duplicate-invitation-link path, not a rare artifact, and this slice must preserve it.

### New handler code

**Imports** (add `TransactWriteCommand` and `unmarshall`; widen the `@aws-sdk/client-dynamodb` import for the `AttributeValue` type):
```ts
import { DynamoDBClient, type AttributeValue } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  UpdateCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
```
`@aws-sdk/util-dynamodb` is already an explicit `package.json` dependency (added in Step 1 for `assign-team-owner`) — no new dependency needed.

**New helpers**, alongside the existing `isConditionalCheckFailed` (round 1 addition: `buildInvitationAcceptUpdate` and `classifyInvitationConflict`, extracted to remove the triplication the original code sketch had — see Minor 5):
```ts
function isTransactionCanceledException(
  error: unknown,
): error is Error & { CancellationReasons?: Array<{ Code?: string; Message?: string; Item?: Record<string, AttributeValue> }> } {
  if (!error || typeof error !== 'object') {
    return false;
  }
  return (error as { name?: unknown }).name === 'TransactionCanceledException';
}

// TransactItems order below is fixed — CancellationReasons is returned in
// the same order as the TransactItems request.
const INVITATION_TRANSACT_INDEX = 0;
const TEAM_TRANSACT_INDEX = 1;

// Shared UpdateExpression/ConditionExpression shape for the PENDING ->
// ACCEPTED invitation transition — used both as a TransactItems[].Update
// entry (happy path) and as the standalone repair UpdateCommand (the
// duplicate-invitation-link sub-case, Decision 8). Handler-local, not a new
// shared module (Decision 5's "not this slice" call applies here too).
function buildInvitationAcceptUpdate(nowIso: string, userId: string) {
  return {
    UpdateExpression: 'SET #status = :acceptedStatus, acceptedAt = :acceptedAt, acceptedBy = :acceptedBy, updatedAt = :updatedAt',
    ConditionExpression: '#status = :pendingStatus',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':acceptedStatus': 'ACCEPTED',
      ':pendingStatus': 'PENDING',
      ':acceptedAt': nowIso,
      ':acceptedBy': userId,
      ':updatedAt': nowIso,
    },
  };
}

// Re-reads the invitation, verifies email match, and classifies the result
// as an idempotent retry by the same user (returns the resolved invitation)
// or a genuine conflict (throws via toInvitationStateError / a mismatch
// error). Shared by the invitation-item-failed branch and the standalone
// repair UpdateCommand's own conditional-failure catch — both do exactly
// this re-read-and-classify sequence today.
async function classifyInvitationConflict(
  teamInvitationTable: string,
  invitationId: string,
  userId: string,
  authenticatedEmail: string,
): Promise<InvitationRecord> {
  const latestInvitation = await getRecordById<InvitationRecord>(
    teamInvitationTable,
    invitationId,
    ['id', 'teamId', 'email', 'status', 'acceptedBy', 'expiresAt'],
  );

  if (!latestInvitation) {
    throw new Error('Invitation not found');
  }

  if (normalizeEmail(latestInvitation.email) !== authenticatedEmail) {
    throw new Error('Invitation recipient mismatch');
  }

  if (!(latestInvitation.status === 'ACCEPTED' && latestInvitation.acceptedBy === userId)) {
    throw toInvitationStateError(latestInvitation.status);
  }

  return latestInvitation;
}
```

**Replaces** the existing "2. Claim invitation" acceptance sub-block and the standalone "3. Concurrency-safe team coach merge" block (original handler lines ~317–390). Both places that previously repeated the invitation-accept `UpdateExpression`/`ConditionExpression` literal now call `buildInvitationAcceptUpdate`; both places that previously repeated the re-read/classify logic now call `classifyInvitationConflict`:
```ts
    const nowIso = new Date().toISOString();
    const invitationAcceptUpdate = buildInvitationAcceptUpdate(nowIso, userId);

    try {
      await docClient.send(new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: teamInvitationTable,
              Key: { id: invitationId },
              ...invitationAcceptUpdate,
              ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
            },
          },
          {
            Update: {
              TableName: teamTable,
              Key: { id: invitation.teamId },
              UpdateExpression: 'SET coaches = list_append(if_not_exists(coaches, :emptyCoaches), :coachToAdd), updatedAt = :updatedAt',
              // Correction 2: null-safe — legacy teams predate `status`
              // entirely; a bare `#status <> :archived` is false against an
              // absent attribute and would wrongly reject acceptance for
              // every pre-archive-feature team.
              ConditionExpression:
                '(attribute_not_exists(#status) OR #status <> :archived) AND (attribute_not_exists(coaches) OR NOT contains(coaches, :coachId))',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':emptyCoaches': [],
                ':coachToAdd': [userId],
                ':coachId': userId,
                ':archived': 'archived',
                ':updatedAt': nowIso,
              },
              ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
            },
          },
        ],
      }));

      invitation = { ...invitation, status: 'ACCEPTED', acceptedBy: userId };
    } catch (error) {
      if (!isTransactionCanceledException(error)) {
        throw error;
      }

      const reasons = error.CancellationReasons ?? [];
      const invitationFailed = reasons[INVITATION_TRANSACT_INDEX]?.Code === 'ConditionalCheckFailed';
      const teamFailed = reasons[TEAM_TRANSACT_INDEX]?.Code === 'ConditionalCheckFailed';

      if (invitationFailed) {
        // Same classification the pre-transaction single-item catch used:
        // re-read and determine idempotent-retry-by-same-user vs. a genuine
        // conflict (claimed by someone else, expired, declined, ...).
        invitation = await classifyInvitationConflict(teamInvitationTable, invitationId, userId, authenticatedEmail);
        // Idempotent retry by the same user — the coach-append half of the
        // original successful transaction is guaranteed to have applied too
        // (both items commit or neither does), verified at the
        // post-transaction Team read below. No repair needed here.
      } else if (teamFailed) {
        // The invitation half of the condition passed (this is a genuine,
        // first-time PENDING -> ACCEPTED transition for this caller) but the
        // coaches-append half was rejected. DynamoDB reports this as a
        // *distinct* per-item failure (unlike the old single-exception
        // shape), so "team archived" and "already a coach" are both
        // determinable from the same atomic response — no second round trip.
        const rawItem = reasons[TEAM_TRANSACT_INDEX]?.Item;
        const currentTeam = rawItem
          ? (unmarshall(rawItem) as { status?: string; coaches?: string[] })
          : undefined;

        if (currentTeam?.status === 'archived') {
          throw new Error('Cannot accept invitation: this team has been archived');
        }

        if (!currentTeam?.coaches?.includes(userId)) {
          // Neither branch of the null-safe OR explains the failure from
          // what DynamoDB returned — surface an honest, generic error
          // rather than guessing.
          throw new Error('Failed to join team');
        }

        // NOT contains(coaches, :coachId) is what failed — this user is
        // already a coach on the team. The ordinary way this happens: a
        // second, still-PENDING invitation to the same email/team is
        // accepted after the first one already succeeded (sendTeamInvitation
        // has no duplicate-invite guard, so this is routine, not an edge
        // case). The whole transaction above rolled back together, so this
        // invitation's own status write never actually applied even though
        // its condition passed — re-issue it alone now that we've confirmed
        // no team-side write is needed, matching today's pre-transaction
        // behavior for the same case.
        try {
          await docClient.send(new UpdateCommand({
            TableName: teamInvitationTable,
            Key: { id: invitationId },
            ...invitationAcceptUpdate,
          }));
          invitation = { ...invitation, status: 'ACCEPTED', acceptedBy: userId };
        } catch (retryError) {
          if (!isConditionalCheckFailed(retryError)) {
            throw retryError;
          }
          invitation = await classifyInvitationConflict(teamInvitationTable, invitationId, userId, authenticatedEmail);
        }
      } else {
        // Cancelled for a reason unrelated to either condition (e.g. a
        // throughput/validation error on one item) — surface as-is rather
        // than mis-classify it as an archived-team or conflict error.
        throw error;
      }
    }
  } else {
    if (!(invitation.status === 'ACCEPTED' && invitation.acceptedBy === userId)) {
      throw toInvitationStateError(invitation.status);
    }

    // Idempotent path: this call never attempts an invitation-status
    // transition (some prior call already fully committed it). Best-effort
    // repair for pre-migration partial-failure drift where the invitation
    // was marked ACCEPTED but the coaches append never happened.
    // Deliberately NOT archived-gated (Decision 6): this repairs an
    // already-granted membership, it does not grant a new one, so an
    // archived team must not block it. This branch IS reachable by a
    // non-Lambda path (any coach can write ACCEPTED/acceptedBy directly on
    // TeamInvitation via allow.ownersDefinedIn('coaches')), but that's a
    // policy bypass by a party who already holds coach-level access to the
    // team, not a privilege escalation for an untrusted party — so leaving
    // it archived-unaware is safe, not just convenient.
    try {
      await docClient.send(new UpdateCommand({
        TableName: teamTable,
        Key: { id: invitation.teamId },
        UpdateExpression: 'SET coaches = list_append(if_not_exists(coaches, :emptyCoaches), :coachToAdd), updatedAt = :updatedAt',
        ConditionExpression: 'attribute_not_exists(coaches) OR NOT contains(coaches, :coachId)',
        ExpressionAttributeValues: {
          ':emptyCoaches': [],
          ':coachToAdd': [userId],
          ':coachId': userId,
          ':updatedAt': new Date().toISOString(),
        },
      }));
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }
      // Already a coach — nothing to repair.
    }
  }
```

Steps 5–7 of the handler (re-read `Team`, verify `coaches` contains `userId`, run the child-record coaches backfill, re-read and return `Team`) are **unchanged** — they already work correctly against whatever state either branch above produces, and already provide the final "did the append actually take effect" check regardless of which code path ran.

The `if (!invitation.expiresAt || new Date(invitation.expiresAt) < new Date())` expiry branch (the very first thing inside `if (status === 'PENDING')`) is **unchanged** — it only ever touches `TeamInvitation`, never `Team`, so it's outside this slice's atomicity concern entirely.

## Part B — `amplify/backend.ts` IAM change (required, deploy-blocking if omitted)

**Concrete, verified finding:** CDK's `Table.grantReadWriteData()` (used for all seven of `acceptInvitation`'s existing table grants) composes `READ_DATA_ACTIONS` (`BatchGetItem`, `Query`, `GetItem`, `Scan`, `ConditionCheckItem`, plus stream actions) and `WRITE_DATA_ACTIONS` (`BatchWriteItem`, `PutItem`, `UpdateItem`, `DeleteItem`) — confirmed directly from `node_modules/aws-cdk-lib/aws-dynamodb/lib/perms.js`. **`dynamodb:TransactWriteItems` is not in either list.** Without an explicit grant, the very first `accept-invitation` call after this change ships would fail at runtime with an IAM `AccessDeniedException`, not a condition-expression error — a deploy-time correctness gap, not a logic one.

Add, near the existing `acceptInvitation` grants (after the seven `grantReadWriteData` calls, matching Step 1's scoped-`PolicyStatement` convention for anything new):
```ts
// TEAM-ARCHIVE-STEP8: TransactWriteItems is a distinct IAM action, not
// covered by grantReadWriteData's WRITE_DATA_ACTIONS (BatchWriteItem/
// PutItem/UpdateItem/DeleteItem only) — confirmed against aws-cdk-lib's
// perms.js. Required for the atomic invitation-accept + coaches-append
// TransactWriteCommand.
backend.acceptInvitation.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['dynamodb:TransactWriteItems'],
    resources: [teamInvitationTable.tableArn, teamTable.tableArn],
  })
);
```
`PolicyStatement`, `teamInvitationTable`, and `teamTable` are all already in scope at this point in the file — no new imports or `Table` references needed.

## Part B — Test Plan (`amplify/functions/accept-invitation/handler.test.ts`)

The existing file mocks `@aws-sdk/lib-dynamodb`'s `GetCommand`/`ScanCommand`/`UpdateCommand` as tagged objects (`{ __type, input }`) and routes all of them through one `mockSend` implementation. Required changes:

1. **Mock additions:**
   - Add `TransactWriteCommand: vi.fn(function (input) { return { __type: 'TransactWriteCommand', input }; })` to the `@aws-sdk/lib-dynamodb` mock.
   - Add a `vi.mock('@aws-sdk/util-dynamodb', () => ({ unmarshall: vi.fn((item) => item) }))` — an identity pass-through, so tests can hand already-plain-JS objects as `CancellationReasons[i].Item` directly rather than hand-constructing DynamoDB's low-level `{ S: 'foo' }` wire format. This matches the spirit (not the letter) of Step 1's real-`unmarshall` usage in `assign-team-owner` — that handler has no test file yet, so there's no existing precedent to match exactly; identity-mocking here is the simplest correct choice given this file's existing all-inputs-as-plain-JS convention.

2. **Existing tests requiring a mock-body update, not a behavior/assertion change** (all currently drive the PENDING→ACCEPTED happy path via two separate `UpdateCommand`s to `TeamInvitationTable`/`TeamTable`; must now handle a single `TransactWriteCommand` covering both): `'backfills coaches to roster, players, formation, and formation positions'`, `'covers every coaches-gated model in the backfill — coverage matrix'`, `'handles paginated roster scans and skips no-op player backfill entries'`, `'resolves email from Cognito User Pool when no email in claims'`. For each, extend `mockSend`'s handling to branch on `command.__type === 'TransactWriteCommand'`: apply both `TransactItems` writes against the test's local state (flip `teamUpdated = true`, and push a synthetic entry per `TransactItems` index into whatever `updateInputs`/`updatedTables` collection the test already asserts against) so the existing downstream assertions (`updatedTables.toContain('TeamTable')`, etc.) keep working with minimal per-test changes.

   **Correction (round 1): one of these four needs a real assertion change, not just a mock-body tweak.** `'backfills coaches to roster, players, formation, and formation positions'` has an existing assertion (~line 176) doing exact-string equality against the OLD standalone-`UpdateCommand` `ConditionExpression`:
   ```ts
   expect(teamMergeUpdate?.ConditionExpression).toBe('attribute_not_exists(coaches) OR NOT contains(coaches, :coachId)');
   ```
   This must be updated to the new null-safe compound string (`'(attribute_not_exists(#status) OR #status <> :archived) AND (attribute_not_exists(coaches) OR NOT contains(coaches, :coachId))'`), and/or re-pointed at the new `TransactItems[TEAM_TRANSACT_INDEX].Update` location instead of a standalone `updateInputs` entry — confirm the exact shape during implementation once the mock's `TransactWriteCommand` handling is in place. This is a genuine assertion change, not a mock-body-only diff.

3. **Existing tests requiring a genuine rewrite** (currently throw `ConditionalCheckFailedException` from a standalone `UpdateCommand` on `TeamTable`/`TeamInvitationTable` to simulate a race — must instead throw `TransactionCanceledException` with a `CancellationReasons` array from the `TransactWriteCommand` mock):
   - `'treats a conditional invitation-claim race as idempotent when same user already claimed it'`
   - `'rejects when a pending invitation is concurrently claimed by a different user'`

   Rewrite shape: when `command.__type === 'TransactWriteCommand'`, throw an object shaped like:
   ```ts
   const error = new Error('Transaction cancelled');
   (error as Error & { name: string; CancellationReasons: unknown[] }).name = 'TransactionCanceledException';
   (error as Error & { CancellationReasons: unknown[] }).CancellationReasons = [
     { Code: 'ConditionalCheckFailed', Item: { id: 'invite-1', status: 'ACCEPTED', acceptedBy: 'coach-a' } }, // index 0: TeamInvitation
     { Code: 'None' }, // index 1: TeamTable — did not itself fail
   ];
   throw error;
   ```

   **Correction (round 1): `'normalizes expired invitation race condition errors to domain error'` needs zero changes, remove it from this list.** Verified: this test's invitation fixture uses an already-expired `expiresAt` (`2000-01-01T00:00:00.000Z`) with `status: 'PENDING'`, so it runs entirely through the *separate*, untouched expire sub-branch (single-item `UpdateCommand` on `TeamInvitationTable`, PENDING → EXPIRED, then throw) — it never reaches the `TransactWriteCommand` path at all. Leave this test file-unchanged.

4. **New tests:**
   - `'rejects invitation acceptance when the team was archived mid-acceptance, and applies no partial state'` — `CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed', Item: { status: 'archived', coaches: ['owner-a'] } }]`; assert `rejects.toThrow(/archived/i)` **and** assert no `UpdateCommand`/repair write for `TeamInvitationTable` was subsequently attempted (proves atomicity — the failure is reported without a follow-up write, unlike the `teamFailed`-but-not-archived duplicate-invite branch).
   - `'accepts successfully for a legacy team with no status attribute at all'` — `TeamTable` fixture has no `status` key; assert the transaction succeeds (proves the null-safe `(attribute_not_exists(#status) OR #status <> :archived)` clause, i.e. proves Correction 2's requirement directly, not just by code inspection).
   - `'accepting a second invitation link after the first was already accepted still marks the second invitation ACCEPTED without re-appending coaches'` (renamed in round 1 — was `'repairs a legacy partial-failure acceptance where coaches was appended but the invitation was never marked ACCEPTED'`; the old name mischaracterized this as a rare legacy-repair case when it's actually the ordinary duplicate-invitation-link path, see Decision 8) — `CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed', Item: { status: 'active', coaches: ['owner-a', 'coach-b'] } }]` (i.e. team-side `NOT contains` is what failed, not archived-status); assert the handler falls through to the standalone invitation-only `UpdateCommand` (via `buildInvitationAcceptUpdate`) and the invitation ends up `ACCEPTED`.
   - `'exercises the TransactionCanceledException/CancellationReasons path for the existing idempotent-retry case, not just ConditionalCheckFailedException'` — explicitly required by the parent plan's Phase 7 step 1 test list; can likely reuse the rewritten test #3 above rather than being fully separate — confirm no duplicate coverage during implementation.

## Sequencing

1. Part A: `delete-game-safe/handler.ts`, `resource.ts` (if needed), `delete-player-safe/handler.ts`, `resource.ts` (if needed), `amplify/backend.ts` grant/env additions for both, comment-only edits to `delete-team-safe/handler.ts` and `delete-formation-safe/handler.ts`. Independent of Part B.
2. Part A UI fix: `src/components/Home.tsx`, `src/components/GameManagement/GameManagement.tsx` — two-line error passthrough; `src/components/Management.tsx` — one-function `confirmAndDelete` passthrough fix. Independent of everything else; can land in any order relative to steps 1/3/4.
3. Part A test updates (`delete-game-safe/handler.test.ts`, `delete-player-safe/handler.test.ts`).
4. Part B: `accept-invitation/handler.ts` rewrite, `amplify/backend.ts` `TransactWriteItems` grant.
5. Part B test rewrite (this is the larger, riskier piece — do it last so Part A's `npm run gate:commit` green state is banked first).
6. `npx tsc -p amplify/tsconfig.json --noEmit` — expect 0 errors.
7. Full verification below.

## Verification

```bash
npx tsc -p amplify/tsconfig.json --noEmit
npx vitest run amplify/functions/delete-game-safe/handler.test.ts
npx vitest run amplify/functions/delete-player-safe/handler.test.ts
npx vitest run amplify/functions/accept-invitation/handler.test.ts
npm run gate:commit
```

**Diff hygiene:** expect changes in exactly: `amplify/functions/delete-game-safe/handler.ts`, `amplify/functions/delete-game-safe/resource.ts` (only if a timeout/config change proves necessary), `amplify/functions/delete-player-safe/handler.ts`, `amplify/functions/delete-player-safe/resource.ts` (only if needed), `amplify/functions/delete-team-safe/handler.ts`, `amplify/functions/delete-formation-safe/handler.ts` (both comment-only), `amplify/functions/accept-invitation/handler.ts`, `amplify/backend.ts`, `amplify/functions/delete-game-safe/handler.test.ts`, `amplify/functions/delete-player-safe/handler.test.ts`, `amplify/functions/accept-invitation/handler.test.ts`, `src/components/Home.tsx`, `src/components/GameManagement/GameManagement.tsx`, `src/components/Management.tsx`. The last three are the deliberate, scoped exception to "no file under `src/`" (round 1 revision, Decision 4's UI fix plus its `Management.tsx` sibling fix) — no other `src/` file should appear in the diff. No `amplify/data/resource.ts` change (no schema/argument changes in this slice), no `package.json`/`package-lock.json` change (`@aws-sdk/util-dynamodb` already a direct dependency since Step 1).

### Manual sandbox smoke test (required before this ships, not performed as part of this plan — matches the level of validation Step 1 required for its own deploy-affecting change)

1. Archive a team as its owner. Confirm `deleteTeamSafe`/`deleteTeamCascade` ("Delete Permanently" from the Archived Teams view) still successfully deletes it.
2. Trigger the "Remove Demo Data" action against an **active** demo team; confirm it still succeeds (proves Decision 1 didn't regress).
3. As a coach viewing an archived team's game history (`Home.tsx`), attempt to delete a game; confirm it is now rejected, and that the toast shows the actual server message ("Cannot delete a game belonging to an archived team...") rather than a bare "Failed to delete game" (proves the Decision 4 UI-fix passthrough works end-to-end, not just in isolation).
4. Delete a player who has roster history on an archived team (Players tab / `Management.tsx`); confirm it is now rejected, and that the toast shows the actual server message ("Cannot delete player: player has history on archived team(s)...") rather than a bare "Failed to delete player" (proves Decision 3's guard and its `confirmAndDelete` UI-fix passthrough together).
5. Delete a game belonging to an **active** team; confirm it still succeeds unaffected. Also delete a player whose only teams are active; confirm it still succeeds unaffected (Decision 3 non-regression).
6. Send an invitation to a team, then archive that team before the invite is accepted; confirm the pending invitation is already `EXPIRED` (existing `archive-team` sweep behavior) and that accepting it fails cleanly (this exercises the *existing* expired-invitation path, not the new archived-team-mid-acceptance path — included for completeness).
7. Send an invitation, accept it normally against an **active** team; confirm the coach is added and can see the team's games/roster/formation (proves the transactional happy path and the backfill step both still work).
8. Simulate the actual race this slice targets — hardest to do live without direct DB access: archive the team via a direct API call *between* the invitee's invitation-acceptance click and the Lambda's execution (e.g. a debugger breakpoint, or a script that archives immediately after the invitation is sent, timed so acceptance lands after archival) — confirm acceptance is rejected with "this team has been archived" and that `Team.coaches` was **not** appended (query the table directly) — proves no partial state, the core requirement of this slice.
9. Accept an invitation against a **legacy team with no `status` attribute at all** (a team created before the archive feature, or a test row with `status` manually removed) — confirm acceptance still succeeds (proves the null-safe condition against real DynamoDB, not just the mocked unit test).

## Risks and Edge Cases

- **`deleteGameSafe`'s new `TeamTable` `GetCommand` is an extra round trip on every call.** Negligible — this handler already does 8+ parallel scans; one more sequential `GetItem` before them is not a meaningful latency or cost concern for a human-initiated delete action.
- **`deletePlayerSafe`'s new per-referenced-team `GetCommand`s are likewise negligible** — typically 1-3 teams per player, sequential `GetItem`s by primary key, not a scan; not a meaningful latency or cost concern.
- **The `teamFailed`-but-not-archived branch in `accept-invitation` handles the ordinary duplicate-invitation-link case (Decision 8), not a rare artifact — it must stay, not be simplified away.** It preserves the *existing* self-healing behavior the old two-step code provided (their unconditional post-if/else team-merge attempt), and `sendTeamInvitation` has no guard against sending a second invitation to the same email/team, so this path is live and reachable today, not speculative. Simplifying it to a generic throw (the fallback the original plan proposed) would regress a currently-working case — do not do this. This is settled per architecture review round 1, not an open decision point.
- **This slice adds a second, independent `TransactWriteCommand`/`TransactionCanceledException` handling pattern to the codebase with zero prior precedent** (Step 1 identified `TransactWriteItems` as "a standard, low-risk feature of the same `@aws-sdk/lib-dynamodb` document client already used" but never actually implemented it). The sandbox smoke test above, especially step 8, is the only thing that proves this against real DynamoDB rather than a mock — do not treat the unit tests alone as sufficient proof for a deploy decision, consistent with how Step 1 treated its own field-level-auth risk.
- **`isConditionalCheckFailed`/`scanAll`-style helper duplication continues to grow** (now also `isTransactionCanceledException`, `buildInvitationAcceptUpdate`, `classifyInvitationConflict`, all handler-local). Step 1 already flagged this as accruing, informational, not blocking; unchanged here — still not the right slice to extract a shared `amplify/functions/shared/` module.
- **No GSI added for anything in this slice** — `deleteGameSafe`'s and `deletePlayerSafe`'s new lookups are single `GetItem`s by primary key (`Team.id`), not scans; no index concern.
- **`Decision 4`'s new `deleteGameSafe` guard (and Decision 3's new `deletePlayerSafe` guard) are genuine, user-visible behavior changes**, not just closing internal gaps: a coach who could previously delete an archived team's game or a cross-team player's history (silently, with no warning) now gets a hard rejection. **Corrected in round 1:** the original plan claimed each call site's generic `handleApiError(error, 'Failed to delete game')` already shows the server's real message — that was factually wrong; `handleApiError` (`src/utils/errorHandler.ts`) always displays only the literal `userMessage` string passed to it, discarding the actual error. Fixed by this slice's Decision 4 UI passthrough (`src/components/Home.tsx`, `src/components/GameManagement/GameManagement.tsx` — see Part A file-by-file item 7). **Also found and fixed while verifying `deletePlayerSafe`'s call site:** `Management.tsx`'s `handleDeletePlayer` routes through a shared local `confirmAndDelete` helper (~line 46-62) whose catch block has the exact same bug — `handleApiError(error, \`Failed to delete ${opts.entityName}\`)`. Left as-is, the new `deletePlayerSafe` archived-team guard would be equally invisible to a coach as the original `deleteGameSafe` bug. Fixed with the same minimal pattern, in one place since `confirmAndDelete` is shared by `handleDeleteTeam`, `handleRemovePlayerFromRoster`, and `handleDeletePlayer` alike (see Part A file-by-file item 8) — the coach now sees "Cannot delete player: player has history on archived team(s)..." instead of "Failed to delete player" for all three flows, not just the player-delete one this slice specifically needed. No banner/disabled-state UI exists yet for either guard (Phase 5/6's read-only banners for in-game/report surfaces are still unbuilt per the parent plan's "Not yet done" list) — the reactive-toast experience (now with a real message everywhere it matters) is acceptable for this backend-focused slice, but Phase 6's read-only banner work should ideally land to make this proactive rather than reactive.

## Required Follow-Ups (not in this slice)

1. Sandbox validation (manual checklist above) — must pass before this ships, per the deploy-affecting-change precedent Step 1 set.
2. Phase 6 read-only banners on `Home.tsx`/`GameManagement.tsx`/`Management.tsx` for archived-team games and players would make the new `deleteGameSafe`/`deletePlayerSafe` rejections proactive (disabled/hidden with explanation) rather than a reactive error toast — not required for this slice, but closes the gap noted above.
3. Parent Phase 7's test list ("Invitation-acceptance atomicity... including a case that exercises the `TransactionCanceledException`/`CancellationReasons` handling path") is substantially satisfied by this slice's Part B tests — confirm during Phase 7 whether anything further is needed, or mark that line done.
