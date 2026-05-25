# Completed Game Timeline Lanes Plan (Revised After Architect Review)

## Scope

Implement a completed-game-only timeline visualization that shows, per player:
- every play interval from PlayTimeRecord (with position labels)
- goal-for / goal-against event markers on the shared time axis
- halftime divider
- jersey-sorted player lanes
- sticky left player identity column during horizontal scroll
- horizontal scrolling behavior on mobile
- live reflection of goal add/edit/delete in completed state

This plan preserves existing completed-state sections (`CompletedPlayTimeSummary`, `GoalTracker`, notes) and adds a dedicated timeline section alongside them.

## UI Review Amendments Incorporated

1. Sticky player labels: keep jersey/name visible in a left column while the timeline track scrolls horizontally on mobile, with card-background overlay behavior so scrolled content does not bleed through labels.
2. Segment accessibility: every rendered play interval segment must expose explicit accessible text describing position and time span.
3. Design-token mapping: use `--danger-red` for opponent goals, `--accent-green` or `--primary-green` for team goals, and `--border-color` for divider/axis visuals.
4. Zero-play-time rows: players with no valid play intervals still render an empty lane so row alignment and roster visibility remain intact.
5. Invalid-duration empty state: fallback must explicitly use the existing `.empty-state` utility class.

## Architect Amendments Incorporated

1. Duration guard: if `gameEndSeconds` is not finite or `<= 0`, render a safe empty timeline state and skip all percentage calculations.
2. Pure transform boundary: move timeline mapping (normalize/clamp/sort/minute labels/marker placement) into a dedicated pure module; keep component presentational.
3. Halftime source parity: use `game.halfLengthMinutes` override first, then `team.halfLengthMinutes` fallback.
4. Shared jersey comparator: define and reuse one comparator for completed-state jersey sorting in both `CompletedPlayTimeSummary` and timeline.
5. Deterministic overlap rules: define stable interval sort and minimum visual width for non-zero intervals.
6. Test expansion:
   - transform-level unit tests for clamping/sorting/edge cases
   - completed-state integration test in `GameManagement` validating marker update when goals change
7. CSS scope: timeline styles remain under a dedicated, block-scoped class namespace.

## Requirements Mapping

1. Timeline location: render only in `gameState.status === 'completed'` branch.
2. Primary view: one lane per player row.
3. Position detail: derive segments from all normalized PlayTimeRecord intervals.
4. Goal display: render markers at `goal.gameSeconds` positions.
5. Goal labels: for/against conveyed by color/icon only in visual layer; include accessible text labels for screen readers.
6. Time format: minute-only labels (`23'`).
7. Halftime divider: visible vertical divider at halftime second using game override first, then team fallback.
8. Player sort: jersey number ascending; undefined/null jersey numbers last.
9. Mobile behavior: horizontally scrollable timeline track with a sticky left player label column.
10. Completed edits: timeline auto-updates as `goals` subscription data changes.
11. Empty-lane behavior: every sorted player renders a row even when no valid intervals remain after normalization/clamping.
12. Visual tokens: goal markers and axis/divider styling map to existing design tokens only.

## Proposed Design

### Component boundaries

- Keep `CompletedPlayTimeSummary` as the numeric summary table, but migrate it to shared jersey comparator.
- Add `CompletedGameTimeline` as a presentational component rendered in completed state.
- Add `completedGameTimelineTransform` pure mapper module for all timeline-derived view data.
- Pass already-available props from `GameManagement`:
  - `players`
  - `playTimeRecords`
  - `goals`
  - `positions`
  - `gameEndSeconds`
  - `halfLengthMinutes` (resolved with game override first, then team fallback)

### Layout structure

- Render each player row as two coordinated regions:
  - sticky left identity column with jersey + player name
  - horizontally scrollable timeline lane area
- Keep the sticky label column visually above the scrolling track using the same card background color as the parent surface.
- Preserve row height/alignment whether the lane contains segments or is empty.

### Pure transform contract

Add a pure transform function (name to finalize during implementation) that accepts timeline inputs and returns:
- `isRenderableDuration` boolean and optional empty-state reason
- sorted lane rows (jersey comparator)
- lane rows for every player, including empty rows when interval list is empty
- lane intervals with `start/end` seconds, minute labels, left/width percentages, position label, and explicit accessible segment text
- goal markers with clamped positions and accessible minute labels
- halftime divider position or null
- axis minute ticks (minute-only labels)

No React state, side effects, DOM reads, or mutations in this transform.

### Duration guard behavior

- If `gameEndSeconds` is not a finite positive number:
  - render timeline section shell + empty-state content
  - use the existing `.empty-state` utility class for the fallback container
  - skip interval percentage math and marker position calculations
  - avoid division by zero / `NaN` style outputs

### Interval and overlap rules

- Normalize records first using `normalizeCompletedRecords(records, gameEndSeconds)` when duration is renderable.
- Clamp each interval to `[0, gameEndSeconds]`.
- Drop invalid intervals after clamp (`end <= start`).
- Preserve player rows even if all intervals for that player are dropped.
- Deterministic interval ordering inside a player lane:
  - primary: `startGameSeconds` ascending
  - secondary: `endGameSeconds` ascending
  - tie-breaker: record id lexical ascending
- Non-zero interval display width:
  - enforce a minimum visual width (for example via `max(calculatedWidth, minWidthPxAsPercent)` logic)
  - keep interval anchored to start position and clamp to timeline bounds

### Goal markers and accessibility

- Shared goal marker axis at top of lanes.
- Marker position from clamped `goal.gameSeconds`.
- Visual-only for/against distinction through color/icon using existing tokens:
  - opponent goals: `--danger-red`
  - team goals: `--accent-green` or `--primary-green`
  - axis and halftime divider: `--border-color`
- Add screen-reader text such as:
  - `Goal for us at 23'`
  - `Goal against at 41'`
- Add explicit accessible text on each interval segment such as:
  - `Defender from 12' to 18'`
  - fallback wording when position metadata is missing

### Time and halftime parity

- Axis labels remain minute-only.
- Halftime source:
  - first: `gameState.halfLengthMinutes` (or current game object half-length if available in completed state)
  - fallback: `team.halfLengthMinutes`
- Divider shown only when halftime second is strictly within duration bounds.

### Live updates in completed state

- No new timeline-local state/effects for data refresh.
- Timeline rerender is driven by existing completed-state `goals` updates in `GameManagement`.
- Integration test will assert marker count/placement changes on goals prop/state update.

### Empty-row behavior

- Every player in the completed-state roster produces a rendered lane row, even when that player has zero play time or only invalid/clamped-out intervals.
- Empty rows retain the sticky identity column and an empty track shell so alignment stays consistent across the full roster.

## Revised File-by-File Change Plan

1. `src/components/GameManagement/CompletedGameTimeline.tsx` (new)
- Presentational rendering only.
- Consumes already-transformed model (or invokes pure transform once per render via memoized call).
- Renders sticky left identity column plus scrollable lane area.
- Applies explicit accessible text semantics to each interval segment.
- Uses scoped CSS class names under one timeline block namespace.

2. `src/components/GameManagement/completedGameTimelineTransform.ts` (new)
- Pure mapping boundary for normalize/clamp/sort/minute labels/marker placement.
- Implements duration guard and deterministic overlap rules.
- Preserves empty player rows and emits segment accessibility text.
- Emits data structure tailored to rendering.

3. `src/components/GameManagement/completedGameTimelineSort.ts` (new)
- Exports shared completed-state jersey comparator (`null`/`undefined` jersey last, deterministic tie-breaker).
- Reused by `CompletedPlayTimeSummary` and timeline transform.

4. `src/components/GameManagement/CompletedPlayTimeSummary.tsx`
- Replace inline jersey sort with shared comparator import.

5. `src/components/GameManagement/GameManagement.tsx`
- Import and render `CompletedGameTimeline` only in completed branch.
- Resolve halftime source parity (game override first, team fallback) before passing prop.

6. `src/App.css`
- Add scoped timeline block styles only (for example `.completed-game-timeline*`).
- Include mobile horizontal scroll lane container, sticky label column, and marker/segment visuals.
- Map goals and divider/axis visuals to `--danger-red`, `--accent-green` or `--primary-green`, and `--border-color`.
- Use card-background overlay treatment for sticky label cells and `.empty-state` for invalid-duration fallback.
- Include deterministic overlap-friendly lane layering and minimum-width presentation rules.

7. `src/components/GameManagement/completedGameTimelineTransform.test.ts` (new)
- Unit tests for transform-level clamping/sorting/edge cases and guard behavior.

8. `src/components/GameManagement/CompletedGameTimeline.test.tsx` (new)
- Component rendering/accessibility tests using transform outputs, including sticky label layout expectations and empty-lane rendering.

9. `src/components/GameManagement/GameManagement.test.tsx`
- Completed-state integration test for live marker update when goals change.
- Keep existing deterministic mocks where needed.

10. `src/components/GameManagement/CompletedPlayTimeSummary.test.tsx`
- Update or add test coverage to ensure shared comparator behavior remains correct for null/undefined jerseys.

## Risks and Edge Cases

- Invalid completed duration (`NaN`, `Infinity`, `0`, negative).
  - Mitigation: explicit duration guard and safe empty-state path.
- Overlapping/duplicate play intervals causing visual ambiguity.
  - Mitigation: deterministic ordering, consistent layering rules, and minimum visual width for non-zero segments.
- Marker and interval inputs outside bounds.
  - Mitigation: strict clamping to `[0, gameEndSeconds]` in transform.
- Sticky column readability over a scrolling track.
  - Mitigation: overlay the label column with card-background styling and scoped stacking rules.
- Missing position metadata.
  - Mitigation: fallback token (`Pos`) and preserved accessible text.
- Zero-play-time players disappearing from completed view.
  - Mitigation: transform emits lane rows for all sorted players, not only those with valid intervals.
- Comparator drift between completed views.
  - Mitigation: one shared comparator module reused by both consumers and covered by tests.
- Halftime mismatch between game override and team defaults.
  - Mitigation: explicit source precedence plus test coverage.

## Data Model / API Impact

- No GraphQL schema changes.
- No backend function changes.
- No new model fields.
- No new client queries/subscriptions.
- Existing completed-state data (`players`, `playTimeRecords`, `goals`, `positions`, half-length values) is reused.

## Dependencies and Sequencing

1. Add shared completed-state comparator module and migrate `CompletedPlayTimeSummary` to it.
2. Implement pure transform module (duration guard, clamping/sorting/labels/marker placement, halftime parity input handling).
3. Build `CompletedGameTimeline` presentational component against transform output.
4. Add scoped timeline CSS with mobile horizontal scroll behavior.
5. Wire timeline into `GameManagement` completed branch and pass resolved halftime source.
6. Add/expand transform, component, and integration tests.
7. Run focused tests for touched slice, then broader commit gate before merge.

## Test Strategy

### Transform-level unit tests

- Returns safe empty result when duration is invalid (`NaN`, non-finite, `<= 0`).
- Normalizes open-ended records and clamps to bounds.
- Drops non-positive intervals after clamp.
- Preserves empty rows for players with zero valid play time.
- Applies deterministic interval sort (start, end, id).
- Enforces minimum visual width for non-zero intervals while preserving bounds.
- Applies shared jersey comparator (including null/undefined last).
- Clamps goals outside bounds and returns minute-only accessible labels.
- Emits explicit segment accessible text with position + time span.
- Halftime parity: uses game override first, then team fallback.

### Component tests (`CompletedGameTimeline`)

- Renders one lane per sorted player.
- Renders sticky player labels that remain present alongside the horizontal timeline.
- Renders segment labels and goal marker visuals with screen-reader text.
- Shows halftime divider only when in range.
- Renders safe empty state for invalid duration using `.empty-state`.
- Renders empty lanes for zero-play-time players without breaking row alignment.
- Keeps minute-only text format (`X'`).
- Uses design-token-backed classes/styles for goal markers and divider/axis visuals.

### Integration tests (`GameManagement` completed state)

- Timeline appears only in completed branch.
- Timeline updates marker rendering when goals data changes due to add/edit/delete flow (state/prop rerender simulation).
- Confirms halftime prop passed with game-override-first precedence.

## Assumptions

- Completed-state `gameEndSeconds` source remains `gameState.elapsedSeconds`.
- Completed-state subscriptions continue to deliver goal mutations without introducing new fetch flows.
- Existing accessibility helper class (`.sr-only`) remains available for marker labels.
- Existing card background token/surface color is already available for the sticky label overlay treatment.
- No new design token additions are required for this feature.
