# Lineup Shape V1 Tactical UI Iteration Plan

## Scope

Implement a UI-only iteration for lineup shape mode in Game Management:
- Remove persistent remove-X control from shape nodes
- Scheduled + halftime filled-node tap opens a quick-replace sheet/menu (bench players sorted by existing priority + clear slot secondary action)
- In-progress filled-node tap remains substitution flow
- Visual cleanup for node hierarchy and pitch readability
- Keep formation orientation/anchors, offline mutation behavior, and accessibility constraints

Out of scope:
- Backend, schema, auth, and data model changes
- Formation geometry/orientation changes
- Substitution queue behavior changes

## Existing Behavior Baseline

- Shape nodes are rendered by LineupShapeView and interaction policy is delegated to lineupInteractionAdapter
- Filled node removal in scheduled/halftime is done via a persistent top-right remove-X button
- Bench strip sorting already supports: play time ascending, then preferred-position fit tie-break when a position is selected
- Empty-node tap in scheduled/halftime routes to existing assignment/substitution modal via onSubstitute
- Filled-node tap in in-progress routes to substitution flow via onSubstitute

## Proposed UX Behavior

### 1) Filled node interaction by game state

- Scheduled:
  - Tap empty node: unchanged (existing assignment flow)
  - Tap filled node: open quick-replace sheet for that position
- Halftime:
  - Tap empty node: unchanged (existing assignment flow)
  - Tap filled node: open quick-replace sheet for that position
- In-progress:
  - Tap empty node: unchanged (disabled)
  - Tap filled node: unchanged substitution flow

### 2) Quick-replace sheet contents

- Header: position name/abbr + currently assigned player
- Primary actions list: bench players sorted by existing priority logic
- Secondary action: clear slot
- Dismiss options: close button, backdrop click, Escape key
- Accessibility:
  - role=dialog, aria-modal=true
  - focus moves into sheet on open and returns to triggering node on close
  - all row actions at least 44x44

### 3) Visual hierarchy and pitch cleanup

- Node typography:
  - Increase assigned player label prominence (size/weight/contrast)
  - Reduce position label prominence (size/weight/opacity)
- Pitch surface:
  - Lower grid line opacity
  - Add subtle center circle + center line + penalty box hints with low-contrast overlays
  - Preserve visual simplicity and avoid crowding behind nodes

## Technical Design Notes

### Replace/Clear mutation strategy (scheduled + halftime)

Implement quick-replace mutation handler in LineupPanel and pass to LineupShapeView as a new callback.

For replace:
- Resolve existing assignment for tapped position
- If selected bench player already has a starter assignment in another position, delete that existing assignment first (preserve one-starter-per-player invariant)
- Update tapped position assignment to selected player (updateLineupAssignment) when assignment exists
- Fallback createLineupAssignment only if assignment disappeared from concurrent updates

For clear slot:
- Delete the current assignment for tapped position

Error handling:
- Reuse handleApiError messaging for replace/clear failures
- Close sheet only on successful mutation

Rationale:
- Keeps behavior in current offline mutation stack
- Avoids direct dependency on SubstitutionPanel for scheduled/halftime quick replace
- Preserves in-progress substitution flow unchanged

## File-by-File Change Plan

1. src/components/GameManagement/shape/LineupShapeView.tsx
- Remove persistent remove button markup and removable class usage
- Add quick-replace sheet state and UI
- Add callbacks for replace/clear actions (received via props)
- Keep in-progress assigned-node tap path unchanged
- Keep empty-node behavior unchanged
- Maintain bench sort logic and selected-position semantics

2. src/components/GameManagement/shape/lineupInteractionAdapter.ts
- Extend assigned-node interaction contract for scheduled/halftime from disabled to tappable, with state-specific title text:
  - scheduled/halftime: Tap to replace or clear
  - in-progress: Tap to open substitution
- Keep empty-node behavior exactly as-is

3. src/components/GameManagement/LineupPanel.tsx
- Introduce async handler for shape quick replace/clear using existing mutations
- Pass handler props into LineupShapeView
- Reuse existing lineup resolution + handleApiError patterns

4. src/App.css
- Remove styles exclusively tied to persistent remove-X control
- Add quick-replace sheet styles using existing modal primitives
- Adjust node typography hierarchy for readability
- Soften pitch grid opacity
- Add subtle pitch anchors (center circle/line + penalty boxes)
- Re-validate mobile breakpoints and 44x44 targets

5. src/components/GameManagement/shape/LineupShapeView.test.tsx
- Replace/remove tests asserting persistent remove-X control presence
- Add tests for scheduled/halftime assigned-node tap opening quick-replace sheet
- Add test for in-progress assigned-node tap still routing substitution callback
- Add test for clear-slot action callback invocation
- Add test for bench-order rendering in sheet uses sorted bench list

6. src/components/GameManagement/shape/lineupInteractionAdapter.test.ts
- Update assigned-node tests for scheduled/halftime tap enabled behavior
- Preserve in-progress substitution test coverage

7. e2e/game-management-shape-view.spec.ts
- Update touch-target assertions to remove node remove-button checks
- Add scenario for scheduled/halftime assigned-node tap opening quick-replace UI
- Assert clear-slot action is visible as secondary action
- Keep in-progress substitution parity assertion unchanged

8. docs/specs/Lineup-Shape-View.md
- Update Interaction Parity to reflect state-specific assigned-node behavior
- Document quick-replace sheet semantics and clear-slot secondary action

9. docs/specs/UI-SPEC.md
- Update Game Management substitution/sheet guidance to include shape quick-replace in scheduled/halftime
- Add visual guidance notes for pitch anchors and node text hierarchy

## Sequencing

1. Update interaction adapter contract + unit tests
2. Implement LineupPanel mutation callbacks for quick replace/clear
3. Implement LineupShapeView quick-replace UI + tests
4. Apply CSS cleanup and responsive adjustments
5. Update E2E shape-view scenarios
6. Update docs/specs

## Risks and Edge Cases

- Concurrency drift:
  - Assignment may change between opening and choosing action; handler must re-resolve current assignment and fail safely
- Duplicate starter assignment:
  - Selected bench player could be assigned elsewhere by another coach while sheet is open
- Empty bench state:
  - Sheet should still show clear-slot secondary action and no crash
- Unknown player data:
  - Missing player/number should still render fallback labels
- Accessibility regressions:
  - Focus trapping/return and dialog semantics can regress if implemented ad hoc
- Tap target regressions on small viewports:
  - Typography changes must not shrink actionable regions below 44x44

## Data/API Impact

- No backend changes
- No schema/model changes
- No new network contracts
- Uses existing offline mutation API methods:
  - deleteLineupAssignment
  - updateLineupAssignment
  - createLineupAssignment (fallback only)

## Test Strategy

Unit/integration:
- LineupShapeView tests for state-specific tap behavior and quick-replace dialog actions
- lineupInteractionAdapter tests for assigned-node behavior by status
- Optional LineupPanel tests for mutation sequencing (replace player already assigned elsewhere)

E2E:
- Extend shape-view mobile flow:
  - scheduled/halftime assigned node opens quick-replace
  - clear-slot action visible
  - in-progress still opens substitution path
- Preserve existing overflow and 44x44 checks

Manual QA checklist:
- Scheduled + halftime: filled-node tap opens sheet, selecting bench player updates slot
- Scheduled + halftime: clear-slot removes assignment
- In-progress: filled-node tap opens substitution modal only
- Pitch remains readable outdoors; no visual clutter
- Keyboard and screen-reader flow for dialog open/close

## Acceptance Criteria (v1)

- Persistent remove-X no longer visible in shape mode
- Filled-node tap behavior matches requested status matrix
- Node text hierarchy improved: player name clearly dominant
- Pitch grid softer and includes subtle anchors without clutter
- No backend/schema changes and offline behavior preserved
- Accessibility and minimum touch target requirements maintained
