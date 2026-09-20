# Saved Rotation Plan Template — Feature Plan

**Status:** Draft — Ready for Architect Review  
**Date:** 2026-05-22  
**Feature:** Allow coaches to save a game rotation plan as a reusable template and load it into future games  
**Triggered by:** Issue filed via in-app bug reporter (rotation plan save request, April 2026)

---

## 1. Problem Statement

After a coach runs the game planner and arrives at a working rotation plan (starting lineup,
rotation interval, and per-rotation substitution schedule), there is no way to persist that plan
for reuse. Each game requires building the plan from scratch, even when the squad and rotation
structure are largely the same week over week.

The coach wants to:
1. Save the current rotation plan (settings + starting lineup + all rotation substitutions) as a
   named template at the end of planning.
2. Return to a future game's plan tab and load that saved template as a starting point.
3. Review which players in the template are unavailable for the upcoming game and resolve the gaps
   before finalising the plan.

---

## 2. Requirements

### Functional Requirements

| ID | Requirement |
|----|-------------|
| RT-1 | Coach can save the active game plan as a named template from the Plan tab. |
| RT-2 | Template stores: rotation interval, starting lineup (position → player), and per-rotation substitution schedule. |
| RT-3 | Templates are scoped to a team and accessible by all coaches on that team. |
| RT-4 | Coach can list saved templates for the team and load one into a scheduled game's plan. |
| RT-5 | Loading a template pre-fills the game plan settings and lineup; coaches confirm before overwriting. |
| RT-6 | After loading, players from the template who are marked absent or have no availability record for the current game are flagged inline in the plan — the plan is still loadable. |
| RT-7 | Coach can rename or delete a saved template. |
| RT-8 | Templates may be saved even when the current game plan is incomplete (e.g., some positions unassigned). |

### Non-Functional Requirements

- Template list must load and render within the Plan tab without a full page reload.
- Deleting a template does not affect any game plan already derived from it — templates are copied on load, not referenced at runtime.
- Authorization model: `allow.ownersDefinedIn('coaches')` consistent with every other team-scoped model.

---

## 3. Requirements Gaps & Assumptions

| # | Item |
|---|------|
| G1 | **Template count limit.** No hard limit is defined. Cap at 20 templates per team to stay within reasonable DynamoDB item size and list UX. |
| G2 | **Position identity across formations.** Templates store raw position IDs. If a team changes formation between save and load, position IDs from the template that no longer exist in the team's current formation are silently dropped on load and shown as a warning. |
| G3 | **Player identity.** Templates store player IDs. Transferred players (removed from the team roster) cause those slots to appear as unassigned on load — treated the same as an absent player slot. |
| G4 | **Half-length coupling.** `rotationIntervalMinutes` is the only stored setting; `halfLengthMinutes` is read from the target game / team at load time. If the resulting rotation count differs from the template's rotation count, extra rotation slots are added empty and surplus template rotations are truncated — with a visible warning. |
| G5 | **Halftime lineup.** The halftime lineup (second-half starting lineup) is stored in the template. On load it is pre-filled exactly like the starting lineup; the same unavailability flags apply. |
| G6 | **Concurrent edits.** Template save uses the existing optimistic-concurrency pattern (`updatedAt` check) to guard against two coaches saving simultaneously. |

---

## 4. Data Model

### 4.1 New Model: `TeamPlanTemplate`

```
TeamPlanTemplate
  id                      UUID (auto)
  teamId                  ID (required, FK → Team)
  name                    string (required, max 60 chars)
  rotationIntervalMinutes integer (required)
  startingLineup          json   // Array<{ positionId: string; playerId: string }>
  halftimeLineup          json   // Array<{ positionId: string; playerId: string }> | null
  rotations               json   // Array<TemplateRotation> — see §4.2
  savedAt                 datetime (required)
  savedFromGameId         string (optional, informational — not a FK)
  coaches                 string[] (team coaches — authorization array)
```

Authorization:
```typescript
.authorization((allow) => [
  allow.ownersDefinedIn('coaches'), // any team coach can create, read, update, delete
])
```

Relationship on `Team`:
```typescript
planTemplates: a.hasMany('TeamPlanTemplate', 'teamId'),
```

### 4.2 `TemplateRotation` (embedded JSON shape, not a separate model)

```typescript
interface TemplateRotation {
  rotationNumber: number;      // 1, 2, 3, … (sequential, matching PlannedRotation.rotationNumber)
  gameMinute: number;          // planned minute for this rotation
  half: number;                // 1 or 2
  plannedSubstitutions: Array<{
    playerOutId: string;
    playerInId: string;
    positionId: string;
  }>;
}
```

Storing rotations inline as JSON in `TeamPlanTemplate.rotations` avoids a separate child table,
keeps the template self-contained, and mirrors the `GamePlan` + `PlannedRotation` serialization
pattern already used in `GamePlan.startingLineup` / `GamePlan.halftimeLineup`.

### 4.3 No Schema Changes to Existing Models

- `GamePlan`, `PlannedRotation`, `Game`, `Team` — unchanged.
- A template is a snapshot copy; loading a template writes to `GamePlan` + `PlannedRotation`
  through the existing save paths (`useGamePlanner.savePlan` + `onUpdatePlannedRotations`).

---

## 5. User Experience

### 5.1 Saving a Template

**Entry point:** "Save as template" action in the Plan tab, visible when the game is in
`scheduled` state and a `GamePlan` exists.

**Flow:**
1. Coach taps "Save as template".
2. A modal appears: "Save rotation plan as template" with a name input pre-filled with the
   opponent name + date (e.g. "vs Rovers — 2026-04-18"). Max 60 characters.
3. Coach confirms. A loading indicator replaces the confirm button.
4. On success: modal closes, a transient success toast appears — "Template saved".
5. On name collision: allow duplicates (names are not unique — coaches can distinguish by date).
6. On error: inline error message inside the modal with a retry option.

**When saving is disabled:**
- Game is not in `scheduled` state (live, halftime, or completed).
- No `GamePlan` record exists yet.

### 5.2 Loading a Template into a Game Plan

**Entry point:** "Load template" button in the Plan tab, visible when the game is in `scheduled`
state. Rendered alongside (or near) the "Generate Rotations" button.

**Flow:**
1. Coach taps "Load template".
2. A sheet / modal lists saved templates for the team, sorted by `savedAt` descending.
   Each row shows: template name, saved date, rotation interval, rotation count.
3. Coach selects a template. A preview expands inline: starting lineup grid (position abbreviation
   + player name), rotation count, half length mismatch warning if applicable.
4. Coach taps "Apply template". A confirmation prompt: "This will replace the current plan. Continue?"
   (Shown only if a `GamePlan` already exists for the game; omitted if no plan exists yet.)
5. On confirm: the template is applied (see §5.3).

**Empty state:** "No saved templates yet. Save your first template from any game's Plan tab."

### 5.3 Apply Template Logic (Client-Side)

When a coach confirms loading a template:

1. **Unavailability check.** For each player ID in `startingLineup`, `halftimeLineup`, and
   `rotations[*].plannedSubstitutions`:
   - Look up that player's `PlayerAvailability` record for the current game.
   - Mark the player as "unavailable in template" if their status is `absent` or if no
     availability record exists for this game.

2. **Write the plan settings.** Call `planner.updateRotationInterval` with the template's
   `rotationIntervalMinutes`.

3. **Write the starting lineup.** Apply the template's `startingLineup`, but omit any player
   whose position or player ID is invalid for the current team. Pass the result to
   `planner.updateStartingLineup`.

4. **Write the halftime lineup.** Same as step 3 but using `halftimeLineup` and
   `planner.updateHalftimeLineup`. Skip if `halftimeLineup` is null.

5. **Write the rotations.** Delete any existing `PlannedRotation` records for this game plan,
   then create new ones from the template's `rotations` array via `onUpdatePlannedRotations`.

6. **Show the unavailability banner.** If any players were flagged in step 1, render a dismissible
   warning banner at the top of the Plan tab listing the affected players and which rotation slots
   they appear in: "3 players from this template are not available for this game: [names]. Review
   and update the affected rotation slots."

### 5.4 Rename and Delete Templates

**Rename:** Inline edit — tap the template name in the template list to enter edit mode.
Confirm with Enter / blur; cancel with Escape.

**Delete:** "Delete template" destructive action in the template detail view (long-press / swipe
on mobile, or a "⋯" overflow menu on desktop). Confirmation prompt: "Delete '[name]'? This
cannot be undone." Deleting a template does not affect any game that previously loaded it.

---

## 6. File-by-File Change List

| File | Change type | Summary |
|------|-------------|---------|
| `amplify/data/resource.ts` | Modify | Add `TeamPlanTemplate` model; add `planTemplates` hasMany to `Team`. |
| `src/components/GameManagement/PlanTab.tsx` | Modify | Add "Save as template" and "Load template" buttons; wire modal / sheet components; display unavailability banner after template load. |
| `src/components/GameManagement/SaveTemplateModal.tsx` | **Create new** | Modal for naming and saving a template. Props: `gamePlan`, `plannedRotations`, `teamId`, `opponentName`, `gameDate`, `onSave`, `onClose`. |
| `src/components/GameManagement/LoadTemplateSheet.tsx` | **Create new** | Sheet/modal for listing, previewing, and selecting a template to load. Props: `teamId`, `players`, `positions`, `currentGamePlayerAvailability`, `onApply`, `onClose`. |
| `src/components/GameManagement/hooks/useTeamPlanTemplates.ts` | **Create new** | Hook: `observeQuery` on `TeamPlanTemplate` by `teamId`; exposes `templates`, `saveTemplate`, `renameTemplate`, `deleteTemplate`. |
| `src/components/GameManagement/hooks/useGamePlanner.ts` | Modify | Expose `applyTemplate(template: TeamPlanTemplate): Promise<void>` that orchestrates steps in §5.3. |
| `src/utils/planTemplateUtils.ts` | **Create new** | Pure helpers: `serializeGamePlanToTemplate`, `checkTemplatePlayerAvailability`, `templateToPlannedRotations`. |
| `src/components/GameManagement/GameManagement.tsx` | Modify | Pass `playerAvailability` records for the current game down to `PlanTab` (needed for unavailability check). |
| `src/App.css` | Modify | Styles for `.save-template-modal`, `.load-template-sheet`, `.template-list-item`, `.template-preview`, `.template-unavailability-banner`. |

---

## 7. Invariants and Contracts

### I1 — Templates are immutable snapshots

Loading a template creates a full in-memory copy; writes go through the existing game plan
mutation paths. After loading, the game plan is decoupled from the template — edits to the
game plan do not propagate back to the template, and edits to the template do not affect game
plans already derived from it.

### I2 — No new mutation paths for GamePlan / PlannedRotation

Applying a template reuses:
- `planner.updateRotationInterval`
- `planner.updateStartingLineup`
- `planner.updateHalftimeLineup`
- `onUpdatePlannedRotations` (passed from `GameManagement`)

No direct DynamoDB writes to `GamePlan` or `PlannedRotation` are introduced outside the
established mutation owners.

### I3 — Availability flags are advisory, not blocking

A template can be loaded and saved even if flagged players are absent. The coach decides how
to resolve unavailable player slots. The app never silently drops a player from the plan on
behalf of the coach.

### I4 — Template list is eventually consistent

`useTeamPlanTemplates` uses `observeQuery` (like all other list hooks in the app). Template
save / delete operations update local optimistic state immediately (via the same pattern used by
`useGamePlanner`) and reconcile on the next subscription event.

### I5 — Authorization follows existing coach pattern

`TeamPlanTemplate` uses `allow.ownersDefinedIn('coaches')`. The `coaches` array is populated at
creation time from the creating coach's user ID plus the existing `team.coaches` array — matching
the pattern used in `GamePlan` and `PlannedRotation`.

---

## 8. Test Strategy

### Unit Tests (`src/utils/planTemplateUtils.test.ts`)

| ID | Scenario | Expected |
|----|----------|---------|
| TU-1 | `serializeGamePlanToTemplate` with a full plan (starting lineup + halftime + 5 rotations) | Returns a `TemplateRotation[]` with correct `gameMinute`, `half`, and `plannedSubstitutions` per slot. |
| TU-2 | `checkTemplatePlayerAvailability` — all players available | Returns empty unavailable set. |
| TU-3 | `checkTemplatePlayerAvailability` — two players absent, one with no record | Returns set of three player IDs; each entry lists affected rotation slot numbers. |
| TU-4 | `templateToPlannedRotations` round-trip | Output array matches `PlannedRotation[]` shape expected by `onUpdatePlannedRotations`. |
| TU-5 | `serializeGamePlanToTemplate` with a partially filled plan (some positions unassigned) | Serialises only assigned positions; unassigned positions omitted from lineup arrays. |

### Component Tests

| ID | File | Scenario | Expected |
|----|------|----------|---------|
| TC-1 | `SaveTemplateModal.test.tsx` | Submit with valid name | `onSave` called with correct `TeamPlanTemplate` payload. |
| TC-2 | `SaveTemplateModal.test.tsx` | Submit with empty name | Validation error shown; `onSave` not called. |
| TC-3 | `SaveTemplateModal.test.tsx` | Submit with name > 60 chars | Truncated to 60 or error shown. |
| TC-4 | `LoadTemplateSheet.test.tsx` | Empty template list | Empty state message rendered. |
| TC-5 | `LoadTemplateSheet.test.tsx` | Load template with absent player | Unavailability indicator shown in preview; "Apply" still enabled. |
| TC-6 | `LoadTemplateSheet.test.tsx` | Confirm apply when plan exists | Confirmation prompt shown before `onApply` called. |
| TC-7 | `LoadTemplateSheet.test.tsx` | Confirm apply when no plan exists | `onApply` called without confirmation prompt. |

### Hook Tests (`src/components/GameManagement/hooks/useTeamPlanTemplates.test.ts`)

| ID | Scenario | Expected |
|----|----------|---------|
| TH-1 | `saveTemplate` success | Template appears in `templates` list; `savedAt` set. |
| TH-2 | `deleteTemplate` | Template removed from `templates` list. |
| TH-3 | `renameTemplate` with duplicate name | Rename succeeds (names are not unique). |

### Integration Tests (`src/components/GameManagement/hooks/useGamePlanner.test.ts`)

| ID | Scenario | Expected |
|----|----------|---------|
| TI-1 | `applyTemplate` with full template | `savePlan` and `onUpdatePlannedRotations` called with correct payloads; no extra DynamoDB writes. |
| TI-2 | `applyTemplate` when game is not `scheduled` | Throws / rejects; no mutations issued. |
| TI-3 | `applyTemplate` with rotation count mismatch (template has 3 rotations; target half length yields 5) | Applies 3 rotations from template; remaining 2 slots created empty; warning flag returned. |

### E2E (additive to `e2e/game-planner.spec.ts`)

| ID | Scenario | Expected |
|----|----------|---------|
| TE-1 | Coach saves a plan as a template, navigates to a second game, loads the template, verifies the plan is applied, and refreshes to confirm persistence. | Plan settings and lineup match the template; data survives full page reload. |
| TE-2 | Coach deletes a template; template no longer appears in the load list. | Template list is empty (or excludes deleted entry) after deletion and refresh. |

---

## 9. Out of Scope

- **Sharing templates between teams.** Templates are team-scoped; cross-team sharing is a future
  capability.
- **Formation-based position mapping.** If the team changes formation between save and load, this
  plan does not auto-remap positions. Coaches must manually fix mismatched slots.
- **Template versioning / history.** Overwriting a template replaces it entirely; no version
  history is maintained.
- **Import / export.** No CSV, JSON download, or URL-share mechanism in this iteration.
- **Auto-save template on game completion.** Coaches explicitly initiate saves; no automatic
  post-game capture.
- **Template ordering / pinning.** Sort order is always most-recently-saved first; no manual
  reorder.
