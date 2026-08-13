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
2. Lock down direct client writes to `ownerId`, `status`, `archivedAt`, and `archivedBy`: today `Team` only has model-level authorization (`allow.ownersDefinedIn('coaches').to(['create','read','update'])`), and the app already calls `Team.update()` directly from the client, so any coach could otherwise overwrite these fields and bypass the owner check entirely. Follow the `GameNote` precedent (grant the model `read`-only for these fields' effective control; route all writes to them exclusively through the new owner-checked archive/restore Lambdas) rather than relying on unproven field-level `.authorization()`, which has no precedent in this repo.
3. `src/types/schema.ts` re-exports the schema type and is auto-derived from `resource.ts`; no manual step is needed there. `schema.graphql/` is a static reference artifact not consumed by the runtime client — confirm this during implementation and skip touching it unless disproven.
4. Ensure new-team creation persists the creator as `ownerId`.
5. Define how a legacy team with no owner is represented (`ownerId` undefined) and ensure it cannot expose archive/restore controls until ownership is assigned.
6. Review invitation role and membership flows so persisted ownership remains stable when coaches are added or removed.

### Phase 2: Existing-Team Owner Assignment

1. Identify whether existing data contains a reliable creator or owner source.
2. If no reliable source exists, add an explicit owner-assignment flow or controlled setup operation.
3. Do not silently infer ownership at archive time.
4. Add authorization tests for owner, non-owner coach, and ownerless legacy team cases.

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
   - Convert `Game.create` to a Lambda-backed operation (mirroring the `*Safe` pattern) so new-game blocking is enforced server-side. Update `client.models.Game.create()` call sites, including `src/components/Home.tsx` and `src/services/demoDataService.ts` (demo-data seeding should bypass the archived check or be updated in lockstep, since demo teams are never archived).
   - Invitation acceptance (see step 4 below).
2. **UI-only enforcement (explicit, documented tradeoff — not full server-side coverage):**
   - Lineup, rotation, and player-availability changes.
   - Notes, goals, substitutions, and other in-game event changes.
   - Roster and player membership changes.
   - Disable/hide these affordances in the UI when the team is archived; document this as a residual risk consistent with this app's existing UI-only role-enforcement precedent, rather than presenting it as fully enforced.
3. Preserve read queries for archived teams in both categories.
4. Return consistent, user-actionable errors when a server-side archived-team mutation is attempted.
5. Ensure invitation acceptance rejects archived teams, with explicit sequencing against `accept-invitation`'s existing two-step, non-transactional flow (invitation marked `ACCEPTED` first, then a separate conditional update appends the coach to `Team.coaches`): check the team's archived status **before** the invitation-acceptance write, and add an archived-status condition to the `coaches`-append update so a team archived mid-acceptance is rejected instead of leaving the invitation `ACCEPTED` with the coach never actually added. Define the error/reconciliation behavior for this partial-failure case explicitly.

### Phase 5: Management and Navigation UX

1. Update `src/components/Management.tsx` with:
   - A segmented sub-toggle inside the existing `Teams` tab — `[ Active Teams (X) | Archived Teams (Y) ]` — placed below the `+ Create New Team` action, mirroring the existing Roster/Positions toggle pattern already used in this component. Do not add a 6th top-level tab; the mobile nav bar is already at capacity.
   - **Mobile swipe-gesture safety fix (Major, blocking):** active team cards currently expose `useSwipeDelete`, surfacing a full-width permanent-delete action on a horizontal swipe. This must be removed from active team cards before archive ships, since a coach's ordinary swipe gesture must never trigger irreversible cascade deletion. Swipe-to-delete is removed from active team cards entirely; permanent delete becomes an explicit button/menu action reachable only from the Archived Teams view.
   - Active team card actions: `Edit`, `Expand Roster`, and an explicit `Archive` button (owner-only; hidden, not just disabled, for non-owners and for legacy teams with no assigned owner).
   - Legacy ownerless team cards: an inline `Owner Unassigned` warning pill plus an explicit `Assign Owner` action, so users understand why archive controls are absent rather than assuming a bug.
   - Archived team cards: muted styling (reduced-emphasis background/opacity) with an `Archived` status badge, actions limited to `Restore Team` and a separately-styled, visually distinct `Delete Permanently` action (danger styling, not adjacent to `Restore Team` without separation) so archive and permanent delete are never confusable.
   - Archived team roster expansion is read-only: hide add/remove-player and position-toggle controls.
   - Confirmation dialogs, matching this app's existing modal conventions:
     - **Archive** — standard/warning tone: reversible, clarifies invitations expire and all data is preserved, confirm action labeled `Archive Team`.
     - **Restore** — standard tone: clarifies the team reactivates and expired invitations are not revived, confirm action labeled `Restore Team`.
     - **Permanent delete** — danger tone (existing convention): irreversible, explicitly names cascade-deleted data, confirm action labeled `Delete Permanently`.
   - Failure states for archive/restore/owner-assignment actions.
   - Optional display of `archivedAt` (and `archivedBy` if resolvable to a coach name) on the archived team card, so multi-coach teams have visibility into who archived and when.
   - `aria-live="polite"` announcement region when switching between the Active/Archived toggle so screen reader users are informed of list changes.
2. Update `src/components/Home.tsx` so archived teams do not appear in active operational navigation, team selectors, or the "Schedule New Game" team dropdown.
3. Update team selectors and routes to distinguish active teams from archived teams.
4. Add a persistent, visible read-only status banner (for example, "Archived Team (Read-Only)" plus the archived date) to archived team and game views reached through history/report navigation, so the read-only state is unambiguous rather than implied only by disabled controls.
5. Disable or hide mutation affordances for archived teams across in-game surfaces (lineup, rotation, substitutions, goals, notes, availability, roster/player edits, deletes). Since this enforcement is UI-only per Phase 4, every disabled control must carry an explicit, accessible explanation (e.g., `aria-disabled="true"` plus a tooltip/`aria-describedby` such as "Editing disabled: Team is archived") rather than silently disappearing or disabling without context — this is required, not optional, given there is no server-side backstop for these paths.

### Phase 6: Reports and Historical Access

1. Update `src/components/routes/SeasonReportRoute.tsx` to include archived teams, visibly flagged in the selector (for example, an "(Archived)" suffix or badge) so users aren't confused about why a listed team can't be scheduled for new games.
2. Permit report generation for archived teams.
3. Permit navigation from reports to read-only historical game views, surfacing the same persistent read-only status banner described in Phase 5 step 4.
4. Ensure archived teams cannot be used to create or edit games through report or route entry points, and that every mutation affordance reachable from this path follows the same disabled-with-explanation treatment as Phase 5 step 5.

### Phase 7: Tests and Documentation

1. Add backend/service tests covering:
   - Owner authorization.
   - Non-owner rejection.
   - Ownerless legacy-team rejection.
   - Archive and restore idempotency.
   - Invitation expiration, including the mid-acceptance race between archive and `accept-invitation`.
   - Child-record preservation.
   - Restore behavior without invitation revival.
   - Archived mutation rejection for server-side-enforced paths (lifecycle fields, deletes, `Game.create`).
   - Direct-write rejection: confirm `ownerId`/`status`/`archivedAt`/`archivedBy` cannot be set via a plain `Team.update()` call by a non-owner coach.
2. Update `amplify/data/resource.safe-delete-policy.test.ts`: its regex assertions pin the exact `Team` authorization block text and the list of expected safe operations; update the expected block for the new field-lockdown approach and add assertions confirming the new archive/restore operations exist, following the same convention used for the existing `*Safe` operations.
3. Extend component tests for management controls, archive filters, owner setup, confirmation/error states, and read-only UI.
4. Extend Playwright coverage in:
   - `e2e/team-management.spec.ts`.
   - `e2e/safe-deletes.spec.ts`.
   - Relevant game-management and report specs.
5. Cover active-team regression and multi-coach authorization behavior.
6. Update `docs/SHARING-PERMISSIONS.md` and architecture documentation with ownership, archive, restore, and invitation rules, including the explicit server-side-vs-UI-only enforcement split.

## Relevant Files

- `amplify/data/resource.ts` — Team, TeamInvitation, authorization, and custom operations.
- `amplify/data/resource.safe-delete-policy.test.ts` — pins `Team` authorization block text; needs updating for the field-lockdown approach plus new archive/restore operation assertions.
- `amplify/functions/delete-team-safe/handler.ts` — established team authorization and rollback conventions (note: uses any-coach check, not owner-only).
- `amplify/functions/accept-invitation/handler.ts` — invitation acceptance; needs archived-team check sequenced against its existing two-step, non-transactional write.
- `scripts/repair-shared-team-permissions.ts` — precedent for the owner-backfill script's `--dry-run`/`--apply`/`--team-id`/`--all-teams` safety-gated CLI pattern.
- `src/services/cascadeDeleteService.ts` — existing team operation service; add separate archive/restore methods.
- `src/components/Management.tsx` — team lifecycle controls, archive view, and existing direct `Team.update()` call site to reconcile with the new field lockdown.
- `src/components/Home.tsx` — active team navigation filtering and existing direct `Game.create()` call site to convert to a Lambda-backed operation.
- `src/services/demoDataService.ts` — direct `Game.create()` call for demo-data seeding; must bypass or be updated in lockstep with the `Game.create` conversion.
- `src/components/routes/SeasonReportRoute.tsx` — archived-team reporting and history access.
- `src/components/GameManagement.tsx` and `src/components/GamePlanner.tsx` (and related in-game panels) — disabled-with-explanation treatment for UI-only-enforced mutation affordances on archived-team games.
- `docs/specs/UI-SPEC.md` — confirmation modal tone/copy conventions, design tokens for status badges, and touch-target/breakpoint rules that the archive UI must follow.
- `docs/SHARING-PERMISSIONS.md` — ownership and lifecycle documentation, including the server-side-vs-UI-only enforcement split.
- `e2e/team-management.spec.ts` — team archive and restore workflows.
- `e2e/safe-deletes.spec.ts` — permanent-delete regression coverage.

## Risks and Mitigations

- **Legacy teams have no reliable owner.** Require explicit owner assignment and hide lifecycle controls until resolved.
- **Lifecycle fields are writable via the existing broad `Team.update()` grant.** Route `ownerId`/`status`/`archivedAt`/`archivedBy` writes exclusively through owner-checked Lambdas and add a regression test (extending `resource.safe-delete-policy.test.ts`) asserting they cannot be set via the general update path.
- **Not all mutation paths can be enforced server-side.** Explicitly split enforcement into a server-side-required set (lifecycle fields, deletes, `Game.create`, invitation acceptance) and a UI-only set (deep in-game mutations), and document the UI-only set as an accepted residual risk rather than implying uniform coverage.
- **Archived data becomes inaccessible.** Keep child records intact and test reports plus read-only historical navigation.
- **Restore creates inconsistent invitations.** Expire pending invitations during archive and explicitly test that restore does not revive them, including the mid-acceptance race.
- **Archive is confused with deletion.** Keep separate backend operations, service methods, UI actions, confirmations, and tests.
- **Mobile swipe-to-delete collides with archive on team cards (Major, blocking).** Active team cards currently bind `useSwipeDelete` to trigger permanent cascade deletion on a horizontal swipe. A coach's ordinary swipe gesture must never be able to trigger irreversible deletion once an `Archive` action also exists on the same card. Remove swipe-to-delete from active team cards entirely; permanent delete becomes an explicit, separately-styled button/menu action reachable only from the Archived Teams view.
- **UI-only enforcement fails silently.** Disabled mutation controls on archived-team games must carry an explicit, accessible explanation (`aria-disabled` plus tooltip/`aria-describedby`) and a persistent read-only status banner, not just a disabled/hidden control with no context.
- **Ownership changes accidentally through sharing.** Preserve `ownerId` independently from the coach membership list and test coach invitation flows.

## UI/UX Design Notes (ui-designer review)

- **Management layout:** Archive/restore lives inside the existing `Teams` tab via a segmented `Active Teams | Archived Teams` sub-toggle (mirroring the existing Roster/Positions toggle pattern) — not a new top-level tab, which would overcrowd the mobile nav bar.
- **Card treatment:** Archived team cards use muted/reduced-emphasis styling with an `Archived` badge; actions are limited to `Restore Team` and a visually separated, danger-styled `Delete Permanently` action, so archive and permanent delete are never adjacent or confusable.
- **Legacy ownerless teams:** show an `Owner Unassigned` warning pill plus an explicit `Assign Owner` action on the card, rather than silently omitting archive controls.
- **Confirmation copy tone:** Archive/Restore use the app's standard/warning modal tone (reversible, data preserved, invitations expire); permanent delete keeps the existing danger tone and explicit irreversibility language.
- **Read-only communication:** archived team/game views reached via history or reports must show a persistent status banner (not rely on disabled controls alone) and every UI-only-disabled control must have an accessible explanation.
- **Accessibility:** `aria-live="polite"` announcements on the Active/Archived toggle switch; `aria-disabled` plus `aria-describedby` tooltips on disabled mutation controls; `aria-label` on the `Archived` status badge.
- **Audit visibility:** show `archivedAt` (and `archivedBy` if resolvable to a coach name) on the archived team card for multi-coach visibility.
- **Touch targets:** all new toggle/action controls meet this app's minimum touch-target sizing on phone breakpoints, per `docs/specs/UI-SPEC.md`.

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
