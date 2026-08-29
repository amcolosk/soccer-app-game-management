# Plan: Archive Teams

## Objective

Introduce a reversible, owner-controlled team lifecycle state that preserves historical data, blocks mutations and new games while archived, invalidates pending invitations, and retains read-only reporting and game history access.

Permanent team deletion remains a separate destructive workflow.

## Decisions

- Archive is reversible; restoring a team fully reactivates it.
- Only a persisted team owner can archive or restore a team.
- New teams assign their creator as owner.
- Existing teams require explicit owner assignment before archive controls are available.
- Archiving changes the team state only; games, rosters, players, formations, and other child records remain intact.
- Archived teams block new games and all mutations to team-related data. Enforcement is server-side (Lambda-backed) wherever a mutation path already goes through a custom operation, or is newly converted to one for the highest-value paths (team lifecycle fields, game creation); the remaining deep in-game mutation surface (lineup, rotations, substitutions, goals, notes, availability) is enforced in the UI only, as an explicit, documented tradeoff consistent with this codebase's existing UI-only role-enforcement precedent (`docs/SHARING-PERMISSIONS.md`).
- Archived teams remain readable for historical game views and reports.
- Archived teams are hidden from active team navigation and available through an archive view in Team Management.
- Archived teams remain selectable in Season Reports.
- Pending invitations are marked `EXPIRED` when the team is archived.
- Restoring a team does not revive invitations that were expired during archiving.
- Archive audit metadata records the timestamp and actor.
- `deleteTeamSafe` remains available as a separate permanent-delete operation.
- Archive and restore controls are available from Team Management only.

## Scope

### In scope

- Team lifecycle and ownership fields in the Amplify data model.
- Locking down direct client writes to lifecycle/ownership fields so they can only change through owner-checked operations.
- Explicit owner assignment for existing teams.
- Owner-authorized archive and restore operations.
- Invitation expiration during archive, with correct sequencing against the existing non-transactional accept-invitation flow.
- Server-side enforcement for team lifecycle and game creation; UI-only enforcement for the remaining in-game mutation surface (documented residual risk, not full server-side coverage).
- Active-team filtering in navigation and selectors.
- Archived-team management and restore UX.
- Read-only historical game and report access.
- Regression, authorization, and end-to-end coverage.
- Documentation of ownership and team lifecycle rules.

### Out of scope

- Cascading archive state onto child records.
- Deleting or permanently purging data as part of archive.
- Per-coach personal hiding of a shared team.
- Reviving expired invitations during restore.
- A broader redesign of team sharing or role management.

## Implementation Status (as of 2026-08-19)

**Landed and committed:**

- **Step 1** (commit `8a4d867`) — `archiveTeam`/`restoreTeam`/`assignTeamOwner` declared as `a.mutation()` operations, wired into `amplify/backend.ts` with least-privilege IAM grants, deployed to a sandbox (transformer confirmed to accept field-level `.authorization()` on `Team` at all). `ownerId` field grant widened to `.to(['create', 'read'])` (Correction 1). **Correction, added post-Step-11:** the "Correction 3's go/no-go passed" claim originally recorded here was inaccurate — the sandbox smoke test run at the time did not actually catch that `status`'s field grant blocked every `Team` creation outright (see Correction 7). That specific bug went unnoticed until a live sandbox test during Step 11 and is now fixed (`6938645`). All Correction 5 handler defects fixed, plus coach-membership TOCTOU guards and an orphaned-owner reclaim path added to archive/restore/assign-owner during review (see `docs/plans/TEAM-ARCHIVE-STEP1-BACKEND-WIRING.md`). `typecheck:amplify` added to `scripts/commit-gate.mjs`. `resource.safe-delete-policy.test.ts` extended — and its CRLF-broken block-bounding logic (found during review) fixed.
- **Step 5** (commit `d133e73`) — frontend service layer (`src/services/teamLifecycleService.ts`), `isTeamArchived`/`isTeamActive`/`isTeamOwner`/`isTeamOwnershipAssigned` helpers (`src/utils/teamUtils.ts`, Correction 2), `ownerId`-at-create wiring, and Management UX: Active/Archived sub-toggle, Archive/Restore/Assign-Owner/Delete-Permanently actions with correct ownership gating, confirmation modals, the blocking swipe-to-delete removal from active team cards, and `Home.tsx`/Sharing-tab active-team filtering. Full details, decisions, and known gaps in `docs/plans/TEAM-ARCHIVE-STEP5-FRONTEND-UX.md`.
- **Step 8** (commit `c20414d`) — remaining Phase 4 server-side checks, re-scoped per-Lambda rather than uniformly (`deleteTeamSafe`/`deleteFormationSafe` need no guard; `deleteGameSafe`/`deletePlayerSafe` get one, closing a real, previously-undocumented data-loss gap — a coach could delete an archived team's game or player history with zero warning). `accept-invitation`'s invitation-accept + coaches-append is now atomic via `TransactWriteCommand`, closing the mid-acceptance-vs-archive race. Fixed a real UX bug found along the way (three call sites were swallowing real server error messages behind a generic toast) and a real regression the new guards introduced (deleting an archived demo team's players via "Remove Demo Data" would fail; fixed by resequencing the delete order). Full details in `docs/plans/TEAM-ARCHIVE-STEP8-SERVER-ENFORCEMENT.md`.
- **Step 9** (commit `15545f6`) — Phase 6: Season Reports team selector labels archived teams `"(Archived)"`; a new shared `ArchivedTeamBanner` component gives every surface showing an archived team's data (Season Reports, all four `GameManagement.tsx` states) a persistent, prominent read-only indicator. Visibility only, not enforcement — makes Step 8's server-side guards proactive rather than purely reactive, but doesn't disable any control (that remains deferred, along with sticky-stack integration for the banner itself). Full details in `docs/plans/TEAM-ARCHIVE-STEP9-REPORTS-READONLY-BANNERS.md`.
- **Step 10** (commit `494c096`) — Phase 7's remaining pieces: dedicated E2E coverage for the archive lifecycle itself (`e2e/team-management.spec.ts`'s archive→restore round trip; the new `e2e/team-archive-ownership.spec.ts` two-coach spec covering the orphaned-owner revoke→reclaim→restore recovery flow), a backend unit test for `assignTeamOwner`'s authorization condition (the one lifecycle Lambda with zero coverage until now — `archive-team`/`restore-team` handler tests remain a follow-up), and a `docs/SHARING-PERMISSIONS.md` rewrite correcting three stale claims (permanent delete and invitation management were documented as owner-gated; they never were) and documenting the real server-side-vs-UI-only split. Security review caught that the docs update as originally planned would have published a detailed exploitation recipe for a real, unfixed `revokeCoachAccess` child-record-cascade gap in this public repo — filed [amcolosk/soccer-app-game-management#162](https://github.com/amcolosk/soccer-app-game-management/issues/162) and trimmed the doc to name the gap without the mechanism detail. Full details in `docs/plans/TEAM-ARCHIVE-STEP10-E2E-AND-DOCS.md`.
- **Step 11, Part 1** (Phase 8 sub-step 1 only) — `Game.create` converted from a direct client-side write to a Lambda-backed `createGame` custom mutation (raw DynamoDB SDK write, consistent with every other Lambda in this feature — Decision 0). The Lambda derives all schema-defaulted fields explicitly and derives `coaches` server-side from a strongly-consistent read of `Team.coaches`, closing the client-side "hope the team data isn't stale" trust gap. `Home.tsx` gained an insertion-side reconciliation mechanism (`pendingCreatedGames` + `gameRefreshKey`) so a newly created game renders immediately without waiting for `observeQuery`'s eventually-consistent scan, plus a window-focus/tab-visibility re-list as a partial mitigation for the now-accepted cross-coach real-time propagation lag (a genuine, if narrow, regression on a previously-real-time-synced path — see the plan's Decision 0). A shared `assertMutationResult` helper was extracted and `teamLifecycleService.ts` retrofitted to use it. **No archived-team check in this part** — that is Part 2's entire content, deliberately deferred so a regression is attributable to exactly one change. Full details in `docs/plans/TEAM-ARCHIVE-STEP11-GAME-CREATE-CONVERSION-PART1.md`.
- **Post-Step-11-Part-1 sandbox-validation fixes** (commits `69be2ea`, `6938645`) — two real bugs surfaced only by an actual live sandbox deploy of Part 1, neither caught by any prior review round since none of them run a real CDK synth or a real create-mutation round trip:
  - `createGame` collided with `Game`'s implicit auto-generated `create<Model>` GraphQL field (Amplify Gen2 declares that field in the schema regardless of what the model's authorization grant allows — removing `create` from the grant only restricts who can *call* it, not whether the field name exists). Renamed to `createGameSafe`, matching the established `Safe`-suffix convention already used by `deleteTeamSafe`/`deleteFormationSafe`/`deleteGameSafe`/`deletePlayerSafe` for exactly this collision class. `createGame` was the only custom create/update/delete-shaped mutation in this schema that hadn't followed the convention.
  - **`Team` creation itself was broken since Step 1** (`8a4d867`) — see Correction 7 below. Fixed by widening `status`'s field-level grant to `.to(['create', 'read'])`, mirroring `ownerId`'s existing shape.
  - Also repaired unrelated but blocking local dev tooling found along the way: `package.json`'s `seed` script pointed at a nonexistent `ampx seed` command (real command is `ampx sandbox seed`), and `@aws-amplify/seed`'s pinned exact `aws-amplify` dependency version was creating a duplicate, never-configured Auth singleton instance, masked behind a misleading `AuthUserPoolException: Auth UserPool not configured` error — fixed via an npm `overrides` entry forcing dependency deduplication.
- **Step 11, Part 2** (Phase 8 sub-step 2, commit `150ebc4`) — added the archived-team check to the `createGameSafe` Lambda: `team.status === 'archived'` now rejects game creation server-side with a clear, actionable error, closing the parent plan's last named gap. Widened the `Team` `GetCommand`'s `ProjectionExpression` to also fetch `#status` (aliased, since `status` is a DynamoDB reserved word) alongside the existing `id, coaches` projection from Part 1 — no new IAM grant needed. `src/components/Home.tsx`'s `handleCreateGame` catch block was updated to surface the real server error message (`showError(error.message)`) instead of the generic `handleApiError` toast, matching Step 8's Decision 4 precedent, now load-bearing because there's a specific, actionable rejection to show. `src/services/demoDataService.ts` was confirmed (not modified) to have no TOCTOU exposure: `createDemoTeam` creates its `Team` and its one `Game` synchronously in the same function body with no user-controllable yield point between them. Moved "Game creation" from the UI-only-enforced list to the backend-enforced list in `docs/SHARING-PERMISSIONS.md`. This closes out Phase 8 and the parent plan's entire "Next Steps (ordered)" list. Full details in `docs/plans/TEAM-ARCHIVE-STEP11-GAME-CREATE-CONVERSION-PART1.md` and `docs/plans/TEAM-ARCHIVE-STEP11-GAME-CREATE-CONVERSION-PART2.md`.

A coach can now create a team, become its owner, archive it, see it move to an Archived Teams view, restore it, have archived teams correctly excluded from game scheduling and coach-sharing invitations, have archived teams' game/player history genuinely protected from deletion server-side, see a clear, persistent visual indicator on every report and game screen showing archived-team data, and recover a team whose owner was revoked mid-session via the orphaned-owner reclaim path — all proven end to end by E2E coverage, not just unit tests, **and confirmed working against a real, live sandbox deploy** (team creation, game creation, and the game appearing immediately without a manual refresh were all directly verified, not just unit-tested). Game creation itself is now Lambda-mediated with server-derived `coaches` **and** a server-side archived-team check — Phase 8 is fully complete.

**Not yet done:** nothing from the parent plan's "Next Steps (ordered)" list — Phase 8 landed in full with Step 11 Part 2. Recorded residual risks, none blocking and none resolved by Step 11 Part 2: (1) from Step 8, a player rostered on two teams where only one is shared with the deleting coach can have the other team's name disclosed in a rejection message (pre-existing `Player.coaches` union behavior, not introduced by Step 8); (2) from Step 9, the read-only banner reflects a team snapshot captured at game-screen entry, not a live subscription, so a mid-session archive by another coach isn't reflected until the screen is re-entered (inherited from Step 1's architecture — the lifecycle Lambdas don't trigger AppSync subscriptions); (3) from Step 10, `revokeCoachAccess` doesn't cascade to child records (`TeamRoster`/`Player`/`Game`/`Formation`/`FormationPosition`), so a "revoked" coach retains read/write on that team's game data until fixed — tracked in issue #162, not yet fixed; (4) `revokeCoachAccess` also still has no owner-guard (a co-coach can revoke the owner and self-claim via `assignTeamOwner` — an accepted tradeoff since Step 1, not tracked as an issue); (5) full `archive-team`/`restore-team` handler unit tests remain unwritten (only `assign-team-owner`'s condition got covered in Step 10, since it's the one the E2E work couldn't reach directly); (6) from Step 11 Part 1, cross-coach real-time propagation lag for newly created games — a coach who stays focused on an untouched `Home.tsx` will not see another coach's newly created game until they navigate away and back, refocus the tab, or refresh (accepted, honestly-framed residual risk with a partial focus/visibility mitigation — see the plan's Decision 0 and Risks section).

<details>
<summary>Original Step 1 status writeup (2026-08-18, kept for history)</summary>

Landed in commit `5fcaff3` ("start of archive plan"):

- **Phase 1 (partial)** — `Team` in `amplify/data/resource.ts` gained `ownerId`, `status` (`.default('active')`), `archivedAt`, and `archivedBy`, each carrying a field-level `.authorization((allow) => [allow.ownersDefinedIn('coaches').to(['read'])])` override. The model-level grant is unchanged, as planned.
- **Phase 3 (partial)** — handler + `defineFunction` resource files exist for `amplify/functions/archive-team/`, `amplify/functions/restore-team/`, and `amplify/functions/assign-team-owner/`, following `delete-team-safe`'s fetch -> check -> conditional-write conventions with owner-equality authorization.

Blocking gaps in what landed:

- **None of the three operations are declared or wired.** `amplify/data/resource.ts` has no `archiveTeam` / `restoreTeam` / `assignTeamOwner` `a.mutation()` block, the three function objects are not imported there, and `amplify/backend.ts` does not register them (`defineBackend` list, `teamTable.grantReadWriteData(...)`, `teamInvitationTable.grantReadWriteData(...)`, `addEnvironment('TEAM_TABLE' | 'TEAM_INVITATION_TABLE', ...)`). The handlers reference `Schema['archiveTeam']` and friends, so all three fail to typecheck today.
- **`npm run gate:commit` does not catch this.** `npm run build` runs `tsc` against the root `tsconfig.json`, whose `include` is `["src"]`; `amplify/**` is never typechecked, and ESLint's type-aware rules do not flag missing schema members. The gate is currently green on a backend that cannot deploy.
- No frontend, service, test, or documentation work has started (Phase 2 UX, Phases 4-7). `amplify/data/resource.safe-delete-policy.test.ts` still passes unchanged — the new fields introduced no blank lines inside the `Team` block, as Phase 7 step 2 anticipated.

</details>

## Corrections Required Before Continuing

These supersede the corresponding text in the phases below.

1. **`ownerId` cannot be set at create under the field lockdown as written (Phase 1 step 2 contradicts Phase 1 step 4).** Both `Management.tsx: handleCreateTeam` and `src/services/demoDataService.ts` create teams with a direct `client.models.Team.create()`; with a field-level grant of `.to(['read'])`, the client cannot write `ownerId` on create either, so every new team would be born ownerless and immediately require an `assignTeamOwner` round trip — with a failure window that leaves an ownerless team behind.
   **Decision:** grant `ownerId` `.to(['create', 'read'])` at field level. The creator stamps ownership atomically at create time; `update` is still not granted, so ownership can never be changed through the general `Team.update()` path. `status` / `archivedAt` / `archivedBy` stay `.to(['read'])` — the `status` default is applied server-side, not by the client. `assignTeamOwner` remains, but only for legacy ownerless teams.

2. **Legacy teams have no `status` attribute at all, permanently.** `.default('active')` applies only to newly created records. Existing rows have no `status`, and nothing in this plan backfills them (owner assignment does not touch `status`). Every read path must therefore treat `status == null` as active. Add one shared helper — `isTeamArchived(team)` / `isTeamActive(team)` in `src/utils/` — and use it for every filter, badge, and guard, rather than inline `=== 'archived'` / `!== 'archived'` comparisons scattered across components. This also affects server-side condition expressions: a bare `#status <> :archived` is false for an absent attribute, so every archived-team DynamoDB condition must be written `(attribute_not_exists(#status) OR #status <> :archived)`. (This also corrects the closing sentence of "Architecture Decision: Lifecycle Field Representation", which implied owner assignment resolves the undefined-status case; it does not.)

3. **Field-level owner-based authorization is unproven in this codebase and must be validated on a sandbox before any UI work.** No other model in this repo uses field-level `.authorization()`, so it is unverified that this Amplify version's transformer accepts `allow.ownersDefinedIn('coaches')` at field level, that `.default()` still applies on a field carrying a field-level rule, and that the locked fields are still populated in `observeQuery` subscription payloads (field-level auth is the classic source of nulled-out subscription fields). Validate on a sandbox deploy with a real smoke test — create a team, confirm `ownerId` persists and `status` defaults to `active`, confirm a plain `Team.update({ id, status: 'archived' })` is rejected, confirm the team still streams into `Home.tsx` with its fields intact — **before** building Phase 5 UI on the assumption. If the transformer rejects the shape, the fallback is a Lambda-backed `updateTeamSafe` covering all team writes, which is a materially larger Phase 1.

4. **`TeamInvitation` has no explicit `teamId` index.** Its only declared secondary index is `index('email').sortKeys(['status'])`, so `archive-team`'s `scanAll` over the invitation table is a full table scan per archive. That matches `delete-team-safe`'s existing scan precedent and is acceptable to ship, but the `Team.invitations` `hasMany` relation already creates an implicit `teamId` index; either query it, or add an explicit `index('teamId').queryField('listInvitationsByTeamId')` for a stable name. Prefer the explicit index — the model is already being modified in this work.

5. **Defects in the landed handlers, to fix while wiring them up:**
   - `archive-team`: the pending-invitation sweep sits *inside* the `if (team.status !== 'archived')` branch, so a retry after a partial failure — or an invitation still `PENDING` after a race — is never swept. This violates Phase 3 step 3's "deterministic when called repeatedly". Move the sweep outside the status branch so a repeat archive call re-sweeps any remaining `PENDING` invitations.
   - `assign-team-owner`: coach membership is checked against the fetched item, but the conditional write only asserts `attribute_not_exists(ownerId)`. Add `contains(coaches, :callerSub)` to the `ConditionExpression` so a coach removed by `revokeCoachAccess` between the read and the write cannot claim ownership.
   - `restore-team`: `REMOVE archivedAt, archivedBy` erases the audit trail on restore, which Phase 3 step 4 left open. **Decision:** keep the removal — these fields are only ever displayed while a team is archived, and a stale value on an active team is misleading. If archive history is wanted later, add append-only audit records rather than retaining last-archive fields. Document this in `docs/SHARING-PERMISSIONS.md`.

6. **`Game.create` conversion is re-sequenced out of Phase 4** — see the revised Phase 4 and the new Phase 8. It is the single largest regression risk in this plan (real-time sync, demo seeding, e2e coverage) and it gates nothing else; archive ships complete and useful without it, because archived teams are already filtered out of the game-creation dropdown in Phase 5.

7. **A schema `.default()` value cannot be applied on a field whose field-level grant excludes `create`, even though nothing in the request explicitly sets that field — this broke every `Team` creation from Step 1 onward, undetected until a live sandbox test during Step 11.** `status: a.string().default('active').authorization((allow) => [allow.ownersDefinedIn('coaches').to(['read'])])` looks correct by the same logic Correction 1 used for `ownerId` (client can't write it, server applies the default) — but applying a default value **is itself a write**, and AppSync's transformer evaluates that write against the field-level grant just like any other. With no `create` permission, AppSync rejects the entire `createTeam` mutation with `Unauthorized on [status]`. This is a distinct failure mode from what Correction 3 anticipated (that correction worried about nulled-out *read* payloads on an already-working mutation, not a hard rejection blocking mutation *entirely*) — which is likely why Correction 3's stated go/no-go smoke test either wasn't run rigorously enough to catch it, or was run before this exact grant text existed. Whatever the history, **the "Correction 3's go/no-go passed" claim recorded against Step 1 in this doc's Implementation Status was inaccurate** — team creation has not actually worked correctly since that commit, on any sandbox, until this correction shipped.
   **Decision:** grant `status` `.to(['create', 'read'])` at field level, exactly mirroring `ownerId`. `update` is still withheld, so a coach still cannot flip `status` directly via a plain `Team.update()` — archiving still only works through `archiveTeam`/`restoreTeam`. Verified against a live sandbox both ways: team creation now succeeds and returns `status: "active"`, and a direct `updateTeam({status: 'archived'})` call is still rejected. Fixed in commit `6938645`.
   **General lesson for this schema going forward:** any field combining a schema `.default()` with a field-level authorization override needs `create` in that grant, or the default can never be written. `archivedAt`/`archivedBy` are unaffected (no `.default()`, so nothing ever auto-writes them) — this class of bug is specific to the `.default()` + field-level-auth-excluding-`create` combination, and any *future* locked field on this or any other model should be checked against it before shipping.

## Next Steps (ordered)

~~1-6~~ Steps 1-6 below are done — kept for history, see "Implementation Status" above for what actually landed vs. what was originally planned (ownership gating on Restore, the orphaned-owner Assign-Owner affordance, and the discard-confirm on tab switch were all added during review, beyond the original text).

<details>
<summary>Original Next Steps 1-6 (completed)</summary>

1. Unblock the backend (Phase 1/3 completion) — done, commit `8a4d867`.
2. Add `tsc -p amplify/tsconfig.json --noEmit` to `scripts/commit-gate.mjs` — done, commit `8a4d867`.
3. Extend `amplify/data/resource.safe-delete-policy.test.ts` — done, commit `8a4d867`.
4. Sandbox-validate the field-level authorization contract — done, confirmed working via a live sandbox deploy.
5. Frontend service layer — done, commit `d133e73`.
6. Phase 5 Management UX — done, commit `d133e73`.

</details>

**Remaining:**

~~7-8~~ Steps 7-8 below are done — kept for history.

<details>
<summary>Original Next Steps 7-8 (completed)</summary>

7. Phase 5 steps 2 and 4 navigation filtering (`Home.tsx`, Sharing-tab picker) — done, commit `d133e73`. `SeasonReportRoute.tsx` remained open, folded into step 9 below.
8. Remaining Phase 4 server-side checks — done, commit `c20414d`, with the archived-team-delete-guard phrasing corrected per-Lambda rather than applied uniformly (see Implementation Status above).

</details>

~~9~~ Step 9 below is done — kept for history.

<details>
<summary>Original Next Step 9 (completed)</summary>

9. Phase 6 reports / read-only access — done, commit `15545f6`. `PlanTab.tsx` needed no separate banner mount (only ever rendered nested inside `GameManagement.tsx`); the Management archived-team roster expansion has no banner because Step 5 deliberately never built that expansion at all.

</details>

~~10~~ Step 10 below is done — kept for history.

<details>
<summary>Original Next Step 10 (completed)</summary>

10. Phase 7 remaining tests and documentation — done, commit `494c096`. Full `archive-team`/`restore-team` handler unit tests were not included (only `assign-team-owner`'s, since that's the condition the E2E work structurally couldn't reach) — see Follow-up 14 below.

</details>

~~11~~ Step 11 below is done — kept for history.

<details>
<summary>Original Next Step 11 (completed)</summary>

11. Phase 8 (`Game.create` conversion), as its own pipeline run — done. Part 1 (Lambda conversion, no archived-team check, `createGameSafe`) and Part 2 (archived-team check, docs closeout) both landed; see the Implementation Status entries above and `docs/plans/TEAM-ARCHIVE-STEP11-GAME-CREATE-CONVERSION-PART1.md` / `..._PART2.md`.

</details>

12. **Follow-up ticket (not gating, low priority):** `deletePlayerSafe`'s archived-team guard can disclose the name of a team the deleting coach doesn't otherwise have visibility into, when a player is rostered on two teams and only one is shared with that coach. Root cause is a pre-existing `Player.coaches` union behavior in `accept-invitation`'s backfill, not something Step 8 introduced — but Step 8's new guard is the first place it surfaces as team-name disclosure in an error message. See `docs/plans/TEAM-ARCHIVE-STEP8-SERVER-ENFORCEMENT.md`'s security review findings.
13. **Follow-up (not gating, medium priority):** the deferred `aria-disabled` treatment on deep in-game mutation controls, and sticky-stack integration for `ArchivedTeamBanner` (or a compact lock indicator folded into `CommandBand`), are natural companions — bundle them together when this is picked up, per Step 9's UI review.
14. **Follow-up (not gating, tracked in GitHub, not just this doc):** [amcolosk/soccer-app-game-management#162](https://github.com/amcolosk/soccer-app-game-management/issues/162) — `revokeCoachAccess` removes a coach from `Team.coaches` only, never sweeping child records (`TeamRoster`/`Player`/`Game`/`Formation`/`FormationPosition`), so a "revoked" coach silently retains read/write access to that team's game data. Filed publicly during Step 10's security review rather than fixed in that slice (tests-and-docs-only scope).
15. **Follow-up (not gating, low priority):** full `archive-team`/`restore-team` handler unit tests (Phase 7 step 1's original scope) — Step 10 only covered `assign-team-owner`'s condition, since E2E structurally couldn't prove the orphaned-owner-on-an-already-archived-team combination and that gap mattered more. `archive-team`/`restore-team`'s own idempotency/owner-check conditions are still only proven by E2E + manual sandbox testing, not fast-feedback unit tests.

## Implementation Plan

### Phase 1: Data Model and Ownership Contract

1. Update `Team` in `amplify/data/resource.ts` with:
   - Persisted `ownerId` (`a.string()`).
   - `status: a.string().default('active')`, with a code comment enumerating valid values (`active | archived`), following the existing `Game.status` convention. Do not use `a.enum()`: this schema's Amplify version does not support `.required()`/`.default()` on enums (see the documented constraint on `GameNote.noteType`), so an enum would reintroduce the same nullability ambiguity this design is trying to avoid.
   - `archivedAt` (`a.datetime()`) and `archivedBy` (`a.string()`) audit fields.
2. Lock down direct client writes to `ownerId`, `status`, `archivedAt`, and `archivedBy` using field-level `.authorization()` overrides. **Amended (Corrections 1 and 3): `ownerId` is granted `.to(['create', 'read'])` so the creator can stamp ownership at create time, the other three stay `.to(['read'])`, and the whole mechanism must be sandbox-validated before UI work begins.** Original rationale: which Amplify Gen2 supports (unused elsewhere in this repo, but the correct native mechanism here — not a workaround). Today `Team` only has model-level authorization (`allow.ownersDefinedIn('coaches').to(['create','read','update'])`), and the app already calls `Team.update()` directly from the client, so any coach could otherwise overwrite these fields and bypass the owner check entirely. Apply a field-level override on each of these four fields granting coaches `read` only (e.g., `allow.ownersDefinedIn('coaches').to(['read'])`), with no `update` grant for coaches on these fields specifically — all writes to them go exclusively through the new owner-checked archive/restore (and Phase 2 owner-assignment) Lambdas. The model-level grant `allow.ownersDefinedIn('coaches').to(['create','read','update'])` remains unchanged for every other `Team` field, since coaches still need direct update access for `name`/`formationId`/`sport`/etc. via `Management.tsx`'s `handleUpdateTeam`, and for the `coaches` array via `invitationService.ts`'s `revokeCoachAccess`. No additional "allow Lambda to write" grant is needed: Lambda handlers already bypass all AppSync/model authorization by writing directly via the DynamoDB SDK against the IAM-scoped environment table (the same pattern `delete-team-safe` uses).
3. `src/types/schema.ts` re-exports the schema type and is auto-derived from `resource.ts`; no manual step is needed there. `schema.graphql/` is a static reference artifact not consumed by the runtime client — confirm this during implementation and skip touching it unless disproven.
4. Ensure new-team creation persists the creator as `ownerId` — at both direct-create call sites, `Management.tsx: handleCreateTeam` and `src/services/demoDataService.ts`, by passing `ownerId: currentUserId` into `client.models.Team.create()` (possible only with the `create` field grant from Correction 1).
5. Define how a legacy team with no owner is represented (`ownerId` undefined) and ensure it cannot expose archive/restore controls until ownership is assigned. Legacy teams also carry no `status` attribute at all (Correction 2) — add the shared `isTeamArchived`/`isTeamActive` helper in this phase, before any consumer needs it.
6. Review invitation role and membership flows so persisted ownership remains stable when coaches are added or removed.

### Phase 2: Existing-Team Owner Assignment

1. Identify whether existing data contains a reliable creator or owner source.
2. If no reliable source exists, add an explicit, Lambda-backed "assign owner" operation — required because `ownerId` is one of the four field-locked fields from Phase 1 step 2 and cannot be set via a plain client write.
3. The assign-owner Lambda must use a conditional DynamoDB write (`attribute_not_exists(ownerId)`) so two coaches cannot concurrently claim ownership of the same legacy team; a losing concurrent request fails with a clear "team already has an owner" error rather than silently overwriting.
4. **Ownership-assignment policy (decided):** self-assignment is first-come-first-served by any existing coach on the team — any coach listed in `Team.coaches` may call assign-owner for an ownerless legacy team, and the conditional write above resolves the race. No additional approval/gating step is required.
5. Do not silently infer ownership at archive time.
6. Add authorization tests for owner, non-owner coach, ownerless legacy team, and concurrent-assign-owner race cases.

### Phase 3: Archive and Restore Backend Operations

1. Add owner-authorized archive and restore schema operations and Lambda handlers.
2. Reuse the fetch-then-check-then-write and error-handling conventions from `delete-team-safe`, but note the authorization shape differs: `delete-team-safe` checks `coaches.includes(callerSub)` (any coach), while archive/restore must check strict equality against `team.ownerId` (owner only) — a stricter, new authorization shape for this repo.
3. Archive should:
   - Verify `team.ownerId === callerSub`.
   - Be deterministic when called repeatedly.
   - Set lifecycle and audit fields.
   - Mark pending team invitations as `EXPIRED`.
   - Leave all child records intact.
4. Restore should:
   - Verify `team.ownerId === callerSub`.
   - Reactivate the team and clear or update current archive metadata according to the audit decision.
   - Leave invitations expired.
5. Update frontend service wrappers with dedicated archive/restore methods rather than conflating archive with cascade deletion.

### Phase 4: Archived-Team Mutation Enforcement

Most of the models listed below (`LineupAssignment`, `Substitution`, `PlayTimeRecord`, `Goal`, `PlayerAvailability`, `GamePlan`, `PlannedRotation`, `TeamRoster`, and `Game.create`) are written today via plain direct `client.models.*` calls, not Lambda-backed mutations, and only carry `gameId`/`teamId` one or two hops removed. Amplify Gen2's declarative authorization cannot reference a parent table's archived state, so full server-side coverage is not achievable without converting each of these to a custom mutation — a materially larger, separately scoped effort. This phase therefore splits enforcement explicitly:

1. **Server-side enforcement (Lambda-backed, required for this phase):**
   - Team lifecycle fields (`ownerId`, `status`, `archivedAt`, `archivedBy`) — already covered by Phase 1/3's field lockdown.
   - Team, formation, position, and related deletes — already covered by existing `*Safe` delete Lambdas; add an archived-team check to them.
   - ~~Convert `Game.create` to a Lambda-backed operation~~ — **re-sequenced to Phase 8 (Correction 6).** Until Phase 8 lands, game creation against an archived team is blocked in the UI only (archived teams are filtered out of the "Schedule New Game" dropdown in Phase 5 step 2), and this is documented alongside the other UI-only-enforced paths.
   - Invitation acceptance (see step 5 below).
2. **UI-only enforcement (explicit, documented tradeoff — not full server-side coverage):**
   - Game creation (until Phase 8 lands).
   - Lineup, rotation, and player-availability changes.
   - Notes, goals, substitutions, and other in-game event changes.
   - Roster and player membership changes.
   - Disable/hide these affordances in the UI when the team is archived; document this as a residual risk consistent with this app's existing UI-only role-enforcement precedent, rather than presenting it as fully enforced.
3. Preserve read queries for archived teams in both categories.
4. Return consistent, user-actionable errors when a server-side archived-team mutation is attempted.
5. Ensure invitation acceptance rejects archived teams and cannot leave partial state: `accept-invitation/handler.ts` must use a `TransactWriteCommand` (DynamoDB SDK, spanning the `TeamInvitation` and `Team` tables in one atomic call) so the invitation's PENDING→ACCEPTED transition (conditioned on current status = `PENDING`) and the `Team.coaches` append (conditioned on `status <> 'archived' AND NOT contains(coaches, :userId)`) either both succeed or both fail — replacing the prior non-transactional two-step write and its acknowledged partial-failure risk. No `TransactWriteItems` precedent exists in this repo yet, but it is a standard, low-risk feature of the same `@aws-sdk/lib-dynamodb` document client already used in `accept-invitation/handler.ts`.
   - **Legacy rows have no `status` attribute (Correction 2).** A bare `status <> 'archived'` condition evaluates to *false* when the attribute is absent, which would reject invitation acceptance for every pre-archive team. The condition must be `(attribute_not_exists(#status) OR #status <> :archived)`, with `#status` in `ExpressionAttributeNames` since `status` is a DynamoDB reserved word. The same null-safe shape applies to any other archived-team condition expression added in this phase.
   - **Transactional error handling:** the `TransactWriteCommand` path throws `TransactionCanceledException` with per-item `CancellationReasons`, not the `ConditionalCheckFailedException` the existing `isConditionalCheckFailed()` helper detects for single-item writes. Add an equivalent transactional-exception check (detecting `TransactionCanceledException` and inspecting `CancellationReasons` for a `ConditionalCheckFailed` entry) so the existing idempotent-retry behavior in `accept-invitation/handler.ts` continues to work on this path.

### Phase 5: Management and Navigation UX

1. Update `src/components/Management.tsx` with:
   - A segmented sub-toggle inside the existing `Teams` tab — `[ Active Teams (X) | Archived Teams (Y) ]` — placed below the `+ Create New Team` action, mirroring the existing Roster/Positions toggle pattern already used in this component. Do not add a 6th top-level tab; the mobile nav bar is already at capacity. Sub-toggle touch targets must meet this app's 44x44px minimum touch-target size.
   - `+ Create New Team` is hidden while the Archived Teams sub-tab is active; it is only visible under Active Teams.
   - Archived Teams empty state: `No archived teams.` with body text `Teams you archive will appear here for historical reference and can be restored anytime.`, following this app's existing `.empty-state` convention (centered, italic, `--text-secondary`).
   - **Mobile swipe-gesture safety fix (Major, blocking):** active team cards currently expose `useSwipeDelete`, surfacing a full-width permanent-delete action on a horizontal swipe. This must be removed from active team cards before archive ships, since a coach's ordinary swipe gesture must never trigger irreversible cascade deletion. Swipe-to-delete is removed from active team cards entirely; permanent delete becomes an explicit button/menu action reachable only from the Archived Teams view.
   - Active team card actions: `Edit`, `Expand Roster`, and an explicit `Archive` button (owner-only; hidden, not just disabled, for non-owners and for legacy teams with no assigned owner).
   - Legacy ownerless team cards: an inline `Owner Unassigned` warning pill plus an explicit `Assign Owner` action, so users understand why archive controls are absent rather than assuming a bug.
   - Archived team cards: muted styling (reduced-emphasis background/opacity) with an `Archived` status badge, actions limited to `Restore Team` and a separately-styled, visually distinct `Delete Permanently` action (danger styling). On mobile viewports, `Restore Team` and `Delete Permanently` must not sit directly adjacent: each control meets the 44px minimum touch-target height and the two are separated by at least a 12px gap or distinct visual grouping/vertical stacking, so an accidental mis-tap cannot trigger permanent deletion.
   - Archived team roster expansion displays the persistent read-only status banner described in step 4 below (e.g., "🔒 Archived Team — Read-Only (Archived MMM D, YYYY)") at the top of the expanded roster container. Add/remove-player and position-toggle controls remain visible (not hidden) and use `aria-disabled="true"` with an explanatory tooltip/title/`aria-describedby` (e.g., "Editing disabled: Team is archived"), matching the treatment used elsewhere for UI-only-enforced mutation controls.
   - Confirmation dialogs, matching this app's existing modal conventions and safety contracts:
     - **Archive** — `variant: 'warning'`; reversible, clarifies invitations expire and all data is preserved; confirm button labeled `Archive Team`; Cancel button receives `autoFocus`.
     - **Restore** — `variant: 'default'`; clarifies the team reactivates and expired invitations are not revived; confirm button labeled `Restore Team`; Cancel button receives `autoFocus`.
     - **Permanent delete** — `variant: 'danger'` (existing convention); irreversible, explicitly names cascade-deleted data; confirm button labeled `Delete Permanently`; Cancel button receives `autoFocus`.
   - Failure states for archive/restore/owner-assignment actions.
   - Display of `archivedAt` (formatted "Archived on MMM D, YYYY") and `archivedBy` (resolved coach name if available) on the archived team card is a standard, required element, not optional, so multi-coach teams always have visibility into who archived and when.
   - `aria-live="polite"` announcement region when switching between the Active/Archived toggle, announcing `"Showing {X} active team(s)"` / `"Showing {Y} archived team(s)"` so screen reader users are informed of list changes.
2. Update `src/components/Home.tsx` so archived teams do not appear in active operational navigation, team selectors, or the "Schedule New Game" team dropdown: filter `teams` to exclude `status === 'archived'` for active game creation dropdowns, active team navigation, and onboarding progress calculation.
3. Update team selectors and routes to distinguish active teams from archived teams.
4. Add a prominent, persistent read-only status banner at the top of the container — e.g., "🔒 Archived Team — Read-Only (Archived MMM D, YYYY)" — to archived team and game views reached through history/report navigation and to the archived roster expansion in `Management.tsx` (step 1 above), so the read-only state is unambiguous rather than implied only by disabled controls.
5. All archived-team mutation controls across in-game surfaces (`GameManagement/GameManagement.tsx`, `GameManagement/PlanTab.tsx`, and related in-game panels covering lineup, rotation, substitutions, goals, notes, availability, roster/player edits, deletes) must remain visible and use `aria-disabled="true"` plus an explanatory tooltip/title/`aria-describedby` such as "Editing disabled: Team is archived" — consistent with the treatment specified in step 1's roster-expansion bullet — rather than being hidden or disabled without context. Each such surface also displays the persistent read-only status banner from step 4 at the top of the container. Since this enforcement is UI-only per Phase 4, this explicit, accessible explanation is required, not optional, given there is no server-side backstop for these paths.

### Phase 6: Reports and Historical Access

1. Update `src/components/routes/SeasonReportRoute.tsx` to include archived teams in the selector, formatted as `"{team.name} (Archived)"` for archived teams, so users aren't confused about why a listed team can't be scheduled for new games. Selecting an archived team displays the persistent read-only status banner (Phase 5 step 4) at the top of the report/history view.
2. Permit report generation for archived teams.
3. Permit navigation from reports to read-only historical game views, surfacing the same persistent read-only status banner described in Phase 5 step 4.
4. Ensure archived teams cannot be used to create or edit games through report or route entry points, and that every mutation affordance reachable from this path uses the same visible-but-`aria-disabled` treatment as Phase 5 step 5, not hidden controls.

### Phase 7: Tests and Documentation

1. Add backend/service tests covering:
   - Owner authorization.
   - Non-owner rejection.
   - Ownerless legacy-team rejection.
   - Concurrent owner-assignment race (conditional-write rejection for the losing request).
   - Archive and restore idempotency.
   - Invitation expiration, including the mid-acceptance race between archive and `accept-invitation`.
   - Invitation-acceptance atomicity: the `TransactWriteCommand` leaves no partial state when either condition fails (archived team mid-acceptance, or invitation no longer `PENDING`), including a case that exercises the `TransactionCanceledException`/`CancellationReasons` handling path (not `ConditionalCheckFailedException`) so the idempotent-retry logic is proven against the transactional error shape, not just the single-item shape.
   - Child-record preservation.
   - Restore behavior without invitation revival.
   - Archived mutation rejection for server-side-enforced paths (lifecycle fields, deletes, invitation acceptance; `Game.create` lands with Phase 8).
   - Direct-write rejection: confirm `ownerId`/`status`/`archivedAt`/`archivedBy` cannot be set via a plain `Team.update()` call by a non-owner coach.
   - *(Real-time `Game.create` behavior moved to Phase 8.)*
2. Update `amplify/data/resource.safe-delete-policy.test.ts`: since the model-level `Team` authorization grant is unchanged (Phase 1 step 2 keeps `allow.ownersDefinedIn('coaches').to(['create','read','update'])` at the model level), the existing regex/assertion pinning that model-level block likely stays as-is. Instead, add new assertions specifically targeting the field-level `.authorization()` text on the four locked fields (`ownerId`, `status`, `archivedAt`, `archivedBy`), plus assertions confirming the new archive/restore/assign-owner operations exist, following the same convention used for the existing `*Safe` operations. Verify this once the actual schema code is written: no blank lines may be introduced inside the `Team` block, since the test's block-bounding logic locates the block via `source.indexOf('Team: a')` up to the next blank line.
3. Extend component tests for management controls, archive filters, owner setup, confirmation/error states, and read-only UI.
4. Extend Playwright coverage in:
   - `e2e/team-management.spec.ts`.
   - `e2e/safe-deletes.spec.ts`.
   - Relevant game-management and report specs.
5. Cover active-team regression and multi-coach authorization behavior.
6. Update `docs/SHARING-PERMISSIONS.md` and architecture documentation with ownership, archive, restore, and invitation rules, including the explicit server-side-vs-UI-only enforcement split.
7. Add `npx tsc -p amplify/tsconfig.json --noEmit` to `scripts/commit-gate.mjs` (and to `CLAUDE.md`'s command list if the gate's stages are documented there). Today the gate never typechecks `amplify/**`, which is exactly how three non-compiling Lambda handlers passed it — see Implementation Status. Aside from the three pending operation declarations, that command is already clean, so this is a low-risk addition.

### Phase 8: Lambda-backed `Game.create` (deferred; separate pipeline run)

Re-sequenced out of Phase 4 per Correction 6: this is the largest regression surface in the plan (real-time sync, demo seeding, e2e), it is independently valuable, and archive ships complete without it. Run it as its own plan -> review -> implement cycle after archive is live. Content is unchanged from the original Phase 4 sub-steps:

1. **Convert `Game.create` to a Lambda-backed operation, landed and validated independently of any archived-team check:**
   - `Home.tsx` (via `useAmplifyQuery`'s `client.models.Game.observeQuery()`) and `SeasonReport.tsx`'s filtered Game list query (`useAmplifyQuery('Game', { filter: { teamId } })`) both rely on AppSync's standard resolver pipeline firing `onCreateGame` for real-time sync. A Lambda handler writing directly via the DynamoDB SDK — the pattern `delete-team-safe` uses — does **not** trigger AppSync subscriptions, so a naive conversion silently breaks real-time game creation for these two views. (`useGameSubscriptions.ts` observes a single existing game by id and is unaffected by `Game.create`.)
   - The new Lambda mutation must return the created `Game` via `.returns(a.ref('Game'))`, mirroring `acceptInvitation`'s return-of-`Team` pattern.
   - Every call site (`Home.tsx`, `demoDataService.ts`) must manually update or refetch local state from the mutation's return value after calling it, since `observeQuery` will not auto-update for this path.
   - `src/services/demoDataService.ts`'s direct `Game.create()` call must be converted in lockstep with the `Home.tsx` conversion — not optionally bypassed. Once `create` is removed from `Game`'s model-level authorization, the direct client call fails outright.
   - Test explicitly: create a game and verify it appears without a manual page refresh, including for other coaches/subscribed views, before the archived-team check is added.
2. **Add the archived-team check to the `Game.create` Lambda,** once step 1 has landed and its real-time behavior is validated. At that point, move game creation from the UI-only-enforced list to the server-side-enforced list in `docs/SHARING-PERMISSIONS.md`.

## Relevant Files

- `amplify/data/resource.ts` — Team, TeamInvitation, authorization, and custom operations. Lifecycle fields have landed; the `archiveTeam`/`restoreTeam`/`assignTeamOwner` operation declarations have not.
- `amplify/backend.ts` — **not yet touched.** Must import and register the three new functions, grant `Team`/`TeamInvitation` table access, and set their `TEAM_TABLE` / `TEAM_INVITATION_TABLE` env vars, following the `acceptInvitation` block as the template.
- `amplify/functions/archive-team/`, `amplify/functions/restore-team/`, `amplify/functions/assign-team-owner/` — handlers landed in `5fcaff3`; see Correction 5 for the fixes to apply while wiring them.
- `scripts/commit-gate.mjs` — add the `amplify/tsconfig.json` typecheck stage (Phase 7 step 7).
- `amplify/data/resource.safe-delete-policy.test.ts` — pins the `Team` model-level authorization block text (unchanged) and the list of expected safe operations; needs new assertions for the field-level authorization text on the four locked fields plus the new archive/restore/assign-owner operations.
- `amplify/functions/delete-team-safe/handler.ts` — established team authorization and rollback conventions (note: uses any-coach check, not owner-only).
- `amplify/functions/accept-invitation/handler.ts` — invitation acceptance; needs an archived-team check plus a `TransactWriteCommand` spanning `TeamInvitation` and `Team` so the status transition and coaches-append either both succeed or both fail; also needs a `TransactionCanceledException`/`CancellationReasons` handling path equivalent to the existing `isConditionalCheckFailed()` helper, since the transactional write throws a different exception shape than the single-item `ConditionalCheckFailedException` that helper detects today.
- `scripts/repair-shared-team-permissions.ts` — precedent for the owner-backfill script's `--dry-run`/`--apply`/`--team-id`/`--all-teams` safety-gated CLI pattern.
- `src/services/cascadeDeleteService.ts` — existing team operation service; add separate archive/restore methods.
- `src/components/Management.tsx` — team lifecycle controls, archive view, and existing direct `Team.update()` call site to reconcile with the new field lockdown.
- `src/components/Home.tsx` — active team navigation filtering, and (Phase 8 only) the direct `Game.create()` call site to convert to a Lambda-backed operation returning the created `Game`.
- `src/services/demoDataService.ts` — creates the demo team (must pass `ownerId`, Correction 1) and, in Phase 8 only, must convert its direct `Game.create()` call in lockstep with `Home.tsx`.
- `src/components/routes/SeasonReportRoute.tsx` — archived-team reporting and history access.
- `src/components/GameManagement/GameManagement.tsx` and its plan surface `src/components/GameManagement/PlanTab.tsx` + `hooks/useGamePlanner.ts` (there is no top-level `GamePlanner.tsx`), plus related in-game panels — persistent read-only status banner plus visible, `aria-disabled` + explanatory-tooltip treatment (not hidden) for UI-only-enforced mutation affordances on archived-team games.
- `docs/specs/UI-SPEC.md` — confirmation modal tone/copy conventions, design tokens for status badges, and touch-target/breakpoint rules that the archive UI must follow.
- `docs/SHARING-PERMISSIONS.md` — ownership and lifecycle documentation, including the server-side-vs-UI-only enforcement split.
- `e2e/team-management.spec.ts` — team archive and restore workflows.
- `e2e/safe-deletes.spec.ts` — permanent-delete regression coverage.

## Risks and Mitigations

- **Legacy teams have no reliable owner.** Require explicit, Lambda-backed owner assignment (first-come-first-served by any existing coach, guarded by a conditional `attribute_not_exists(ownerId)` write) and hide lifecycle controls until resolved.
- **Lifecycle fields are writable via the existing broad `Team.update()` grant.** Apply field-level `.authorization()` overrides on `ownerId`/`status`/`archivedAt`/`archivedBy` granting coaches `read` only, so writes to them are only possible through owner-checked Lambdas, and add a regression test (extending `resource.safe-delete-policy.test.ts`) asserting they cannot be set via the general update path.
- **Converting `Game.create` to a Lambda-backed operation breaks real-time sync (deferred to Phase 8).** `Home.tsx` and `SeasonReport.tsx`'s filtered Game list query rely on `observeQuery`, which a direct-DynamoDB-SDK Lambda write does not trigger (`useGameSubscriptions.ts`, which observes a single existing game by id, is unaffected). Mitigate by returning the created `Game` from the mutation and having call sites manually update/refetch local state; land and test this in isolation before adding the archived-team check.
- **Invitation acceptance leaves partial state on a mid-acceptance archive race.** Mitigate with a `TransactWriteCommand` spanning `TeamInvitation` and `Team` so the acceptance either fully succeeds or fully fails.
- **Not all mutation paths can be enforced server-side.** Explicitly split enforcement into a server-side-required set (lifecycle fields, deletes, `Game.create`, invitation acceptance) and a UI-only set (deep in-game mutations), and document the UI-only set as an accepted residual risk rather than implying uniform coverage.
- **Archived data becomes inaccessible.** Keep child records intact and test reports plus read-only historical navigation.
- **Restore creates inconsistent invitations.** Expire pending invitations during archive and explicitly test that restore does not revive them, including the mid-acceptance race.
- **Archive is confused with deletion.** Keep separate backend operations, service methods, UI actions, confirmations, and tests.
- **Mobile swipe-to-delete collides with archive on team cards (Major, blocking).** Active team cards currently bind `useSwipeDelete` to trigger permanent cascade deletion on a horizontal swipe. A coach's ordinary swipe gesture must never be able to trigger irreversible deletion once an `Archive` action also exists on the same card. Remove swipe-to-delete from active team cards entirely; permanent delete becomes an explicit, separately-styled button/menu action reachable only from the Archived Teams view.
- **UI-only enforcement fails silently.** Disabled mutation controls on archived-team games must carry an explicit, accessible explanation (`aria-disabled` plus tooltip/`aria-describedby`) and a persistent read-only status banner, not just a disabled/hidden control with no context.
- **Ownership changes accidentally through sharing.** Preserve `ownerId` independently from the coach membership list and test coach invitation flows.

## UI/UX Design Notes (ui-designer review)

- **Management layout:** Archive/restore lives inside the existing `Teams` tab via a segmented `Active Teams | Archived Teams` sub-toggle (mirroring the existing Roster/Positions toggle pattern) — not a new top-level tab, which would overcrowd the mobile nav bar.
- **Card treatment:** Archived team cards use muted/reduced-emphasis styling with an `Archived` badge; actions are limited to `Restore Team` and a visually separated, danger-styled `Delete Permanently` action, each meeting the 44px touch-target minimum and separated by at least 12px (or distinct grouping/vertical stacking) so archive and permanent delete are never adjacent or confusable, especially on mobile.
- **Legacy ownerless teams:** show an `Owner Unassigned` warning pill plus an explicit `Assign Owner` action on the card, rather than silently omitting archive controls.
- **Confirmation modal contracts:** Archive uses `variant: 'warning'` (confirm labeled `Archive Team`); Restore uses `variant: 'default'` (confirm labeled `Restore Team`); Permanent delete keeps `variant: 'danger'` (confirm labeled `Delete Permanently`, existing convention). All three modals set `autoFocus` on the Cancel button so the destructive/state-changing path is never the default keyboard action.
- **Read-only communication:** every archived-team view — Management roster expansion, `GameManagement/GameManagement.tsx`, `GameManagement/PlanTab.tsx`, and history/report navigation — shows the same persistent, prominent status banner (e.g., "🔒 Archived Team — Read-Only (Archived MMM D, YYYY)") at the top of the container, not just disabled controls. UI-only-enforced mutation controls stay visible and use `aria-disabled="true"` plus an explanatory tooltip/title/`aria-describedby` (e.g., "Editing disabled: Team is archived") rather than being hidden — applied uniformly, not just on some surfaces.
- **Accessibility:** `aria-live="polite"` announcements on the Active/Archived toggle switch ("Showing {X} active team(s)" / "Showing {Y} archived team(s)"); `aria-disabled` plus `aria-describedby` tooltips on disabled mutation controls; `aria-label` on the `Archived` status badge.
- **Audit visibility:** `archivedAt` (formatted "Archived on MMM D, YYYY") and `archivedBy` (resolved coach name if available) are a required, standard element on every archived team card, not optional.
- **Empty state and visibility:** `+ Create New Team` is hidden while the Archived Teams sub-tab is active; the Archived Teams empty state reads "No archived teams." with body copy "Teams you archive will appear here for historical reference and can be restored anytime.", following this app's existing `.empty-state` convention.
- **Touch targets:** all new toggle/action controls (including the Active/Archived sub-toggle and archived-card actions) meet this app's 44x44px minimum touch-target sizing on phone breakpoints, per `docs/specs/UI-SPEC.md`.

## Architecture Decision: Lifecycle Field Representation

**Decided:** `status: a.string().default('active')`, not `a.enum()`, with `archivedAt`/`archivedBy` as audit-only fields and the restricted value set (`'active' | 'archived'`) validated at the TypeScript/Lambda layer.

Rationale: this schema's Amplify version does not support `.required()`/`.default()` on `a.enum()` fields (documented explicitly for `GameNote.noteType`, which uses `a.string()` for the same reason). `Game.status` already uses `a.string().default('scheduled')` with a comment enumerating valid values — this is the established convention in this codebase for exactly this shape of field, and it avoids reintroducing the nullable/undefined ambiguity the enum option would otherwise carry for all newly created teams. **Corrected (Correction 2):** existing legacy teams remain `status: undefined` *permanently* — `.default()` applies only to newly created records, and owner assignment does not write `status`. The undefined case is therefore not resolved by the owner-assignment gate and must be handled by every consumer via the shared `isTeamArchived`/`isTeamActive` helper, which treats a null/undefined `status` as active.

## Acceptance Criteria

1. Only the persisted owner can archive or restore a team.
2. Legacy teams without an assigned owner cannot be archived.
3. Archiving expires pending invitations and preserves all child records.
4. Lifecycle fields, deletes, invitation acceptance, and game creation are rejected server-side for archived teams; the remaining deep in-game mutation surface (lineup, rotation, substitutions, and similar in-game event changes) is blocked in the UI only, as a documented, accepted, permanent residual risk.
5. Archived teams remain available for reports and read-only historical game access.
6. Restoring a team re-enables normal operations without reviving expired invitations.
7. Active navigation excludes archived teams while Management exposes an archive view.
8. Permanent safe deletion remains a separate explicit workflow.
9. Automated tests cover authorization, lifecycle behavior, read-only enforcement, reports, restore, and active-team regressions.
10. `npm run gate:commit` — including the new `amplify/tsconfig.json` typecheck stage — passes before committing.
