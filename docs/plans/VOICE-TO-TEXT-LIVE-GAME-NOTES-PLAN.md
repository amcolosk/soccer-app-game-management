# Voice-to-Text for Live Game Notes (Option 2 Hybrid)

Status: Draft Stage 1 Revised (implementation-planner)
Date: 2026-03-30

## Goal
Add voice-to-text capture to the in-game note modal so coaches can quickly dictate note text on iPhone Safari/Chrome, while preserving the existing secure save path and explicit save confirmation behavior.

## Confirmed Requirements in Scope
- Hybrid approach: browser-native speech recognition first, fallback to manual typing and OS dictation.
- Mobile target for v1: iPhone Safari and iPhone Chrome.
- Offline behavior: voice capture may be unavailable; manual entry remains available.
- Save behavior: no auto-save, explicit user Save action required.
- Interaction: one-tap start and one-tap stop (toggle interaction).
- Note intent support: optimized quick flow for `gold-star` and `yellow-card` live notes.
- Language: English only for v1.
- Confidence: show a warning when recognition confidence is below 70%.
- Silence timeout auto-stop: stop dictation after 10 seconds of silence.
- End cue: provide a visual completion cue and a short vibration when supported by PWA/device.
- Security and persistence: must continue using existing secure game-note mutation flow.

## Requirements Gaps and Assumptions

### Gaps requiring explicit decision before implementation
1. Behavior for multi-result dictation is not specified (append vs replace).

### Assumptions for implementation planning
1. Low-confidence warning threshold is `< 0.70` average confidence across final segments.
2. Auto-stop timeout is 10 seconds of silence, while preserving manual tap-to-stop.
3. Dictation appends to existing note text at cursor end (never replaces without user action).
4. Confidence is UI-only metadata and is not persisted to the backend.
5. Voice controls appear only in in-game note modal path (`PlayerNotesPanel`), not pre-game coaching notes.
6. Backend note text max length is 500 characters; client must enforce the same ceiling before save.
7. End cue uses visual feedback by default; vibration is additive and only used when `navigator.vibrate` is supported and permitted.

## Architecture Constraints (must-follow)
1. Persistence must reuse the existing path only: `mutations.createGameNote(...)` and `mutations.updateGameNote(...)` from the `useOfflineMutations` flow already passed into `PlayerNotesPanel`.
2. No new direct GraphQL calls, no bypass of offline queue, and no custom persistence side-channel for voice events.
3. Voice lifecycle handlers (`onresult`, `onend`, `onerror`, timeout, modal close/pagehide cleanup) must never call any persistence mutation.

## Architecture and UX Plan

### Current UX entry points (clarified)
1. Voice controls live only in the in-game note modal within the live Game Management notes flow (`PlayerNotesPanel`).
2. Common tap path to recording start is: Game Management active game view -> Notes tab -> player note action (for example Gold Star or Yellow Card) -> in-game note modal opens with note type preselected -> tap `Start Dictation`.
3. This does not introduce a new top-level entry point, route, or pre-game note voice surface.

### Phone modal pattern, safe-area, and height behavior (required)

Chosen pattern:
- Use a bottom-sheet style full-width phone modal for live notes on iPhone, anchored to bottom edge.
- Keep the note type quick-intent actions and mic control cluster inside a sticky top rail within the modal body.

Height and safe-area behavior:
1. Modal max height uses dynamic viewport units to avoid keyboard overlap (`max-height: 100dvh`).
2. Modal content uses internal scrolling; page behind modal must not scroll.
3. Sticky control rail remains visible while textarea scrolls.
4. Bottom padding includes `env(safe-area-inset-bottom)` so primary actions remain tappable above home indicator.
5. When keyboard opens, modal shrinks to available viewport height and preserves visible one-tap Stop control.

Acceptance criteria:
1. On iPhone Safari and iPhone Chrome, with keyboard open, Stop control remains visible without additional scrolling.
2. No clipped primary controls at top/bottom in portrait mode with safe-area insets.
3. Textarea remains editable with at least 4 visible lines while keyboard is open.

### Explicit speech finite-state machine (FSM)

States:
- `idle`
- `starting`
- `listening`
- `stopping`
- `stopped` (terminal state marker with reason)

Terminal reasons:
- `manual-stop`
- `timeout`
- `onend`
- `onerror`
- `modal-close`
- `visibility-hide`

Allowed transitions:
1. `idle -> starting` on trusted mic button tap.
2. `starting -> listening` when engine starts successfully.
3. `starting -> stopped(onerror)` on start failure.
4. `listening -> stopping` on manual stop tap.
5. `listening -> stopped(timeout)` on silence timeout.
6. `listening -> stopped(onerror)` on speech engine error.
7. `listening -> stopped(onend)` when engine ends naturally.
8. `listening -> stopped(modal-close)` on modal close/cancel.
9. `listening -> stopped(visibility-hide)` on `visibilitychange` hidden or `pagehide`.
10. `stopping -> stopped(onend)` when engine confirms end.
11. `stopped(*) -> idle` only through explicit reset when user starts another dictation session.

Idempotent terminal handling:
- Implement a single `finalizeSession(reason)` guard that is idempotent per session token.
- First terminal event wins; duplicate terminal events are ignored.
- All terminal reasons converge on the same cleanup path (clear timers, detach listeners, mark not listening).
- Manual stop plus subsequent `onend` must not produce double state updates.

### iOS capability gating and acceptance criteria

Runtime capability checks (all required for active mic UI):
1. Secure context is true (`window.isSecureContext === true`).
2. API exists (`window.SpeechRecognition` or `window.webkitSpeechRecognition`).
3. Start action originates from explicit user gesture (mic button click/tap event).

Behavior rules:
- If any check fails, app enters fallback-only mode.
- Fallback-only mode hides/disabled active mic capture control and shows helper text to type or use iOS keyboard dictation.
- Fallback-only is explicitly acceptable for unsupported iOS browser paths (including constrained webviews or browser versions lacking API support).

Acceptance criteria:
1. iPhone Safari supported path with all gates true: start/stop works.
2. iPhone Chrome supported path with all gates true: start/stop works.
3. Any iOS path with missing API or insecure context: no crash, no mic start attempt, fallback helper shown.
4. No recognition start occurs without user gesture.

### Client-side dictated text normalization and length enforcement

Normalization pipeline applied before writing transcript into textarea state:
1. Unicode normalize to NFKC.
2. Convert line breaks/tabs to single spaces.
3. Collapse repeated whitespace to single spaces.
4. Trim leading/trailing whitespace.

Length policy:
1. Enforce hard max of 500 characters in UI (`textarea maxLength=500`).
2. Clamp merged dictated text to 500 before `setNoteText`.
3. Re-clamp on Save to guarantee backend-aligned limit even under race conditions.
4. Show character count and truncation warning when clipping occurs.

### High-level flow
1. Coach opens live note modal (`gold-star`, `yellow-card`, `red-card`, `other`).
2. Component evaluates iOS capability gates and chooses active mic mode or fallback-only mode.
3. Coach taps microphone control once to start recognition (trusted gesture), entering FSM `starting` then `listening`.
4. Interim/final transcript is normalized and merged into note text (capped at 500 chars).
5. Coach taps visible one-tap Stop control to stop, or recognition terminates via 10-second silence timeout/onend/onerror/modal close/visibility hide using idempotent terminal handling.
6. On terminal stop, show visual completion feedback and trigger a short vibration when supported by PWA/device.
7. Final transcript remains editable in textarea.
8. Coach explicitly presses Save Note to persist via existing `mutations.createGameNote` path.

### UX states and edge cases

### Mobile-first control layout and tap-target contract

Control layout requirements:
1. Controls are arranged for thumb reach on phones with primary actions clustered at the lower half of modal content.
2. While recording, Stop is a dedicated always-visible control in the sticky rail; do not hide behind keyboard.
3. All tappable controls in modal meet minimum 44x44 CSS pixel target size.
4. Visual spacing between adjacent controls is at least 8 CSS pixels to reduce accidental taps.

Control set:
- Quick-intent chips/buttons for note type: gold star and yellow card are first in order.
- Mic control cluster: Start Dictation, Stop Dictation, state label.
- Save/Cancel row pinned above safe area in modal footer.

### Transient state contract (explicit)

Required transient UI states:
1. `starting`: disable note-type switching and disable Start control; show helper copy `Starting microphone...`.
2. `stopping`: disable Start/Stop toggles and disable note-type switching; show helper copy `Stopping microphone...`.
3. `finalizing`: disable Save for the brief merge/finalization window; show helper copy `Finalizing transcript...`.

Rules:
1. Textarea remains editable in all transient states except any short finalizing lock window (max 500 ms target).
2. Disabled controls must have visible disabled styling and accessible disabled semantics.
3. Transient helper copy appears inline near controls and is announced politely.

#### Idle / supported
- Mic toggle visible with label `Tap to Dictate`.
- English language hint shown (`English only`).
- Start control accessible name: `Start English dictation`.

#### Recording active
- Mic toggle changes to `Tap to Stop`.
- Visual active state (`Recording...`) and optional subtle pulse indicator.
- Note text updates with interim/final transcript.
- Stop control remains visible even when keyboard is open.
- Stop control accessible name: `Stop dictation`.

#### Unsupported browser/API/insecure context
- If `SpeechRecognition`/`webkitSpeechRecognition` unavailable or context not secure, hide active mic control and show helper text: `Voice capture is not supported in this browser. Type your note manually, or use iPhone keyboard dictation (tap the microphone key on the keyboard).`
- English-only guidance remains explicit: `English dictation is supported in this release.`

#### Permissions denied / blocked
- Stop recording and show non-blocking warning toast plus inline message.
- Leave typed text untouched.

#### English-only unsupported-state fallback (no dead-end)
- Always provide a successful completion path:
  - manual typing in textarea remains fully available.
  - explicit guidance for OS keyboard dictation on iPhone.
- Copy guidance must be plain English and action-oriented; avoid technical error wording only.
- Save remains available whenever textarea has valid content.

#### Timeout / no speech detected
- Stop recording and show warning (`No speech detected. Try again or type note manually.`).
- No modal close, no save attempt.

#### Network offline during recognition
- If speech service requires network and fails, show warning and keep manual typing enabled.
- Saving still works through existing offline queue path when user presses Save.

#### Low confidence
- If final confidence is below threshold, display inline warning near textarea (`Transcription may be inaccurate. Please review before saving.`).
- Save remains enabled; user review remains explicit gate.

### Accessibility interaction contract (required)

Focus behavior:
1. On modal open, initial focus lands on modal title for screen reader context, then next Tab reaches note type quick-intent controls.
2. On modal close, focus returns to the exact opener control that launched the modal.

Accessible naming rules:
1. Idle mic button name: `Start English dictation`.
2. Active mic button name: `Stop dictation`.
3. During `starting` and `stopping`, control names remain stable and include busy semantics via state text, not renamed per frame.

ARIA live priority rules:
1. `aria-live=polite` for normal state updates (`Recording started`, `Recording stopped`, helper copy).
2. `aria-live=assertive` only for blocking/error guidance (permission denied, unsupported capture path explanation).
3. Do not send duplicate consecutive live-region messages for the same state transition.

Keyboard and switch interaction:
1. All controls reachable in logical order.
2. Enter/Space activate Start/Stop and quick-intent actions.
3. Escape closes modal only when not in finalizing lock window.

### Message hierarchy and collision rules (required)

Priority order (highest first):
1. Blocking/terminal errors (permission denied, API unavailable in supported path).
2. Transient processing state copy (`starting`, `stopping`, `finalizing`).
3. Low-confidence advisory.
4. Informational hints (English-only, keyboard dictation tip).

Collision rules:
1. Show only one inline message per priority level region.
2. When a higher-priority inline message appears, lower-priority inline hint in same region is hidden.
3. Toasts are for ephemeral event notifications; inline messages are for actionable next-step guidance that must remain visible.

Toast versus inline mapping:
- Inline only: unsupported fallback guidance, low-confidence advisory, transient helper copy.
- Toast + inline: permission denied, network/no-speech errors (toast confirms event; inline explains recovery action).
- Toast only: non-actionable success confirmations such as `Dictation stopped`.

### Deterministic low-tap quick-intent flows (required)

Gold-star flow target:
1. Open modal from player row via Gold Star action.
2. Gold-star note type preselected.
3. Start Dictation immediately available as primary control.
4. Stop Dictation stays visible; Save Note follows in fixed footer.
5. Completion target: <= 4 taps for common case (open, start, stop, save).

Yellow-card flow target:
1. Open modal from player row via Yellow Card action.
2. Yellow-card note type preselected.
3. Same deterministic control order and <= 4 taps common-case target.

Determinism rules:
1. No control reordering while recording.
2. Save button position fixed between states.
3. If dictation unavailable, focus lands on textarea with fallback guidance visible and Save path unchanged.

#### Explicit save guarantee
- Voice lifecycle events must not call save handlers.
- Only existing Save button triggers persistence.

### Accessibility and interaction notes
- Mic toggle is a standard button with clear accessible name and pressed state.
- Status text should be exposed to assistive tech using `aria-live="polite"`.
- Existing keyboard and manual textarea behavior remains unchanged.

## File-by-File Change List

### 1) src/components/GameManagement/PlayerNotesPanel.tsx
- Add voice-recognition UI controls and state to live note modal.
- Integrate a new hook for speech recognition lifecycle.
- Enforce 500-char max in textarea and Save path.
- Apply dictated text normalization before merge.
- Ensure dictated text merges into `noteText` without auto-save.
- Add quick-intent quality-of-life defaults for `gold-star` and `yellow-card`:
  - optional note-type-specific starter prompts/placeholders.
  - keep existing note type selection and secure save payload unchanged.
- Add inline low-confidence warning display.
- Add unsupported/permission guidance messaging.
- Implement sticky control rail and fixed footer actions for phone modal behavior.
- Ensure one-tap Stop stays visible with keyboard open.
- Implement transient state disabled behavior (`starting`, `stopping`, `finalizing`) and helper copy.
- Implement accessibility contract: initial focus, focus return, aria-live channel split, stable accessible names.
- Apply message hierarchy/collision logic and toast-vs-inline mapping.
- Ensure modal close path triggers speech cleanup and idempotent finalization.

### 2) src/components/GameManagement/hooks/useSpeechToText.ts (new)
- Encapsulate browser speech API feature detection and event handling.
- Implement explicit FSM with allowed transitions and terminal reason handling.
- Expose:
  - support/gating status and fallback reason
  - listening/FSM status
  - transcript updates (interim and final)
  - confidence signal
  - start/stop/toggle functions
  - normalized error codes for UI mapping
- Force `lang = 'en-US'`.
- Provide defensive cleanup on unmount, modal close, and `visibilitychange`/`pagehide`.

### 3) src/components/GameManagement/hooks/useSpeechToText.test.ts (new)
- Unit tests for capability detection, lifecycle transitions, and error mapping.
- FSM transition validity tests, including duplicate terminal event idempotency.
- Race/event-sequence tests (manual stop + onend + timeout ordering).
- Timeout and visibility/pagehide cleanup tests.

### 4) src/components/GameManagement/PlayerNotesPanel.test.tsx
- Add component tests for:
  - mic control render when supported
  - fallback helper text when unsupported/insecure context
  - one-tap start/stop toggle behavior and rapid repeated toggles
  - transcript propagation and normalization into textarea
  - 500-char clamp behavior and truncation warning
  - low-confidence warning rendering
  - permission denied / timeout warning state handling
  - modal close while recording triggers cleanup
  - explicit save-only persistence (voice events never call create/update mutation)
  - 44x44 minimum tap-target assertions for actionable controls
  - keyboard-open simulation ensuring Stop remains visible and actionable
  - initial focus and focus-return contract assertions
  - aria-live polite/assertive routing assertions for mapped messages
  - transient state disablement and helper copy assertions
  - message collision priority assertions (error over advisory over hints)
  - deterministic low-tap quick-intent path assertions for gold-star and yellow-card

### 5) src/App.css
- Add styles for voice UI states in the existing modal:
  - mic button default/active/disabled
  - recording indicator
  - confidence warning text
  - helper/fallback text
  - character count and truncation warning
- Ensure mobile-first spacing/readability for iPhone portrait widths.
- Add modal bottom-sheet, sticky control rail, fixed footer, and safe-area padding rules.
- Add tap target and spacing token-aligned styles that guarantee minimum 44x44 controls.

### 6) docs/specs/UI-SPEC.md
- Add section defining voice note capture behavior for live notes:
  - support matrix expectations for iPhone Safari/Chrome
  - iOS capability gating acceptance criteria
  - explicit save requirement
  - low-confidence warning behavior
  - normalization and 500-char enforcement behavior
  - fallback behavior when unsupported/offline/denied
  - phone modal bottom-sheet pattern and keyboard-open visibility rules
  - transient state contract (`starting`, `stopping`, `finalizing`) and disabled behavior
  - accessibility interaction contract (focus and aria-live rules)
  - message hierarchy/collision rules and toast-vs-inline mapping
  - deterministic quick-intent flow/tap-count targets for gold-star and yellow-card
  - token alignment and responsive acceptance criteria on iPhone Safari/Chrome with keyboard open

### 7) Optional telemetry (only if existing analytics pattern is preferred)
- src/utils/analytics.ts and/or caller points in PlayerNotesPanel
  - Track `voice_note_started`, `voice_note_stopped`, `voice_note_low_confidence`, `voice_note_error`.
  - Keep payload non-sensitive (no transcript text).

## Data Model and API Impact
- No schema changes required in `amplify/data/resource.ts`.
- No backend Lambda contract changes required.
- Existing secure mutation path remains authoritative and unchanged:
  - `mutations.createGameNote(...)` and `mutations.updateGameNote(...)` via `useOfflineMutations`
  - backend secure note handlers currently used by those mutations
- No additional persistence fields for confidence/transcript metadata in v1.

## Dependencies and Sequencing
1. Confirm UI-SPEC acceptance wording for phone modal, safe-area, aria-live rules, quick-intent tap-count targets, and end-cue behavior.
2. Implement speech hook (`useSpeechToText`) with explicit FSM and tests first.
3. Integrate hook into `PlayerNotesPanel` UI states (including transient states), accessibility contract, 500-char enforcement, and end-cue handling.
4. Implement modal layout styles (bottom-sheet, sticky controls, safe-area, 44x44 targets) and keyboard-open behavior.
5. Expand `PlayerNotesPanel` tests for collision rules, focus behavior, deterministic low-tap flows, and end-cue behavior.
6. Update UI spec docs with full alignment criteria.
7. Run targeted tests, then full commit gate (`npm run gate:commit`).

## Expanded Test Strategy

### Unit tests
- Hook-focused tests for speech API wrapper:
  - support detection (`SpeechRecognition` vs `webkitSpeechRecognition` vs unavailable)
  - secure-context + user-gesture gating behavior
  - FSM state transitions (valid and rejected transitions)
  - idempotent terminal handling (manual stop/timeout/onend/onerror/modal close)
  - race/event-sequence ordering (e.g., manual stop followed immediately by onend)
  - rapid start/stop toggle stress behavior
  - result parsing (interim/final), normalization pipeline, and 500-char clamp
  - confidence threshold and warning signal
  - error mapping (`not-allowed`, `network`, `no-speech`, aborted)
  - visibility/pagehide cleanup

### Component tests
- `PlayerNotesPanel` rendering and interaction tests:
  - voice controls visible only when all capability gates pass
  - helper text shown in fallback-only mode
  - dictated text remains manually editable
  - low-confidence warning appears but does not block Save
  - Save button required for persistence
  - voice events never persist notes without explicit Save
  - modal close cleanup stops active session and removes listeners
  - offline/manual fallback path remains functional

### Device/manual tests (required for iPhone Safari + Chrome)
- Matrix:
  - iPhone Safari online supported path: start/stop, transcript quality, low-confidence warning path
  - iPhone Chrome online supported path: same scenarios
  - iPhone Safari/Chrome unsupported path (API unavailable/insecure context): fallback-only behavior accepted
  - iPhone Safari/Chrome offline: graceful fallback, manual note save still works
  - permission denied path: inline + toast guidance, no crash
  - modal close while recording: recording stops and resources clean up
  - app background/pagehide while recording: session finalizes safely and does not auto-save
  - keyboard open in modal on iPhone Safari/Chrome: Stop control visible and tappable without scroll
  - safe-area/home-indicator devices: Save/Cancel actions remain tappable and not clipped
  - quick-intent gold-star and yellow-card common path completes within tap-count target

### UI-SPEC alignment criteria (explicit)
1. Uses existing design tokens for spacing, color, and typography; no one-off hardcoded visual values outside established token exceptions.
2. Every interactive control in the note modal meets minimum 44x44 target requirement.
3. Responsive acceptance validated on iPhone Safari and iPhone Chrome with software keyboard open.
4. Message hierarchy and aria-live behavior match documented contract in UI-SPEC.
5. Unsupported-state copy includes English-only guidance and non-blocking manual typing/OS dictation route.

### Regression checks
- Existing live note create flow for all note types remains intact.
- Existing secure create/update note mutation tests remain green.
- No behavior change to pre-game coaching note modal.

## Risks and Mitigations
1. Browser API variability on iOS and webviews.
   - Mitigation: strict runtime feature detection + explicit fallback-only acceptance criteria.
2. Event-order races causing stale state or duplicate stop handling.
   - Mitigation: explicit FSM with transition guard + idempotent `finalizeSession(reason)`.
3. Confidence score inconsistency across engines.
   - Mitigation: treat confidence as advisory only; never block save.
4. Dictation lifecycle leaks (mic left active after modal close/backgrounding).
   - Mitigation: cleanup on unmount/close and stop on `visibilitychange`/`pagehide`.
5. Potential accidental persistence if events are miswired.
   - Mitigation: tests proving voice events cannot call mutation methods and only Save persists.
6. Backend rejection due to note length overflow.
   - Mitigation: client normalization and hard 500-char clamp on both input and save.

## Out of Scope (v1)
- Non-English language support.
- Background transcription when app/tab not active.
- Legal/privacy policy updates and transcript retention policy work.
- Backend storage of transcript confidence metadata.
