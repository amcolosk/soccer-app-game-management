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

## Implementation Plan

### Phase 1: Data Model and Ownership Contract

1. Update `Team` in `amplify/data/resource.ts` with:
   - Persisted `ownerId` (`a.string()`).
   - `status: a.string().default('active')`, with a code comment enumerating valid values (`active | archived`), following the existing `Game.status` convention. Do not use `a.enum()`: this schema's Amplify version does not support `.required()`/`.default()` on enums (see the documented constraint on `GameNote.noteType`), so an enum would reintroduce the same nullability ambiguity this design is trying to avoid.
   - `archivedAt` (`a.datetime()`) and `archivedBy` (`a.string()`) audit fields.
2. Lock down direct client writes to `ownerId`, `status`, `archivedAt`, and `archivedBy` using field-level `.authorization()` overrides, which Amplify Gen2 supports (unused elsewhere in this repo, but the correct native mechanism here — not a workaround). Today `Team` only has model-level authorization (`allow.ownersDefinedIn('coaches').to(['create','read','update'])`), and the app already calls `Team.update()` directly from the client, so any coach could otherwise overwrite these fields and bypass the owner check entirely. Apply a field-level override on each of these four fields granting coaches `read` only (e.g., `allow.ownersDefinedIn('coaches').to(['read'])`), with no `update` grant for coaches on these fields specifically — all writes to them go exclusively through the new owner-checked archive/restore (and Phase 2 owner-assignment) Lambdas. The model-level grant `allow.ownersDefinedIn('coaches').to(['create','read','update'])` remains unchanged for every other `Team` field, since coaches still need direct update access for `name`/`formationId`/`sport`/etc. via `Management.tsx`'s `handleUpdateTeam`, and for the `coaches` array via `invitationService.ts`'s `revokeCoachAccess`. No additional "allow Lambda to write" grant is needed: Lambda handlers already bypass all AppSync/model authorization by writing directly via the DynamoDB SDK against the IAM-scoped environment table (the same pattern `delete-team-safe` uses).
3. `src/types/schema.ts` re-exports the schema type and is auto-derived from `resource.ts`; no manual step is needed there. `schema.graphql/` is a static reference artifact not consumed by the runtime client — confirm this during implementation and skip touching it unless disproven.
4. Ensure new-team creation persists the creator as `ownerId`.
5. Define how a legacy team with no owner is represented (`ownerId` undefined) and ensure it cannot expose archive/restore controls until ownership is assigned.
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
   - Convert `Game.create` to a Lambda-backed operation, landed and validated as its own sub-step (2 below) **before** adding the archived-team check to that same Lambda (sub-step 3), so any regression is attributable to a single change at a time.
   - Invitation acceptance (see step 7 below).
2. **Sub-step: convert `Game.create` to a Lambda-backed operation (land and validate first, independent of the archived check):**
   - `Home.tsx` (via `useAmplifyQuery`'s `client.models.Game.observeQuery()`) and `SeasonReport.tsx`'s filtered Game list query (`useAmplifyQuery('Game', { filter: { teamId } })`) both rely on AppSync's standard resolver pipeline firing `onCreateGame` for real-time sync. A Lambda handler writing directly via the DynamoDB SDK — the pattern `delete-team-safe` uses — does **not** trigger AppSync subscriptions, so a naive conversion silently breaks real-time game creation for these two views. (`useGameSubscriptions.ts` observes a single existing game by id and is unaffected by `Game.create`.)
   - The new Lambda mutation must return the created `Game` via `.returns(a.ref('Game'))`, mirroring `acceptInvitation`'s return-of-`Team` pattern.
   - Every call site (`Home.tsx`, `demoDataService.ts` — see below) must manually update or refetch local state from the mutation's return value after calling it, since `observeQuery` will not auto-update for this path.
   - `src/services/demoDataService.ts`'s direct `Game.create()` call must be converted to call this new Lambda-backed operation in lockstep with the `Home.tsx` conversion — not optionally bypassed. Once `create` is removed from `Game`'s model-level authorization, the direct client call fails outright, so there is no working "bypass" option; demo-data seeding calls the same Lambda-backed operation as `Home.tsx`.
   - This sub-step must be explicitly tested per Phase 7: create a game and verify it appears without a manual page refresh, including for other coaches/subscribed views, before the archived-team check (sub-step 3) is added.
3. **Sub-step: add the archived-team check to the `Game.create` Lambda,** once sub-step 2 has landed and its real-time behavior is validated.
4. **UI-only enforcement (explicit, documented tradeoff — not full server-side coverage):**
   - Lineup, rotation, and player-availability changes.
   - Notes, goals, substitutions, and other in-game event changes.
   - Roster and player membership changes.
   - Disable/hide these affordances in the UI when the team is archived; document this as a residual risk consistent with this app's existing UI-only role-enforcement precedent, rather than presenting it as fully enforced.
5. Preserve read queries for archived teams in both categories.
6. Return consistent, user-actionable errors when a server-side archived-team mutation is attempted.
7. Ensure invitation acceptance rejects archived teams and cannot leave partial state: `accept-invitation/handler.ts` must use a `TransactWriteCommand` (DynamoDB SDK, spanning the `TeamInvitation` and `Team` tables in one atomic call) so the invitation's PENDING→ACCEPTED transition (conditioned on current status = `PENDING`) and the `Team.coaches` append (conditioned on `status <> 'archived' AND NOT contains(coaches, :userId)`) either both succeed or both fail — replacing the prior non-transactional two-step write and its acknowledged partial-failure risk. No `TransactWriteItems` precedent exists in this repo yet, but it is a standard, low-risk feature of the same `@aws-sdk/lib-dynamodb` document client already used in `accept-invitation/handler.ts`.
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
5. All archived-team mutation controls across in-game surfaces (`GameManagement.tsx`, `GamePlanner.tsx`, and related in-game panels covering lineup, rotation, substitutions, goals, notes, availability, roster/player edits, deletes) must remain visible and use `aria-disabled="true"` plus an explanatory tooltip/title/`aria-describedby` such as "Editing disabled: Team is archived" — consistent with the treatment specified in step 1's roster-expansion bullet — rather than being hidden or disabled without context. Each such surface also displays the persistent read-only status banner from step 4 at the top of the container. Since this enforcement is UI-only per Phase 4, this explicit, accessible explanation is required, not optional, given there is no server-side backstop for these paths.

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
   - Archived mutation rejection for server-side-enforced paths (lifecycle fields, deletes, `Game.create`).
   - Direct-write rejection: confirm `ownerId`/`status`/`archivedAt`/`archivedBy` cannot be set via a plain `Team.update()` call by a non-owner coach.
   - Real-time `Game.create` behavior: a created game appears in `Home.tsx` and other subscribed/observing views without a manual page refresh (validated before the archived-team check is added per Phase 4 sub-step 3).
2. Update `amplify/data/resource.safe-delete-policy.test.ts`: since the model-level `Team` authorization grant is unchanged (Phase 1 step 2 keeps `allow.ownersDefinedIn('coaches').to(['create','read','update'])` at the model level), the existing regex/assertion pinning that model-level block likely stays as-is. Instead, add new assertions specifically targeting the field-level `.authorization()` text on the four locked fields (`ownerId`, `status`, `archivedAt`, `archivedBy`), plus assertions confirming the new archive/restore/assign-owner operations exist, following the same convention used for the existing `*Safe` operations. Verify this once the actual schema code is written: no blank lines may be introduced inside the `Team` block, since the test's block-bounding logic locates the block via `source.indexOf('Team: a')` up to the next blank line.
3. Extend component tests for management controls, archive filters, owner setup, confirmation/error states, and read-only UI.
4. Extend Playwright coverage in:
   - `e2e/team-management.spec.ts`.
   - `e2e/safe-deletes.spec.ts`.
   - Relevant game-management and report specs.
5. Cover active-team regression and multi-coach authorization behavior.
6. Update `docs/SHARING-PERMISSIONS.md` and architecture documentation with ownership, archive, restore, and invitation rules, including the explicit server-side-vs-UI-only enforcement split.

## Relevant Files

- `amplify/data/resource.ts` — Team, TeamInvitation, authorization, and custom operations.
- `amplify/data/resource.safe-delete-policy.test.ts` — pins the `Team` model-level authorization block text (unchanged) and the list of expected safe operations; needs new assertions for the field-level authorization text on the four locked fields plus the new archive/restore/assign-owner operations.
- `amplify/functions/delete-team-safe/handler.ts` — established team authorization and rollback conventions (note: uses any-coach check, not owner-only).
- `amplify/functions/accept-invitation/handler.ts` — invitation acceptance; needs an archived-team check plus a `TransactWriteCommand` spanning `TeamInvitation` and `Team` so the status transition and coaches-append either both succeed or both fail; also needs a `TransactionCanceledException`/`CancellationReasons` handling path equivalent to the existing `isConditionalCheckFailed()` helper, since the transactional write throws a different exception shape than the single-item `ConditionalCheckFailedException` that helper detects today.
- `scripts/repair-shared-team-permissions.ts` — precedent for the owner-backfill script's `--dry-run`/`--apply`/`--team-id`/`--all-teams` safety-gated CLI pattern.
- `src/services/cascadeDeleteService.ts` — existing team operation service; add separate archive/restore methods.
- `src/components/Management.tsx` — team lifecycle controls, archive view, and existing direct `Team.update()` call site to reconcile with the new field lockdown.
- `src/components/Home.tsx` — active team navigation filtering and existing direct `Game.create()` call site to convert to a Lambda-backed operation that returns the created `Game` (`.returns(a.ref('Game'))`); the call site must manually update/refetch local state, since `observeQuery` will not auto-update for this path.
- `src/services/demoDataService.ts` — direct `Game.create()` call for demo-data seeding; must be converted to the new Lambda-backed `Game.create` operation in lockstep with the `Home.tsx` conversion (mandatory, not an optional bypass, since the direct client call fails outright once `create` is removed from `Game`'s model-level authorization).
- `src/components/routes/SeasonReportRoute.tsx` — archived-team reporting and history access.
- `src/components/GameManagement.tsx` and `src/components/GamePlanner.tsx` (and related in-game panels) — persistent read-only status banner plus visible, `aria-disabled` + explanatory-tooltip treatment (not hidden) for UI-only-enforced mutation affordances on archived-team games.
- `docs/specs/UI-SPEC.md` — confirmation modal tone/copy conventions, design tokens for status badges, and touch-target/breakpoint rules that the archive UI must follow.
- `docs/SHARING-PERMISSIONS.md` — ownership and lifecycle documentation, including the server-side-vs-UI-only enforcement split.
- `e2e/team-management.spec.ts` — team archive and restore workflows.
- `e2e/safe-deletes.spec.ts` — permanent-delete regression coverage.

## Risks and Mitigations

- **Legacy teams have no reliable owner.** Require explicit, Lambda-backed owner assignment (first-come-first-served by any existing coach, guarded by a conditional `attribute_not_exists(ownerId)` write) and hide lifecycle controls until resolved.
- **Lifecycle fields are writable via the existing broad `Team.update()` grant.** Apply field-level `.authorization()` overrides on `ownerId`/`status`/`archivedAt`/`archivedBy` granting coaches `read` only, so writes to them are only possible through owner-checked Lambdas, and add a regression test (extending `resource.safe-delete-policy.test.ts`) asserting they cannot be set via the general update path.
- **Converting `Game.create` to a Lambda-backed operation breaks real-time sync.** `Home.tsx` and `SeasonReport.tsx`'s filtered Game list query rely on `observeQuery`, which a direct-DynamoDB-SDK Lambda write does not trigger (`useGameSubscriptions.ts`, which observes a single existing game by id, is unaffected). Mitigate by returning the created `Game` from the mutation and having call sites manually update/refetch local state; land and test this in isolation before adding the archived-team check.
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
- **Read-only communication:** every archived-team view — Management roster expansion, `GameManagement.tsx`, `GamePlanner.tsx`, and history/report navigation — shows the same persistent, prominent status banner (e.g., "🔒 Archived Team — Read-Only (Archived MMM D, YYYY)") at the top of the container, not just disabled controls. UI-only-enforced mutation controls stay visible and use `aria-disabled="true"` plus an explanatory tooltip/title/`aria-describedby` (e.g., "Editing disabled: Team is archived") rather than being hidden — applied uniformly, not just on some surfaces.
- **Accessibility:** `aria-live="polite"` announcements on the Active/Archived toggle switch ("Showing {X} active team(s)" / "Showing {Y} archived team(s)"); `aria-disabled` plus `aria-describedby` tooltips on disabled mutation controls; `aria-label` on the `Archived` status badge.
- **Audit visibility:** `archivedAt` (formatted "Archived on MMM D, YYYY") and `archivedBy` (resolved coach name if available) are a required, standard element on every archived team card, not optional.
- **Empty state and visibility:** `+ Create New Team` is hidden while the Archived Teams sub-tab is active; the Archived Teams empty state reads "No archived teams." with body copy "Teams you archive will appear here for historical reference and can be restored anytime.", following this app's existing `.empty-state` convention.
- **Touch targets:** all new toggle/action controls (including the Active/Archived sub-toggle and archived-card actions) meet this app's 44x44px minimum touch-target sizing on phone breakpoints, per `docs/specs/UI-SPEC.md`.

## Architecture Decision: Lifecycle Field Representation

**Decided:** `status: a.string().default('active')`, not `a.enum()`, with `archivedAt`/`archivedBy` as audit-only fields and the restricted value set (`'active' | 'archived'`) validated at the TypeScript/Lambda layer.

Rationale: this schema's Amplify version does not support `.required()`/`.default()` on `a.enum()` fields (documented explicitly for `GameNote.noteType`, which uses `a.string()` for the same reason). `Game.status` already uses `a.string().default('scheduled')` with a comment enumerating valid values — this is the established convention in this codebase for exactly this shape of field, and it avoids reintroducing the nullable/undefined ambiguity the enum option would otherwise carry for all newly created teams. Existing legacy teams remain `status: undefined` until explicit owner assignment resolves them, which is already handled separately by the owner-assignment gate.

## Acceptance Criteria

1. Only the persisted owner can archive or restore a team.
2. Legacy teams without an assigned owner cannot be archived.
3. Archiving expires pending invitations and preserves all child records.
4. Archived teams cannot create games, and lifecycle fields/deletes/invitation acceptance are rejected server-side; the remaining deep in-game mutation surface is blocked in the UI as a documented, accepted residual risk.
5. Archived teams remain available for reports and read-only historical game access.
6. Restoring a team re-enables normal operations without reviving expired invitations.
7. Active navigation excludes archived teams while Management exposes an archive view.
8. Permanent safe deletion remains a separate explicit workflow.
9. Automated tests cover authorization, lifecycle behavior, read-only enforcement, reports, restore, and active-team regressions.
10. `npm run gate:commit` passes before committing.
