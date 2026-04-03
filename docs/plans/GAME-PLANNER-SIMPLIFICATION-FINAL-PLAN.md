# Game Planner Simplification - Final Implementation Plan

## Scope
Simplify `GamePlanner` so lineup editing lives in the Rotations experience, preserve existing plan persistence behavior, and improve discoverability by always showing expanded details with a selected timeline pill.

User decisions incorporated:
1. Start and HT lineup editors appear only when that timeline pill is selected.
2. Before a plan exists, coaches can set rotation schedule and always see initial lineup and halftime pills.
3. In halftime view, substitution summary remains below the full lineup editor.
4. Rotation details are always expanded with one pill always selected; default selection is Start on load (or first valid pill).

## Current-State Summary (Validated)
- `GamePlanner` has three tabs: availability, lineup, rotations.
- Timeline pills render only when `gamePlan && rotations.length > 0`.
- Start detail panel is read-only with CTA to edit in Lineup tab.
- HT detail panel is substitutions/continuing-player summary with CTA to edit in Lineup tab.
- Editable first-half and second-half `LineupBuilder` are currently only in Lineup tab.
- Halftime persistence is already implemented through `GamePlan.halftimeLineup` and halftime `PlannedRotation` diffs.

## Requirements Mapping

### R1 - Pill-scoped lineup editing
- Move first-half lineup editing UI into selected Start timeline detail panel.
- Move halftime lineup editing UI into selected HT timeline detail panel.
- Remove edit CTAs that redirect to Lineup tab.

### R2 - Pre-plan schedule + always-visible Start/HT pills
- Keep schedule controls available before plan exists.
- Render a pre-plan timeline that includes at minimum Start and HT pills derived from current schedule inputs.
- Keep detail area visible and useful before persistence (plan creation still occurs only on `Create Game Plan`).

### R3 - Halftime composition ordering
- In HT detail panel, render full editable lineup first.
- Render substitutions summary and continuing list beneath the editor.

### R4 - Discoverability default
- Enforce exactly one selected pill when timeline has items.
- Default selected pill to Start on initial load.
- If Start is unavailable in edge states, select first valid pill.
- Remove toggle-off behavior that can collapse detail area to empty.

## Explicit Invariants and Contracts

### I1 - Persistence invariant (Create and Update)
- `Create Game Plan` and `Update Plan` flows must preserve these persistence semantics:
  - `GamePlan.startingLineup` stores Start lineup assignments.
  - `GamePlan.halftimeLineup` stores halftime lineup assignments (nullable only when intentionally unset by product rules; no accidental nulling during unrelated schedule edits).
  - Halftime `PlannedRotation` entry remains a diff-only representation (`plannedSubstitutions`) computed against the effective lineup immediately before halftime.
- Any UI refactor must keep current diff pipeline behavior unchanged (`computeLineupAtRotation` -> `computeLineupDiff` -> downstream recalculation updates).
- Non-halftime timeline edits must not overwrite `GamePlan.halftimeLineup` unless the selected halftime editor was intentionally changed.

### I2 - Stable timeline identity + deterministic reconciliation contract
- Each timeline pill uses a stable key identity:
  - Start pill key: `starting`
  - Halftime pill key: `halftime`
  - Rotation pill key: persisted rotation `id` when present; otherwise deterministic synthetic key derived from `(rotationNumber, gameSeconds)` in pre-plan mode.
- Selection reconciliation rule (must be deterministic):
  1. Preserve current selection if its key still exists after timeline recompute.
  2. Else select Start (`starting`) when present.
  3. Else select first available key in timeline order.
- Reconciliation must run after schedule edits and after observeQuery updates so selection does not jump unexpectedly.

### I3 - Rendering invariant
- Exactly one details panel is mounted for the currently selected pill.
- Non-selected pill details and editors are not mounted (not hidden-only), preventing duplicate focus targets, stale local editor instances, and unnecessary autosave side effects.

### I4 - Pre-plan halftime local edit lifecycle invariant
- Before a persisted plan exists, halftime lineup edits are local draft state only.
- Local draft lifecycle:
  - Dirty state is set on first user halftime edit and tracked independently from Start dirty state.
  - Schedule changes that alter timeline shape but preserve halftime semantics retain dirty halftime draft.
  - Schedule changes that invalidate halftime context (for example, half length/interval changes that require recomputing fallback halftime baseline) trigger a user warning and require explicit keep/reset choice.
  - If coach chooses keep, retain local halftime draft and reconcile against new timeline keys.
  - If coach chooses reset, clear halftime draft dirty state and regenerate from fallback computed halftime lineup.
- On `Create Game Plan`, current local halftime draft (if dirty) is serialized into `GamePlan.halftimeLineup` and halftime diff generation follows existing semantics.

### I5 - Accessibility and interaction invariant
- Timeline pills must be implemented with explicit single-select semantics:
  - Use `role="tablist"` + `role="tab"`/`aria-selected` + `aria-controls` (preferred), or `role="radiogroup"` + `role="radio"` with equivalent single-select behavior.
  - Keyboard support: Left/Right (or Up/Down) moves selection between pills, Home jumps to first, End jumps to last, Enter/Space selects focused pill.
  - Selected-state announcement must be exposed to assistive tech via `aria-selected=true` and accessible selected styling.
- Details region must have a stable relationship to selected pill (`aria-labelledby` to selected pill id).

### I6 - Focus and scroll transition invariant
- On pill selection change by keyboard, focus remains on the newly selected pill.
- On pill selection by pointer/touch, do not force focus into details editor automatically.
- Details region scroll behavior:
  - Keep selected pill row visible (scroll selected pill into view on overflow timeline).
  - Avoid jarring full-page jumps; use nearest-block alignment for details reveal and preserve user scroll when selection changes within visible viewport.

### I7 - Mobile labels and empty/fallback copy invariant
- Timeline pill labels on narrow viewports must include context prefixes:
  - Start pill: `Start` (or `Start Lineup` when space allows)
  - Halftime pill: `HT`
  - Rotation pills: `R1`, `R2`, ...
- Details header labels on mobile must expand context:
  - Start: `Starting Lineup`
  - Halftime: `Halftime Lineup`
  - Rotation: `Rotation N`
- Empty/fallback copy matrix must be explicit and test-covered:
  - No available players: `Mark players as available above to generate a rotation plan.`
  - No plan persisted yet (rotations tab active): `Set your lineup and schedule, then create your plan.`
  - Halftime fallback (no explicit halftime lineup yet): `Halftime lineup is using the current projected lineup. Edit to customize before saving.`
  - Timeline unavailable due to transient loading: `Loading timeline...` (non-error, skeleton-friendly).

## Implementation Plan

### 1) Selection Model + Timeline Data Refactor
- Keep `RotationSelection` union (`'starting' | 'halftime' | number`), but remove nullable usage in UI path.
- Add a helper to compute display timeline items from current schedule values, regardless of `gamePlan` existence.
  - Planned mode: existing persisted rotations + halftime marker logic.
  - Pre-plan mode: synthesized Start + HT pills using `halfLengthMinutes`, `rotationIntervalMinutes`, and derived halftime rotation number.
- Update selection state management:
  - Initialize selection to `'starting'`.
  - On timeline changes, reconcile using stable-key contract: preserve current key if exists; else Start; else first key.
  - `handleRotationClick` becomes set-only (no deselect).
  - Maintain a key map (`RotationSelectionKey`) so selection does not depend on unstable array index.

### 2) Move Start Editor into Start Detail Panel
- Replace Start read-only grid in `renderSelectedDetails` with `LineupBuilder` for first-half lineup.
- Use existing `handleLineupChange` autosave behavior when `gamePlan` exists; keep local editing before plan exists.
- Keep bench visibility in `LineupBuilder` behavior as-is.

### 3) Move HT Editor into HT Detail Panel
- Replace HT read-only/CTA structure with:
  1. `LineupBuilder` bound to `halftimeLineupForDisplay` and `handleHalftimeLineupChange`.
  2. Existing substitutions summary block.
  3. Existing continuing list block.
- Preserve current halftime diff recalculation pipeline unchanged (`computeLineupAtRotation`, `computeLineupDiff`, downstream recalculation).
- Ensure only selected-panel editor mounts (unselected editors unmounted).

### 4) Simplify/Retarget Tabs
- Keep `availability` and `rotations` tabs as primary planner flow.
- Remove `lineup` tab from navigation and panel rendering.
- Preserve pre-game notes rendering and other non-lineup planner content.
- Initial tab logic defaults to `rotations` so timeline/details are immediately visible.

### 5) Pre-plan Details Behavior
- In `rotations` tab, always render timeline + selected details below schedule card.
- For pre-plan mode:
  - Start panel edits local `startingLineup`.
  - HT panel shows editable lineup from fallback (`halftimeLineupForDisplay`) and local dirty-state indicator.
  - Any HT save attempts before plan exists should be guarded to local state only (no API calls), then persisted at plan creation through existing `halftimeLineup` inclusion logic.
  - On schedule changes that alter halftime baseline assumptions, show explicit keep/reset warning before mutating local halftime draft.

### 6) Styling + UX Adjustments
- Remove styles tied to deprecated lineup-tab-only second-half section and HT edit-link CTA.
- Add/adjust classes for inline lineup editors in details panels so layout remains readable on mobile.
- Ensure active timeline pill is always visually indicated.
- Add selected details region heading/ids to support `aria-labelledby` relationship.
- Ensure timeline overflow behavior supports horizontal scroll with selected-pill auto-visibility.

### 7) Accessibility + Focus Behavior
- Implement single-select timeline semantics and keyboard interactions (Arrow/Home/End/Enter/Space).
- Ensure selected-state announcement (`aria-selected`) and visible focus ring contrast meet existing token standards.
- On keyboard selection transitions, keep focus on selected pill; do not auto-shift focus to editor.
- Preserve scroll position and avoid abrupt viewport jumps when details panel content changes.

### 8) Mobile Copy + Empty/Fallback States
- Define mobile label variants for pill text and details headings.
- Add explicit fallback copy states for pre-plan, halftime fallback, and timeline-loading states.
- Keep copy concise for sideline readability and ensure no layout overflow at narrow widths.

## File-by-File Change List

### `src/components/GamePlanner.tsx`
- Refactor tab union/state to remove lineup tab path.
- Refactor timeline item derivation to support both persisted and pre-plan modes.
- Change selected rotation state from nullable toggle model to always-selected stable-key model.
- Replace Start detail panel with editable `LineupBuilder`.
- Replace HT detail panel with editable `LineupBuilder` + substitutions summary below.
- Keep existing rotation-number detail editor behavior unchanged.
- Update pre-plan rendering so timeline/details always show.
- Add pre-plan halftime dirty-state lifecycle handling (retain/reset warning on invalidating schedule changes).
- Add timeline ARIA semantics and deterministic keyboard navigation.
- Add focus/scroll behavior for selection transitions.

### `src/App.css`
- Remove or repurpose styles that only support old Lineup-tab halftime block and `ht-edit-link` CTA.
- Add/adjust styles for detail-embedded lineup editors in Start and HT panels.
- Ensure spacing and hierarchy for HT lineup editor followed by substitutions summary.
- Add styles for selected/focused timeline pills and details-region relationship affordances.
- Add responsive label handling for narrow mobile timeline pills.

### `src/components/GamePlanner.interaction.test.tsx`
- Replace test asserting "Edit in Lineup tab" navigation with assertions for inline editing presence in Start panel.
- Add assertion that one timeline pill is selected by default and cannot be deselected to empty state.
- Add deterministic reconciliation tests for stable key selection after schedule/timeline recompute.
- Add keyboard accessibility tests for timeline pill navigation and selected-state announcement semantics.
- Add focus behavior tests for keyboard and pointer selection transitions.

### `src/components/GamePlanner.test.ts`
- Keep existing lineup/substitution algorithm tests.
- Add selection/timeline utility-level tests if helpers are extracted; otherwise extend behavior coverage in interaction tests.
- Add regression test: pre-plan halftime edits, then `Create Game Plan`, persists correct halftime diff semantics.
- Add lifecycle tests for pre-plan halftime dirty retain/reset decisions after schedule changes.

### `e2e/game-planner.spec.ts`
- Remove dependency on Lineup tab for first-half/second-half editing workflow.
- Update flow to use Start and HT pills directly for lineup edits.
- Add checks that timeline/details are visible before plan creation and Start is preselected.
- Add mobile viewport checks for pill labels and fallback copy matrix.
- Add keyboard-only traversal for timeline pills and selected details visibility.

### `e2e/full-workflow.spec.ts`
- Update any planner steps that navigate via Lineup tab to use timeline Start/HT panels.
- Keep downstream recalculation assertions, now against HT panel ordering and content.
- Add cross-screen regression assertion that created plan preserves halftime diff behavior when halftime was edited pre-plan.

## Data Model / API Impact
- No schema changes.
- No new models or fields.
- Existing persistence path remains:
  - `GamePlan.startingLineup`
  - `GamePlan.halftimeLineup`
  - `PlannedRotation.plannedSubstitutions` for halftime diff and downstream rotations
- API volume pattern remains similar; no new backend endpoints.

## Dependencies
- Existing `LineupBuilder` component behavior and props.
- Existing halftime diff utilities:
  - `computeLineupAtRotation`
  - `computeLineupDiff`
- Existing observeQuery sync behavior in `GamePlanner`.

## Risks and Mitigations
- Risk: Pre-plan HT editor confusion if no persisted rotations exist.
  - Mitigation: Clear helper text and ensure values roll into `handleUpdatePlan` serialization.
- Risk: Selection reconciliation bugs when interval changes alter timeline shape.
  - Mitigation: stable timeline key contract and deterministic reconcile rule with unit coverage.
- Risk: E2E brittleness due changed interaction path.
  - Mitigation: migrate selectors to timeline/detail-driven flow and avoid obsolete tab selectors.
- Risk: Mobile vertical space pressure with inline editors in details.
  - Mitigation: keep compact section headers, preserve existing card spacing tokens, validate on small viewport in e2e.
- Risk: Pre-plan halftime draft loss on schedule edits.
  - Mitigation: explicit dirty lifecycle with keep/reset warning and deterministic retain/reset behavior.
- Risk: A11y regressions from custom pill interactions.
  - Mitigation: tab/radio semantics, keyboard tests, and screen-reader selected-state assertions.

## Edge Cases
- `rotationsPerHalf = 0` (halftime-only): Start and HT pills still render; HT selected state works.
- Interval/half-length edits that shift halftime marker placement: selected pill remains valid or falls back deterministically.
- Plan exists but rotations temporarily empty during observeQuery transitions: timeline falls back safely, no null details gap.
- Halftime lineup unset (`null`): HT editor displays fallback computed lineup and persists once explicit edits are made.
- Pre-plan halftime dirty draft + interval change: coach must choose keep or reset before draft mutation.
- Key identity shift from transient to persisted rotations after create/update: selection reconciles by key contract without unexpected jumps.

## Test Strategy

### Unit/Component (Vitest + RTL)
- Default selected pill is Start on initial rotations view.
- Clicking selected pill does not deselect/hide details.
- Start panel renders editable lineup controls.
- HT panel renders editable lineup controls and substitutions summary below.
- Pre-plan state renders Start/HT pills and detail panel before plan creation.
- Deterministic selection reconciliation contract: preserve key, else Start, else first.
- Rendering invariant: only selected panel/editor is mounted.
- Pre-plan halftime dirty lifecycle: retain/reset behavior and warning path.
- Timeline a11y semantics: single-select roles, `aria-selected`, keyboard navigation, details-region association.
- Focus/scroll transition assertions for pill selection changes.

### E2E (Playwright)
- New-game planner flow shows timeline/detail content immediately in Rotations tab.
- Start pill editing changes lineup without navigating to Lineup tab.
- HT pill editing updates halftime lineup and displays substitutions summary underneath editor.
- Create/update plan persists both starting and halftime lineup changes.
- Downstream rotation recalculation behavior remains intact.
- Regression scenario: pre-plan HT edits followed by create plan persist correct halftime diff behavior.
- Mobile copy and label matrix verifies Start/HT/Rotation context and fallback texts.

### Regression/Commit Gate
- Run `npm run gate:commit` after test updates.
- If gate fails, troubleshoot failing planner/e2e specs first (likely selector and flow updates).

## Acceptance Criteria
- Coaches can edit first-half lineup only within selected Start pill details.
- Coaches can edit halftime lineup only within selected HT pill details.
- Before plan creation, schedule controls are available and timeline shows Start + HT with details visible.
- HT details display full lineup editor first, then substitution summary and continuing players.
- Timeline always has one selected pill; Start is selected by default on first load (fallback to first valid pill when needed).
- Selection reconciliation is deterministic by stable key contract: preserve if key exists; else Start; else first key.
- Only selected pill details panel/editor is mounted.
- Pre-plan halftime draft lifecycle (dirty retain/reset warning behavior) is implemented and tested.
- Timeline pills satisfy keyboard/a11y semantics with selected-state announcement and details-region relationship.
- Focus/scroll behavior for pill transitions is stable and non-jarring.
- Mobile labels and empty/fallback copy matrix is implemented and verified.
- No regression to halftime persistence and downstream rotation recalculation.
- Planner tests and e2e flows pass with the simplified interaction model.

## Clarifications
- No blocking clarifications remain based on current decisions.
