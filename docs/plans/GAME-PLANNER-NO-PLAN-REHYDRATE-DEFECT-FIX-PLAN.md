# Game Planner No-Plan Rehydrate Defect Fix Plan

Status: Stage 1 revision after UI review blockers

## Scope
Fix planner draft rehydrate behavior when no `GamePlan` exists so that `startingLineup` refreshes from latest `startingLineupAssignments` on prop updates (not only initial mount), while preserving `selectedTimelineKey` and all previously approved constraints.

## Requirements and Constraints
- In `useGamePlanner`, when `gamePlan` is null and draft is not dirty, rehydrate `startingLineup` from latest `startingLineupAssignments` whenever props refresh and source data changes.
- Preserve `selectedTimelineKey` during remote rehydrate by using functional `setDraft(prev => ...)` updates.
- Keep timeline semantic reconciliation utility unchanged.
- In `PlannerLineupView`, implement grouped two-button toggle parity (`List` / `Shape`) using existing `lineup-view-toggle` + `btn-secondary` + active class pattern.
- Add explicit accessibility semantics for the single-select toggle group (group labeling + selected-state signaling).
- Add planner lineup list/select styles in `App.css` for mobile-first layout, focus-visible affordances, min touch targets, and long-name wrapping/overflow handling.
- Add explicit planner empty-state messaging when no positions exist.
- Add regression tests for toggle semantics/state, no-snapback selection behavior, no-plan rehydrate behavior, and planner empty-state rendering.
- No backend/API/model changes.

## Root Cause Summary
`useGamePlanner` currently performs draft initialization from `startingLineupAssignments` only in the initial state factory. Later rehydrate logic reads only `gamePlan.startingLineup` when fingerprint changes; when `gamePlan` remains null, it falls back to an empty map. This causes stale or cleared planner starting lineup after lineup assignment prop refreshes and resets selection by setting `selectedTimelineKey` to null.

## Proposed Changes (File-by-File)
1. `src/components/GameManagement/hooks/useGamePlanner.ts`
- Add a pure helper to derive `startingLineup` from either `gamePlan.startingLineup` (if present/parsable) or current `startingLineupAssignments` fallback.
- Update rehydrate effect so no-plan, clean-draft prop refreshes can update `startingLineup` from latest assignments.
- Keep dirty guard behavior unchanged (`dirtyKeys.size > 0` blocks rehydrate).
- Preserve timeline selection by switching to functional updates:
  - `setDraft(prev => ({ ...prev, rotationIntervalMinutes, startingLineup, halftimeLineup, selectedTimelineKey: prev.selectedTimelineKey }))`
  - Do not force `selectedTimelineKey` to null during remote rehydrate.
- Ensure rehydrate trigger includes `startingLineupAssignments` change detection in addition to fingerprint differences where needed for no-plan path.
- Keep `reconcileSelectionKey` and timeline utility behavior unchanged (no edits in utility module).
- Preserve consumer-side reconciliation contract: if the previous key becomes invalid after timeline changes, `PlanTab` reconciliation remains the only fallback mechanism.

2. `src/components/GameManagement/hooks/useGamePlanner.test.ts` (new)
- Add hook-level regression tests for no-plan rehydrate on prop updates:
  - Initializes from `startingLineupAssignments` when `gamePlan` is null.
  - Rehydrates `startingLineup` when `startingLineupAssignments` props change and draft is clean.
  - Does not rehydrate from prop changes when draft is dirty.
  - Preserves `selectedTimelineKey` across no-plan rehydrate using functional updates (no snapback to `Start`).
  - Keeps existing gamePlan-based rehydrate behavior intact.

3. `src/components/GameManagement/PlanTab.test.tsx`
- Add integration regression tests around hook usage in Plan tab:
  - When `gamePlan` is null and lineup starter assignments prop updates, selected timeline remains stable (no unexpected selection reset).
  - If previously selected key is no longer present, fallback path uses `reconcileSelectionKey` and only then lands on first valid item.
  - Planner lineup view reflects updated starting assignments after prop refresh in clean state.
- Ensure tests explicitly cover "no-plan rehydrate prop updates" scenario requested in this revision.

4. `src/components/GameManagement/PlannerLineupView.tsx`
- Replace one-way "Switch to ..." button rendering with grouped two-button parity control:
  - Use `lineup-view-toggle` wrapper with `btn-secondary` buttons for `List` and `Shape` in both list and shape render paths.
  - Apply existing active class (`is-active`) based on effective mode.
  - Keep disable/read-only behavior aligned with parent interactivity rules.
- Add explicit accessibility semantics for single-select group:
  - Group container labeling (`role="group"` + `aria-label` or equivalent accessible name).
  - Selected-state signaling on each option button (`aria-pressed` or equivalent explicit state signal) while preserving button semantics.
- Add explicit empty-state message when `positions.length === 0` in planner lineup panel (read-only and editable modes).
- Maintain planner-safe `LineupShapeView` behavior (no direct live mutation calls).

5. `src/App.css`
- Add planner-lineup styling completeness using existing tokens/colors:
  - Mobile-first row layout for position label + selector/value with clear vertical rhythm.
  - Select/input hit-area sizing to meet touch usability expectations.
  - Focus-visible treatment for planner selects and interactive row controls.
  - Long-name handling (wrapping/overflow behavior) for labels and selected values.
  - Keep toggle parity by reusing `.lineup-view-toggle` and `.btn-secondary` active styling.
- Avoid broad style refactors or token changes.

6. `src/components/GameManagement/PlannerLineupView.test.tsx` (new)
- Add focused component tests for planner lineup UI:
  - Renders grouped `List` / `Shape` controls with expected active-state class behavior.
  - Exposes single-select accessibility semantics for toggle group and selected state.
  - Renders explicit empty-state messaging when no positions are provided.
  - Confirms planner-safe interaction routing remains callback-based.

## Data Model / API Impacts
- None.
- No GraphQL schema, Amplify model, resolver, Lambda, or API contract changes.

## Dependencies and Sequencing
1. Implement `useGamePlanner` rehydrate logic update first.
2. Add/adjust hook tests (`useGamePlanner.test.ts`) to lock behavior.
3. Implement `PlannerLineupView` toggle parity + accessibility semantics + explicit empty state.
4. Implement `App.css` planner-lineup row/select/focus/touch/overflow styles.
5. Add `PlannerLineupView` component tests for toggle semantics and empty state.
6. Apply PlanTab regression tests for selection persistence + no-plan prop-refresh reflection.
7. Run targeted tests, then `npm run gate:commit`.

## Risks and Edge Cases
- Risk: Over-broad rehydrate may clobber intentional unsaved edits.
  - Mitigation: Preserve existing dirty guard (`dirtyKeys.size > 0`) and test it explicitly.
- Risk: Selection drift if timeline item set changes during refresh.
  - Mitigation: Preserve `selectedTimelineKey`; rely on existing `reconcileSelectionKey` to adjust only when key is invalid.
- Risk: Toggle semantics mismatch (visual active state not reflected for assistive tech).
  - Mitigation: Add explicit selected-state semantics and test via role/ARIA assertions.
- Risk: Mobile usability regressions from dense planner rows/selects.
  - Mitigation: Add touch-target and focus-visible styles with mobile-first defaults; validate in component tests and responsive review.
- Risk: Empty/invalid `gamePlan.startingLineup` parse path.
  - Mitigation: Keep parse guard + fallback behavior deterministic.
- Risk: UI toggle style drift between Plan tab and Lineup panel.
  - Mitigation: Reuse existing class pattern and limit CSS changes.

## Test Strategy
- Unit/hook tests:
  - `src/components/GameManagement/hooks/useGamePlanner.test.ts` for no-plan prop-refresh rehydrate and selection preservation.
- Component tests:
  - `src/components/GameManagement/PlannerLineupView.test.tsx` for grouped toggle semantics/state + empty-state rendering.
  - `src/components/GameManagement/PlanTab.test.tsx` for no-plan rehydrate behavior visible in timeline/lineup rendering and selection stability.
- Gate:
  - Run targeted tests for both files.
  - Run `npm run gate:commit` before commit gate approval.

## Out of Scope
- Any backend/API/model/schema updates.
- Changes to timeline reconciliation utility semantics.
- Planner algorithm or rotation persistence semantics beyond this rehydrate defect.
