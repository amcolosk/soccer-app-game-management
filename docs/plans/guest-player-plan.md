# Implementation Plan: Guest Player (Issue #224)

## Overview
Let a coach add a player who isn't a full-time team member — a one-off fill-in or a recurring call-up — and use them in lineups, rotations, and stats exactly like a regular roster player. Guests are added to the team roster permanently (not scoped to a single game) and flagged `isGuest` so they're visually distinguishable; their jersey number is optional since a fill-in often doesn't have one.

**Status:** Revised after architect review (round 1) — findings below incorporated.
**Scope:** Small-to-medium: one schema change (1 new field, 1 field loosened from required→optional), a shared create-and-roster helper, roughly 25 display call sites that need null-safe jersey-number rendering, and two UI entry points. Touches the data model, so follows the full pipeline per `dev-pipeline` (plan → architecture review → implement → validation + security review → commit gate).
**Risk Level:** Medium. The schema changes themselves are safe (backward-compatible loosenings, no backfill), but `playerNumber` going from always-a-number to sometimes-null fans out across ~25 display sites that assume a number today — round 1 of architect review found this was undercounted; see the full site list below.

## Confirmed requirements (from Andrew, via project thread)
1. A guest is added to the team roster **permanently** (not deleted after the game), flagged as a Guest.
2. A guest's goals/shots/saves/play-time **count in season reports** like any other player — no exclusion.
3. Jersey number is **optional** for a guest.
4. Guests can be added from **both** team roster management (`Management.tsx`) and the pregame lineup screen.
5. Guest intake uses the **same fields as a regular player** (first name, last name, optional birth year, optional preferred positions) — just combined into a one-step quick-add instead of today's two-step "create player, then add to a roster" flow.

## Current state (relevant to this change)
- `Player` is a global record (not team-scoped); `TeamRoster` is the per-team join row (`teamId`, `playerId`, `playerNumber: required`, `preferredPositions`, `isActive`, `coaches`). Every screen that lists "the team's players" reads from `TeamRoster` joined to `Player` (`useTeamData.ts` → `PlayerWithRoster`).
- Adding a player today is two separate steps: `Management.tsx`'s `handleCreatePlayer` (global `Player.create`) and, separately, `handleAddPlayerToRoster` (picks an *existing* un-rostered `Player` and creates a `TeamRoster` row with a required jersey number, copying `team.coaches` onto the roster row and merging `team.coaches` into `Player.coaches`).
- `src/utils/validation.ts` already has `isPlayerNumberUnique` and `isValidPlayerNumber`, both written to treat `null`/`undefined` jersey numbers as valid — but neither is wired into `Management.tsx`'s add/update handlers today. Ready-made hook for requirement 3.
- **`Player` deletion is disallowed at the schema level** (`amplify/data/resource.ts:136-137`: "Delete is intentionally disallowed on the model. Use deletePlayerSafe.") — there is no `client.models.Player.delete`. Any rollback of a `Player.create` must go through `deletePlayerCascade` (`src/services/cascadeDeleteService.ts`), which wraps the `deletePlayerSafe` Lambda.
- `rotationPlannerService.ts`'s `SimpleRoster.playerNumber` field is declared but never read in the rotation algorithm (confirmed by architect review) — safe to loosen to optional.
- Lambda side: only `get-stat-tracker-view/handler.ts` reads `TeamRoster.playerNumber`, and it already does `?? null`; its `StatTrackerPlayer` custom type is already nullable. `accept-invitation`'s coach-backfill walks roster rows by `playerId`, so a newly-shared coach picks up guests the same as regular players with no extra work.
- Lineup/rotation/stats code (`LineupPanel`, `LineupBuilder`, `BenchTab`, `PlannerLineupView`, `RotationWidget`, `SubstitutionPanel`, `GameTimer`, `GoalTracker`, `ShotSaveTracker`, `SeasonReport`, etc.) all consume `PlayerWithRoster[]`/`TeamRoster[]` passed down from `useTeamData`, so once a guest is a normal `TeamRoster` row it reaches every one of those screens with no new data plumbing — the remaining work is making jersey-number display null-safe everywhere (see below) and adding an optional "Guest" badge.

## Data model changes
`amplify/data/resource.ts`, `TeamRoster` model:
- Add `isGuest: a.boolean().default(false)`.
- Change `playerNumber: a.integer().required()` → `a.integer()` (optional).

Both changes are additive/loosening — no existing data needs backfilling, no authorization rule changes (still `allow.ownersDefinedIn('coaches')`). `isGuest` lives on `TeamRoster`, not `Player`, since "guest" describes a player's membership on *this* team's roster. Note `default(false)` only applies on `create`; existing rows will read back `isGuest: null|undefined`, so every consumer must treat that as falsy (see `useTeamData` normalization below) rather than assuming `false` is always materialized.

`src/types/schema.ts`: add `isGuest?: boolean` to `PlayerWithRoster` (alongside the existing `playerNumber?`/`preferredPositions?`).

`src/hooks/useTeamData.ts`: when building `PlayerWithRoster`, normalize both fields instead of passing raw values through:
```ts
playerNumber: roster.playerNumber ?? undefined,
isGuest: roster.isGuest ?? false,
```
This matters because Amplify returns `null` for a missing number, but `PlayerWithRoster.playerNumber` is typed `number | undefined` — passing `null` through untyped would defeat every `!== undefined` check downstream (see Finding 1).

## Shared jersey-number display helper (new — required before touching display sites)
Add to `src/utils/playerUtils.ts` (generalizing the two correct existing implementations already in the codebase — `completedGameTimelineTransform.ts`'s and `TrackerFieldLineup.tsx`'s jersey-prefix formatting — rather than inventing a third pattern):
```ts
export function formatJerseyPrefix(playerNumber: number | null | undefined): string {
  return playerNumber != null ? `#${playerNumber} ` : '';
}
```
Use this (or an inline `playerNumber != null` guard where a trailing space/layout differs) at every display site in the full list below. Do **not** let `?? 0` or `|| 0` reach a rendered string — those produce a literal "#0" for a guest with no number, which is worse than the "#null"/bare "#" bugs they're meant to avoid.

### Sort order policy
Guests with no number should sort to the **end** of number-ordered lists (consistent with how `BenchTab.tsx:197` and `SubstitutionPanel.tsx:526` already sort a missing number, via `?? 999`). Update `sortRosterByNumber` (`src/utils/playerUtils.ts:7`, currently `?? 0`, which incorrectly sorts no-number guests to the *front*) to use the same `?? 999`-style "sort last" convention, so ordering is consistent across every screen instead of only some.

### Full list of display call sites requiring a null-safe guard (do not patch a subset and grep-later)
Template-string sites (currently interpolate `playerNumber` directly into a string — will render the literal text `#null` once the schema allows null):
- `GameManagement.tsx:884,914,948,1516` (notification/conflict text)
- `PreGameNotesPanel.tsx:22`
- `ShotOutcomeEntry.tsx:297-303`
- `SubstitutionPanel.tsx:424`
- `SeasonReport.tsx:784,889` (these check `!== undefined` against raw `TeamRoster` rows, which `null` passes through — switch to `!= null`)

JSX sites that render a bare `#` with nothing after it when the number is missing:
- `BenchTab.tsx:400,423,503,537`
- `RotationWidget.tsx:271,278,288`
- `GameTimer.tsx:307,314`
- `GoalTracker.tsx:161,166`
- `ShotSaveTracker.tsx:248`
- `PlayerNotesPanel.tsx:537`
- `CreateEditNoteModal.tsx:154`
- `PlayerSelect.tsx:18`
- `PlayerAvailabilityGrid.tsx:132`
- `LineupPanel.tsx:601,671,720`
- `SubstitutionPanel.tsx:430,478,546,599`

Sites that currently do `?? 0`/`|| 0` and will render a misleading literal `#0`:
- `LineupBuilder.tsx:108,161,198`
- `PlannerLineupView.tsx:329,408`
- `GameManagement.tsx:990` (`SimpleRoster` mapping — change `p.playerNumber || 0` to omit the field or pass `undefined`, since it's unused by the rotation algorithm anyway per Current State above)

Other:
- `CompletedPlayTimeSummary.tsx:67` renders an empty `<th scope="row">` when there's no number — give it a fallback (e.g. the player's initials, or just omit the cell content without leaving the row looking broken; confirm wording with `ui-reviewer`).

Also update the now-stale comment at `amplify/data/resource.ts:1003-1006` ("Nullable at the GraphQL level as a defensive measure even though `TeamRoster.playerNumber` is `.required()` in the DB") — after this change the DB field is no longer required either, so the comment should say the nullability is now the actual schema, not a defensive GraphQL-layer workaround.

## New shared service function
Add `createPlayerOnRoster({ team, fields, currentUserId, isGuest, existingNumbers })` to a new `src/services/rosterService.ts` (per architect review: a general create-and-roster operation with `isGuest` as one parameter, not a guest-only helper — this also leaves room for a later refactor of `handleAddPlayerToRoster` onto the same function, which is out of scope here). `existingNumbers: number[]` is passed in by the caller (already-loaded `TeamRoster[]` for the team) so the helper doesn't need to re-fetch roster rows itself — `LineupPanel` only has `PlayerWithRoster[]` in scope, not raw `TeamRoster[]`, and shouldn't be made to load the latter just for this check.

Fields: `firstName`, `lastName`, `birthYear?`, `jerseyNumber?`, `preferredPositionIds?`.

Steps:
1. Validate names are non-empty (same rule as `handleCreatePlayer`); if `jerseyNumber` is supplied, validate it with `isValidPlayerNumber` and uniqueness against `existingNumbers`.
2. `Player.create({ firstName, lastName, birthYear, coaches: union(team.coaches, [currentUserId]) })` — **not** `coaches: [currentUserId]` alone. A co-coach who isn't the creator must already be able to read this `Player`, or `useTeamData.ts`'s join (`if (!player) return null`) silently drops the new guest from their view of the roster, bench, and lineup. Seeding `coaches` with the team's full coach list up front also means the separate `Player.update`-merge step that `handleAddPlayerToRoster` needs today is unnecessary here.
3. `TeamRoster.create({ teamId: team.id, playerId: <new player id>, playerNumber: jerseyNumber ?? null, preferredPositions, isGuest, coaches: team.coaches })`.
4. On step 3 failing, roll back step 2 via `deletePlayerCascade(playerId)` (not a raw `Player.delete`, which doesn't exist on this model — see Current State). Log a rollback failure the same way `Management.tsx:586-588` does today and accept that a harmless orphan `Player` record may remain if the rollback itself fails; the creating coach is in its `coaches` array (from step 2) so it's still visible and manageable from the Players list if that happens.

This one function backs both UI entry points so they can't drift from each other.

## UI changes

### 1. Team roster management (`Management.tsx`) — requirement 4a
In the existing "Add Player to Roster" panel (the `rosterForm.isAdding` block, ~line 1425), add a mode toggle: "Existing player" (today's dropdown-of-unrostered-players flow, unchanged, still requires a number) vs. "New guest player" (first name, last name, optional birth year, optional jersey number, optional preferred positions — reusing the preferred-position checkboxes already rendered there). Submitting in guest mode calls `createPlayerOnRoster({ ..., isGuest: true })`.
- `managementReducers.ts`: extend `RosterFormState` with a `mode: 'existing' | 'guest'` field plus `firstName`/`lastName`/`birthYear` for the guest sub-form (mirroring `PlayerFormState`'s shape), and a corresponding reducer case.
- **Edit path must also support guests** (round-1 gap): `handleUpdateRoster` (`Management.tsx:623-656`) currently always requires and writes a jersey number. Change it to only require a number when `!rosterForm.editing.isGuest`, and to write `playerNumber: num ?? null` so a guest's number can be left blank or cleared. Use `isValidPlayerNumber`/`isPlayerNumberUnique` in both the add (existing-player and guest) and edit paths, replacing the current ad hoc inline checks — this is where requirement 3 actually has to hold for the full lifecycle, not just at creation.
- Roster list rows (`Management.tsx:1374,1404,1608,2002`, all `#{roster.playerNumber}`): switch to `formatJerseyPrefix(roster.playerNumber)` and add a small "Guest" badge next to the name when `roster.isGuest`.

### 2. Pregame entry point — requirement 4b
Architect review found the originally-proposed host (`LineupPanel`'s bench list) isn't reliably reachable: in the pregame `scheduled` state, the "Plan" tab renders `PlanTab`/`PlannerLineupView` (`GameManagement.tsx:2516`), and `LineupPanel` only appears on the separate "Field" tab (`GameManagement.tsx:2558`) — and even there, `LineupBuilder`'s bench list is only rendered in list mode, not shape mode (`LineupPanel.tsx:522-579` vs. the shape-mode toggle at `LineupPanel.tsx:473-485`).

Revised plan: put the "+ Add Guest Player" action in **`LineupPanel`'s header actions row**, above the list/shape view-mode switch, so it's visible regardless of which view mode the coach has selected, and add the equivalent action to `PlanTab`'s available-players area so it's also reachable from the Plan tab without requiring a tab switch. Both call the same `createPlayerOnRoster`. `LineupPanel` already has `team` in props; `currentUserId` is currently optional there (`LineupPanel.tsx:42`) — make the add-guest action itself conditionally disabled (not the whole prop) when `currentUserId` is undefined, rather than widening the prop's type for this one feature.
- Gate the action on `!isReadOnly` and `gameState.status === 'scheduled'`, consistent with other pregame-only actions in `GameManagement.tsx`.
- When a guest is added after rotations have already been generated for the game, the existing planned rotations will not include them until the coach re-runs `onRecalculateRotations` (the same as adding/removing availability today) — no new behavior needed, but surface a one-line hint in the add-guest confirmation ("Recalculate rotations to include them") rather than silently leaving the plan stale.

### 3. Guest badge elsewhere
Everywhere a player name is already rendered from `PlayerWithRoster` (bench rows in `BenchTab`, `PlannerLineupView`, lineup list in `LineupPanel`), add a small "Guest" text badge when `player.isGuest` — consistent with the existing non-color-only status-badge pattern used for injury (`injury-marking-feature-plan.md`). Cosmetic only; no filtering logic changes, since guests must behave exactly like regular players per requirement 2. Note guests will also appear unbadged in the global Manage ▸ Players list, since `isGuest` lives on the roster row, not the player — that's expected (a player can be a guest on one team and a full member of another) and doesn't need a fix, just a one-line mention so it isn't mistaken for a bug during review.

### 4. Season reports (`SeasonReport.tsx`)
No filtering changes — guest stats already flow through because they're a normal `TeamRoster`/`Player` pair. Fix the two `!== undefined` jersey-number checks at lines 784 and 889 to `!= null` (see display-site list above) and optionally add the same "Guest" badge in the player table/drill-down for consistency.

## Validation / edge cases
- Jersey number: when provided, validated 1–99 and unique within the team via `isValidPlayerNumber`/`isPlayerNumberUnique`, now wired into add (both modes) and edit; when omitted for a guest, both utils already treat that as valid. Uniqueness remains a client-side check only (a race between two coaches adding at once could in theory produce a duplicate) — this is no weaker than today's unenforced behavior, just noting it's not newly introduced.
- Guest player names: same required-first/last-name validation as `handleCreatePlayer`.
- Converting a guest to a full roster player, or vice versa, is a deferred follow-up (`TeamRoster.update({ isGuest: false })`), not part of this plan — no migration path needed since `isGuest` carries no behavioral weight beyond display.
- Deleting a guest: uses the existing `deletePlayerCascade` / roster-removal flow unchanged.
- Multi-coach sharing: `createPlayerOnRoster` seeds `Player.coaches` with the team's full coach list plus the creator (not just the creator), and `TeamRoster.coaches` from `team.coaches`, per `CLAUDE.md`'s authorization rule — see step 2 above for why seeding at creation (rather than merging after) matters here.

## Risks
- **Jersey-number display fan-out is the real size of this change.** Architect review's first pass found the "already null-safe" claim in the original draft was wrong — roughly 25 sites across 15+ files assume a number today. The full site list above must be treated as the actual scope, not a sample; a coding agent should still re-grep `.playerNumber` at implementation time in case something new landed since this review.
- **Schema change requires a `npx ampx sandbox`/deploy cycle** before the frontend change can be tested end-to-end against a live backend — this sandbox has no AWS credentials for prod per project memory, so Andrew will need to run/verify the deploy locally.
- **Two near-duplicate "add a player" flows** (existing-player-to-roster vs. new-guest) living in the same form could get confusing if not visually distinct — flag for `ui-reviewer`, along with the pregame entry point's exact placement (§2 above) and the `CompletedPlayTimeSummary` empty-cell fallback.

## Documentation updates
- `README.md:18` (Team Rosters section: "with jersey numbers" → note numbers are optional for guests) and `README.md:153` (Data Model: `TeamRoster` gains `isGuest`, `playerNumber` now optional).
- `docs/ARCHITECTURE.md:126` — same two field notes.
- `docs/specs/UI-SPEC.md` — the roster-management guest-mode form, the pregame "Add Guest" action and its placement, and the Guest badge pattern, once `ui-reviewer` signs off on wording/placement.
- The comment at `amplify/data/resource.ts:1003-1006` (see above).
- Checked-in `amplify`-generated GraphQL schema artifacts will need regenerating after the schema change (standard `npx ampx sandbox`/deploy step, not a manual edit).

## Test strategy
- Unit: `validation.test.ts` extended to assert `isPlayerNumberUnique`/`isValidPlayerNumber` are actually exercised by the roster add/edit paths now.
- Unit: new `rosterService.test.ts` covering `createPlayerOnRoster`'s validation branch, the `Player.coaches` seeding (team coaches + creator), and the rollback-via-`deletePlayerCascade` path on a `TeamRoster.create` failure.
- Unit: `useTeamData.test.ts` — assert `isGuest` and a normalized (`undefined`, not `null`) `playerNumber` are carried through into `PlayerWithRoster`.
- Unit: `playerUtils.test.ts` — `formatJerseyPrefix` and the revised `sortRosterByNumber` "guests sort last" behavior.
- Component: `Management.tsx` roster-tab tests extended for the new guest add mode and the guest-aware edit path; `LineupPanel.test.tsx` / `PlanTab.test.tsx` extended for the new "Add Guest Player" action in both view modes.
- E2E: `game-planner.spec.ts` / `team-sharing.spec.ts` run to confirm the existing-player path is untouched; add one new smoke case covering adding a no-number guest from the pregame screen and confirming they're selectable in the lineup and visible to a second coach.
- `npm run gate:commit` (lint → test:run → build) once at the end, per repo convention.

## Resolved open questions (architect review, round 1)
1. **Where `createPlayerOnRoster` lives:** new `src/services/rosterService.ts`, parameterized by `isGuest` rather than a guest-only helper — approved above.
2. **Guest-only vs. global optional jersey number:** optional number stays **guest-only**, gated on `roster.isGuest` in both add and edit paths; the existing-player add-to-roster flow keeps requiring a number. The schema-level loosening is global (unavoidably, since it's one field), which is exactly why the display-site hardening above isn't optional scope-wise even though the number is only ever actually omitted for guests.

## Next steps
1. `ui-reviewer` pass on this revised plan — specifically the pregame entry-point placement (§2), the guest-mode form layout in `Management.tsx`, the Guest badge wording/placement, and the `CompletedPlayTimeSummary` empty-cell fallback.
2. Implement per plan.
3. Parallel validation-reviewer + security-reviewer pass once implemented.
4. `npm run gate:commit`, then commit.
