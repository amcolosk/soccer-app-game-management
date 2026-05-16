# Plan Tab Rotation Editing Restoration Plan (Revised v2)

Date: 2026-05-01
Stage: 1 (implementation-planner re-run, architect correction pass)
Owner: implementation-planner

## Stage-1 Revision Scope (Architect Correction Pass v2)

This revision incorporates four required changes from the architect review, plus one factual correction to the prior plan document:

1. Add `updateStartingLineup(lineup: Map<string,string>)` to `useGamePlanner` result and dirty-state flow.
2. Explicitly resolve shared lineup view mutation routing — Plan tab must never call live `LineupAssignment` mutations when the coach edits the lineup within a planner timeline state.
3. Inject halftime lineup as boundary seed when applying same-half cascade to second-half rotations.
4. Ensure halftime sentinel is included in effective local rotations used for projected play time when the sentinel exists only in the local draft (not yet persisted as a PlannedRotation row).
5. Correct the inaccurate prior-plan claim that `savePlan` writes PlannedRotation rows — code inspection confirms it writes GamePlan only.

All prior architect constraints (single writer ownership, fingerprint preconditions, timeline utility reuse, halftime cascade boundaries, local-effective projection with reconcile) remain in effect and are carried forward unchanged.

## Objective

Restore editable per-rotation planning in Plan tab without introducing write clobbering, race regressions, or identity drift. Keep scope practical for a defect fix while aligning to existing architecture and utility contracts.

## Explicit UX Requirements (2026-05-01 Request)

1. Restore pre-merge walkthrough behavior in merged planner:
- Coach can set starting formation and halftime formation.
- Coach can step timeline pills and inspect the same lineup surface for each state.

2. Required layout and interaction updates:
- Move projected play time section to the bottom of Plan tab.
- In Starting Formation, render the same lineup view currently shown lower on the page.
- Clicking timeline pills (`R1`, `R2`, `HT`, `R3`, `R4`, etc.) updates that same lineup view to the selected timeline state.
- Coach can update lineup assignments at each timeline state (not just via separate rotation select list).

3. Regression symptoms to eliminate:
- Timeline appears truncated in practical use (only initial + limited rotations visible in current flow perception).
- Assignment updates are unreliable due to split editing surfaces and non-shared state.
- Projected play time can diverge from what coach sees in timeline walkthrough.

## Architect Corrections Incorporated

1. Single canonical ownership for PlannedRotation writes.
- PlannedRotation create/update/delete must be owned by one mutation boundary in `GameManagement`.
- `useGamePlanner.savePlan` must stop writing PlannedRotation rows; it should persist GamePlan fields only.
- Plan-tab rotation edit and Save Settings flows both call parent-owned mutation APIs to avoid concurrent clobber.

2. Concurrency-safe precondition contract using fingerprints.
- All mutating planner actions carry `expectedFingerprint` from the latest subscribed plan snapshot.
- Parent compares against current server-derived fingerprint before write.
- On mismatch: do not write, return structured conflict result, trigger UI reconcile path.

3. Reuse existing timeline identity/reconciliation utilities.
- Plan tab timeline must use `buildRotationTimelineItems` and `reconcileSelectionKey` from `gamePlannerTimeline`.
- Canonical key generation remains in `plannerKeyUtils`; avoid creating a parallel key scheme in Plan tab.

4. Explicit halftime cascade boundaries.
- Editing a first-half rotation cascades only through first-half rotations up to (not including) halftime sentinel.
- Editing a second-half rotation cascades only through second-half rotations.
- Halftime lineup remains a boundary state and does not get implicitly rewritten by rotation cascade.

5. Immediate local projection update with eventual server reconcile.
- Projected play time must update from local effective rotations immediately after edit commit intent.
- Subscription refresh then reconciles and clears/keeps local overrides based on equality or conflict outcome.

6. Explicit race/no-clobber tests added.
- Add tests for Save Settings + rotation edit no-clobber behavior.
- Add tests for subscription refresh races while local overrides are pending.

## Current-State Summary (Corrected)

- `PlanTab` currently builds timeline keys directly and displays rotation substitutions read-only.
- **CORRECTION (v2):** `useGamePlanner.savePlan` writes `GamePlan` fields only (`startingLineup`, `halftimeLineup`, `rotationIntervalMinutes`). It does NOT write `PlannedRotation` rows. The prior plan's statement that "savePlan writes both GamePlan and PlannedRotation (halftime sentinel diff path)" was incorrect. The single-writer contract for PlannedRotation is already enforced in `GameManagement` via `onUpdatePlannedRotations`. Phase 1's "remove PlannedRotation writes from savePlan" sub-item is therefore a no-op and is removed from scope.
- `useGamePlanner` exposes `updateHalftimeLineup` but has **no `updateStartingLineup`** method. Draft `startingLineup` only changes via initial hydration or subscription-triggered rehydration, never from a direct user edit in the Plan tab timeline.
- `PlanTab` renders a `LineupPanel` at the bottom of the page with live `mutations` passed through. This is the live-game mutation surface and must NOT be called when editing the starting or halftime lineup in the Plan tab timeline view.
- `applyRotationEditWithSameHalfCascade` seeds `runningLineup` from `startingLineup` and accumulates through all rotations before the target. For second-half rotations, this ignores the coach-set `halftimeLineup` which is the authoritative boundary state. If the halftime lineup differs from what pure rotation cascade would produce, second-half projections are wrong.
- `effectivePlannedRotations` is built by merging `plannedRotations` (server) with `localRotationOverrides`. The computed halftime sentinel from `planner.computeHalftimeRotation()` (derived from `draft.halftimeLineup`) is never injected into this set when no server PlannedRotation row exists for the halftime slot. Projected play time therefore ignores halftime substitutions until the plan is fully persisted.
- `rotationDiffUtils` and planner fingerprints exist and can be reused for precondition checks.
- `gamePlannerTimeline` and `plannerKeyUtils` exist and should be the single timeline identity path.

## Revised Implementation Plan (v2)

### Phase 1: Planner hook and write-ownership corrections

1. Add `updateStartingLineup` to `useGamePlanner`.
   - New method `updateStartingLineup(lineup: Map<string, string>): Promise<void>`.
   - Guards: `assertScheduledStatus()`, `mutationInFlightRef` check.
   - Updates `draft.startingLineup` to `new Map(lineup)`.
   - Marks `startingLineup` key dirty in `dirtyKeys`.
   - Added to `UseGamePlannerResult` interface and hook return value.
   - Note: `localFingerprint` already recomputes from `draft.startingLineup`, so fingerprint tracking is automatically correct after this change.

2. Verify and document the single-writer invariant for PlannedRotation.
   - `savePlan` already writes GamePlan fields only — confirmed by code inspection. No code change required.
   - Add a code comment in `savePlan` and in `GameManagement`'s `onUpdatePlannedRotations` explicitly documenting the boundary to prevent future drift.
   - Add test to `useGamePlanner.test.ts` asserting that `savePlan` does not call any `PlannedRotation.create/update/delete` model methods.

3. Canonical parent mutation API in `GameManagement` (existing, verify completeness).
   - `savePlannerSettings(input)` for GamePlan settings only — confirm no PlannedRotation write.
   - `updatePlannedRotations(input)` for rotation assignment edits only — already owns PlannedRotation writes.
   - Both accept `expectedFingerprint` and return `{ status: 'ok' | 'conflict', serverFingerprint, conflictReason }`.
   - No structural change needed; only the documentation/test gap above.

### Phase 2: Plan tab timeline, lineup view, and mutation routing

1. Replace ad hoc timeline keying with utility-backed timeline items.
   - Build items with `buildRotationTimelineItems`.
   - Maintain selection stability with `reconcileSelectionKey`.

2. Resolve shared lineup view mutation routing (new in v2).
   - The Plan tab must display the same `LineupPanel` component for every timeline state (Start, R1, R2, HT, R3, R4, …).
   - The `LineupPanel` already exists at the bottom of `PlanTab`; it must be repositioned to be the central lineup display responsive to `selectedKey`.
   - Mutation routing by timeline state:

     | Selected state | LineupPanel data source | On-edit mutation target |
     |---|---|---|
     | `starting` | `planner.draft.startingLineup` converted to `LineupAssignment[]` | `planner.updateStartingLineup` → `planner.savePlan` |
     | `halftime` | `effectiveHalftimeLineup` converted to `LineupAssignment[]` | `handleHalftimeLineupChange` → `planner.updateHalftimeLineup` → `planner.savePlan` |
     | `rotation-N` (scheduled) | Computed projected lineup for that rotation | Rotation edit flow (`handleStartRotationEdit` → `handleApplyRotationEdit` → `onUpdatePlannedRotations`) |
     | Any state (live/halftime/completed, `readOnly`) | Same computed sources above | All edits disabled |

   - Live `LineupAssignment` mutations (`mutations.createLineupAssignment`, `mutations.deleteLineupAssignment`) must NEVER be called from any Plan tab lineup interaction. The existing `LineupPanel` at the bottom of PlanTab that passes live `mutations` must be removed or wrapped to prevent these calls.
   - `LineupPanel` receives an `isReadOnly` flag when in Plan tab for rotation states (edits route through rotation edit flow, not through inline lineup changes).
   - For `starting` and `halftime` states in scheduled mode: pass a custom `onSubstitute` shim that opens a player-selector routed to the planner draft rather than the live substitution panel.

3. Introduce explicit per-rotation editing interaction model for scheduled mode (unchanged from prior plan).
   - Entry: user selects a rotation timeline item and chooses Edit Rotation.
   - While in edit mode, timeline remains visible and selectable for inspection.
   - Switching selection while dirty prompts discard or continue.
   - Edit controls: position-level substitution selectors for the active rotation.
   - Reset Rotation reverts to last committed server/effective snapshot for only that rotation.
   - Cascade Preview shows affected downstream same-half rotations before apply.
   - Apply commits the selected rotation plus deterministic same-half cascade via `onUpdatePlannedRotations` with `expectedFingerprint`.
   - Cancel exits edit mode without changing effective data.
   - Escape key triggers Cancel path with focus returned to Edit Rotation trigger.
   - Preview is computed from current editor values using boundary-aware utility; apply uses exact previewed payload.
  - Plan tab enters single-rotation edit mode with that rotation as active editor target.
  - While in edit mode, timeline remains visible and selectable for inspection, but switching selection prompts to discard current edits or continue editing current rotation.
- Edit controls:
  - Position-level substitution selectors (player-out/player-in) for the active rotation.
  - Reset Rotation action reverts active editor values to last committed server/effective snapshot for only the selected rotation.
  - Cascade Preview panel shows affected downstream same-half rotations before apply.
- Apply/Cancel behavior:
  - Apply commits the selected rotation plus deterministic same-half cascade to parent mutation API using expectedFingerprint.
  - Cancel exits edit mode and restores view mode without changing effective data.
  - Escape key triggers Cancel path with focus returned to Edit Rotation trigger.
- Cascade preview behavior:
  - Preview is computed locally from current editor values using boundary-aware utility.
  - Preview must explicitly mark rotations that will change, unchanged rotations, and halftime boundary stop.
  - Apply uses the exact previewed payload; no hidden recomputation differences allowed between preview and write payload.

### Phase 3: Halftime boundary seed for second-half cascade (new in v2)

1. Update `applyRotationEditWithSameHalfCascade` in `gamePlannerUtils.ts`.
   - Add optional `halftimeLineup?: Map<string, string>` parameter (last positional arg, defaults to `undefined` to keep existing call sites working).
   - When `halftimeLineup` is provided and `targetHalf === 2`:
     - Seed `runningLineup` from `new Map(halftimeLineup)` instead of `new Map(startingLineup)`.
     - In the pre-target accumulation loop, skip rotations where `rotation.half !== 2` (ignore first-half rows entirely).
   - When `halftimeLineup` is not provided (or `targetHalf === 1`): behavior is unchanged.

2. Update `computeLineupAtRotation` usage in `PlanTab.tsx` for second-half projected lineups.
   - `selectedRotationBeforeLineup` and `selectedRotationCurrentLineup` currently call `computeLineupAtRotation(planner.draft.startingLineup, rotationRowsForLineup, ...)` for all rotations.
   - For second-half timeline selections (i.e., the selected rotation's `half === 2`):
     - Compute using `effectiveHalftimeLineup` as the seed and only second-half rotation rows.
     - Add a `secondHalfRotationRows` derived list: `rotationRowsForLineup` filtered to `half === 2` only.
     - Compute second-half rotations' numbers relative to their index within the second-half list (rotationNumber attribute already correct; filtering handles rest).
   - For first-half timeline selections: no change.
   - `computeLineupAtRotation` signature is unchanged; callers are updated in `PlanTab.tsx` to pass the correct seed and rotation list.

3. Pass `planner.draft.halftimeLineup` to `applyRotationEditWithSameHalfCascade` in `PlanTab.tsx`.
   - `cascadePreview` computation updated to include `planner.draft.halftimeLineup` as the new optional 5th argument.

### Phase 4: Halftime sentinel injection into effective local rotations (new in v2)

1. Inject synthetic halftime sentinel into `effectivePlannedRotations` when absent from server.
   - After merging `plannedRotations` + `localRotationOverrides` into `mergedByKey`, check if any rotation with `rotationNumber === halftimeRotationNumber` exists in the merged set.
   - If absent: compute `const htSentinel = planner.computeHalftimeRotation()`.
     - If `htSentinel` is non-null, create a synthetic entry:
       ```
       { ...htSentinel, rotationNumber: halftimeRotationNumber }
       ```
     - Insert it into the sorted result at the position where `rotationNumber === halftimeRotationNumber`.
   - If present (server row or local override exists): skip injection.
   - This ensures `calculatePlayTime` always receives halftime substitutions when the coach has set a halftime lineup, even before `onUpdatePlannedRotations` has persisted those changes.

2. Dependency tracking: add `planner.draft.halftimeLineup` (and by extension `planner.draft.startingLineup`) to the `effectivePlannedRotations` `useMemo` dependency array. `planner.computeHalftimeRotation` is derived from those maps so it must be in deps too.

### Phase 5: Local effective rotations and projection reconciliation (carried forward)

1. Local override map in Plan tab keyed by canonical rotation key — already present in current code.
   - After edit intent, local overrides are updated immediately.
   - `effectivePlannedRotations = merge(serverRotations, localOverrides)` — already present.
   - Projected play time reads from effective set — already present; Phase 4 above ensures sentinel is included.

2. Reconcile on subscription updates — already present in current code. Sentinel injection in Phase 4 must not interfere: the sentinel is only injected when absent from the server set; once the server row arrives, the injection guard fires false and the server row is used directly.

### Phase 6: Conflict UX and guardrails (carried forward)

1. Conflict handling UX in Plan tab.
   - Banner/toast: settings changed remotely, review latest plan.
   - Keep user on current timeline selection when possible via `reconcileSelectionKey`.

2. Status gates remain strict.
   - Parent and hook both retain scheduled-only mutation guards.
   - Any status transition during write returns controlled failure.

### Phase 7: State model, responsive UX, and accessibility hardening (carried forward)

1. Define complete Plan tab state matrix and rendering contract.
   - loading: timeline skeleton + disabled edit controls + aria-busy on main planner region.
   - empty: no rotations available message with guidance and no edit affordances.
   - edit-in-progress: active editor shown, apply/cancel available, unsaved-change guard active.
   - save-pending: apply disabled, spinner/progress text, mutation controls locked to prevent duplicate writes.
   - success: transient confirmation message after successful apply, then return to view state.
   - conflict: non-blocking conflict banner, local conflicting overrides cleared, selection reconciled to nearest server rotation.
   - error: inline error banner/toast with retry action; editor retains user input unless data invalidation requires forced reset.
   - parse-fallback: malformed `plannedSubstitutions` is ignored for that row; row marked unavailable for editing with safe fallback text and telemetry/log hook.

2. Define scheduled vs live read-only behavior table for all relevant controls.

   | Control/Behavior | scheduled | in-progress | halftime | completed |
   |---|---|---|---|---|
   | Timeline selection | Enabled | Enabled | Enabled | Enabled |
   | Lineup view (Start/HT states) | Editable in scheduled | Read-only | Read-only | Read-only |
   | Enter rotation edit mode | Enabled | Disabled | Disabled | Disabled |
   | Position substitution selectors | Enabled in edit mode | Hidden/Disabled | Hidden/Disabled | Hidden/Disabled |
   | Cascade preview panel | Enabled in edit mode | Hidden | Hidden | Hidden |
   | Apply changes | Enabled in edit mode | Disabled | Disabled | Disabled |
   | Cancel edit | Enabled in edit mode | N/A | N/A | N/A |
   | Save planner settings | Enabled | Disabled | Disabled | Disabled |
   | Conflict/error banners | Enabled | Read-only informational only | Read-only informational only | Read-only informational only |

3. Define responsive behavior for timeline + editor.
   - Phone (< md breakpoint): timeline horizontal scroll with snap; editor below in single-column; cascade preview collapsed by default with explicit Expand; Apply/Cancel pinned at bottom action bar.
   - Tablet and up (>= md breakpoint): two-pane layout; cascade preview expanded; no modal takeover.
   - Orientation change: preserve selected rotation and unsaved editor state; move focus to editor heading if previous focus target is removed.

4. Define visual consistency constraints.
   - Reuse existing spacing scale, card shells, and status banner variants from GameManagement.
   - Reuse existing button hierarchy and destructive/secondary action styling; no new ad hoc color tokens.
   - Keep z-index layering compliant with documented stack.
   - Reuse existing copy tone for confirmation, conflict, and error messaging.

5. Define accessibility acceptance criteria.
   - Keyboard: full edit flow operable; logical tab order: timeline → editor fields → cascade preview → footer actions; Escape cancels edit; Enter/Space activates focused controls.
   - Focus management: enter edit mode moves focus to editor heading; apply success moves focus to selected timeline item; conflict/error retains focus in editor region.
   - ARIA: timeline uses list/listitem or tablist/tab semantics; editor controls have explicit labels including position and rotation context; live regions for pending/success/conflict/error.
   - Target size: interactive controls meet minimum 44×44 CSS pixel hit area; timeline chips have touch-friendly spacing.

6. Resolve persistence decision.
   - Explicit submit (Apply) per rotation edit session, not autosave per field change.
   - Rationale: minimizes conflict frequency; preserves preview→apply payload determinism; reduces accidental mobile bursts; aligns with Cancel undo path.

## File-by-File Change List (v2)

1. **`src/components/GameManagement/hooks/useGamePlanner.ts`**
   - Add `updateStartingLineup(lineup: Map<string, string>): Promise<void>` method with `assertScheduledStatus` and `mutationInFlightRef` guards.
   - Update `UseGamePlannerResult` interface to include `updateStartingLineup`.
   - Add inline code comment documenting that `savePlan` is GamePlan-only (no PlannedRotation writes).

2. **`src/components/GameManagement/GameManagement.tsx`**
   - Add inline code comment to `onUpdatePlannedRotations` documenting it as the sole PlannedRotation write path.
   - No structural change required; single-writer contract is already implemented.

3. **`src/components/GameManagement/PlanTab.tsx`**
   - Add `handleStartingLineupChange` callback routing to `planner.updateStartingLineup` + `planner.savePlan` (mirroring `handleHalftimeLineupChange` pattern).
   - Reposition existing `LineupPanel` to be the central lineup display responsive to `selectedKey` (move it above projected play time section as per UX requirement).
   - For `starting` state: derive `LineupAssignment[]` from `planner.draft.startingLineup` and pass `onSubstitute` shim targeting `handleStartingLineupChange`; set `isReadOnly={false}`.
   - For `halftime` state: derive `LineupAssignment[]` from `effectiveHalftimeLineup`; pass `onSubstitute` shim targeting `handleHalftimeLineupChange`; set `isReadOnly={false}`.
   - For rotation states: pass projected lineup (from `selectedRotationCurrentLineup`); set `isReadOnly={true}` when edit mode is not active; rotation editing routes through existing `handleStartRotationEdit`/`handleApplyRotationEdit` flow.
   - For `readOnly` prop (live/completed game): all timeline states set `isReadOnly={true}`.
   - Remove the live-mutation `LineupPanel` at the bottom of PlanTab or make it conditional on `!isScheduled` only.
   - Update `selectedRotationBeforeLineup` and `selectedRotationCurrentLineup` memos: for `half === 2` selections, seed from `effectiveHalftimeLineup` with second-half-only rotation rows.
   - Update `cascadePreview` memo: pass `planner.draft.halftimeLineup` as 5th arg to `applyRotationEditWithSameHalfCascade`.
   - Update `effectivePlannedRotations` memo: inject synthetic halftime sentinel when no server/override row exists for `halftimeRotationNumber`. Add `planner.computeHalftimeRotation` result and `halftimeRotationNumber` to deps.
   - Move projected play time section to the bottom of the Plan tab render (below the lineup view).

4. **`src/utils/gamePlannerUtils.ts`**
   - Add optional `halftimeLineup?: Map<string, string>` parameter to `applyRotationEditWithSameHalfCascade`.
   - When `halftimeLineup` is provided and `targetHalf === 2`: seed `runningLineup` from `halftimeLineup` and skip half-1 rows in the pre-target accumulation loop.
   - Existing call sites that don't pass the 5th arg are unaffected.

5. **`src/utils/gamePlannerTimeline.ts`**
   - Reuse as-is. No changes required.

6. **`src/utils/plannerKeyUtils.ts`**
   - Reuse as-is. No changes required.

7. **`src/components/GameManagement/PlanTab.test.tsx`**
   - Add test: starting lineup edit in `starting` state calls `updateStartingLineup` and NOT any live `LineupAssignment` mutation.
   - Add test: halftime lineup edit in `halftime` state calls `updateHalftimeLineup` and NOT any live `LineupAssignment` mutation.
   - Add test: `effectivePlannedRotations` includes synthetic halftime sentinel when no server row exists for halftime rotation number.
   - Add test: synthetic sentinel is NOT injected when server row already exists for halftime rotation number.
   - Add test: second-half rotation projected lineup is seeded from `halftimeLineup`, not accumulated from starting lineup through first-half rotations.
   - Add tests from prior plan: local effective projection, conflict return path, Save Settings no-clobber, state matrix, scheduled-vs-live gating, keyboard/focus, responsive layout.

8. **`src/components/GameManagement/hooks/useGamePlanner.test.ts`** (create or expand)
   - Add test: `updateStartingLineup` updates draft and marks dirty.
   - Add test: `updateStartingLineup` is a no-op when game status is not scheduled.
   - Add test: `savePlan` does not call `PlannedRotation.create`, `PlannedRotation.update`, or `PlannedRotation.delete`.
   - Add test: `localFingerprint` changes after `updateStartingLineup` is called.

9. **`src/components/GameManagement/GameManagement.test.tsx`**
   - Add test: precondition mismatch returns conflict and blocks writes.
   - Add test: concurrent Save Settings + rotation edit produces no PlannedRotation clobber.

10. **`src/utils/gamePlannerUtils.test.ts`** (expand)
    - Add test: `applyRotationEditWithSameHalfCascade` with `halftimeLineup` seeds second-half cascade from halftime lineup, ignoring first-half rows.
    - Add test: omitting `halftimeLineup` for a second-half rotation behaves as before (no regression).
    - Add existing tests: halftime boundary stops cascade, first-half cascade does not cross into second half.

11. **`src/utils/rotationDiffUtils.test.ts`**
    - Add tests validating fingerprint changes for conflicting server refresh scenarios.

12. **`e2e/game-planner.spec.ts`**
    - Add race-focused user flow: edit rotation, trigger settings save, ensure no substitution clobber.
    - Add subscription-refresh race case: immediate projection remains locally updated until server reconcile.
    - Add keyboard-only edit flow and focus restore assertions.
    - Add mobile viewport flow for timeline scroll + edit apply/cancel behavior.
    - Add live-state read-only assertions (in-progress/halftime/completed).

## Data Model / API Impact

- No schema changes in `amplify/data/resource.ts`.
- No new GraphQL model required.
- API contract change is internal frontend mutation orchestration only:
  - `useGamePlanner` gains `updateStartingLineup` as a new method.
  - `PlannerMutationResult` and `PlannedRotationsUpdateInput` types already defined in `PlanTab.tsx` and `GameManagement.tsx`.

## Dependencies and Sequencing (v2)

1. Add `updateStartingLineup` to `useGamePlanner` and its tests (Phase 1).
2. Correct `effectivePlannedRotations` sentinel injection (Phase 4) — depends on `computeHalftimeRotation` already available in hook; no new deps.
3. Update `applyRotationEditWithSameHalfCascade` with halftime boundary seed (Phase 3) — pure utility change; no framework deps.
4. Update `PlanTab.tsx` lineup view routing, second-half lineup computation, cascade call, and layout repositioning (Phases 2, 3, 4).
5. Implement full state matrix render paths, responsive behavior, and accessibility (Phase 7).
6. Add all unit and component tests.
7. Add/adjust e2e coverage.
8. Run `npm run gate:commit`.

## Risks and Mitigations (v2)

1. Risk: hidden secondary writer still updates PlannedRotation.
   - Mitigation: `savePlan` already GamePlan-only (confirmed). Add regression test asserting no PlannedRotation writes from Save Settings path.

2. Risk: false-positive conflicts due to unstable fingerprint inputs.
   - Mitigation: fingerprint computation uses canonical sorted rotations and existing utility. `updateStartingLineup` marks dirty correctly; fingerprint updates via `localFingerprint` memo.

3. Risk: selection jump during reconcile after subscription refresh.
   - Mitigation: always pass through `reconcileSelectionKey`.

4. Risk: cascade crosses halftime boundary.
   - Mitigation: `applyRotationEditWithSameHalfCascade` already stops at half boundary; Phase 3 adds correct seeding. Explicit tests for both halves.

5. Risk: stale projection after local edit or before server round-trip.
   - Mitigation: `effectivePlannedRotations` updates immediately. Phase 4 sentinel injection ensures halftime is included.

6. Risk: preview/apply mismatch creates user distrust.
   - Mitigation: single shared payload builder used by both preview and apply submission path.

7. Risk: sentinel injection introduces duplicate halftime row if server row arrives concurrently.
   - Mitigation: injection guard checks existence of rotation with `rotationNumber === halftimeRotationNumber` before injecting; once server row arrives it takes precedence.

8. Risk: live `LineupAssignment` mutations called from Plan tab after lineup view refactor.
   - Mitigation: `onSubstitute` shim in Plan tab routes through `handleStartingLineupChange`/`handleHalftimeLineupChange`; live mutations are not accessible through that shim. Test explicitly asserts no live mutation calls.

9. Risk: keyboard/focus regressions in complex responsive layout switches.
   - Mitigation: explicit focus contracts with component tests and mobile/tablet viewport test coverage.

## Edge Cases Required in Test Coverage (v2)

- Save Settings and rotation edit fired close together; no substitution loss (no PlannedRotation clobber).
- Precondition mismatch on stale tab: conflict returned, no writes.
- Subscription refresh arrives between local edit and mutation completion.
- Halftime selected while editing adjacent rotations.
- Invalid `plannedSubstitutions` payload in a server row must fail safe and not crash projection.
- Read-only states preserve timeline inspection but never expose mutation controls.
- Cancel from dirty edit mode should not mutate projection or server data.
- Apply disabled and deduplicated during save-pending.
- Orientation/breakpoint change mid-edit preserves state without focus trap.
- Synthetic halftime sentinel is present in projected play time before server persistence.
- Synthetic sentinel is NOT double-injected once server row for halftime rotation number arrives.
- Second-half cascade correctly seeds from halftime lineup even when halftime lineup differs from starting-lineup-through-first-half-rotations.
- `updateStartingLineup` marks draft dirty; `savePlan` persists the new lineup; fingerprint updates.
- Starting lineup edit in Plan tab does not call `mutations.createLineupAssignment` or `mutations.deleteLineupAssignment`.

## Test Strategy (v2)

Unit:
- `gamePlannerUtils`: cascade boundary, halftime boundary seed for second half, and determinism tests.
- `rotationDiffUtils`: fingerprint and conflict-input stability tests.

Component:
- `useGamePlanner`: `updateStartingLineup` dirty state, `savePlan` GamePlan-only write assertion, fingerprint tracking.
- `PlanTab`: starting and halftime lineup edit routing (no live mutation calls).
- `PlanTab`: synthetic sentinel injection into effective rotations.
- `PlanTab`: second-half projected lineup seeded from halftime.
- `PlanTab`: immediate local projection updates and reconcile behavior.
- `PlanTab`: explicit no-clobber behavior around Save Settings.
- `PlanTab`: full state matrix rendering and transitions.
- `PlanTab`: scheduled-vs-live control gating.
- `PlanTab`: keyboard/focus/live-region contracts.
- `PlanTab`: responsive timeline/editor behavior for phone and tablet breakpoints.

Integration:
- `GameManagement`: single-owner mutation routing and precondition conflict handling.

E2E:
- Scheduled plan rotation edit remains after Save Settings.
- Subscription race does not regress displayed projection or final persisted result.
- Keyboard-only edit session validates accessibility flow end-to-end.
- Live game statuses enforce read-only controls while preserving inspection.
- Mobile viewport timeline + editor flow remains operable.

Gate:
- `npm run gate:commit`

## Assumptions (v2)

1. Rotation edits use explicit submit (Apply) semantics within a per-rotation edit session.
2. Conflict UX can be non-blocking banner/toast for this scope.
3. Existing read-only behavior for live states remains unchanged.
4. `computeHalftimeRotation()` returning `null` means the halftime lineup is identical to the starting lineup; no sentinel injection needed in that case.
5. The sentinel injection in Phase 4 uses `halftimeRotationNumber` (derived from `rotationsPerHalf + 1`) as the authoritative rotation number for the halftime slot in the sorted effective list.

## Out of Scope (This Defect Fix)

- New backend conditional-write API.
- Multi-user merge UI for conflict diff visualization.
- Broad redesign of planner tab layout.
- Changes to `computeLineupAtRotation` function signature — callers in PlanTab are updated to pass correct inputs rather than changing the utility signature.
