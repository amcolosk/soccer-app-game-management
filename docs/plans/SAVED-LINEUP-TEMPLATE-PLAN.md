# Saved Lineup Template — Feature Plan (v2, simplified)

**Status:** Draft v2.2 (JSON list on `Team`; revised after architect + second-model review) — supersedes the rotation-schedule design in PR #129 (`SAVED-ROTATION-PLAN-TEMPLATE-PLAN.md`)
**Date:** 2026-10-18
**Feature:** Let coaches save a proposed starting lineup and halftime lineup as a named team template, and load it into a scheduled game's plan.

## 1. Why v2

Review of the PR #129 plan found that storing the full rotation schedule drags in half-length remapping, rotation-chain validation, a delete-then-create write with no rollback, and a fingerprint race. Scope is now **lineups only**: a template is a named pair of lineups (start of game, start of second half). Rotations are not stored; after loading, the coach uses the existing "Generate Rotations" to rebuild the schedule.

## 2. Requirements

| ID | Requirement |
|----|-------------|
| LT-1 | From the Plan tab, a coach can save the game's current persisted starting lineup and halftime lineup as a named template. |
| LT-2 | Templates are team-scoped and visible to every coach on the team, including coaches who join later. |
| LT-3 | A coach can load a template into a `scheduled` game; loading replaces the plan's starting and halftime lineups in one write. |
| LT-4 | Loading never silently drops anyone: slots whose player or position no longer exists are left empty and listed in a "couldn't apply" summary. |
| LT-5 | Absent/injured players in the loaded lineup surface through the existing Plan Conflicts banner (no new availability logic). |
| LT-6 | A coach can rename and delete templates. |
| LT-7 | Saving and loading are available from the Plan tab of a `scheduled` game only (the Plan tab is not mounted for halftime/completed, and is read-only in progress). Saving after the game is an explicit follow-up, not in this scope. Templates save the *planned* lineups, not who actually played. |

## 3. Decisions and assumptions

- **D1 No rotations stored.** Existing PlannedRotations were derived from the old lineups, so apply **clears** them: each existing row's `plannedSubstitutions` is set to `"[]"` (rows are NOT deleted — row IDs stay valid for `normalizeAndCreateRotationSchedule`, which already treats schedule rows with empty subs as normal; deleting would make an immediate Generate fail on IDs the subscription hasn't dropped yet). Confirm copy: "This will replace your lineups and clear all rotation substitutions." The post-apply toast says "Rotations cleared — tap Generate Rotations". `totalRotations` is set to 0 on update.
- **D2 Interval is not stored.** `rotationIntervalMinutes` stays whatever the game's plan (or team default) already has.
- **D3 Formation (blocking).** Template stores the `formationId` it was saved under (from the team's current formation). Position IDs are **FormationPosition** IDs (planner convention, `useTeamData`), not `FieldPosition`. Position IDs belong to one formation, so on a mismatch (`template.formationId !== team.formationId`) **Apply is blocked** and the preview explains why (templates for other formations are greyed out). Same-formation templates survive formation edits because position IDs are preserved on update. If `formationId` is absent (not recorded), treat as non-matching only if none of its position IDs exist in the team's current formation.
- **D4 Halftime lineup = the full effective halftime lineup, not the stored overrides.** `GamePlan.halftimeLineup` holds only overrides relative to the end-of-first-half lineup (starting lineup + first-half rotations; see `mergeHalftimeLineup`, `halftimeProjectionUtils.ts`, `PlanTab.tsx` ~345-358). Saving it verbatim would lose rotated-in players. On save, compute `mergeHalftimeLineup(endOfFirstHalfLineup(persisted plan + persisted rotations), parseHalftimeLineup(plan.halftimeLineup))` in a pure function and store **every position explicitly** (`playerId: ""` for cleared slots). On apply, write that full map. Test: saved from a game with first-half rotations → loaded halftime equals what was displayed.
- **D5 What is saved.** Persisted `GamePlan` + persisted rotations, not the in-memory draft. "Save as template" is disabled while `planner.isDirty` or when no `GamePlan` / empty starting lineup exists. **"Apply" is also disabled while `planner.isDirty`** (the planner lives in `PlanTab`, so this gate is in `PlanTab`): otherwise the stale draft is not reloaded and the next "Save Plan" silently reverts the template.
- **D6 Names** are free text, 1–60 chars, not unique. No default derived from opponent; placeholder text only ("e.g. 2-3-1 standard").
- **D7 Soft cap** of 10 templates per team enforced client-side only (UX, not security).
- **D8 Offline / not ready:** save, load, rename and delete are disabled when offline (reuse `isOnline` from `useOfflineMutations`, already in `GameManagement`), and Apply is disabled until `useTeamData` roster and positions have loaded (otherwise every slot reads as skipped).
- **D9 LT-4 rules.** "Exists" means: player is on the **current team roster** (not merely a `Player` row), position is in the team's current formation. A player appearing twice in one lineup: first slot (by position order) wins, others are skipped and reported. The same player in both lineups is normal. If all starting slots are skipped, refuse with "nothing applied". A halftime entry for a skipped position is skipped too.
- **D10 Storage: JSON list on `Team`, not a new model.** Chosen for scope: a `Team.lineupTemplates` JSON array (max 10) inherits `Team.coaches`, so no new table, GSI, `backend.ts` IAM/env wiring, or accept/revoke/delete-team Lambda changes (the main risk surface of the model-based design). Accepted costs: (a) every save/rename/delete is read-modify-write of the whole array and the generated client has no conditional write, so concurrent writers (two coaches, two tabs; not the offline queue — `Team` is not in `ALLOWED_MODELS` and D8 disables writes offline) can silently drop a template — mitigated by re-fetching `Team` immediately before writing, and the conditional-write idea (`condition: { updatedAt: { eq: <fetched> } }`) was **not used**: the generated data client does not expose `condition`, so last-write-wins is accepted; (b) **read cost:** the team list is an unfiltered `observeQuery`/`Team.list()` (`useAmplifyQuery.ts:52`, `Home.tsx:126`, `Management.tsx:152`, `main.tsx:32`) and Team has no secondary index, so it is a table Scan filtered by auth afterward; DynamoDB bills full item size regardless of projection and caps a Scan page at 1 MB. A Team row is < 1 KB today; with templates it is ~10-70 KB, i.e. every coach's Home load scans every team's templates (~10-70x read capacity, more page round-trips as the table grows). **Trigger to move to a real model:** average Team item > ~20 KB, more than ~500 teams, or any need for sharing/usage counts; migration then means moving data out of `Team`. Cap templates at 10 per team (not 20) to bound this; (c) no field-level validation or indexing, so cross-team sharing, usage counts or per-template permissions would later need migrating to a real model; (d) must confirm no guest-facing Lambda (`get-fan-game-view`, `get-stat-tracker-view`) returns the whole `Team` item, since templates hold player IDs. Size: ~3.5 KB per template, ~35 KB at a 10 cap, well under the 400 KB item limit.

## 4. Data model

Add one field to `Team` in `amplify/data/resource.ts`:

```
lineupTemplates: a.json()   // Array<LineupTemplate>, max 10; write the string "[]" when the last template is deleted (omitting the field leaves it untouched)
```

```ts
interface LineupTemplate {
  id: string;                 // crypto.randomUUID(), client-generated
  name: string;               // 1-60 chars
  formationId?: string;       // team.formationId at save time; omit when unknown
  startingLineup: Array<{ playerId: string; positionId: string }>;
  halftimeLineup?: Array<{ playerId: string; positionId: string }>; // full effective lineup incl. playerId "" for cleared slots (D4)
  savedAt: string;            // ISO timestamp (no per-row createdAt in a JSON list)
  updatedAt: string;
}
```

Authorization is inherited from `Team` (`allow.ownersDefinedIn('coaches')`; confirm no field-level restriction applies to a plain `a.json()` field, unlike `ownerId`/`status`). No changes to `GamePlan`, `PlannedRotation`, `Game`.

**Read protocol:** `GameManagement`'s `team` is a one-time snapshot (`GameManagementRoute.tsx:35-44,63` takes it from `location.state` or a single `Team.get`; `Home.tsx:777-778` copies it into history state, which survives reload) and nothing under `GameManagement/` subscribes to `Team`. So `useLineupTemplates` **owns its own state**: it runs `Team.get` on mount / when the Load sheet opens, replaces its state with the result of every successful write, and optionally subscribes via `Team.onUpdate` filtered by id. It never reads `team.lineupTemplates` from props.

**Write protocol (all of save / rename / delete):** re-`get` the `Team`, parse `lineupTemplates` (invalid JSON -> error, no write), apply the change to that fresh array, enforce the 10 cap on save, then `Team.update({ id, lineupTemplates: JSON.stringify(next) })`. Never write from the props copy or a stale local copy. If the conditional write (D10a) is not viable, last-write-wins on a simultaneous write is a documented, accepted race.

### 4.1 Lambda / backend impact

None. `Team.coaches` is already maintained by `accept-invitation` and `revoke-coach-access`, and the field is deleted with the team by `delete-team-safe`. `archive-team` / `restore-team` need no change. **Archived teams:** the model-level `update` grant does not depend on `status`, so template writes would succeed; the UI blocks Save/rename/delete on archived teams (read-only list). **Guest Lambdas:** verified none return template data (fan/tracker views return only `team.name`), but `shareLinkAccess.ts:160-163` (`validateShareLinkAndTeam`) and `submit-stat-event/handler.ts:583` `GetCommand` the whole Team row on every fan poll / stat tap; add `ProjectionExpression: 'id, #name, coaches, #status'` there (one-line change; file list below).


## 5. UX

**Entry point:** extend the existing "Copy from game" modal in `PlanTab` into a single **"Load plan"** sheet with two tabs — *Templates* and *Previous games* (existing behavior unchanged). Load the two tabs independently (`handleOpenCopyModal` currently closes the whole modal if the previous-games query fails). Renaming the button breaks existing E2E selectors/help copy — list and update them. Rename/delete are reachable only from a scheduled game's sheet (accepted). Rename and Delete are inline row buttons (no popover, which the scrolling list would clip); Rename reuses `SaveTemplateModal` in rename mode. This avoids a third button at 375px. "Save as template" is a separate secondary action in the Plan tab lineup area.

**Save:** tap → name modal (autofocus, 60-char limit, inline validation, inline error + retry) → "Template saved" toast.

**Load (Templates tab):** list sorted by `updatedAt` desc; row shows name, saved date, and a "different formation" tag when the template's formation does not match the team's. Selecting shows a read-only preview (position abbreviation + player name) and any formation-mismatch warning. "Apply" → if a `GamePlan` exists, confirm "Replace existing plan?" (same copy as Copy-from-game; also warns rotations will be removed).

**After apply:** toast "Lineup applied"; if any slots were skipped, a dismissible summary lists them. Absent/injured players appear via the existing Plan Conflicts banner.

**Manage:** inline Rename and Delete buttons on each row (an absolutely positioned overflow menu was clipped by the scrolling list) — no long-press/swipe-only affordance. Delete confirms "Delete '[name]'? This cannot be undone." Deleting never affects games that already loaded it. Rename is in a separate edit action, not tap-on-name (tap selects the row).

## 6. Apply path (the part that must be right)

Do **not** call `updateStartingLineup` / `updateHalftimeLineup` in sequence — each writes the other lineup and the interval from a stale `draft` captured at render time (`useGamePlanner.ts:220,241,279,302`), so the second write reverts the first, and with no existing plan each call can `GamePlan.create` again.

Instead add one service function, owned next to `handleCopyFromGame` in `GameManagement.tsx` (not in `useGamePlanner`):

`applyLineupTemplate(template, game, gamePlan, team)`:
1. Re-read `Game`; abort unless `status === 'scheduled'`. Re-list `GamePlan` by `gameId` (as `handleEnsureRotationSchedule` does) and use that result, not the `gamePlan` prop, to choose update vs create (the prop can lag a just-created plan; two coaches applying to a plan-less game can still both create — accept last-write-wins and say so).
2. Map template entries onto the team's current FormationPosition IDs and roster; build final `startingLineup` / `halftimeLineup` strings and the skipped-slot list (pure function in `planTemplateUtils.ts`, unit-tested).
3. One GamePlan write: `update` the existing plan (set `startingLineup` + `halftimeLineup` together, keep its interval) or `create` with `rotationIntervalMinutes` = 10 (the app-wide planner default; `Team` has no interval field), `totalRotations: 0`, `coaches` from `team.coaches`. Never create a second GamePlan for a game.
4. List rotations by the fresh plan ID and set each row's `plannedSubstitutions` to `"[]"` (D1). Write the plan first, then clear rotations; a failure leaves a valid plan with stale rotations — surface "partially applied — retry" (Retry re-runs the whole apply, which is idempotent). With no existing plan, poll to confirm the write (as `handleCopyFromGame` does) before closing the sheet, because Generate does nothing while `gamePlan` is still null.
5. Analytics event (`LOAD_LINEUP_TEMPLATE`), mirroring `COPY_PLAN_FROM_GAME`.

`getPlanConflicts` must also scan the **effective** halftime lineup (D4), skipping `""` markers. This needs a new conflict type (`'halftime'`; union today is `'starter' | 'rotation' | 'on-field'`), de-dupe against starter entries, label updates in `PlanTab.tsx` (~1184), `GameTimer.tsx` (~215) and `RotationWidget.tsx` (~32), and a limit to before-halftime states so the live banner shows no stale conflicts. This changes behavior for existing games; intended.

## 7. File-by-file change list

| File | Change |
|------|--------|
| `amplify/data/resource.ts` | Add `Team.lineupTemplates: a.json()`. |
| `amplify/functions/shared/shareLinkAccess.ts`, `amplify/functions/submit-stat-event/handler.ts` | Add `ProjectionExpression` to the Team `GetCommand` (+ existing tests updated). |
| `src/utils/planTemplateUtils.ts` (+test) | Pure: `serializePlanToTemplate`, `mapTemplateToTeam` (returns lineups + skipped slots + formation-mismatch flag). |
| `src/components/GameManagement/hooks/useLineupTemplates.ts` (+test) | Owns template state via `Team.get` (never props); `saveTemplate`, `renameTemplate`, `deleteTemplate` using the re-fetch-then-write protocol (§4). |
| `src/components/GameManagement/SaveTemplateModal.tsx` (+test) | Name entry modal. |
| `src/components/GameManagement/PlanTab.tsx` | Fold templates into the Load/Copy modal as a tab; add "Save as template"; skipped-slot summary. |
| `src/components/GameManagement/GameManagement.tsx` | `applyLineupTemplate` handler beside `handleCopyFromGame`; halftime scan in `getPlanConflicts`. |
| `src/App.css` | Appended styles (templates tab, inline row actions, preview). |
| `src/utils/analytics` (events file) | New event. |
| `README.md`, `docs/ARCHITECTURE.md`, `docs/specs/UI-SPEC.md` | Data model + planner section updates. |

## 8. Test strategy

**Unit (`planTemplateUtils.test.ts`):** serialize persisted plan (full / start-only / halftime with `""` markers preserved); map with removed player (slot empty + reported); map with removed position; formation mismatch flag; duplicate player in one lineup handled.
**Hook (`useLineupTemplates.test.ts`):** save/rename/delete each re-fetch `Team` and write from the fresh array (a template added by another writer between subscription and write is preserved); invalid JSON -> error, no write; 10-cap per team; deleting the last template writes `"[]"`; after save/rename/delete the list updates without remount; a stale `team` prop does not hide a saved template; conditional-write conflict (if adopted) retries once.
**Component:** SaveTemplateModal validation (empty, >60 chars, error + retry); Load sheet empty state, preview, formation warning, confirm only when a plan exists, disabled offline; Save disabled when dirty / no plan.
**Apply (`GameManagement` / service):** (additions) Apply disabled while dirty; stale-`gamePlan`-prop case issues exactly one create across a re-list; rotations cleared via `"[]"` update and an immediate Generate succeeds; formation mismatch blocks; duplicate-player and all-skipped rules (D9); unparseable template JSON → error, no writes; 10-cap is per team. Also: applies both lineups in a single `GamePlan` write (assert one `update`, no `create` when a plan exists, exactly one `create` when none); interval preserved; rotations deleted only after plan write succeeds; failure after plan write → retry-able error; non-`scheduled` status rejects with no writes; halftime absent player appears in Plan Conflicts.
**E2E (additive to `e2e/game-planner.spec.ts` and `e2e/team-sharing.spec.ts`):** save from game A, load into game B, reload to confirm persistence; delete removes it; co-coach (including one who joins after save) sees the template, since it rides on `Team`.

## 9. Out of scope

Rotation schedules, interval, half length, cross-team sharing, auto-remap across formations, versioning, import/export, auto-save on completion, manual template ordering.
