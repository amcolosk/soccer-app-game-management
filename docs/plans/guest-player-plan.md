# Implementation Plan: Guest Player (Issue #224)

## Overview
Let a coach add a player who isn't a full-time team member — a one-off fill-in or a recurring call-up — and use them in lineups, rotations, and stats exactly like a regular roster player. Guests are added to the team roster permanently (not scoped to a single game) and flagged `isGuest` so they're visually distinguishable; their jersey number is optional since a fill-in often doesn't have one.

**Status:** Revised after architect review round 1, ui-reviewer round 1, and architect review round 2 — findings below incorporated.
**Scope:** Small-to-medium: one schema change (1 new field, 1 field loosened from required→optional), a shared create-and-roster helper and shared intake form, roughly 29 display call sites that need null-safe jersey-number rendering, and two UI entry points sharing one form. Touches the data model, so follows the full pipeline per `dev-pipeline` (plan → architecture review → implement → validation + security review → commit gate).
**Risk Level:** Medium. The schema changes themselves are safe (backward-compatible loosenings, no backfill), but `playerNumber` going from always-a-number to sometimes-null fans out across ~29 display sites that assume a number today, and two rounds of review found real placement/plumbing gaps in the pregame entry point — see the full detail below. Per architect review round 2: implement as two sequential commits within this one plan/pipeline run — (A) null-safety only (`formatJerseyPrefix`, `sortRosterByNumber`, every display site, `useTeamData` normalization — no behavioral change since no null numbers exist until the schema changes, fully unit-testable without a deploy), then (B) the schema change plus the guest feature, entry points, badge, and docs. Not a reason to split into separate plans.

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

Sites that currently fall back to a literal `'?'` (found in architect review round 2 — missed by both prior passes):
- `shape/LineupShapeView.tsx:503,545` (renders `#{playerNumber ?? '?'}`)
- `FanMode/StatTrackerView.tsx:591,802` (same pattern, on the public helper-link view)

Already null-safe, no change needed: `LineupShapeView.tsx:442` (plain truthy check), `lineupInteractionAdapter.ts:156`, `completedGameTimelineSort.ts`.

Other:
- `CompletedPlayTimeSummary.tsx:67` renders `{player.playerNumber}` with no `#` prefix in a column headed bare `"#"` (`:45-47`) — when null, render `"—"`, matching the table's own existing no-value convention one column over (`hasTime ? formatPlayTime(...) : "—"` at line 70). Not initials (ui-reviewer: inconsistent with the column's numeric-only semantics) and not an empty cell (it's a `<th scope="row">` — a screen reader would announce nothing for that row header).

Also update the now-stale comment at `amplify/data/resource.ts:1003-1006` ("Nullable at the GraphQL level as a defensive measure even though `TeamRoster.playerNumber` is `.required()` in the DB") — after this change the DB field is no longer required either, so the comment should say the nullability is now the actual schema, not a defensive GraphQL-layer workaround.

## New shared service function
Add `createPlayerOnRoster({ team, fields, currentUserId, isGuest, existingNumbers })` to a new `src/services/rosterService.ts` (per architect review round 1: a general create-and-roster operation with `isGuest` as one parameter, not a guest-only helper — this also leaves room for a later refactor of `handleAddPlayerToRoster` onto the same function, which is out of scope here). `existingNumbers: number[]` is passed in by the caller (already-loaded `TeamRoster[]`/`PlayerWithRoster[]` for the team) so the helper doesn't need to re-fetch roster rows itself — `LineupPanel`/`PlanTab` only have `PlayerWithRoster[]` in scope, not raw `TeamRoster[]`, and shouldn't be made to load the latter just for this check.

Fields: `firstName`, `lastName`, `birthYear?`, `jerseyNumber?`, `preferredPositionIds?`.

Steps:
1. Validate names are non-empty (same rule as `handleCreatePlayer`). If `jerseyNumber` is supplied: validate range with `isValidPlayerNumber`, then check uniqueness with a plain `existingNumbers.includes(jerseyNumber)` — **not** `isPlayerNumberUnique`, whose signature takes a `TeamRoster[]` with `teamId`/`id` fields (architect review round 2: this mismatch would otherwise force building fake `TeamRoster`-shaped objects just to call it). `isPlayerNumberUnique` stays reserved for `Management.tsx`'s add/edit paths below, where a real `TeamRoster[]` is already in scope.
2. `Player.create({ firstName, lastName, birthYear, coaches: union(team.coaches, [currentUserId]) })` — **not** `coaches: [currentUserId]` alone. A co-coach who isn't the creator must already be able to read this `Player`, or `useTeamData.ts`'s join (`if (!player) return null`) silently drops the new guest from their view of the roster, bench, and lineup. Seeding `coaches` with the team's full coach list up front also means the separate `Player.update`-merge step that `handleAddPlayerToRoster` needs today is unnecessary here.
3. `TeamRoster.create({ teamId: team.id, playerId: <new player id>, playerNumber: jerseyNumber ?? null, preferredPositions, isGuest, coaches: team.coaches })`.
4. On step 3 failing, roll back step 2 via `deletePlayerCascade(playerId)` (not a raw `Player.delete`, which doesn't exist on this model — see Current State). Log a rollback failure the same way `Management.tsx:586-588` does today and accept that a harmless orphan `Player` record may remain if the rollback itself fails; the creating coach is in its `coaches` array (from step 2) so it's still visible and manageable from the Players list if that happens.

This one function backs both UI entry points so they can't drift from each other. Callers must map an empty/blank jersey-number input to `undefined` *before* calling this function, not pass `parseInt('')` through — `parseInt('')` is `NaN`, and `NaN ?? null` is still `NaN` (architect review round 2 caught this exact bug in the originally-drafted edit-path code). Both `Management.tsx`'s add/edit handlers and this function's own `jerseyNumber ?? null` in step 3 depend on the caller having already turned a blank field into `undefined`/`null`, never `NaN`, upstream.

## UI changes

### 1. Team roster management (`Management.tsx`) — requirement 4a
In the existing "Add Player to Roster" panel (the `rosterForm.isAdding` block, ~line 1425), add a mode toggle: "Existing player" vs. "New guest player". New-guest mode adds first name, last name, optional birth year, optional jersey number, optional preferred positions (reusing the preferred-position checkboxes already rendered there) and calls `createPlayerOnRoster({ ..., isGuest: true })`.
- The toggle is a two-option segmented control styled like the existing `List`/`Shape` view-mode toggle (`LineupPanel.tsx:472-499`), not a bare unlabeled pair of inputs — use real radio inputs (`role="radiogroup"`, each option a labeled `<label>`), consistent with fixing (not perpetuating) this panel's existing lack of visible field labels (today's inputs rely on `placeholder` text alone, e.g. `placeholder="Player Number *"` — a pre-existing gap this plan shouldn't add more of). Switching modes clears the other mode's fields rather than leaving stale hidden state, and moves focus to the First Name input when switching into guest mode.
- **Existing-player mode also gets a "Mark as guest" checkbox** (architect review round 2, finding on call-ups from the existing global Player pool): without this, a coach calling up a child who's already a `Player` record (e.g. from their other team) has no way to flag them `isGuest` on *this* roster, and would otherwise have to either skip the flag or create a duplicate `Player` that splits that child's stats across two identities — a real correctness bug, not just a missing nice-to-have. Note this path does **not** go through `createPlayerOnRoster` (which always creates a *new* `Player` — wrong here, since the player already exists): it's the existing `handleAddPlayerToRoster`, extended to accept `isGuest` and to make its jersey-number requirement conditional on the checkbox, writing `TeamRoster.create({ ..., isGuest: markExistingAsGuest, playerNumber: num ?? null })`. `createPlayerOnRoster` stays reserved for the two "new guest" intake paths (§1's guest sub-form and §2's pregame form), where a brand-new `Player` genuinely needs creating.
- `managementReducers.ts`: extend `RosterFormState` with `mode: 'existing' | 'guest'`, a `markExistingAsGuest: boolean` flag, and `guestFirstName`/`guestLastName`/`guestBirthYear` fields for the guest sub-form — named distinctly from the existing `editFirstName`/`editLastName` edit-path fields (architect review round 2: reusing bare `firstName`/`lastName` names risks confusing the add-guest and edit-roster code paths). The `SET_FIELD` action's field union must include the three new field names. `EDIT_ROSTER`'s reducer case (currently a full object literal, `managementReducers.ts:264-273`) must explicitly set `mode: 'existing'` and clear the three guest fields and `markExistingAsGuest` — add a test asserting this, since TypeScript won't catch a merely-wrong `mode` value, only a missing field.
- **Edit path must also support guests** (round-1 gap): `handleUpdateRoster` (`Management.tsx:623-656`) currently always requires and writes a jersey number. Change it to only require a number when `!rosterForm.editing.isGuest`. Map a blank number input to `undefined` *before* any `parseInt`/`?? null` logic runs (see the shared-service-function note above on the `NaN ?? null` bug architect review round 2 caught in this exact spot) and write `playerNumber: parsedNumOrUndefined ?? null`. Use `isValidPlayerNumber`/`isPlayerNumberUnique` (the real `TeamRoster[]`-based signature, since this component has that data) in both the add (existing-player and guest) and edit paths, replacing the current ad hoc inline checks. Show the same Guest badge (§3) in the edit form's header when editing a guest, so it's clear why the number field behaves differently.
- Roster list rows: switch every `#{roster.playerNumber}` to `formatJerseyPrefix(roster.playerNumber)` and add the Guest badge (§3) next to the name when `roster.isGuest`, with one exception — `Management.tsx:2002` (`` `${team.name} #${r.playerNumber}` ``) is a row in the **global Manage ▸ Players list**, not a team-roster row, so it stays unbadged there for the same reason given in §3 (the flag is per-team-roster, and this row doesn't carry team-roster context the way `1374`/`1404`/`1608` do — those three are genuine roster rows and do get the badge).

### 2. Pregame entry point — requirement 4b
Two rounds of review moved this twice: architect review round 1 found the originally-proposed host (`LineupPanel`'s bench list) isn't reliably reachable in shape mode; ui-reviewer round 1 found the proposed second host ("PlanTab's available-players area") didn't exist under that name and re-pinned it to `PlannerLineupView`'s Bench section; architect review round 2 then found *that* host has the same shape-mode-visibility defect as round 1's original `LineupPanel` finding (`PlannerLineupView.tsx:139-182` renders `LineupShapeView` instead of the list/Bench markup when `viewMode === "shape"`, and the Bench section is also hidden when `positions.length === 0`), plus two design gaps: no single owner for the intake form/handler, and no stated answer for which of `PlannerLineupView`'s three mountings (Starting lineup, Halftime, each rotation) shows the action.

**Final design — one shared form, two buttons that just open it:**
- `GameManagement.tsx` owns the feature: a single `handleAddGuestPlayer` (wrapping `createPlayerOnRoster`) and one shared intake modal/form (same fields as §1's guest sub-form: first/last name, optional birth year, optional jersey number). This is the one place with everything the flow needs in scope — `team`, `plannedRotations` (for the stale-rotation hint below, which `LineupPanel` doesn't have), and `currentUserId`.
- Both entry points become a plain "+ Add Guest Player" button that calls an `onAddGuestPlayer` opener prop — not a form of their own:
  - **Field tab:** in `LineupPanel`'s header actions row, next to (not replacing) the existing `List`/`Shape` view-mode toggle and `Clear All Positions` button — visible regardless of view mode since it lives in the header, not inside the list/shape-conditional body. That row can hold up to 4 controls on a 375px phone; add an explicit `flex-wrap` rule (or a second row) rather than letting it overflow.
  - **Plan tab:** in `PlanTab` itself (not inside `PlannerLineupView`, which the shape-mode defect above rules out as a host) — placed next to the "Starting Formation" heading (`PlanTab.tsx:1264`), shown only for the **Starting Lineup** section, not for the Halftime or per-rotation sections `PlannerLineupView` also renders within that tab. Adding a guest is meaningfully a pregame-roster action, not a rotation-planning one, so one fixed location there is correct rather than repeating the button at every mounting.
- `sharedLineupPanelProps` (`GameManagement.tsx:2324-2339`) already reaches both `LineupPanel` and `PlanTab` (`:2534`, `:2559`) — add `onAddGuestPlayer` to that object rather than threading a new prop through each call site individually. That object is also spread into the halftime `LineupPanel` (`:2831`) and the in-progress `PlanTab` (`:2679`), so the `gameState.status === 'scheduled'` gate must stay an explicit check inside the opener/button, not something the prop's mere presence implies.
- Both buttons use the same label, icon, and visual treatment so a coach recognizes "+ Add Guest Player" as one feature reachable from two places.
- Gate the action on `!isReadOnly`, `gameState.status === 'scheduled'`, and `isOnline` (architect review round 2: `Player`/`TeamRoster` creates aren't in `useOfflineMutations`'s allow-list, the second create depends on the first one's generated ID so it can't be queued regardless, and a failed rollback is more likely while offline, which makes an orphan `Player` more likely too — pregame sideline setup is exactly where connectivity is often poor, so disable the action with a short "Reconnect to add a guest player" reason rather than letting it attempt and fail). `isOnline` is already available in `GameManagement.tsx:2436`.
- When a guest is added after rotations have already been generated for the game, surface the existing `showWarning` toast pattern (not a new banner, and not `PlanTab`'s conflict-banner, which is for a different stale-plan state) — one line: "Recalculate rotations to include them."

### 3. Guest badge elsewhere
Reuse the existing bare `.status-badge` class (the non-color-only pattern already used for `Injured`, `BenchTab.tsx:407/430`) for "Guest", but with a **new distinct modifier**, `.status-badge--guest`, not `.unavailable`. Architect review round 2 found `.unavailable` isn't actually a color at all today — `App.css` only styles `.assigned-player.unavailable`, `.bench-player.unavailable`, and `.availability-badge.unavailable`; `.status-badge` alone (which is what `Injured` currently uses) is unstyled/bare. Without a distinct style, Guest, Injured, and a transient "Saving…" message would all render visually identical, defeating the badge's purpose. Add a small neutral `.status-badge--guest` style (not a warning color, since Guest isn't a problem state) and correct the UI-SPEC write-up so it doesn't describe `.unavailable` as a color that already exists for Injured — document both the gap and the new modifier (see Documentation section below).

This is **not** a uniform "add it everywhere" change — two rendering contexts need a different, space-constrained treatment:
- **`BenchTab.tsx`'s player-meta row** (`.bench-tab__player-meta`, `BenchTab.tsx:406-417`) can already show an Injured badge *and* a transient `rowStatusMessage` badge (e.g. "Saving…", "Queued offline…") together. Architect review round 2 corrected the original diagnosis here: the overflow is **not** caused by the row's CSS grid (`.bench-tab__player-row-container`, which already grows vertically fine) — it's that the adjacent badge `<span>`s have no whitespace between them in the JSX (`BenchTab.tsx:407-410`) combined with `.status-badge`'s `white-space: nowrap` (`App.css:1634`), leaving no line-break point, so the badges overflow sideways toward the fixed 5.5rem action column instead of wrapping. The actual fix: change `.bench-tab__player-meta` itself to `display: flex; flex-wrap: wrap; gap: …` (not the row container's grid columns, which are fine as-is). Combine that with an explicit priority order — render **Guest, then Injured, then the status message** — so when space is tight the more important badges still appear first on the wrapped line. A guest who is also injured with a pending offline sync is a realistic combination, not a hypothetical edge case, which is why this is flagged Major rather than cosmetic.
- **`PlannerLineupView`'s Bench chips** (`.bench-player`, `App.css:3062-3082`) are 2-column grid pills at mobile widths that already truncate long names with `ellipsis`; a full-text "Guest" badge doesn't fit without further truncating the name or breaking the grid's row alignment. Use a compact alternate treatment there instead — e.g. a small superscript "G" next to the name, or showing "G" in the jersey-number slot when there's no number — rather than the full badge used everywhere else.

Everywhere else a player name renders from `PlayerWithRoster` (lineup list in `LineupPanel`, `SeasonReport`'s player table/drill-down) gets the full `.status-badge.status-badge--guest` "Guest" treatment with no special-casing needed. Cosmetic only; no filtering logic changes, since guests must behave exactly like regular players per requirement 2. Note guests will also appear unbadged in the global Manage ▸ Players list (`Management.tsx:2002`, see §1), since `isGuest` lives on the roster row, not the player — that's expected (a player can be a guest on one team and a full member of another) and doesn't need a fix, just this one-line mention so it isn't mistaken for a bug during review.

### 4. Season reports (`SeasonReport.tsx`)
No filtering changes — guest stats already flow through because they're a normal `TeamRoster`/`Player` pair. Fix the two `!== undefined` jersey-number checks at lines 784 and 889 to `!= null` (see display-site list above) and optionally add the same "Guest" badge in the player table/drill-down for consistency.

## Validation / edge cases
- Jersey number: when provided, validated 1–99 and unique within the team via `isValidPlayerNumber`/`isPlayerNumberUnique`, now wired into add (both modes) and edit; when omitted for a guest, both utils already treat that as valid. Uniqueness remains a client-side check only (a race between two coaches adding at once could in theory produce a duplicate) — this is no weaker than today's unenforced behavior, just noting it's not newly introduced.
- Guest player names: same required-first/last-name validation as `handleCreatePlayer`.
- Converting a guest to a full roster player, or vice versa, is a deferred follow-up (`TeamRoster.update({ isGuest: false })`), not part of this plan — no migration path needed since `isGuest` carries no behavioral weight beyond display.
- Deleting a guest: uses the existing `deletePlayerCascade` / roster-removal flow unchanged.
- Multi-coach sharing: `createPlayerOnRoster` seeds `Player.coaches` with the team's full coach list plus the creator (not just the creator), and `TeamRoster.coaches` from `team.coaches`, per `CLAUDE.md`'s authorization rule — see step 2 above for why seeding at creation (rather than merging after) matters here.

## Risks
- **Jersey-number display fan-out is the real size of this change.** Two review rounds found the "already null-safe" claim in the original draft was wrong and undercounted — roughly 29 sites across 15+ files assume a number today. The full site list above must be treated as the actual scope, not a sample; a coding agent should still re-grep `.playerNumber` at implementation time in case something new landed since this review. Mitigated structurally by doing this slice as its own first commit (see Scope above) so it's reviewable and testable in isolation from the feature itself.
- **Schema change requires a `npx ampx sandbox`/deploy cycle** before the frontend change can be tested end-to-end against a live backend — this sandbox has no AWS credentials for prod per project memory, so Andrew will need to run/verify the deploy locally.
- **Two near-duplicate "add a player" flows** (existing-player-to-roster vs. new-guest) living in the same form — addressed in §1 above via a labeled segmented toggle with mode-switch field clearing, consistent with the existing List/Shape toggle pattern.
- **Badge crowding on `BenchTab`'s mobile row** (Guest + Injured + a transient status message, overflowing sideways due to a missing wrap point) — addressed in §3 via a defined badge priority order and a `flex-wrap` fix on `.bench-tab__player-meta`.
- **Pregame entry-point placement took three rounds to converge** (round 1: `LineupPanel` bench list unreachable in shape mode → round 2 (ui-reviewer): second host misnamed, needed `PlannerLineupView`'s Bench section + new prop plumbing → round 3 (architect round 2): that host has the *same* shape-mode defect, and the form/handler ownership was undefined) — now settled on a single shared form owned by `GameManagement`, with both entry points as thin opener buttons (§2). This history is left in the plan intentionally so a future reader understands why the design looks the way it does rather than re-litigating it.
- **Offline/sideline use**: the pregame add-guest action is now explicitly gated on `isOnline` (§2) since the two-step create can't be queued and a failed rollback while offline would leave an orphan `Player` record.

## Documentation updates
- `README.md:18`, `README.md:132` (Getting Started also describes jersey numbers as always present), and `README.md:153` (Data Model: `TeamRoster` gains `isGuest`, `playerNumber` now optional).
- `docs/ARCHITECTURE.md:19,126,533` — same field notes (architect review round 2 found two more lines beyond the original `:126` describing jersey numbers as always present).
- `docs/specs/UI-SPEC.md` §5.7 — add a general "inline status badge" subsection documenting the reusable `.status-badge` pattern and its modifiers, correctly describing which ones currently have actual color styling (`.unavailable` does **not**, despite being used for Injured today — see §3) versus the new `.status-badge--guest`. Name the final pregame entry point by its real components (`LineupPanel`'s header actions row; `PlanTab`'s Starting-Formation-adjacent action) rather than any of the two earlier, now-superseded placements, and document the `BenchTab`/`PlannerLineupView` badge exceptions and priority order from §3.
- The comment at `amplify/data/resource.ts:1003-1006` (see above).
- Checked-in `amplify`-generated GraphQL schema artifacts will need regenerating after the schema change (standard `npx ampx sandbox`/deploy step, not a manual edit).

## Test strategy
- Unit: `validation.test.ts` extended to assert `isPlayerNumberUnique`/`isValidPlayerNumber` are actually exercised by the roster add/edit paths now.
- Unit: new `rosterService.test.ts` covering `createPlayerOnRoster`'s validation branch, the `Player.coaches` seeding (team coaches + creator), and the rollback-via-`deletePlayerCascade` path on a `TeamRoster.create` failure.
- Unit: `useTeamData.test.ts` — assert `isGuest` and a normalized (`undefined`, not `null`) `playerNumber` are carried through into `PlayerWithRoster`.
- Unit: `playerUtils.test.ts` — `formatJerseyPrefix` and the revised `sortRosterByNumber` "guests sort last" behavior.
- Component: `Management.tsx` roster-tab tests extended for the new guest add mode (including focus-on-switch and field-reset-on-switch behavior), the "Mark as guest" checkbox on existing-player mode, and the guest-aware edit path; `managementReducers.test.ts` (new) asserting `EDIT_ROSTER` resets `mode`/guest fields correctly; `LineupPanel.test.tsx` extended for the header action in both view modes; `PlanTab.test.tsx` extended for the new action next to "Starting Formation" and for a Shape-mode case (confirming it's still visible, since it now lives in `PlanTab` rather than inside the shape-sensitive `PlannerLineupView`); `BenchTab.test.tsx` extended for the three-badge (Guest/Injured/status-message) priority-order and wrap behavior.
- E2E: `game-planner.spec.ts` / `team-sharing.spec.ts` run to confirm the existing-player path is untouched; add one new smoke case covering adding a no-number guest from the pregame screen and confirming they're selectable in the lineup and visible to a second coach.
- `npm run gate:commit` (lint → test:run → build) once at the end, per repo convention.

## Resolved open questions (architect review, round 1)
1. **Where `createPlayerOnRoster` lives:** new `src/services/rosterService.ts`, parameterized by `isGuest` rather than a guest-only helper — approved above.
2. **Guest-only vs. global optional jersey number:** optional number stays **guest-only**, gated on `roster.isGuest` in both add and edit paths; the existing-player add-to-roster flow keeps requiring a number *unless* the round-2-added "Mark as guest" checkbox (§1) is checked, in which case that submission is a guest too and the same optional-number rule applies. The schema-level loosening is global (unavoidably, since it's one field), which is exactly why the display-site hardening above isn't optional scope-wise even though the number is only ever actually omitted for guests.

## Resolved findings (ui-reviewer, round 1)
1. **Pregame second entry point** named precisely as `PlannerLineupView`'s Bench section (not "PlanTab's available-players area"), with the required `onAddGuestPlayer` prop plumbing through `PlanTab` called out — §2 above. (Major)
2. **`BenchTab` badge crowding** (Guest + Injured + transient status message in a width-constrained mobile grid row) — resolved via a defined priority order and a wrap-instead-of-clip layout change, plus a separate compact treatment for `PlannerLineupView`'s Bench chips — §3 above. (Major)
3. Minor findings (toggle control type/labels/focus order, edit-form Guest indicator, toast mechanism for the stale-rotation hint, `.status-badge` modifier choice, `CompletedPlayTimeSummary` fallback value, header-row wrap on mobile, shared visual treatment for both entry points) all folded into §1–§3 and the display-site list above.

## Resolved findings (architect review, round 2)
1. **Plan-tab entry point hidden in Shape view** — the host moved out of `PlannerLineupView` entirely, into `PlanTab` itself (next to "Starting Formation"), which isn't shape-sensitive — §2.
2. **No single owner for the intake form/handler** — `GameManagement` now owns one shared modal/handler; both buttons are thin openers via `onAddGuestPlayer` on `sharedLineupPanelProps` — §2.
3. **`BenchTab` badge-overflow root cause was misdiagnosed** (grid vs. missing wrap point) — corrected to a `flex-wrap` fix on `.bench-tab__player-meta` — §3.
4. **`.status-badge.unavailable` isn't actually styled** — Guest gets its own new `.status-badge--guest` modifier instead — §3.
5. **`num ?? null` doesn't handle a blank input** (`parseInt('') === NaN`, and `NaN ?? null` is still `NaN`) — callers now map blank to `undefined` before any parse/validate step — §1, shared service function section.
6. **`isPlayerNumberUnique`'s signature doesn't match `existingNumbers: number[]`** — `createPlayerOnRoster` now does a plain `.includes()` check; `isPlayerNumberUnique` stays reserved for `Management.tsx`, which has a real `TeamRoster[]` — shared service function section.
7. **4 more display sites found** (`LineupShapeView.tsx`, `StatTrackerView.tsx`, both using a `'?'` fallback) — added to the site list.
8. **§1/§3 contradicted each other on `Management.tsx:2002`** — resolved: it's a global-Players-list row, stays unbadged, consistent with §3's Players-list policy.
9. **`RosterFormState` field-naming collision risk and `EDIT_ROSTER` reset gap** — guest fields renamed `guestFirstName`/etc., `EDIT_ROSTER` explicitly resets `mode` and guest fields, test added.
10. **Offline/sideline risk unaddressed** — action now gated on `isOnline` — §2.
11. **Existing-pool call-ups couldn't be flagged as guests**, risking duplicate `Player` records for the same real person — added a "Mark as guest" checkbox to existing-player mode — §1.
12. **Doc/test gaps** (`README.md:132`, `docs/ARCHITECTURE.md:19,533`, `PlanTab.test.tsx` shape case, `managementReducers.test.ts`) — added above.
13. **Scope check**: confirmed appropriately sized for one plan/pipeline run, implemented as two sequential commits (null-safety, then feature) rather than split into separate plans — see Scope at the top.

## Next steps
1. Final self-review pass (this session) before handing to implementation, since the plan has now gone through three review rounds and should be checked for internal consistency as a whole.
2. ui-reviewer re-confirmation is optional per architect review round 2 ("don't need to see it again unless the revision changes the data or service design") — the round-2 changes were placement/ownership/CSS fixes, not new data or service design, so this plan proceeds to implementation without a third UI round unless Andrew wants one.
3. Implement per plan, as two sequential commits (null-safety display fixes, then the schema + feature).
4. Parallel validation-reviewer + security-reviewer pass once implemented.
5. `npm run gate:commit`, then commit.
