# Plan Tab Rotation Edit Restoration Plan (Finalized v3)

**Date:** 2026-05-01  
**Stage:** 1 — Final (incorporates architect v2 corrections + UI-designer findings + user-confirmed decisions)  
**Owner:** implementation-planner  
**Supersedes:** PLAN-TAB-ROTATION-EDIT-RESTORATION-PLAN.md (v2)

---

## Scope

This plan finalizes the Plan tab restoration work by incorporating:

1. All architect corrections from v2 (retained unchanged unless superseded below).
2. UI-designer findings from the parallel Stage 3 review.
3. Three user-confirmed decisions that change interaction semantics from v2.

---

## User-Confirmed Decisions (Normative Override of v2)

### Decision 1 — Immediate save on each change

**v2 position:** Explicit submit (Apply) per rotation edit session.  
**Confirmed:** Immediate save on each field change.  

Consequences:
- The `editingRotationNumber` / `handleStartRotationEdit` / Apply/Cancel flow is **eliminated**.
- Position assignment changes in any timeline state (Start, HT, or any Rotation slot) save immediately to the backend.
- The rotation "editor" is always-on in scheduled mode — there is no "enter edit mode" step.
- Cascade is computed and applied immediately when a position assignment changes in a rotation slot.
- The cascade preview panel (informational) may remain as a read-only inline indicator **after** save, but it does not gate the write.
- Saving in-flight state (a second change while first write is still in flight) must be queued or debounced to prevent concurrent writes. A 300 ms debounce on the individual position assignment is acceptable; writes must still be serialized.
- Dirty indicators on timeline pills show local overrides pending server confirmation.
- A per-rotation "Reset to original" action is retained (reverts to last server snapshot for that rotation only, no global cancel).

### Decision 2 — HT details use same visual lineup field view

**v2 position:** `HalftimeLineupEditor` component with dropdown-first UX ("Starting: X" label + select for halftime player).  
**Confirmed:** Replace with the same visual lineup field view used by Start and Rotation states; remove the split dropdown-first UX.

Consequences:
- `HalftimeLineupEditor` is deleted and not replaced with another dropdown component.
- HT details panel renders:
  1. **Visual lineup field** (shape or list) showing the halftime projected lineup (editable in scheduled, read-only otherwise).
  2. **Summary context strip** — compact, below or alongside the field — listing which players changed from the starting lineup to the HT lineup (diff summary). Read-only in all states.
- The visual field uses a new `PlannerLineupView` component (see New Component below).
- Interactions (tap a position to change assignment) trigger immediate save via `handleHalftimeLineupChange`.

### Decision 3 — Post-HT labels: continuous numbering

**v2 position:** Timeline labels used `R${rotation.rotationNumber}` directly.  
**Confirmed:** Continuous numbering: Start, R1, R2, HT, R3, R4, … (rotations after HT continue the numeric sequence, not reset to R1).

Consequences:
- `buildRotationTimelineItems` must be updated to compute a monotonically increasing visual display index per non-halftime rotation in timeline order.
- The stored `PlannedRotation.rotationNumber` is globally sequential (confirmed: `rotationsPerHalf + 1` for HT sentinel, `rotationsPerHalf + 1 + index` for second-half rows). The visual label must still skip the halftime slot's number so that display sequence reads R1, R2, HT, R3, R4 without a gap.
- Implementation: track a `displayIndex` counter (increments only for non-halftime items) in `buildRotationTimelineItems`; use `R${displayIndex}` as `label`.
- The `RotationTimelineItem` interface gains an optional `displayIndex?: number` field for callers that need it.
- Cascade preview, rotation details heading, and plan conflict descriptions must all use the display label, not the raw `rotationNumber`.

---

## Explicit Render Order for Plan Tab (Normative)

The following is the authoritative top-to-bottom render order for `PlanTab`. All prior partial orderings in v2 are superseded by this list:

1. **Read-only banner** — rendered when `readOnly === true`.
2. **Rotation settings card** — rendered when `isScheduled && !readOnly`. Contains: half-length input, rotation interval input, derived rotations-per-half display, Reset to team default link. No "Save Settings" explicit button (settings save immediately on committed change per v2 normative §2).
3. **Generate Rotations button** — adjacent to or below settings card, `isScheduled && !readOnly`.
4. **Plan conflict banner** — rendered when `gamePlan && planConflicts.length > 0`.
5. **Remote conflict / error banners** — rendered when pending conflict or error state.
6. **Timeline pills** (`role="tablist"`) — rendered when `timelineItems.length > 0`. Horizontal scroll strip. Dirty indicator dot on pills with pending local overrides.
7. **Timeline details panel** (`role="tabpanel"`) — one of:
   - **Start state:** `PlannerLineupView` showing `planner.draft.startingLineup` (interactive in scheduled, read-only otherwise).
   - **HT state:** `PlannerLineupView` showing `effectiveHalftimeLineup` + HT summary context strip (interactive in scheduled, read-only otherwise).
   - **Rotation N state:** `PlannerLineupView` showing projected lineup for that rotation + per-rotation "Reset to original" action (interactive in scheduled, read-only otherwise). Cascade indicator strip (which other rotation slots are also affected) shown inline after save.
8. **Player availability grid** — rendered when `!readOnly`.
9. **Projected play time** — rendered always when data is available. True bottom of Plan tab, below availability grid.

---

## New Component: `PlannerLineupView`

A new component `src/components/GameManagement/PlannerLineupView.tsx` handles the visual lineup field for all Plan tab timeline states without routing through live `LineupAssignment` mutations.

### Props

```typescript
interface PlannerLineupViewProps {
  /** Planner lineup: positionId → playerId (empty string or missing = unassigned) */
  displayLineup: Map<string, string>;
  positions: FormationPosition[];
  players: PlayerWithRoster[];
  /** Called when a position assignment changes. playerId === '' means unassigned/cleared. */
  onPositionAssign?: (positionId: string, playerId: string) => void;
  /** True = no interaction, visual only. */
  isReadOnly: boolean;
  /** Optional: human-readable label for ARIA (e.g. "Starting lineup", "Halftime lineup", "After R3"). */
  label?: string;
  viewMode?: "list" | "shape";
  onViewModeChange?: (mode: "list" | "shape") => void;
  /** For shape view: game/team context needed by SoccerPitchSurface. */
  game?: Game;
  team?: Team;
}
```

### Internal design

- Converts `displayLineup: Map<string, string>` into synthetic `LineupAssignment[]` (with stable synthetic `id = \`plan-${positionId}\``, `isStarter: true`, `playerId` from map; unassigned positions are omitted or included with `playerId: ''`).
- In **shape view**: uses `LineupShapeView` with custom `onQuickReplace` and `onClearSlot` props that call `onPositionAssign(positionId, newPlayerId)` instead of live mutations. The `mutations` object used by `LineupShapeView` is a null-safe stub (`onQuickReplace` and `onClearSlot` are owned by the parent via props already, so no stubs needed at that level; the stub exists at `PlannerLineupView` boundary to prevent any `mutations.*` call from reaching DynamoDB).
- In **list view**: renders a simple position-player grid with a player select per position (already the approach of `HalftimeLineupEditor` but shared across all three states).
- `onPositionAssign` is the single callback for all assignment changes — called immediately on any user interaction.
- `isReadOnly={true}` disables all interactions and hides the player select / quick-replace affordances.

### Rationale for new component vs modifying `LineupPanel`

`LineupPanel` is tightly coupled to `LineupAssignment` records and `GameMutationInput`. Modifying it to accept a planner-mode data model would require adding a discriminated union or optional prop bags, increasing its surface area significantly. A thin `PlannerLineupView` wrapper is lower risk and more targeted.

---

## HT Summary Context Strip

Rendered below the `PlannerLineupView` in the HT timeline state.

- Shows a compact list: "Position → Changed: [StartingPlayerName] → [HTPlayerName]" for each position where the HT lineup differs from the starting lineup.
- If there are no changes: "Same as starting lineup."
- Read-only in all game states (never interactive).
- Component: inline in `PlanTab` or small sub-component (`HtSummaryStrip`), not a standalone file.

---

## Cascade Indicator Strip (Rotation states)

Rendered below the `PlannerLineupView` in rotation timeline states, after an immediate save completes.

- Shows: "This change also updated: R3, R5" (using display labels).
- Clears automatically after 4 seconds or on next user interaction.
- Does NOT require user acknowledgment or gate any action.
- Implemented as a transient state variable in `PlanTab` (`cascadeAffectedLabels: string[] | null`), set after successful `onUpdatePlannedRotations`, cleared by effect or timer.

---

## Dirty Indicator on Timeline Pills

- Each pill that has a local override entry in `localRotationOverrides` (key present) renders a visual dirty indicator (a small dot or asterisk appended to or overlaid on the pill label).
- The indicator clears when the subscription confirms the server state matches the local override (existing reconcile logic in `PlanTab`).
- ARIA: the pill's `aria-label` includes "(pending save)" when dirty.
- CSS class: `planner-timeline-pill--dirty` added alongside existing `--active` and `--halftime` classes.

---

## Immediate Save Implementation for Rotation Slots

### Interaction flow (replaces Apply/Cancel)

1. User taps a position in `PlannerLineupView` for a rotation state.
2. `PlannerLineupView.onPositionAssign(positionId, playerId)` fires.
3. `PlanTab.handleRotationPositionChange(positionId, playerId)` runs:
   - Computes the new substitutions diff between `selectedRotationBeforeLineup` and the updated rotation lineup.
   - Calls `applyRotationEditWithSameHalfCascade` (with `halftimeLineup` boundary arg for H2 targets — Phase 3 of v2).
   - Immediately updates `localRotationOverrides` with the resulting affected rotations.
   - Triggers debounced `persistRotationChange()` (300 ms).
4. `persistRotationChange()` calls `onUpdatePlannedRotations({ expectedFingerprint, plannedRotations: cascadeResult.rotations })`.
5. On success: conflict/error state clears; `cascadeAffectedLabels` is set from `cascadeResult.changedRotationNumbers` (converted to display labels); local overrides remain until subscription confirms.
6. On conflict: non-blocking conflict banner shown; local overrides for those keys are cleared.
7. On error: error banner shown; local overrides for those keys are cleared (no silent data loss — coach sees error and can retry by re-assigning).

### Debounce handling

- A `useRef<ReturnType<typeof setTimeout> | null>(null)` (`rotationSaveTimerRef`) tracks the pending debounce per individual position change.
- Each new `handleRotationPositionChange` call clears the previous timer and sets a new one.
- If the user tabs away (timeline pill change) while a debounce is pending, the pending change is flushed immediately (not discarded).

---

## Phase-by-Phase Changes (v3, authoritative)

### Phase 0: Continuous label generation in `gamePlannerTimeline.ts`

**New** (not in v2).

- Update `buildRotationTimelineItems` to track `displayIndex` (increments for each non-halftime rotation in timeline order, 1-indexed).
- Change label from `R${rotation.rotationNumber}` to `R${displayIndex}`.
- Add `displayIndex?: number` to `RotationTimelineItem` interface.
- Cascade preview and all rotation-related heading text in `PlanTab` must read display label from `selectedTimelineItem.displayIndex` (not raw `rotationNumber`).

### Phase 1: `useGamePlanner` hook (retained from v2, no changes)

- Add `updateStartingLineup(lineup: Map<string, string>): Promise<void>` with `assertScheduledStatus` guard.
- Update `UseGamePlannerResult` interface.
- Add code comment documenting `savePlan` as GamePlan-only (no `PlannedRotation` writes).

### Phase 2: New `PlannerLineupView` component

**New** (replaces v2 Phase 2 "shared lineup view mutation routing").

- Create `src/components/GameManagement/PlannerLineupView.tsx`.
- Shape view: delegate to `LineupShapeView` with custom `onQuickReplace` / `onClearSlot` routing to `onPositionAssign`.
- List view: position grid with player select per row, calling `onPositionAssign` on change.
- Disabled (read-only) mode: no selects, no quick-replace affordances.
- `isReadOnly` prop gates all interactions.
- Delete `HalftimeLineupEditor` component from `PlanTab.tsx` entirely.

### Phase 3: `PlanTab.tsx` timeline detail panels (replaces v2 Phase 2 detail rendering)

**Updated** from v2 to reflect immediate-save and visual field view for all states.

1. **Start state panel:**
   - Remove placeholder text ("Set starters in the lineup panel below…").
   - Render `PlannerLineupView` with `displayLineup={planner.draft.startingLineup}`.
   - `onPositionAssign` → `handleStartingLineupChange` → `planner.updateStartingLineup` → `planner.savePlan`.
   - `isReadOnly={!isScheduled || readOnly}`.

2. **HT state panel:**
   - Remove `HalftimeLineupEditor`.
   - Render `PlannerLineupView` with `displayLineup={effectiveHalftimeLineup}`.
   - `onPositionAssign` → `handleHalftimeLineupChange` → `planner.updateHalftimeLineup` → `planner.savePlan`.
   - `isReadOnly={!isScheduled || readOnly}`.
   - Render `HtSummaryStrip` below the field (comparing `planner.draft.startingLineup` vs `effectiveHalftimeLineup`).

3. **Rotation N state panel:**
   - Remove `editingRotationNumber` state, `handleStartRotationEdit`, `handleCancelRotationEdit`, `handleApplyRotationEdit`, and the Apply/Cancel UI.
   - Remove the dropdown-per-position rotation editor.
   - Render `PlannerLineupView` with `displayLineup={selectedRotationCurrentLineup}` (converted from Map).
   - `onPositionAssign` → `handleRotationPositionChange` (debounced immediate save, see above).
   - `isReadOnly={!isScheduled || readOnly}`.
   - Render cascade indicator strip (`cascadeAffectedLabels`) below the field (transient, post-save).
   - Keep per-rotation "Reset to original" button (calls `handleResetRotation(selectedRotationNumber)`).
   - Remove "Edit Rotation" button (always-on editing in scheduled mode).

4. **Live action prop wiring** for `PlannerLineupView`:
   - Pass `game` and `team` for shape-view context.
   - Pass `viewMode` and `onViewModeChange` props (shared across all three states so the mode persists across pill selection).

5. **Remove the live-mutation `LineupPanel` at the bottom of `PlanTab`:**
   - The existing `<LineupPanel … mutations={mutations} …>` at the very bottom of `PlanTab.tsx` must be removed.
   - Its availability display role is fully covered by `PlayerAvailabilityGrid` (already present) and `PlannerLineupView` above.

6. **Render order in JSX** updated to match the explicit render order above (settings → generate → conflicts → timeline pills → timeline panel → availability grid → projected play time).

### Phase 4: Halftime boundary seed (retained from v2 Phase 3)

- Update `applyRotationEditWithSameHalfCascade` in `gamePlannerUtils.ts` with optional `halftimeLineup?: Map<string, string>` parameter.
- Second-half cascade seeds from `halftimeLineup` when provided, ignoring first-half rows.
- All callers in `PlanTab.tsx` updated to pass `planner.draft.halftimeLineup` as 5th arg.

### Phase 5: Halftime sentinel injection (retained from v2 Phase 4)

- Inject synthetic halftime sentinel into `effectivePlannedRotations` when absent from server.
- Add `planner.computeHalftimeRotation` to `effectivePlannedRotations` memo deps.

### Phase 6: Second-half projected lineup seeding (retained from v2 Phase 3, updated caller)

- `selectedRotationCurrentLineup` and `selectedRotationBeforeLineup` memos:
  - For second-half selections (`selectedTimelineItem.rotation.half === 2`): compute from `effectiveHalftimeLineup` seed + second-half-only rotation rows.
  - For first-half selections: compute from `planner.draft.startingLineup` (unchanged).
- The `Map` outputs from these memos are passed directly to `PlannerLineupView` as `displayLineup`.

### Phase 7: Dirty pill indicators

**New** (not in v2).

- Add `planner-timeline-pill--dirty` CSS class to pills whose key exists in `localRotationOverrides`.
- HT pill gets dirty indicator when the effective HT lineup is locally overridden (track via a `localHtOverride` flag alongside `localRotationOverrides`).
- Start pill gets dirty indicator when `planner.isDirty && planner.dirtyKeys.has('startingLineup')`.
- ARIA: `aria-label` for dirty pills appends " (saving…)" text.

### Phase 8: State model, accessibility, responsive (retained from v2 Phase 7)

All v2 Phase 7 normative content remains in effect, with these updates:
- Remove `edit-in-progress` state (eliminated by immediate-save semantics).
- `save-pending` now means "immediate save write is in flight" (spinner or pill indicator only, no modal lock).
- `success` state after immediate save: cascade indicator strip appears (transient), no modal confirmation.
- The `Apply/Cancel` keyboard contract is removed; `Escape` in a rotation panel now focuses the timeline pill for that rotation (since there is no Cancel).

---

## `GameManagement.tsx` Changes (v3)

1. Add inline comment to `onUpdatePlannedRotations` documenting it as the sole `PlannedRotation` write path.
2. No structural changes required; single-writer contract already implemented.
3. `handleStartingLineupChange` callback: add to `GameManagement.tsx` if it is needed as a parent-owned pass-through to `useGamePlanner.updateStartingLineup`. If `PlanTab` invokes the hook directly (current pattern), no parent change needed — confirm by code path review.

---

## File-by-File Change List (v3)

| File | Change type | Summary |
|---|---|---|
| `src/utils/gamePlannerTimeline.ts` | Modify | Add `displayIndex` to `RotationTimelineItem`; update `buildRotationTimelineItems` to compute continuous display labels R1, R2, HT, R3, R4 (skip HT slot in counter). |
| `src/components/GameManagement/PlannerLineupView.tsx` | **Create new** | Visual lineup field for Plan tab. Takes `displayLineup: Map`, `onPositionAssign`, `isReadOnly`. Shape mode via `LineupShapeView`; list mode via position grid. No live mutations. |
| `src/components/GameManagement/PlanTab.tsx` | Modify (significant) | Replace `HalftimeLineupEditor` + dropdown rotation editor + Apply/Cancel flow with `PlannerLineupView` for all three timeline states. Add `handleRotationPositionChange` (debounced immediate save). Add `cascadeAffectedLabels` state. Add `HtSummaryStrip` inline. Remove bottom `<LineupPanel>`. Enforce render order. Add dirty pill indicator logic. Update second-half projection seeding. Inject HT sentinel per v2 Phase 4. |
| `src/components/GameManagement/hooks/useGamePlanner.ts` | Modify | Add `updateStartingLineup` method; add code comment on `savePlan` boundary; update `UseGamePlannerResult` interface. |
| `src/components/GameManagement/GameManagement.tsx` | Minor modify | Add `onUpdatePlannedRotations` comment. Confirm no structural changes needed. |
| `src/utils/gamePlannerUtils.ts` | Modify | Add optional `halftimeLineup` param to `applyRotationEditWithSameHalfCascade` (v2 Phase 3). |
| `src/utils/gamePlannerTimeline.ts` | Modify | (Also Phase 0 above) Update `buildRotationTimelineItems` for continuous display labels. |
| `src/components/GameManagement/PlannerLineupView.test.tsx` | **Create new** | `onPositionAssign` called on shape/list interaction; no `LineupAssignment` mutation methods called; read-only disables all interactions; shape→planner map conversion correctness. |
| `src/components/GameManagement/PlanTab.test.tsx` | Modify (significant) | Replace Apply/Cancel tests with immediate-save tests; add dirty pill indicator tests; add HT summary strip tests; add cascade indicator strip tests; add render order snapshot; retain all other v2 test requirements. |
| `src/components/GameManagement/hooks/useGamePlanner.test.ts` | Modify | Add `updateStartingLineup` dirty state + fingerprint tests; add `savePlan` no-PlannedRotation-writes assertion (v2 Phase 1). |
| `src/utils/gamePlannerUtils.test.ts` | Modify | Add halftime boundary seed tests (v2 Phase 3). |
| `src/utils/gamePlannerTimeline.test.ts` | Modify or create | Add continuous label tests: 2-rotation/half → labels R1, R2, HT, R3, R4; 1-rotation/half → R1, HT, R2; 0-rotations/half → Start, HT. |
| `e2e/game-planner.spec.ts` | Modify | Replace Apply/Cancel e2e flows with immediate-save flows; add dirty pill indicator assertion; add HT field view assertion; add continuous numbering assertion. |

---

## Data Model / API Impact

- No schema changes in `amplify/data/resource.ts`.
- No new GraphQL model or mutation.
- `RotationTimelineItem` interface gains optional `displayIndex?: number` field (frontend only).
- `PlannerLineupView` has no backend contract; it's a pure frontend view component.

---

## Dependencies and Sequencing (v3)

1. **Phase 0** (`gamePlannerTimeline.ts` continuous labels) — independent, do first to unblock label-dependent tests.
2. **Phase 1** (`updateStartingLineup` in `useGamePlanner`) — independent.
3. **Phase 4** (`applyRotationEditWithSameHalfCascade` halftime param) — pure utility, independent.
4. **Phase 2** (new `PlannerLineupView` component) — depends on phases 0, 4.
5. **Phase 5** (halftime sentinel injection) — depends on `useGamePlanner` changes (Phase 1).
6. **Phase 6** (second-half projection seeding caller updates) — depends on Phase 4.
7. **Phase 3** (`PlanTab` refactor) — depends on phases 1, 2, 5, 6.
8. **Phase 7** (dirty pill indicators) — depends on Phase 3.
9. **Phase 8** (state model, accessibility, responsive) — depends on Phase 3.
10. All tests — depend on respective implementation phases.
11. `npm run gate:commit`.

---

## Risks and Mitigations (v3)

| Risk | Mitigation |
|---|---|
| Immediate save causes excessive write churn on fast input (position dragging) | 300 ms debounce; serialize pending writes; skip write if value unchanged from last sent payload |
| Second change arrives while first write is in flight (race) | `mutationInFlightRef` guard in `useGamePlanner`; debounce serializes at source; conflict return path clears local override |
| `LineupShapeView` internal path calls `mutations.*` despite custom `onQuickReplace`/`onClearSlot` | `PlannerLineupView` passes a no-op stub `mutations` object; add test asserting no `createLineupAssignment`/`deleteLineupAssignment` is called |
| Continuous label counter breaks if rotation rows are missing or sparse | `buildRotationTimelineItems` increments counter only for items actually pushed (guards malformed input); add unit test for sparse rotation sets |
| Cascade indicator strip displays wrong display labels (uses raw `rotationNumber`) | Cascade indicator reads `displayIndex` from the updated `RotationTimelineItem` set built after save; explicit test |
| HT summary strip is confusing when starting lineup is empty | If starting lineup has no assignments: render "Starting lineup not set." in summary strip instead of empty diff list |
| Removing bottom `LineupPanel` breaks some existing behavior | Verify that `PlayerAvailabilityGrid` already shows the bench/available players independently; confirm no feature regression in e2e |
| `PlannerLineupView` in shape mode requires `Game` and `Team` props that are not always available | `Game` and `Team` are already threaded through `PlanTab` as props; pass them through |
| Escape key no longer cancels (no Cancel exists) | Update keyboard contract: Escape in rotation panel focuses the selected timeline pill (back to navigation); tested explicitly |

---

## Edge Cases Required in Test Coverage (v3)

All v2 edge cases remain in scope. Additional v3-specific edge cases:

- Immediate save fires when user changes same position twice quickly (debounce absorbs second; only one write fires with final value).
- Dirty indicator appears immediately after local override is set; clears after server confirms.
- HT summary strip shows "Same as starting lineup" when no diff exists.
- HT summary strip renders correctly when starting lineup is partially unassigned.
- Continuous label sequence: 0 rotations per half → Start, HT only (no R labels); 1 per half → Start, R1, HT, R2; 3 per half → Start, R1, R2, R3, HT, R4, R5, R6.
- Reset to original reverts only the selected rotation; other rotations and their overrides are unaffected.
- Cascade indicator strip auto-clears after 4 seconds.
- `PlannerLineupView` in shape mode: tapping an occupied position opens quick-replace (planner path only); tapping an empty position opens player select (planner path only).
- `PlannerLineupView` in read-only mode: no interactive affordances rendered; verified by accessibility test.
- Second-half rotation projected lineup: seeded from halftime lineup even when HT lineup differs from cascaded starting-lineup-through-rotations.
- Live game states (in-progress, halftime, completed): all `PlannerLineupView` instances are `isReadOnly={true}`; no `onPositionAssign` calls fire.
- Flush pending debounce on timeline pill navigation (dirty change not silently lost).

---

## Test Strategy (v3)

**Unit:**
- `gamePlannerTimeline`: continuous label counter, gap handling, sparse input.
- `gamePlannerUtils`: halftime boundary seed (H2 cascade from halftime, not starting).
- `rotationDiffUtils`: fingerprint stability.

**Component:**
- `PlannerLineupView`: data model conversion, interaction routing, read-only gating, no live mutation calls.
- `PlanTab`: immediate-save flow (no Apply/Cancel), dirty indicators, render order, HT summary strip, cascade indicator, scheduled vs live gating, keyboard/focus contracts, accessible timeline semantics, second-half projection seeding.
- `useGamePlanner`: `updateStartingLineup`, `savePlan` PlannedRotation no-write assertion, fingerprint tracking.

**Integration:**
- `GameManagement`: single-owner mutation routing, precondition conflict handling.

**E2E:**
- Immediate-save rotation assignment: change a player, confirm change persists after refresh.
- Continuous labels: R1, R2, HT, R3, R4 visible on timeline for 2-rotations-per-half game.
- HT field view: visual lineup field (not dropdowns) shown in HT panel.
- Start field view: visual lineup field (not placeholder text) shown in Start panel.
- Dirty indicator appears after change; disappears after server confirmation.
- Keyboard-only traversal of timeline with immediate-save interaction.
- Live game read-only assertions.
- Mobile viewport flow.

**Gate:** `npm run gate:commit`

---

## Assumptions (v3)

1. `LineupShapeView` can accept custom `onQuickReplace` and `onClearSlot` props without structural changes to its component signature (confirmed by reading its current prop interface).
2. A 300 ms debounce is acceptable for immediate-save UX on position assignment changes.
3. Cascade indicator strip can be transient (auto-dismiss in 4 s) without requiring a persistent history log.
4. `PlannerLineupView` list mode can use a simple `<select>` per position (matching the removed `HalftimeLineupEditor` visual quality). Shape mode reuses `LineupShapeView`.
5. `computeHalftimeRotation()` returning `null` means halftime lineup equals starting lineup; no sentinel injection needed (v2 assumption retained).
6. `planner.dirtyKeys` is an accessible property on the `UseGamePlannerResult` interface (if not, expose it in Phase 1 alongside `updateStartingLineup`).
7. Display-index counter in `buildRotationTimelineItems` is computed from the already-sorted `rotations` array (sorted by `rotationNumber`); halftime sentinel is already correctly positioned before second-half rows in sorted order.

---

## Out of Scope (v3)

- New backend conditional-write API.
- Multi-user merge UI for conflict diff visualization.
- Broad redesign of other Game Management tabs.
- Changes to `computeLineupAtRotation` function signature.
- Undo/redo stack for position assignment changes.
- Bulk reset-all-rotations action.
