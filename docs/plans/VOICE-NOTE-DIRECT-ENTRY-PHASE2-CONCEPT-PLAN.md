# Phase 2 Concept Plan: Direct Voice-Note Entry from Live Game View

Status: Draft Stage 1 (implementation-planner)
Date: 2026-03-30

## Goal
Enable direct in-game voice-note entry from the live Game Management surface without requiring coaches to navigate to the Notes tab first, while preserving existing secure persistence and the current Notes tab workflow.

## Inputs and Carried Defaults (from approved Phase 1)
- Low-confidence warning threshold: below 70%.
- Silence auto-stop timeout: 10 seconds.
- End-of-recording cue: visual cue plus short vibration when supported.
- Save behavior: explicit Save required, no auto-save.
- Primary device/browser target: iPhone Safari and iPhone Chrome.

## Confirmed Phase 2 Decisions
- CommandBand trigger style on narrow iPhone widths: icon-only.
- Direct-entry default note type from CommandBand: always other (display label: Note).
- Halftime direct-entry trigger surface of truth: halftime action row in the halftime layout (not CommandBand), because halftime intentionally has no CommandBand in UI-SPEC.

## UI-SPEC Alignment Updates (Required)
- `docs/specs/UI-SPEC.md` section 7.4 (Game Management - In Progress): add direct note trigger in CommandBand and define responsive coexistence contract with rotation badge.
- `docs/specs/UI-SPEC.md` section 7.5 (Game Management - Halftime): add halftime action row and declare direct note trigger ownership in halftime surface.
- `docs/specs/UI-SPEC.md` section 8 (Modal & Overlay Patterns): add voice-note modal launch/focus/keyboard behavior and save lifecycle states.
- Alignment rule: implementation must follow this plan and UI-SPEC updates together; if one changes, both must be updated in the same PR.

## Architecture Lock (Post-Architect Review)
- Use one always-mounted shared note modal controller at the GameManagement level.
- Notes tab actions and CommandBand actions both dispatch to this shared controller.
- Direct open is supported from in-progress non-notes tabs and halftime without forced tab switching.
- Keep one canonical modal/editor implementation and one save path.

### Shared Open API Contract
- Controller API (source-discriminated by shape):
  - `openNoteModal(intent: NoteOpenIntent)`
  - `type NoteOpenIntent =`
    - `{ source: 'command-band'; defaultType: 'other' }`
    - `| { source: 'notes-tab' }`
- Contract rules:
  - `source: 'command-band'` is only valid with `defaultType: 'other'` present and equal to `other`.
  - `source: 'notes-tab'` must not provide `defaultType`; Notes tab keeps existing defaults (no behavior regression).
  - Opening from CommandBand must never trigger a tab change.
  - Opening from in-progress Lineup and Bench tabs must not trigger a tab change.
  - Opening from halftime must use the same controller and modal behavior as in-progress.

## Scope Boundaries
In scope:
- New direct entry point from live game UI (CommandBand/active game shell).
- Reuse existing note modal and secure save path.
- Keep existing Notes tab behavior intact.

Out of scope:
- Backend schema changes.
- Auto-save behavior.
- Non-iPhone browser optimization beyond graceful fallback.

## UX Option A: Quick Capture Sheet

Concept:
- Add a mic quick action in CommandBand for in-progress and halftime states.
- Tap opens a compact bottom sheet optimized for immediate recording.
- The sheet defaults to note type other and optional player None, with one prominent Start Dictation control.
- Coach can stop, review text, and explicitly Save or Cancel.

Interaction model:
- Fastest capture path prioritizes speed over context.
- Optional Expand action opens full note modal for richer editing/player attribution.

Tap count from live in-progress field view (common case):
- 4 taps: Open mic, Start, Stop, Save.

Strengths:
- Minimal cognitive load during live play.
- Predictable one-thumb operation.
- Lowest tap count.

Tradeoffs:
- Weaker player and note-type context at entry.
- Requires an additional expand/secondary action for richer tagging.

## UX Option B: Contextual Modal Launcher

Concept:
- Add a Note action in CommandBand that opens the existing full in-game note modal directly (same component model used by Notes tab), with voice controls already visible.
- Coach lands in familiar full context: note type chips, player selector, textarea, voice controls.
- When opened from CommandBand, initialize note type to other (display label: Note).
- Optional prefill based on current game context (for example, currently selected player from substitution flow) if available, but no hard coupling required.

Interaction model:
- Prioritizes consistency and data quality over raw speed.
- Keeps one canonical note editor surface.

Tap count from live in-progress field view (common case):
- 4 taps: Open note modal, Start, Stop, Save.
- 5 taps when changing type or selecting player.

Strengths:
- Reuses established Notes tab mental model and tests.
- Better attribution and classification quality.
- Lower implementation risk and less duplicated UI logic.

Tradeoffs:
- Slightly denser UI than a minimal sheet.
- May consume more vertical space on smaller iPhones when keyboard and recording controls are visible.

## Recommendation
Recommend Option B: Contextual Modal Launcher.

Reasoning:
- Same best-case tap count as Option A (4 taps) for direct capture.
- Lower architectural and QA risk because it reuses the existing modal path and secure save integration.
- Stronger backward compatibility because Notes tab and direct entry share one editor implementation.
- Better in-game safety: fewer divergent flows and less chance of mismatch between quick-capture and full notes behaviors.
- Strong architectural determinism: one always-mounted controller serves all entry points.

## CommandBand Placement and In-Game Safety Risks

1. Risk: Sticky CommandBand is already dense; adding another action increases accidental taps near Pause/Resume and Back.
- Mitigation: Place voice-note action in right cell as a distinct icon+label chip with minimum 44x44 tap area and spacing from timer controls. Keep destructive or navigation controls visually separated.

2. Risk: Rotation badge currently occupies right cell in some in-progress states; new action could conflict with rotation access.
- Mitigation: Use a dual-action right cell layout with deterministic priority.
- Priority rule: If rotation badge is visible, render voice-note as an adjacent icon button, not a replacement.
- Deterministic responsive coexistence rules:
  - At >= 430px: right cell can show rotation icon+count+label and note icon+label.
  - At 390px: right cell max width is 136px; note action is icon-only; rotation keeps icon+count and may keep short label only if no overlap.
  - At 375px: right cell max width is 124px; note action is icon-only; rotation is icon+count only (no helper label).
  - Right-cell spacing and non-overlap constraints:
    1. Minimum gap between right-cell actions: 8px.
    2. Minimum gap from center content to right cell: 8px.
    3. Right cell must never overlap or visually occlude center score/clock text; center text truncates first.
    4. Both right-cell action hit targets stay >=44x44 CSS px across all required iPhone widths.
  - Collapse order at reduced width is fixed:
    1. Hide note action text label (note icon remains).
    2. Hide rotation helper label text (rotation icon + count remain).
    3. Truncate center informational text in CommandBand before any hit-target reduction.
  - Non-collapsible essentials: note icon button, rotation icon, rotation count badge, and both action hit targets (>=44x44).
  - Never hide or replace rotation badge with note action, and never hide note action when direct entry is enabled.

3. Risk: Coaches may trigger note recording during critical gameplay moments, causing attention shift.
- Mitigation: Keep direct-entry first screen minimal and non-blocking to game state.
- Do not pause timer automatically.
- Ensure modal can be quickly dismissed with one tap and no data loss warning if empty.

4. Risk: Overlay and sticky layers can clash with existing z-index stack and hide key controls.
- Mitigation: Keep modal overlay at existing modal layer (1000) and avoid custom z-index increments unless needed.
- Validate on iPhone portrait: CommandBand underneath modal, no clipping of Stop/Save above safe-area inset.

5. Risk: Audio lifecycle events could create unintended saves under pressure.
- Mitigation: Preserve explicit Save gate only.
- Ensure start/stop/timeout/onend never call persistence mutations.

## Direct Trigger Affordance Contract (Icon-Only)

CommandBand icon-only trigger (in-progress):
- Icon glyph semantics: microphone with note/plus affordance indicating create note by voice; no ambiguous "record-only" iconography.
- Accessible name: `Add note` via `aria-label` on the button.
- Focus visibility: high-contrast 2px ring using existing focus token pattern; must remain visible against CommandBand background.
- Touch target: minimum 44x44 CSS px.
- Tooltip/assistive hint behavior:
  - Pointer/hover-capable: tooltip text `Add note` on hover/focus.
  - Touch-only iPhone: no persistent tooltip; accessible name is announced by screen readers.
  - Tooltip must not block adjacent rotation action hit area.

Halftime trigger affordance:
- Surface of truth is halftime action row control labeled `Add note` (icon + text allowed at halftime).
- Halftime trigger uses same modal open contract and same accessibility contract (`aria-label`, focus style, 44x44 target).

## Modal Launch and Keyboard Behavior Contract

When modal is opened from either CommandBand or halftime action row:
- Initial focus target: note text input/textarea.
- Keyboard auto-open policy:
  - iPhone/touch devices: auto-focus textarea on open to request software keyboard immediately.
  - Non-touch desktop/tablet with hardware keyboard: focus textarea but do not force virtual keyboard behavior.
- Guaranteed CTA visibility with keyboard open:
  - `Stop` (when recording is active) and `Save` must remain visible and tappable above keyboard/safe-area inset.
  - If viewport is constrained, modal body scrolls; CTA row remains sticky within modal footer.
- Focus trap and escape:
  - Modal traps focus while open, returns focus to triggering control on close.
  - Keyboard dismissal (Done) must not close modal or clear draft text.

## Entry Path Parity Contract

Strict parity requirement between command-band direct entry and notes-tab entry:
- Same modal component, same field order, same validation rules, same error presentation, same save mutation path.
- Same loading/disabled states, same retry UX, same offline/pending semantics.
- Same analytics event structure except for `source` dimension.
- Only allowed behavioral difference: default note type initialization.
  - Command-band/halftime direct entry default: `other`.
  - Notes-tab entry default: existing Notes-tab default behavior unchanged.

Parity regression rule:
- Any future modal change must be verified for both entry sources in the same test update.

## Save Lifecycle and Failure Recovery Contract

Save states (single-submit lifecycle):
1. `idle`: Save enabled when form valid.
2. `saving`: Save disabled, spinner/`Saving...` label, duplicate submit blocked.
3. `success`: modal closes per existing behavior and success feedback is shown.
4. `failed`: modal stays open, inline error shown, Save re-enabled, draft retained.

Failure recovery behavior:
- Duplicate submit prevention: ignore additional Save taps/Enter while `saving`.
- Draft retention on failed save: preserve note text, selected player, note type, and voice transcript text.
- Retry path: user can tap Save again without re-entering content.
- Cancel after failed save: prompt only if draft is non-empty; otherwise close immediately.

## Backward Compatibility Plan (Notes Tab)

Compatibility objective:
- Existing Notes tab flow remains fully functional and behaviorally unchanged for users who continue to enter notes via tab navigation.

Approach:
- Keep PlayerNotesPanel as the canonical editor for both entry paths.
- Lift modal orchestration to an always-mounted shared controller in GameManagement.
- Route both Notes tab and CommandBand open intents through `openNoteModal(...)`.
- Introduce a controlled open API (props/state) so GameManagement opens the same modal from Notes tab or CommandBand without tab switching.
- Preserve existing note type buttons and list rendering in Notes tab.
- Preserve existing secure mutation path through useOfflineMutations.createGameNote.

Regression guardrails:
- Existing PlayerNotesPanel tests remain and are expanded, not replaced.
- Add tests proving both entry routes produce identical save payload structure.

## File-by-File Impact and Complexity Estimate

1. src/components/GameManagement/GameManagement.tsx
- Add always-mounted shared note modal controller state and handlers.
- Implement source-discriminated `openNoteModal(intent)` contract and route both entry sources through it.
- Pass modal-control props into PlayerNotesPanel and CommandBand trigger callbacks.
- Wire CommandBand action callback.
- Complexity: Medium.

2. src/components/GameManagement/CommandBand.tsx
- Add new optional action prop(s) and render logic for direct note entry.
- Dispatch note open intent to shared GameManagement controller.
- Ensure deterministic coexistence with rotation badge and status badges in right cell.
- Enforce icon-only narrow behavior with explicit accessibility contract.
- Complexity: Medium.

3. src/components/GameManagement/PlayerNotesPanel.tsx
- Refactor to consume external shared controller state while preserving local Notes-tab actions.
- Reuse existing voice controls from Phase 1; no persistence-path change.
- Complexity: Medium-High (state coordination and backward compatibility).

4. src/App.css
- Add CommandBand action styles and deterministic responsive behavior for right-cell coexistence.
- Add icon-only trigger sizing rules with 44x44 minimum tap target.
- Verify touch target and safe-area spacing.
- Complexity: Low-Medium.

5. docs/specs/UI-SPEC.md
- Update sections 7.4, 7.5, and 8 to codify in-progress trigger, halftime trigger surface-of-truth, keyboard/focus contract, and save lifecycle states.
- Complexity: Low-Medium.

6. src/components/GameManagement/CommandBand.test.tsx
- Add coverage for new direct note action rendering, click behavior, and coexistence with rotation badge.
- Add viewport assertions for 375px and 390px right-cell coexistence rules (icon-only, non-overlap constraints).
- Complexity: Low-Medium.

7. src/components/GameManagement/PlayerNotesPanel.test.tsx
- Add tests for externally controlled modal open path and parity with Notes-tab initiated path.
- Add save lifecycle tests: saving/failed/success transitions, duplicate submit prevention, draft retention after failed save.
- Complexity: Medium.

8. src/components/GameManagement/GameManagement.test.tsx
- Add integration tests for opening note modal directly from in-progress Lineup and Bench tabs and halftime without tab switch.
- Add keyboard behavior assertions for initial focus and trigger focus return on close.
- Complexity: Medium.

9. e2e/game-management-direct-note.mobile.spec.ts (canonical mobile E2E for this feature)
- Add mobile viewport E2E verification for icon-only CommandBand note trigger behavior.
- Verify direct note modal entry from Lineup, Bench, and halftime without switching to Notes tab.
- Required viewport matrix: iPhone SE (375x667), iPhone 12/13/14 (390x844), iPhone 14 Pro Max (430x932).
- Add assertions that Stop/Save controls remain visible and tappable with software keyboard open.
- Complexity: Medium.

10. src/utils/analytics.ts (optional but recommended)
- Add events for direct note entry opened, recording started/stopped from direct path.
- Complexity: Low.

## Data Model and API Impacts
- No data model changes required.
- No GraphQL schema changes required.
- No Lambda changes required.
- Persistence remains through existing secure createSecureGameNote path wrapped by useOfflineMutations.

## Dependencies and Sequencing

Sequence:
1. Finalize shared-controller contract and source-aware open API at GameManagement level.
2. Implement CommandBand and Notes-tab dispatchers to shared controller.
3. Refactor PlayerNotesPanel modal control for external orchestration while preserving Notes-tab behaviors.
4. Implement deterministic right-cell coexistence and accessibility/tap-target styling.
5. Add/adjust unit/integration tests for both entry sources and non-tab-switch behavior.
6. Add mobile E2E coverage for icon-only trigger and halftime/field-tab direct entry.

Dependencies:
- Existing Phase 1 voice-control behavior in note modal.
- Current modal z-index and sticky layout stack.
- Existing offline mutation and secure note creation flow.

## Test Strategy

Unit/component:
- CommandBand rendering matrix:
  - in-progress with rotation badge
  - in-progress without rotation badge
  - narrow iPhone widths render voice-note trigger as icon-only
  - icon-only trigger exposes accessible name `Add note`
  - icon-only trigger keeps 44x44 target and keyboard operability
  - halftime/completed states (no unintended regressions)
- PlayerNotesPanel:
  - modal opens from command-band direct-entry trigger via shared controller
  - modal opens from Notes tab buttons via shared controller
  - command-band direct-entry path initializes note type to other (display label: Note)
  - save payload parity across both opens

Integration:
- GameManagement live view:
  - direct entry from Lineup tab without switching tabs
  - direct entry from Bench tab without switching tabs
  - direct entry from halftime without switching tabs
  - complete 4-tap flow (open/start/stop/save) with explicit save
  - parity assertions: command-band and notes-tab open paths share identical modal structure and validation/errors
  - keyboard/focus assertions: textarea receives initial focus; focus returns to trigger on close

E2E (mobile):
- Canonical spec file: `e2e/game-management-direct-note.mobile.spec.ts` (all direct-note mobile E2E assertions live here; no duplicate coverage in other specs).
- Required iPhone viewport matrix:
  - iPhone SE: 375x667
  - iPhone 12/13/14: 390x844
  - iPhone 14 Pro Max: 430x932
- For each required viewport:
  - verify CommandBand trigger is icon-only with accessible name `Add note`
  - verify right-cell max-width behavior and non-overlap with center content at 375px and 390px
  - from in-progress Lineup tab, tapping icon opens note modal directly (no Notes tab navigation)
  - from in-progress Bench tab, tapping icon opens note modal directly (no Notes tab navigation)
  - from halftime, tapping icon opens note modal directly (no Notes tab navigation)
  - verify rotation badge coexistence in right cell and independent operability where both appear
  - open keyboard and verify `Stop`/`Save` remain visible and tappable
  - simulate failed save and verify draft is retained and retry succeeds

Manual iPhone validation:
- Safari and Chrome: tapability, keyboard overlap, safe-area, vibration fallback.
- Confirm no timer pause side effect and no accidental navigation conflicts.

Accessibility contract validation:
- Icon-only trigger must provide accessible name `Add note`.
- Trigger hit target must be at least 44x44 CSS px.
- Trigger must be fully keyboard and touch operable.
- Visible focus ring on trigger must pass contrast against CommandBand background.

## Requirements Gaps and Assumptions

Gaps:
- No open requirement gaps after incorporating UI-review requirements.

Assumptions:
1. Phase 2 reuses existing voice-capture behavior and thresholds from Phase 1 without changing confidence or timeout constants.
2. In-progress trigger surface is CommandBand; halftime trigger surface is halftime action row; scheduled/completed keep existing flows.
3. Direct-entry save path must remain identical to existing Notes tab save payload semantics.
4. CommandBand direct entry always opens with `defaultType: 'other'`, matching confirmed decision.

## Risks Summary
- Primary risk concentration is UI density and tap safety in CommandBand.
- Secondary risk is state synchronization between externally opened modal and existing in-panel modal actions.
- Backend/security risk is low because persistence path remains unchanged.
